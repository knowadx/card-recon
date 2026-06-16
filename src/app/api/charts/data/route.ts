import { prisma } from "@/lib/db";
import { loadRateMap, toUsd } from "@/lib/exchangeRates";
import { getChartMonthlyValues } from "@/lib/chartData";

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
  const convertToUsd = searchParams.get("usd") === "true";

  const now = new Date();
  const defaultFrom = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const defaultTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const from = searchParams.get("from") || defaultFrom;
  const to = searchParams.get("to") || defaultTo;

  const rangeStart = new Date(`${from}-01T00:00:00.000Z`);
  const rangeEnd = new Date(`${to}-01T00:00:00.000Z`);
  rangeEnd.setMonth(rangeEnd.getMonth() + 1);
  rangeEnd.setMilliseconds(-1);

  const [charts, rateMap] = await Promise.all([
    prisma.dashboardChart.findMany({
      include: {
        lines: { include: { category: true }, orderBy: { order: "asc" } },
        seriesLinks: {
          orderBy: { order: "asc" },
          include: {
            series: {
              include: {
                values: { where: { month: { gte: from, lte: to } }, orderBy: { month: "asc" } },
                // include formula fields so we can compute derived series
              },
            },
          },
        },
      },
      orderBy: { order: "asc" },
    }),
    convertToUsd ? loadRateMap() : Promise.resolve({} as Record<string, number>),
  ]);

  const months = monthsBetween(from, to);

  const categoryIds = [...new Set(charts.flatMap(c => c.lines.map(l => l.categoryId)))];

  const splits = categoryIds.length > 0 ? await prisma.transactionSplit.findMany({
    where: {
      managerialCategoryId: { in: categoryIds },
      transaction: {
        ignored: false,
        ...(companyId ? { account: { companyId } } : {}),
      },
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
  }) : [];

  const byCategory: Record<string, Record<string, number>> = {};
  for (const split of splits) {
    const catId = split.managerialCategoryId!;
    const date = split.accountingDate ?? split.transaction.date;
    const month = date.toISOString().slice(0, 7);
    const amount = convertToUsd
      ? toUsd(split.amount, split.transaction.currency, month, rateMap)
      : split.amount;
    if (!byCategory[catId]) byCategory[catId] = {};
    byCategory[catId][month] = (byCategory[catId][month] || 0) + amount;
  }

  // Build manual series value maps for ALL series (formula operands may not be linked to this chart)
  const allLinkedSeries = charts.flatMap(c => c.seriesLinks.map(l => l.series));
  const allSeriesDb = await prisma.planSeries.findMany({
    include: { values: { where: { month: { gte: from, lte: to } } } },
  });
  const manualValueMap: Record<string, Record<string, number>> = {};
  for (const s of allSeriesDb) {
    if (!s.formulaOp) {
      manualValueMap[s.id] = {};
      for (const v of s.values) manualValueMap[s.id][v.month] = v.value;
    }
  }

  // Pre-fetch chart data for any chart used as formula operand
  const formulaChartIds = new Set<string>();
  for (const s of allLinkedSeries) {
    if (s.formulaChartAId) formulaChartIds.add(s.formulaChartAId);
    if (s.formulaChartBId) formulaChartIds.add(s.formulaChartBId);
  }
  const chartOperandMap: Record<string, Record<string, number>> = {};
  await Promise.all(
    Array.from(formulaChartIds).map(async chartId => {
      chartOperandMap[chartId] = await getChartMonthlyValues(chartId, from, to, convertToUsd);
    })
  );

  const resolveSeriesValues = (s: typeof allLinkedSeries[0]): Record<string, number | null> => {
    if (!s.formulaOp) {
      // Manual series
      const map = manualValueMap[s.id] ?? {};
      return Object.fromEntries(months.map(m => [m, map[m] ?? null]));
    }
    // Derived series — compute formula
    const aMap = s.formulaChartAId ? (chartOperandMap[s.formulaChartAId] ?? {}) : (manualValueMap[s.formulaSeriesAId ?? ""] ?? {});
    const bMap = s.formulaChartBId ? (chartOperandMap[s.formulaChartBId] ?? {}) : (manualValueMap[s.formulaSeriesBId ?? ""] ?? {});
    return Object.fromEntries(months.map(m => {
      const a = aMap[m];
      const b = bMap[m];
      if (a === undefined || b === undefined) return [m, null];
      if (s.formulaOp === "+") return [m, a + b];
      if (s.formulaOp === "-") return [m, a - b];
      if (s.formulaOp === "*") return [m, a * b];
      if (s.formulaOp === "/") return [m, b !== 0 ? a / b : null];
      return [m, null];
    }));
  };

  const result = charts.map(chart => {
    const series = months.map(month => {
      const value = chart.lines.reduce((sum, line) => {
        return sum + (byCategory[line.categoryId]?.[month] ?? 0) * line.factor;
      }, 0);
      return { month, value };
    });

    const planSeries = chart.seriesLinks.map(link => {
      const values = resolveSeriesValues(link.series);
      return {
        id: link.series.id,
        name: link.series.name,
        color: link.series.color,
        seriesType: link.series.seriesType,
        unit: link.series.unit,
        format: link.series.format,
        yAxis: link.yAxis ?? "left",
        series: months.map(month => ({ month, value: values[month] ?? null })),
      };
    });

    return {
      id: chart.id,
      name: chart.name,
      color: chart.color,
      unit: chart.unit,
      format: chart.format,
      series,
      targets: planSeries,
    };
  });

  return Response.json({ charts: result, months });
}
