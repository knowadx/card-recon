import { prisma } from "@/lib/db";

export async function GET() {
  const charts = await prisma.dashboardChart.findMany({
    include: {
      lines: { include: { category: true }, orderBy: { order: "asc" } },
      seriesLinks: { include: { series: true }, orderBy: { order: "asc" } },
    },
    orderBy: { order: "asc" },
  });
  return Response.json(charts);
}

// PATCH /api/charts — reorder: { ids: string[] } in desired order
export async function PATCH(request: Request) {
  const { ids } = await request.json() as { ids: string[] };
  await Promise.all(ids.map((id, i) => prisma.dashboardChart.update({ where: { id }, data: { order: i } })));
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  const { name, color, unit, format, lines } = await request.json();
  const count = await prisma.dashboardChart.count();
  const chart = await prisma.dashboardChart.create({
    data: {
      name,
      color: color || "#00b9a5",
      unit: unit || "currency",
      format: format || "auto",
      order: count,
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
  return Response.json(chart, { status: 201 });
}
