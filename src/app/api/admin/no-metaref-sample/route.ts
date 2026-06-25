import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/no-metaref-sample — mostra a description/reference das cobranças Meta SEM
 * metaRef (Revolut etc.), por conta. Pra ver ONDE (ou se) o código Facebk *XXXX está no texto.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const rows = await prisma.transaction.findMany({
    where: { isMetaCharge: true, metaRef: null },
    take: 40,
    orderBy: { date: "desc" },
    select: { date: true, description: true, reference: true, cardLast4: true, amount: true,
      account: { select: { name: true, bank: true } } },
  });

  // contagem por conta (das sem metaRef)
  const semByAccount: Record<string, number> = {};
  const all = await prisma.transaction.findMany({
    where: { isMetaCharge: true, metaRef: null },
    select: { account: { select: { name: true } } },
  });
  for (const t of all) { const k = t.account?.name ?? "?"; semByAccount[k] = (semByAccount[k] ?? 0) + 1; }

  return NextResponse.json({
    totalSemMetaRef: all.length,
    porConta: semByAccount,
    amostra: rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      bank: r.account?.bank ?? null,
      account: r.account?.name ?? null,
      card: r.cardLast4,
      amount: r.amount,
      description: r.description, // <-- aqui dá pra ver se tem "Facebk *XXXX"
      reference: r.reference,
    })),
  });
}
