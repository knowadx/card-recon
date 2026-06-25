import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scopedCompanyIds } from "@/lib/auth";
import { CHECK_FLOOR } from "@/lib/metaCharges";
import { loadRateMap, toUsd } from "@/lib/exchangeRates";

export const dynamic = "force-dynamic";

/** GET /api/checagem?company=<id> — comparação de gasto: o que o Meta diz × o que foi cobrado na conta (sem match). */
export async function GET(request: Request) {
  const scope = await scopedCompanyIds();
  const params = new URL(request.url).searchParams;
  const company = params.get("company");
  const account = params.get("account");
  // filtro: conta específica > empresa > escopo do usuário
  const accountWhere = account
    ? { id: account }
    : company
      ? { companyId: company }
      : scope === "all"
        ? null
        : { companyId: { in: scope } };
  const base = { isMetaCharge: true, date: { gte: CHECK_FLOOR }, ...(accountWhere ? { account: accountWhere } : {}) };

  const [metaAccts, metaCharges, metaChargeCount, ops, metaAcctCards, allMetaTx, companies, accounts, allMetaCharges, receiptRefs, rateMap] = await Promise.all([
    prisma.metaAdAccount.count(),
    prisma.metaBillingCharge.findMany({ where: { chargedAt: { gte: CHECK_FLOOR } }, orderBy: { chargedAt: "desc" }, take: 2000 }),
    prisma.metaBillingCharge.count({ where: { chargedAt: { gte: CHECK_FLOOR } } }),
    prisma.operation.findMany({ select: { id: true, name: true } }),
    prisma.metaAdAccount.findMany({ select: { accountId: true, fundingCardLast4: true } }),
    prisma.transaction.findMany({ where: base, select: { date: true, amount: true, currency: true, billAmount: true, billCurrency: true, accountId: true, metaRef: true, account: { select: { name: true, company: { select: { name: true } } } } } }),
    prisma.company.findMany({ where: scope === "all" ? {} : { id: { in: scope } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.account.findMany({ where: scope === "all" ? {} : { companyId: { in: scope } }, select: { id: true, name: true, company: { select: { name: true } } }, orderBy: { name: "asc" } }),
    prisma.metaBillingCharge.findMany({ where: { chargedAt: { gte: CHECK_FLOOR } }, select: { transactionId: true, amountUsd: true, currency: true, chargedAt: true, accountId: true, accountName: true, bmName: true, bmId: true } }),
    prisma.metaReceipt.findMany({ where: { referenceNumber: { not: null } }, select: { transactionId: true, referenceNumber: true } }),
    loadRateMap(),
  ]);
  // código do recibo (referenceNumber) por transactionId — pra exibir na tabela de cobranças do Meta
  const refByTx = new Map(receiptRefs.map((r) => [r.transactionId, r.referenceNumber]));
  // "identificada" = metaRef do extrato casa com o referenceNumber de uma COBRANÇA do Meta (não só recibo solto).
  // refSet = códigos de recibo cujo transactionId existe numa MetaBillingCharge.
  const metaTxIds = new Set(allMetaCharges.map((c) => c.transactionId));
  const refSet = new Set(receiptRefs.filter((r) => metaTxIds.has(r.transactionId)).map((r) => r.referenceNumber!.toLowerCase()));

  // comparação por mês: gasto que o Meta diz × gasto cobrado na conta (USD, sem match)
  const months = new Set<string>();
  const monthlyMap = new Map<string, { bankUsd: number; metaUsd: number; bankCount: number; metaCount: number; idCount: number; idUsd: number }>();
  const getRow = (m: string) => {
    let row = monthlyMap.get(m);
    if (!row) { row = { bankUsd: 0, metaUsd: 0, bankCount: 0, metaCount: 0, idCount: 0, idUsd: 0 }; monthlyMap.set(m, row); }
    return row;
  };
  // lado conta (cobrado no extrato): billAmount (moeda original) quando há, senão o valor da transação
  const bankAcctMap = new Map<string, { name: string; company: string | null; count: number; totalUsd: number; byMonth: Record<string, number> }>();
  for (const t of allMetaTx) {
    const m = t.date.toISOString().slice(0, 7); months.add(m);
    const amt = t.billAmount != null ? t.billAmount : Math.abs(t.amount);
    const cur = (t.billAmount != null ? t.billCurrency : t.currency) || t.currency;
    const usd = toUsd(amt, cur, m, rateMap);
    const mr = getRow(m); mr.bankUsd += usd; mr.bankCount++;
    if (t.metaRef && refSet.has(t.metaRef.toLowerCase())) { mr.idCount++; mr.idUsd += usd; } // identificada (tem recibo)
    let row = bankAcctMap.get(t.accountId);
    if (!row) { row = { name: t.account?.name ?? "?", company: t.account?.company?.name ?? null, count: 0, totalUsd: 0, byMonth: {} }; bankAcctMap.set(t.accountId, row); }
    row.count++; row.totalUsd += usd; row.byMonth[m] = (row.byMonth[m] ?? 0) + usd;
  }
  // lado Meta (gasto que o Meta diz)
  const metaAcctMap = new Map<string, { name: string; accountId: string; bm: string | null; bmId: string | null; count: number; totalUsd: number; byMonth: Record<string, number> }>();
  for (const ch of allMetaCharges) {
    const m = ch.chargedAt.toISOString().slice(0, 7); months.add(m);
    const usd = toUsd(ch.amountUsd, ch.currency, m, rateMap);
    const mr = getRow(m); mr.metaUsd += usd; mr.metaCount++;
    let row = metaAcctMap.get(ch.accountId);
    if (!row) { row = { name: ch.accountName ?? "?", accountId: ch.accountId, bm: ch.bmName, bmId: ch.bmId, count: 0, totalUsd: 0, byMonth: {} }; metaAcctMap.set(ch.accountId, row); }
    row.count++; row.totalUsd += usd; row.byMonth[m] = (row.byMonth[m] ?? 0) + usd;
  }
  const monthly = Array.from(monthlyMap.entries())
    .map(([month, v]) => ({ month, metaUsd: v.metaUsd, bankUsd: v.bankUsd, diffUsd: v.bankUsd - v.metaUsd, metaCount: v.metaCount, bankCount: v.bankCount, idCount: v.idCount, idUsd: v.idUsd }))
    .sort((a, b) => b.month.localeCompare(a.month));
  const monthList = Array.from(months).sort((a, b) => b.localeCompare(a));
  const bankByAccount = Array.from(bankAcctMap.values()).sort((a, b) => b.totalUsd - a.totalUsd);
  const metaByAccount = Array.from(metaAcctMap.values()).sort((a, b) => b.totalUsd - a.totalUsd);
  const totalMetaUsd = metaByAccount.reduce((s, r) => s + r.totalUsd, 0);
  const totalBankUsd = bankByAccount.reduce((s, r) => s + r.totalUsd, 0);

  const opName = new Map(ops.map((o) => [o.id, o.name]));
  const fundingByAcct = new Map(metaAcctCards.map((a) => [a.accountId, a.fundingCardLast4]));

  return NextResponse.json({
    companies,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, company: a.company?.name ?? null })),
    totals: { metaUsd: totalMetaUsd, bankUsd: totalBankUsd, diffUsd: totalBankUsd - totalMetaUsd },
    monthly,
    absMonths: monthList,
    bankByAccount,
    metaByAccount,
    metaAccounts: metaAccts,
    metaChargeCount,
    metaCharges: metaCharges.map((m) => ({
      id: m.id,
      transactionId: m.transactionId,
      referenceNumber: refByTx.get(m.transactionId) ?? null, // código do recibo (= metaRef do extrato)
      date: m.chargedAt.toISOString().slice(0, 10),
      amount: m.amountUsd,
      currency: m.currency,
      account: m.accountName,
      accountId: m.accountId,
      bm: m.bmName,
      bmId: m.bmId,
      operation: m.operationId ? opName.get(m.operationId) ?? null : null,
      fundingCard: fundingByAcct.get(m.accountId) ?? null, // cartão de funding primário (Meta) — referência
    })),
  });
}
