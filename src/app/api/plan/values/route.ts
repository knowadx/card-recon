import { prisma } from "@/lib/db";
import { getChartMonthlyValues } from "@/lib/chartData";

// GET ?from=2026-01&to=2026-12
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

  const series = await prisma.planSeries.findMany({
    include: {
      values: from && to
        ? { where: { month: { gte: from, lte: to } }, orderBy: { month: "asc" } }
        : { orderBy: { month: "asc" } },
      chartLinks: { include: { chart: { select: { id: true, name: true } } } },
    },
    orderBy: { order: "asc" },
  });

  // Build month→value map for all manual series
  const valueMap: Record<string, Record<string, number>> = {};
  for (const s of series) {
    valueMap[s.id] = {};
    for (const v of s.values) {
      valueMap[s.id][v.month] = v.value;
    }
  }

  // Pre-fetch chart metadata (names) and data for formula operands
  const chartIds = new Set<string>();
  for (const s of series) {
    if (s.formulaChartAId) chartIds.add(s.formulaChartAId);
    if (s.formulaChartBId) chartIds.add(s.formulaChartBId);
  }
  const chartValueMap: Record<string, Record<string, number>> = {};
  const chartNameMap: Record<string, string> = {};
  if (chartIds.size > 0) {
    const chartMeta = await prisma.dashboardChart.findMany({
      where: { id: { in: Array.from(chartIds) } },
      select: { id: true, name: true },
    });
    for (const c of chartMeta) chartNameMap[c.id] = c.name;
    if (from && to) {
      await Promise.all(
        Array.from(chartIds).map(async chartId => {
          chartValueMap[chartId] = await getChartMonthlyValues(chartId, from, to, true);
        })
      );
    }
  }

  // Helper: resolve operand map (series or chart)
  const resolveMap = (seriesId: string | null, chartId: string | null): Record<string, number> => {
    if (chartId) return chartValueMap[chartId] ?? {};
    if (seriesId) return valueMap[seriesId] ?? {};
    return {};
  };

  // For formula series, compute derived values
  const result = series.map(s => {
    if (!s.formulaOp) return s;
    const hasA = s.formulaSeriesAId || s.formulaChartAId;
    const hasB = s.formulaSeriesBId || s.formulaChartBId;
    if (!hasA || !hasB) return s;

    const aMap = resolveMap(s.formulaSeriesAId, s.formulaChartAId);
    const bMap = resolveMap(s.formulaSeriesBId, s.formulaChartBId);
    const allMonths = new Set([...Object.keys(aMap), ...Object.keys(bMap)]);

    const derivedValues = Array.from(allMonths)
      .filter(m => (!from || m >= from) && (!to || m <= to))
      .sort()
      .map(month => {
        const a = aMap[month];
        const b = bMap[month];
        if (a === undefined || b === undefined) return null;
        let value: number | null = null;
        if (s.formulaOp === "+") value = a + b;
        else if (s.formulaOp === "-") value = a - b;
        else if (s.formulaOp === "*") value = a * b;
        else if (s.formulaOp === "/") value = b !== 0 ? a / b : null;
        if (value === null) return null;
        return { id: `${s.id}:${month}`, seriesId: s.id, month, value };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    const labelA = s.formulaChartAId ? (chartNameMap[s.formulaChartAId] ?? "?") : (series.find(x => x.id === s.formulaSeriesAId)?.name ?? "?");
    const labelB = s.formulaChartBId ? (chartNameMap[s.formulaChartBId] ?? "?") : (series.find(x => x.id === s.formulaSeriesBId)?.name ?? "?");
    return { ...s, values: derivedValues, formulaALabel: labelA, formulaBLabel: labelB };
  });

  return Response.json(result);
}

// POST — batch upsert { values: [{ seriesId, month, value }] }
export async function POST(request: Request) {
  const { values } = await request.json() as {
    values: Array<{ seriesId: string; month: string; value: number | null }>;
  };

  for (const v of values) {
    if (v.value === null || v.value === undefined || (typeof v.value === "string" && (v.value as string).trim() === "") || isNaN(Number(v.value))) {
      await prisma.planSeriesValue.deleteMany({ where: { seriesId: v.seriesId, month: v.month } });
    } else {
      await prisma.planSeriesValue.upsert({
        where: { seriesId_month: { seriesId: v.seriesId, month: v.month } },
        create: { seriesId: v.seriesId, month: v.month, value: Number(v.value) },
        update: { value: Number(v.value) },
      });
    }
  }

  return Response.json({ ok: true });
}
