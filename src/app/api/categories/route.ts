import { prisma } from "@/lib/db";
import { guarded, requireSuperadmin, requireUser } from "@/lib/access";

// Categorias = configuração global: qualquer usuário logado lê; só o administrador geral altera.
export const GET = guarded(async (request: Request) => {
  await requireUser();
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const categories = await prisma.category.findMany({
    where: type ? { type } : undefined,
    include: { children: true, parent: true },
    orderBy: { name: "asc" },
  });
  return Response.json(categories);
});

export const POST = guarded(async (request: Request) => {
  await requireSuperadmin();
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
});
