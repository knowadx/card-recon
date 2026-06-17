import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scopedCompanyIds } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/checagem — resumo da checagem + transações leak/review (escopado por empresa). */
export async function GET() {
  const scope = await scopedCompanyIds();
  const companyWhere = scope === "all" ? {} : { account: { companyId: { in: scope } } };

  const base = { isMetaCharge: true, ...companyWhere };

  const [leak, review, okSample, okCount, metaAccts, metaWithCard, whitelist] = await Promise.all([
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
    prisma.transaction.findMany({
      where: { ...base, metaCheck: "ok" },
      include: { account: { include: { company: true } }, operation: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 200,
    }),
    prisma.transaction.count({ where: { ...base, metaCheck: "ok" } }),
    prisma.metaAdAccount.count(),
    prisma.metaAdAccount.findMany({
      where: { NOT: { fundingCardLast4: null } },
      select: {
        fundingCardLast4: true, fundingCardBrand: true, accountId: true, bmName: true, bmId: true,
        name: true, currency: true, amountSpent: true, operation: { select: { name: true } },
      },
      orderBy: [{ fundingCardLast4: "asc" }, { amountSpent: "desc" }],
    }),
    prisma.cardWhitelist.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  const map = (t: (typeof leak)[number]) => ({
    id: t.id,
    date: t.date.toISOString().slice(0, 10),
    description: t.description,
    amount: Math.abs(t.amount),
    currency: t.currency,
    cardLast4: t.cardLast4,
    account: t.account?.name ?? null,
    company: t.account?.company?.name ?? null,
    operation: t.operation?.name ?? null,
    validatedBy: t.metaCheckNote ?? null,
  });

  // mapa cartão → onde gasta (Conta + BM com IDs, operação, gasto) — auto (funding) + manual (whitelist)
  const combos = [
    ...metaWithCard.map((a) => ({
      last4: a.fundingCardLast4,
      brand: a.fundingCardBrand,
      account: a.name,
      accountId: a.accountId,
      bm: a.bmName,
      bmId: a.bmId,
      operation: a.operation?.name ?? null,
      currency: a.currency,
      spent: a.amountSpent != null ? a.amountSpent / 100 : null,
      source: "meta",
    })),
    ...whitelist.map((w) => ({
      last4: w.last4, brand: null, account: w.label, accountId: null, bm: null, bmId: null,
      operation: null, currency: null, spent: null, source: "manual",
    })),
  ];

  return NextResponse.json({
    counts: { leak: leak.length, review: review.length, ok: okCount },
    leak: leak.map(map),
    review: review.map(map),
    okSample: okSample.map(map),
    combos,
    metaAccounts: metaAccts,
    whitelist,
  });
}
