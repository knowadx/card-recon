import { prisma } from "@/lib/db";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { name, color, seriesType, unit, format, formulaOp, formulaSeriesAId, formulaSeriesBId, formulaChartAId, formulaChartBId } = await request.json();
  const series = await prisma.planSeries.update({
    where: { id },
    data: {
      name, color, seriesType, unit, format,
      formulaOp: formulaOp || null,
      formulaSeriesAId: formulaSeriesAId || null,
      formulaSeriesBId: formulaSeriesBId || null,
      formulaChartAId: formulaChartAId || null,
      formulaChartBId: formulaChartBId || null,
    },
  });
  return Response.json(series);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.planSeries.delete({ where: { id } });
  return Response.json({ ok: true });
}
