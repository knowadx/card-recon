import { prisma } from "@/lib/db";

// POST — link a series to a chart  { chartId, seriesId }
export async function POST(request: Request) {
  const { chartId, seriesId } = await request.json();
  const count = await prisma.chartSeriesLink.count({ where: { chartId } });
  const link = await prisma.chartSeriesLink.create({
    data: { chartId, seriesId, order: count },
    include: { series: true },
  });
  return Response.json(link, { status: 201 });
}

// PATCH — update link fields { chartId, seriesId, yAxis }
export async function PATCH(request: Request) {
  const { chartId, seriesId, yAxis } = await request.json();
  const link = await prisma.chartSeriesLink.update({
    where: { chartId_seriesId: { chartId, seriesId } },
    data: { yAxis },
    include: { series: true },
  });
  return Response.json(link);
}

// DELETE — unlink { chartId, seriesId }
export async function DELETE(request: Request) {
  const { chartId, seriesId } = await request.json();
  await prisma.chartSeriesLink.deleteMany({ where: { chartId, seriesId } });
  return Response.json({ ok: true });
}
