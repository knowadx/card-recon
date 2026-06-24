import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/metaref-dump — lista os metaRef capturados (com cartão/valor/data) e a
 * quebra [4 transação][3 conta][3 cartão]. Serve p/ verificar a extração e analisar o hash.
 * Exige login.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const metaTotal = await prisma.transaction.count({ where: { isMetaCharge: true } });
  const withRef = await prisma.transaction.count({ where: { metaRef: { not: null } } });

  const rows = await prisma.transaction.findMany({
    where: { metaRef: { not: null } },
    orderBy: { date: "desc" },
    take: 500,
    select: {
      date: true, amount: true, billAmount: true, billCurrency: true, currency: true,
      cardLast4: true, cardLabel: true, metaRef: true,
      account: { select: { name: true, company: { select: { name: true } } } },
    },
  });

  const parse = (ref: string) => ref.length === 10
    ? { txn: ref.slice(0, 4), acct: ref.slice(4, 7), card: ref.slice(7, 10) }
    : { raw: ref, len: ref.length };

  // verificação: token-de-cartão é estável por last4? quantos tokens-de-conta distintos?
  const cardTokenToLast4: Record<string, Set<string>> = {};
  const acctTokens = new Set<string>();
  for (const r of rows) {
    if (r.metaRef!.length !== 10) continue;
    const card = r.metaRef!.slice(7, 10);
    const acct = r.metaRef!.slice(4, 7);
    acctTokens.add(acct);
    (cardTokenToLast4[card] ??= new Set()).add(r.cardLast4 ?? "—");
  }

  return NextResponse.json({
    metaChargesTotal: metaTotal,
    comMetaRef: withRef,
    taxaCaptura: metaTotal ? `${Math.round((withRef / metaTotal) * 100)}%` : "—",
    tokensContaDistintos: acctTokens.size,
    cardTokenToLast4: Object.fromEntries(Object.entries(cardTokenToLast4).map(([k, v]) => [k, [...v]])),
    amostra: rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      metaRef: r.metaRef,
      ...parse(r.metaRef!),
      last4: r.cardLast4,
      card: r.cardLabel,
      amount: r.amount,
      bill: r.billAmount != null ? `${r.billAmount} ${r.billCurrency ?? ""}`.trim() : null,
      account: r.account?.name ?? null,
      company: r.account?.company?.name ?? null,
    })),
  });
}
