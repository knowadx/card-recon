import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scopedCompanyIds } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/checagem — resumo da checagem + transações leak/review (escopado por empresa). */
export async function GET() {
  const scope = await scopedCompanyIds();
  const companyWhere = scope === "all" ? {} : { account: { companyId: { in: scope } } };

  const base = { isMetaCharge: true, ...companyWhere };

  const [leak, review, okCount, metaAccts, whitelist] = await Promise.all([
    prisma.transaction.findMany({
      where: { ...base, metaCheck: "leak" },
      include: { account: { include: { company: true } } },
      orderBy: { date: "desc" },
      take: 500,
    }),
    prisma.transaction.findMany({
      where: { ...base, metaCheck: "review" },
      include: { account: { include: { company: true } } },
      orderBy: { date: "desc" },
      take: 200,
    }),
    prisma.transaction.count({ where: { ...base, metaCheck: "ok" } }),
    prisma.metaAdAccount.count(),
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
  });

  return NextResponse.json({
    counts: { leak: leak.length, review: review.length, ok: okCount },
    leak: leak.map(map),
    review: review.map(map),
    metaAccounts: metaAccts,
    whitelist,
  });
}
