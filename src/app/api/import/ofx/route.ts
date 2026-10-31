import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, assertAccount, guarded, requireUser } from "@/lib/access";
import { isManager } from "@/lib/auth";
import { lerOfx } from "@/lib/ofx";
import { isMetaMerchant, extractMetaRef } from "@/lib/metaCheck";
import { recomputeHasReceipt } from "@/lib/receipts";
import { inicioDoDia, registrarCobertura } from "@/lib/cobertura";

export const dynamic = "force-dynamic";

/**
 * POST /api/import/ofx?accountId=… — corpo: o texto do OFX. Importa o extrato numa conta de banco SEM
 * API — ou de banco com API que AINDA não foi ligado (começou pela XP Empresas; BTG pedido em
 * 2026-10-25). Uma linha por lançamento: reference ofx:<banco>:<conta>:<FITID> (reimportar não
 * duplica). Cada conta usa UMA fonte (a primeira usada). Travas:
 *  - conta já configurada pra sincronizar pela API (syncConfig) não aceita OFX (duplicaria o sync);
 *  - moeda do arquivo diferente da conta = recusa;
 *  - a conta fica LIGADA à conta do primeiro OFX: arquivo de outra conta bancária = recusa.
 * Superadmin e admins (como as outras importações).
 * Cobertura: o período do arquivo (DTSTART–DTEND, dias inteiros; o fim é inclusivo) vira um trecho
 * importado da conta — dia sem lançamento também conta. Sem período no arquivo: do 1º ao último lançamento.
 */
export const POST = guarded(async (request: Request) => {
  const user = await requireUser();
  if (!isManager(user.role)) throw new AccessError(403, "só administradores importam extratos");
  const accountId = new URL(request.url).searchParams.get("accountId") ?? "";
  await assertAccount(user, accountId); // outro grupo = 404
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  if (account.syncConfig) {
    return NextResponse.json({ error: `a conta ${account.name} já sincroniza pela API do ${account.bank} — importar OFX duplicaria os lançamentos` }, { status: 400 });
  }

  const { extrato, erro } = lerOfx(await request.text());
  if (!extrato) return NextResponse.json({ error: erro }, { status: 400 });
  if (extrato.moeda && extrato.moeda !== account.currency) {
    return NextResponse.json({ error: `o OFX é em ${extrato.moeda} e a conta ${account.name} é em ${account.currency} — conta errada?` }, { status: 400 });
  }
  const prefixo = `ofx:${extrato.banco ?? "?"}:${extrato.conta}:`;
  const deOutraConta = await prisma.transaction.findFirst({
    where: { accountId, reference: { startsWith: "ofx:" }, NOT: { reference: { startsWith: prefixo } } },
    select: { reference: true },
  });
  if (deOutraConta) {
    const [, banco, conta] = deOutraConta.reference!.split(":");
    return NextResponse.json({ error: `este OFX é da conta ${extrato.conta} (banco ${extrato.banco ?? "?"}), mas ${account.name} já recebeu extratos da conta ${conta} (banco ${banco}) — conta errada?` }, { status: 400 });
  }

  const dados = extrato.lancamentos.map((l) => ({
    accountId,
    reference: `${prefixo}${l.chave}`, // FITID (ou FITID+valor quando o banco numera por dia — Itaú)
    date: l.data,
    description: l.descricao,
    amount: l.valor,
    fee: 0,
    currency: account.currency,
    isMetaCharge: isMetaMerchant(l.descricao),
    metaRef: extractMetaRef(l.descricao),
  }));
  const { count: gravados } = await prisma.transaction.createMany({ data: dados, skipDuplicates: true });
  if (dados.some((d) => d.isMetaCharge)) await recomputeHasReceipt();

  let filename: string | null = null;
  try { filename = decodeURIComponent(request.headers.get("x-filename") ?? "").slice(0, 200) || null; } catch { filename = null; }
  const resumo = { lancamentos: dados.length, gravados, jaExistiam: dados.length - gravados, linhasDeSaldoIgnoradas: extrato.linhasDeSaldo, contaBanco: `${extrato.banco ?? "?"}/${extrato.agencia ?? "?"}/${extrato.conta}`, conta: account.name, saldo: extrato.saldo };
  const log = await prisma.importLog.create({
    data: { kind: "ofx", filename, userId: user.id, periodFrom: extrato.inicio, periodTo: extrato.fim, companyIds: [account.companyId], summary: JSON.stringify(resumo) },
  });
  const datas = extrato.lancamentos.map((l) => l.data.toISOString().slice(0, 10)).sort();
  const diaDe = extrato.diaInicio ?? datas[0];
  const diaAte = extrato.diaFim ?? datas[datas.length - 1];
  await registrarCobertura({
    accountId, de: inicioDoDia(diaDe), ate: new Date(inicioDoDia(diaAte).getTime() + 86_400_000), fonte: "ofx", userId: user.id, importLogId: log.id,
  });
  return NextResponse.json({ ok: true, ...resumo });
});
