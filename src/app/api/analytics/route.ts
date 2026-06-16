import { prisma } from "@/lib/db";

function monthsBetween(from: string, to: string): string[] {
  const result: string[] = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    result.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return result;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const categoryId = searchParams.get("categoryId");
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

  if (!categoryId || !from || !to) return Response.json({ rows: [], months: [] });

  const rangeStart = new Date(`${from}-01T00:00:00.000Z`);
  const rangeEnd = new Date(`${to}-01T00:00:00.000Z`);
  rangeEnd.setMonth(rangeEnd.getMonth() + 1);
  rangeEnd.setMilliseconds(-1);

  const splits = await prisma.transactionSplit.findMany({
    where: {
      managerialCategoryId: categoryId,
      transaction: { ignored: false },
      OR: [
        { accountingDate: { gte: rangeStart, lte: rangeEnd } },
        { accountingDate: null, transaction: { date: { gte: rangeStart, lte: rangeEnd } } },
      ],
    },
    select: {
      amount: true,
      accountingDate: true,
      transaction: { select: { date: true, description: true } },
    },
  });

  const months = monthsBetween(from, to);

  // Pivot: name → month → sum
  const pivot: Record<string, Record<string, number>> = {};
  for (const split of splits) {
    const name = split.transaction.description?.trim() || "(no name)";
    const date = split.accountingDate ?? split.transaction.date;
    const month = date.toISOString().slice(0, 7);
    if (!pivot[name]) pivot[name] = {};
    pivot[name][month] = (pivot[name][month] || 0) + split.amount;
  }

  // Sort rows by total absolute value descending
  const rows = Object.entries(pivot)
    .map(([name, byMonth]) => ({
      name,
      byMonth,
      total: Object.values(byMonth).reduce((s, v) => s + Math.abs(v), 0),
    }))
    .sort((a, b) => b.total - a.total);

  return Response.json({ rows, months });
}
