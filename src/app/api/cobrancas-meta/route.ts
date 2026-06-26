import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionScopes } from "@/lib/auth";
import { getCheckFloor } from "@/lib/settings";
import { loadRateMap, toUsd } from "@/lib/exchangeRates";

export const dynamic = "force-dynamic";

/**
 * GET /api/cobrancas-meta — Guia 2: cobranças que o Meta reporta (MetaBillingCharge) das contas
 * que você controla. PURAMENTE lado Meta. Para cada cobrança, cruza pelo transactionId com os
 * PDFs salvos (MetaReceipt) → "Possui PDF" + o código facebk do PDF (pra correlação futura).
 * NÃO cruza com o banco (isso é a Guia 1). Filtros: month, account, pdf (com|sem).
 */
export async function GET(request: Request) {
  const sc = await sessionScopes();
  const params = new URL(request.url).searchParams;
  const month = params.get("month");
  const account = params.get("account");
  const pdf = params.get("pdf"); // "com" | "sem" | null

  const floor = await getCheckFloor();
  let dateRange: { gte: Date; lt?: Date } = { gte: floor };
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const mStart = new Date(`${month}-01T00:00:00.000Z`);
    const mEnd = new Date(mStart); mEnd.setUTCMonth(mEnd.getUTCMonth() + 1);
    dateRange = { gte: mStart > floor ? mStart : floor, lt: mEnd };
  }
  const meses: string[] = [];
  for (let d = new Date(Date.UTC(floor.getUTCFullYear(), floor.getUTCMonth(), 1)), now = new Date(); d <= now; d.setUTCMonth(d.getUTCMonth() + 1)) meses.push(d.toISOString().slice(0, 7));
  meses.reverse();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { chargedAt: dateRange };
  if (!sc.isAdmin) where.operationId = { in: sc.operationIds };
  if (account) where.accountId = account;

  const [charges, receipts, contasCtrl, rateMap] = await Promise.all([
    prisma.metaBillingCharge.findMany({ where, select: { transactionId: true, accountId: true, accountName: true, bmName: true, bmId: true, amountUsd: true, currency: true, chargedAt: true }, orderBy: { chargedAt: "desc" }, take: 5000 }),
    prisma.metaReceipt.findMany({ where: { referenceNumber: { not: null } }, select: { transactionId: true, referenceNumber: true } }),
    prisma.metaAdAccount.findMany({ where: sc.isAdmin ? {} : { operationId: { in: sc.operationIds } }, select: { accountId: true, name: true }, orderBy: { name: "asc" } }),
    loadRateMap(),
  ]);
  const refByTx = new Map(receipts.map((r) => [r.transactionId, r.referenceNumber!]));
  const round2 = (n: number) => Math.round(n * 100) / 100;

  let comPdf = { qtde: 0, usd: 0 };
  let semPdf = { qtde: 0, usd: 0 };
  const rows = charges.map((c) => {
    const usd = toUsd(c.amountUsd, c.currency, c.chargedAt.toISOString().slice(0, 7), rateMap);
    const facebk = refByTx.get(c.transactionId) ?? null;
    const hasPdf = facebk != null;
    if (hasPdf) { comPdf.qtde++; comPdf.usd += usd; } else { semPdf.qtde++; semPdf.usd += usd; }
    return {
      data: c.chargedAt.toISOString().slice(0, 10),
      transactionId: c.transactionId,
      conta: c.accountName, accountId: c.accountId,
      bm: c.bmName, bmId: c.bmId,
      usd: round2(usd), moeda: c.currency,
      hasPdf, facebk,
    };
  }).filter((r) => (pdf === "com" ? r.hasPdf : pdf === "sem" ? !r.hasPdf : true));

  return NextResponse.json({
    piso: floor.toISOString().slice(0, 10),
    mesesDisponiveis: meses,
    contas: contasCtrl, // dropdown de contas controladas
    kpis: {
      contas: contasCtrl.length,
      cobrancas: charges.length,
      totalUsd: round2(charges.reduce((s, c) => s + toUsd(c.amountUsd, c.currency, c.chargedAt.toISOString().slice(0, 7), rateMap), 0)),
      comPdf: { qtde: comPdf.qtde, usd: round2(comPdf.usd) },
      semPdf: { qtde: semPdf.qtde, usd: round2(semPdf.usd) },
      pctComPdf: charges.length ? Math.round((comPdf.qtde / charges.length) * 100) : 0,
    },
    rows,
  });
}
