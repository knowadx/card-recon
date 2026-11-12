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
 * payoneer:<Transaction ID> (reimportar não duplica); a moeda é a da linha; o código FACEBK (em qualquer parte da
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
