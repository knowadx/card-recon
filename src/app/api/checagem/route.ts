import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scopedCompanyIds } from "@/lib/auth";
import { CHECK_FLOOR } from "@/lib/chargeMatch";
import { loadRateMap, toUsd } from "@/lib/exchangeRates";

export const dynamic = "force-dynamic";

/** GET /api/checagem?company=<id> — resumo do match + cobranças leak/review (escopado por empresa). */
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

  const [leak, review, okCount, metaAccts, metaCharges, metaChargeCount, ops, metaAcctCards, allMetaTx, companies, accounts, allMetaCharges, rateMap] = await Promise.all([
    prisma.transaction.findMany({
      where: { ...base, metaCheck: "leak" },
      include: { account: { include: { company: true } }, operation: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 500,
    }),
    prisma.transaction.findMany({
      where: { ...base, metaCheck: "review" },
      include: { account: { include: { company: true } }, operation: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 200,
    }),
    prisma.transaction.count({ where: { ...base, metaCheck: "ok" } }),
    prisma.metaAdAccount.count(),
    prisma.metaBillingCharge.findMany({ where: { chargedAt: { gte: CHECK_FLOOR } }, orderBy: { chargedAt: "desc" }, take: 2000 }),
    prisma.metaBillingCharge.count({ where: { chargedAt: { gte: CHECK_FLOOR } } }),
    prisma.operation.findMany({ select: { id: true, name: true } }),
    prisma.metaAdAccount.findMany({ select: { accountId: true, fundingCardLast4: true } }),
    prisma.transaction.findMany({ where: base, select: { date: true, metaCheck: true, amount: true, currency: true, billAmount: true, billCurrency: true, cardLast4: true, cardLabel: true, accountId: true, account: { select: { name: true, company: { select: { name: true } } } } } }),
    prisma.company.findMany({ where: scope === "all" ? {} : { id: { in: scope } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.account.findMany({ where: scope === "all" ? {} : { companyId: { in: scope } }, select: { id: true, name: true, company: { select: { name: true } } }, orderBy: { name: "asc" } }),
    prisma.metaBillingCharge.findMany({ where: { chargedAt: { gte: CHECK_FLOOR } }, select: { amountUsd: true, currency: true, chargedAt: true, accountId: true, accountName: true, bmName: true, bmId: true } }),
    loadRateMap(),
  ]);

  // controle mensal: total de cobranças, status, valor vazado (por moeda) + totais em USD
  const monthlyMap = new Map<string, { ok: number; leak: number; review: number; total: number; leakValue: Record<string, number>; bankUsd: number; metaUsd: number }>();
  const getRow = (m: string) => {
    let row = monthlyMap.get(m);
    if (!row) { row = { ok: 0, leak: 0, review: 0, total: 0, leakValue: {}, bankUsd: 0, metaUsd: 0 }; monthlyMap.set(m, row); }
    return row;
  };
  // lado banco (cobrado no cartão): valor USD = billAmount (moeda original) quando há, senão converte
  for (const t of allMetaTx) {
    const m = t.date.toISOString().slice(0, 7);
    const row = getRow(m);
    row.total++;
    if (t.metaCheck === "ok" || t.metaCheck === "leak" || t.metaCheck === "review") row[t.metaCheck]++;
    if (t.metaCheck === "leak") row.leakValue[t.currency] = (row.leakValue[t.currency] ?? 0) + Math.abs(t.amount);
    const amt = t.billAmount != null ? t.billAmount : Math.abs(t.amount);
    const cur = (t.billAmount != null ? t.billCurrency : t.currency) || t.currency;
    row.bankUsd += toUsd(amt, cur, m, rateMap);
  }
  // lado Meta (registrado nas cobranças do Meta) — em USD
  for (const ch of allMetaCharges) {
    const m = ch.chargedAt.toISOString().slice(0, 7);
    getRow(m).metaUsd += toUsd(ch.amountUsd, ch.currency, m, rateMap);
  }
  const monthly = Array.from(monthlyMap.entries())
    .map(([month, v]) => ({ month, ok: v.ok, leak: v.leak, review: v.review, total: v.total, leakValue: v.leakValue, pending: v.leak + v.review, metaUsd: v.metaUsd, bankUsd: v.bankUsd, diffUsd: v.bankUsd - v.metaUsd }))
    .sort((a, b) => b.month.localeCompare(a.month));
  // diferença por cartão: cobrado no cartão × casado com Meta (ok) × não explicado (leak+review)
  const cardMap = new Map<string, { last4: string | null; label: string | null; total: number; ok: number; pending: number; chargedUsd: number; matchedUsd: number }>();
  for (const t of allMetaTx) {
    const last4 = t.cardLast4 ?? null;
    const key = last4 ?? "—";
    let row = cardMap.get(key);
    if (!row) { row = { last4, label: t.cardLabel ?? null, total: 0, ok: 0, pending: 0, chargedUsd: 0, matchedUsd: 0 }; cardMap.set(key, row); }
    if (!row.label && t.cardLabel) row.label = t.cardLabel;
    row.total++;
    const m = t.date.toISOString().slice(0, 7);
    const amt = t.billAmount != null ? t.billAmount : Math.abs(t.amount);
    const cur = (t.billAmount != null ? t.billCurrency : t.currency) || t.currency;
    const usd = toUsd(amt, cur, m, rateMap);
    row.chargedUsd += usd;
    if (t.metaCheck === "ok") { row.ok++; row.matchedUsd += usd; }
    else if (t.metaCheck === "leak" || t.metaCheck === "review") row.pending++;
  }
  const perCard = Array.from(cardMap.values())
    .map((c) => ({ ...c, diffUsd: c.chargedUsd - c.matchedUsd }))
    .sort((a, b) => b.diffUsd - a.diffUsd);

  // VALOR ABSOLUTO (sem match) — para diagnosticar divergência por mês:
  const months = new Set<string>();
  // (1) cobrado por conta bancária (extrato)
  const bankAcctMap = new Map<string, { name: string; company: string | null; count: number; totalUsd: number; byMonth: Record<string, number> }>();
  for (const t of allMetaTx) {
    const m = t.date.toISOString().slice(0, 7); months.add(m);
    const key = t.accountId;
    let row = bankAcctMap.get(key);
    if (!row) { row = { name: t.account?.name ?? "?", company: t.account?.company?.name ?? null, count: 0, totalUsd: 0, byMonth: {} }; bankAcctMap.set(key, row); }
    const amt = t.billAmount != null ? t.billAmount : Math.abs(t.amount);
    const cur = (t.billAmount != null ? t.billCurrency : t.currency) || t.currency;
    const usd = toUsd(amt, cur, m, rateMap);
    row.count++; row.totalUsd += usd; row.byMonth[m] = (row.byMonth[m] ?? 0) + usd;
  }
  // (2) cobranças por conta de anúncio (Meta)
  const metaAcctMap = new Map<string, { name: string; accountId: string; bm: string | null; bmId: string | null; count: number; totalUsd: number; byMonth: Record<string, number> }>();
  for (const ch of allMetaCharges) {
    const m = ch.chargedAt.toISOString().slice(0, 7); months.add(m);
    const key = ch.accountId;
    let row = metaAcctMap.get(key);
    if (!row) { row = { name: ch.accountName ?? "?", accountId: ch.accountId, bm: ch.bmName, bmId: ch.bmId, count: 0, totalUsd: 0, byMonth: {} }; metaAcctMap.set(key, row); }
    const usd = toUsd(ch.amountUsd, ch.currency, m, rateMap);
    row.count++; row.totalUsd += usd; row.byMonth[m] = (row.byMonth[m] ?? 0) + usd;
  }
  const monthList = Array.from(months).sort((a, b) => b.localeCompare(a));
  const bankByAccount = Array.from(bankAcctMap.values()).sort((a, b) => b.totalUsd - a.totalUsd);
  const metaByAccount = Array.from(metaAcctMap.values()).sort((a, b) => b.totalUsd - a.totalUsd);

  const opName = new Map(ops.map((o) => [o.id, o.name]));
  const fundingByAcct = new Map(metaAcctCards.map((a) => [a.accountId, a.fundingCardLast4]));

  const map = (t: (typeof leak)[number]) => ({
    id: t.id,
    date: t.date.toISOString().slice(0, 10),
    description: t.description,
    amount: Math.abs(t.amount),
    currency: t.currency,
    cardLast4: t.cardLast4,
    cardLabel: t.cardLabel ?? null,
    account: t.account?.name ?? null,
    company: t.account?.company?.name ?? null,
    operation: t.operation?.name ?? null,
    validatedBy: t.metaCheckNote ?? null,
  });

  return NextResponse.json({
    counts: { leak: leak.length, review: review.length, ok: okCount },
    companies,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, company: a.company?.name ?? null })),
    monthly,
    perCard,
    absMonths: monthList,
    bankByAccount,
    metaByAccount,
    leak: leak.map(map),
    review: review.map(map),
    metaAccounts: metaAccts,
    metaChargeCount,
    metaCharges: metaCharges.map((m) => ({
      id: m.id,
      transactionId: m.transactionId,
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
