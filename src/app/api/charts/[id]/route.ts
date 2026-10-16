import { prisma } from "@/lib/db";
import { guarded, requireSuperadmin } from "@/lib/access";

type Ctx = { params: Promise<{ id: string }> };

// Gráficos = configuração global: só o administrador geral altera.
export const PUT = guarded(async (request: Request, { params }: Ctx) => {
  await requireSuperadmin();
  const { id } = await params;
  const { name, color, unit, format, lines } = await request.json();
  await prisma.dashboardChartLine.deleteMany({ where: { chartId: id } });
  const chart = await prisma.dashboardChart.update({
    where: { id },
    data: {
      name,
      color,
      unit: unit || "currency",
      format: format || "auto",
      lines: {
        create: (lines ?? []).map((l: { categoryId: string; factor: number; yAxis?: string }, i: number) => ({
          categoryId: l.categoryId,
          factor: l.factor ?? 1,
          yAxis: l.yAxis ?? "left",
          order: i,
        })),
      },
    },
    include: { lines: { include: { category: true } }, seriesLinks: { include: { series: true } } },
  });
  return Response.json(chart);
});

export const DELETE = guarded(async (_req: Request, { params }: Ctx) => {
  await requireSuperadmin();
  const { id } = await params;
  await prisma.dashboardChart.delete({ where: { id } });
  return Response.json({ ok: true });
});
