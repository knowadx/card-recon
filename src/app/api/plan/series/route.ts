import { prisma } from "@/lib/db";

export async function GET() {
  const series = await prisma.planSeries.findMany({
    include: { chartLinks: { include: { chart: { select: { id: true, name: true } } } } },
    orderBy: { order: "asc" },
  });
  return Response.json(series);
}

export async function POST(request: Request) {
  const { name, color, seriesType, unit, format, formulaOp, formulaSeriesAId, formulaSeriesBId, formulaChartAId, formulaChartBId } = await request.json();
  const count = await prisma.planSeries.count();
  const series = await prisma.planSeries.create({
    data: {
      name,
      color: color || "#f59e0b",
      seriesType: seriesType || "line",
      unit: unit || "currency",
      format: format || "auto",
      order: count,
      formulaOp: formulaOp || null,
      formulaSeriesAId: formulaSeriesAId || null,
      formulaSeriesBId: formulaSeriesBId || null,
      formulaChartAId: formulaChartAId || null,
      formulaChartBId: formulaChartBId || null,
    },
  });
  return Response.json(series, { status: 201 });
}
