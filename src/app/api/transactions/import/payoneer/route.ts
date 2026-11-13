import { prisma } from "@/lib/db";
import { AccessError, RequestError, assertAccount, guarded, requireUser } from "@/lib/access";
import { isManager } from "@/lib/auth";
import { lerPayoneer } from "@/lib/payoneer";
import { isMetaMerchant, extractMetaRef } from "@/lib/metaCheck";
import { recomputeHasReceipt } from "@/lib/receipts";
import { registrarArquivo } from "@/lib/importacaoArquivo";

export const dynamic = "force-dynamic";

/**
 * POST /api/transactions/import/payoneer (form: file, accountId) — extrato completo do Payoneer (com Transaction
 * ID) numa conta Payoneer (src/lib/payoneer.ts). Uma linha por lançamento concluído: reference
 * payoneer:<Transaction ID> (reimportar não duplica); extrato de moeda diferente da conta = recusado; lançamento
 * (Transaction ID + valor) que já está em OUTRA conta = recusado (mesmo arquivo na empresa errada) — o mesmo ID com
 * outro valor é o outro lado de um pagamento entre contas Payoneer e entra; o código FACEBK (em qualquer parte da
 * descrição) vira cobrança Meta. Devolve as quebras na sequência do saldo (falta lançamento no arquivo). O arquivo
 * não diz o período → devolve o sugerido e a tela pergunta (src/lib/importacaoArquivo.ts). Administradores.
 */
export const POST = guarded(async (request: Request) => {
  const user = await requireUser();
  if (!isManager(user.role)) throw new AccessError(403, "só administradores importam extratos");
  const form = await request.formData();
  const file = form.get("file") as File | null;
  const accountId = String(form.get("accountId") ?? "");
  await assertAccount(user, accountId); // outro grupo = 404
  if (!file) throw new RequestError(400, "envie o arquivo CSV do Payoneer");
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  if (account.bank !== "Payoneer") throw new RequestError(400, `a conta ${account.name} não é do Payoneer`);

  const { extrato, erro } = lerPayoneer(await file.text());
  if (!extrato) throw new RequestError(400, erro ?? "arquivo inválido");
  // uma conta por moeda (decisão do dono em 2026-11-12: o Payoneer exporta USD e EUR em extratos separados e o
  // "importado até…" é por conta) → extrato de outra moeda é recusado inteiro, antes de gravar qualquer coisa
  const outras = [...new Set(extrato.lancamentos.map((l) => l.moeda).filter((m) => m !== account.currency))];
  if (outras.length) {
    throw new RequestError(400, `o extrato tem lançamentos em ${outras.join(", ")} e a conta ${account.name} é em ${account.currency} — conta errada? (cada moeda do Payoneer é uma conta aqui)`);
  }

  // o extrato não diz de quem é a conta (Pixel Ads e LinkView têm Payoneer): se algum lançamento dele já está em
  // OUTRA conta, é o mesmo arquivo subido na empresa errada → recusa inteiro (dono, 2026-11-12). "O mesmo
  // lançamento" = mesmo Transaction ID E mesmo valor: pagamento de uma conta Payoneer pra outra tem o MESMO
  // Transaction ID nos dois extratos, com débito no pagador e crédito no recebedor (visto em prod 2026-11-13 num
  // pagamento Pixel → LinkView; só o ID recusava o extrato do pagador inteiro — "extrato com 1 linha não importa")
  const valorPorRef = new Map(extrato.lancamentos.map((l) => [`payoneer:${l.chave}`, l.valor]));
  const centavos = (x: number) => Math.round(x * 100);
  const comOID = await prisma.transaction.findMany({
    where: { reference: { in: [...valorPorRef.keys()] }, accountId: { not: accountId } },
    select: { reference: true, amount: true, account: { select: { name: true, currency: true, company: { select: { name: true } } } } },
  });
  const jaEmOutra = comOID.find((t) => centavos(t.amount) === centavos(valorPorRef.get(t.reference ?? "") ?? NaN));
  if (jaEmOutra) {
    const o = jaEmOutra.account;
    throw new RequestError(409, `esse extrato já foi importado na conta ${o.name} ${o.currency} da ${o.company.name} — conta errada? (o mesmo lançamento não entra em duas contas)`);
  }

  const dados = extrato.lancamentos.map((l) => ({
    accountId,
    reference: `payoneer:${l.chave}`,
    date: l.data,
    description: l.descricao,
    amount: l.valor,
    fee: 0,
    currency: l.moeda || account.currency,
    isMetaCharge: isMetaMerchant(l.descricao),
    metaRef: extractMetaRef(l.descricao),
  }));
  const { count: imported } = await prisma.transaction.createMany({ data: dados, skipDuplicates: true });
  if (dados.some((d) => d.isMetaCharge)) await recomputeHasReceipt();

  const resumo = { imported, skipped: dados.length - imported, naoConcluidos: extrato.naoConcluidos, invalidos: extrato.invalidos, quebrasDeSaldo: extrato.quebrasDeSaldo };
  const arquivo = await registrarArquivo({ kind: "payoneer", filename: file.name, userId: user.id, account, datas: dados.map((d) => d.date), resumo });
  return Response.json({ ...resumo, ...arquivo });
});
