import { prisma } from "@/lib/db";
import { guarded, requireSuperadmin } from "@/lib/access";

// Vínculo gráfico↔série = configuração global: só o administrador geral altera.

// POST — link a series to a chart  { chartId, seriesId }
export const POST = guarded(async (request: Request) => {
  await requireSuperadmin();
  const { chartId, seriesId } = await request.json();
  const count = await prisma.chartSeriesLink.count({ where: { chartId } });
  const link = await prisma.chartSeriesLink.create({
    data: { chartId, seriesId, order: count },
    include: { series: true },
  });
  return Response.json(link, { status: 201 });
});

// PATCH — update link fields { chartId, seriesId, yAxis }
export const PATCH = guarded(async (request: Request) => {
  await requireSuperadmin();
  const { chartId, seriesId, yAxis } = await request.json();
  const link = await prisma.chartSeriesLink.update({
    where: { chartId_seriesId: { chartId, seriesId } },
    data: { yAxis },
    include: { series: true },
  });
  return Response.json(link);
});

// DELETE — unlink { chartId, seriesId }
export const DELETE = guarded(async (request: Request) => {
  await requireSuperadmin();
  const { chartId, seriesId } = await request.json();
  await prisma.chartSeriesLink.deleteMany({ where: { chartId, seriesId } });
  return Response.json({ ok: true });
});
