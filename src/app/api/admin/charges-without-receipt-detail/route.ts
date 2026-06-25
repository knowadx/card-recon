import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/charges-without-receipt-detail — lista CADA cobrança Meta sem PDF na pasta
 * (transactionId não existe em MetaReceipt), com detalhe completo.
 *   ?month=2026-05  (default; "all" = todos os meses)
 *   ?account=<accountId>  filtra uma conta
 * Como não há recibo, não dá pra ligar ao cartão do extrato (o elo é o recibo). Mostra o lado Meta.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const month = sp.get("month") ?? "2026-05";
  const account = sp.get("account") || undefined;

  const where: { accountId?: string; chargedAt?: { gte: Date; lt: Date } } = {};
  if (account) where.accountId = account;
  if (month !== "all") {
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
    where.chargedAt = { gte: start, lt: end };
  }

  const [charges, receipts] = await Promise.all([
    prisma.metaBillingCharge.findMany({
      where,
      select: { transactionId: true, accountId: true, accountName: true, bmName: true, bmId: true, amountUsd: true, currency: true, chargedAt: true },
      orderBy: [{ accountName: "asc" }, { chargedAt: "asc" }],
    }),
    prisma.metaReceipt.findMany({ select: { transactionId: true } }),
  ]);
  const haveReceipt = new Set(receipts.map((r) => r.transactionId));

  const semPdf = charges.filter((c) => !haveReceipt.has(c.transactionId));
  const totalUsd = semPdf.reduce((s, c) => s + c.amountUsd, 0);

  // agrupado por conta (resumo) + lista plana detalhada
  const porConta = new Map<string, { name: string | null; bm: string | null; qtde: number; usd: number }>();
  for (const c of semPdf) {
    const r = porConta.get(c.accountId) ?? { name: c.accountName, bm: c.bmName, qtde: 0, usd: 0 };
    r.qtde++; r.usd += c.amountUsd; porConta.set(c.accountId, r);
  }

  return NextResponse.json({
    filtro: { month, account: account ?? "(todas)" },
    qtde: semPdf.length,
    totalUsd: Math.round(totalUsd * 100) / 100,
    porConta: [...porConta.entries()].map(([accountId, v]) => ({ accountId, ...v, usd: Math.round(v.usd * 100) / 100 })).sort((a, b) => b.qtde - a.qtde),
    transacoes: semPdf.map((c) => ({
      data: c.chargedAt.toISOString().slice(0, 10),
      transactionId: c.transactionId,
      usd: c.amountUsd,
      moeda: c.currency,
      conta: c.accountName,
      accountId: c.accountId,
      bm: c.bmName,
      bmId: c.bmId,
    })),
  });
}
