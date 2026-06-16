import { prisma } from "@/lib/db";
import { loadRateMap, toUsd } from "@/lib/exchangeRates";

/**
 * Returns a month→value map for a DashboardChart's actual transaction totals.
 * Applies line factors (+/-) just like the charts/data API does.
 */
export async function getChartMonthlyValues(
  chartId: string,
  from: string,
  to: string,
  convertToUsd = false,
): Promise<Record<string, number>> {
  const rangeStart = new Date(`${from}-01T00:00:00.000Z`);
  const rangeEnd = new Date(`${to}-01T00:00:00.000Z`);
  rangeEnd.setMonth(rangeEnd.getMonth() + 1);
  rangeEnd.setMilliseconds(-1);

  const [chart, rateMap] = await Promise.all([
    prisma.dashboardChart.findUnique({
      where: { id: chartId },
      include: { lines: { include: { category: true } } },
    }),
    convertToUsd ? loadRateMap() : Promise.resolve({} as Record<string, number>),
  ]);

  if (!chart || chart.lines.length === 0) return {};

  const categoryIds = chart.lines.map(l => l.categoryId);

  const splits = await prisma.transactionSplit.findMany({
    where: {
      managerialCategoryId: { in: categoryIds },
      transaction: { ignored: false },
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
  });

  const byCategory: Record<string, Record<string, number>> = {};
  for (const split of splits) {
    const catId = split.managerialCategoryId!;
    const date = split.accountingDate ?? split.transaction.date;
    const month = date.toISOString().slice(0, 7);
    const amount = convertToUsd
      ? toUsd(split.amount, split.transaction.currency, month, rateMap)
      : split.amount;
    if (!byCategory[catId]) byCategory[catId] = {};
    byCategory[catId][month] = (byCategory[catId][month] ?? 0) + amount;
  }

  const result: Record<string, number> = {};
  for (const line of chart.lines) {
    const catMonths = byCategory[line.categoryId] ?? {};
    for (const [month, val] of Object.entries(catMonths)) {
      result[month] = (result[month] ?? 0) + val * line.factor;
    }
  }
  return result;
}
