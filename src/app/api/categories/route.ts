import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const categories = await prisma.category.findMany({
    where: type ? { type } : undefined,
    include: { children: true, parent: true },
    orderBy: { name: "asc" },
  });
  return Response.json(categories);
}

export async function POST(request: Request) {
  const body = await request.json();
  const category = await prisma.category.create({
    data: {
      type: body.type,
      name: body.name,
      code: body.code || null,
      parentId: body.parentId || null,
      color: body.color || "#6366f1",
    },
  });
  return Response.json(category, { status: 201 });
}
