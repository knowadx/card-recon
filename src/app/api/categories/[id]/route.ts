import { prisma } from "@/lib/db";
import { guarded, requireSuperadmin } from "@/lib/access";

type Ctx = { params: Promise<{ id: string }> };

// Categorias = configuração global: só o administrador geral altera.
export const PUT = guarded(async (request: Request, { params }: Ctx) => {
  await requireSuperadmin();
  const { id } = await params;
  const body = await request.json();
  const category = await prisma.category.update({
    where: { id },
    data: { name: body.name, code: body.code || null, parentId: body.parentId || null, color: body.color, plSection: body.plSection ?? null },
  });
  return Response.json(category);
});

export const DELETE = guarded(async (_req: Request, { params }: Ctx) => {
  await requireSuperadmin();
  const { id } = await params;
  await prisma.category.delete({ where: { id } });
  return new Response(null, { status: 204 });
});
