import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scopedCompanyIds } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/checagem — resumo do match + cobranças leak/review (escopado por empresa). */
export async function GET() {
  const scope = await scopedCompanyIds();
  const companyWhere = scope === "all" ? {} : { account: { companyId: { in: scope } } };
  const base = { isMetaCharge: true, ...companyWhere };

  const [leak, review, okCount, metaAccts, metaCharges, metaChargeCount, ops, metaAcctCards, allMetaTx] = await Promise.all([
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
    prisma.metaBillingCharge.findMany({ orderBy: { chargedAt: "desc" }, take: 2000 }),
    prisma.metaBillingCharge.count(),
    prisma.operation.findMany({ select: { id: true, name: true } }),
    prisma.metaAdAccount.findMany({ select: { accountId: true, fundingCardLast4: true } }),
    prisma.transaction.findMany({ where: base, select: { date: true, metaCheck: true, amount: true, currency: true } }),
  ]);

  // controle mensal: total de cobranças, status e valor vazado (por moeda) por mês
  const monthlyMap = new Map<string, { ok: number; leak: number; review: number; total: number; leakValue: Record<string, number> }>();
  for (const t of allMetaTx) {
    const m = t.date.toISOString().slice(0, 7);
    const row = monthlyMap.get(m) ?? { ok: 0, leak: 0, review: 0, total: 0, leakValue: {} };
    row.total++;
    if (t.metaCheck === "ok" || t.metaCheck === "leak" || t.metaCheck === "review") row[t.metaCheck]++;
    if (t.metaCheck === "leak") row.leakValue[t.currency] = (row.leakValue[t.currency] ?? 0) + Math.abs(t.amount);
    monthlyMap.set(m, row);
  }
  const monthly = Array.from(monthlyMap.entries())
    .map(([month, v]) => ({ month, ...v, pending: v.leak + v.review }))
    .sort((a, b) => b.month.localeCompare(a.month));
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
    monthly,
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
      operation: m.operationId ? opName.get(m.operationId) ?? null : null,
      fundingCard: fundingByAcct.get(m.accountId) ?? null, // cartão de funding primário (Meta) — referência
    })),
  });
}
