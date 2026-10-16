import { prisma } from "@/lib/db";
import { guarded, requireManager } from "@/lib/access";

type Ctx = { params: Promise<{ id: string }> };

// Séries do plano = configuração global: superadmin e admins alteram (member só lê).
export const PUT = guarded(async (request: Request, { params }: Ctx) => {
  await requireManager();
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
});

export const DELETE = guarded(async (_req: Request, { params }: Ctx) => {
  await requireManager();
  const { id } = await params;
  await prisma.planSeries.delete({ where: { id } });
  return Response.json({ ok: true });
});
