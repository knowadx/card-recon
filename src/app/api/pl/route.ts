import { prisma } from "@/lib/db";
import { loadRateMap, toUsd } from "@/lib/exchangeRates";

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
  const companyId = searchParams.get("companyId") || null;
  const now = new Date();
  const from = searchParams.get("from") || `${now.getFullYear()}-01`;
  const to = searchParams.get("to") || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const rangeStart = new Date(`${from}-01T00:00:00.000Z`);
  const rangeEnd = new Date(`${to}-01T00:00:00.000Z`);
  rangeEnd.setMonth(rangeEnd.getMonth() + 1);
  rangeEnd.setMilliseconds(-1);

  const accountFilter = companyId ? { account: { companyId } } : {};

  const [splits, categories, uncategorized, rateMap] = await Promise.all([
    // Categorized splits
    prisma.transactionSplit.findMany({
      where: {
        managerialCategoryId: { not: null },
        transaction: { ignored: false, ...accountFilter },
        OR: [
          { accountingDate: { gte: rangeStart, lte: rangeEnd } },
          { accountingDate: null, transaction: { date: { gte: rangeStart, lte: rangeEnd } } },
        ],
      },
      select: {
        managerialCategoryId: true,
        amount: true,
        accountingDate: true,
        transaction: { select: { date: true, currency: true } },
      },
    }),
    prisma.category.findMany({
      where: { type: { in: ["MANAGERIAL", "managerial"] } },
      orderBy: { name: "asc" },
    }),
    // Transactions with NO managerial category split at all
    prisma.transaction.findMany({
      where: {
        ignored: false,
        ...accountFilter,
        date: { gte: rangeStart, lte: rangeEnd },
        splits: { none: { managerialCategoryId: { not: null } } },
      },
      select: { amount: true, currency: true, date: true },
    }),
    loadRateMap(),
  ]);

  const months = monthsBetween(from, to);

  // Aggregate categorized: categoryId → month → amount (USD)
  const byCategory: Record<string, Record<string, number>> = {};
  for (const split of splits) {
    const catId = split.managerialCategoryId!;
    const date = split.accountingDate ?? split.transaction.date;
    const month = date.toISOString().slice(0, 7);
    const amountUsd = toUsd(split.amount, split.transaction.currency, month, rateMap);
    if (!byCategory[catId]) byCategory[catId] = {};
    byCategory[catId][month] = (byCategory[catId][month] || 0) + amountUsd;
  }

  // Aggregate uncategorized: month → amount (USD)
  const uncatByMonth: Record<string, number> = {};
  for (const tx of uncategorized) {
    const month = tx.date.toISOString().slice(0, 7);
    if (!months.includes(month)) continue;
    uncatByMonth[month] = (uncatByMonth[month] || 0) + toUsd(tx.amount, tx.currency, month, rateMap);
  }
  const uncatTotal = months.reduce((s, m) => s + (uncatByMonth[m] ?? 0), 0);

  const rows = categories
    .filter(c => byCategory[c.id])
    .map(c => ({
      id: c.id,
      name: c.name,
      plSection: c.plSection ?? (c.isInternal ? "internal" : null),
      values: Object.fromEntries(months.map(m => [m, byCategory[c.id]?.[m] ?? 0])),
      total: months.reduce((s, m) => s + (byCategory[c.id]?.[m] ?? 0), 0),
    }));

  const uncategorizedRow = uncatTotal !== 0 ? {
    values: uncatByMonth,
    total: uncatTotal,
    count: uncategorized.length,
  } : null;

  return Response.json({ months, rows, uncategorizedRow });
}
