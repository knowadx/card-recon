import { prisma } from "@/lib/db";
import { isSuperadmin } from "@/lib/auth";
import { AccessError, assertCompany, assertHolding, guarded, requireUser } from "@/lib/access";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = guarded(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  await assertCompany(user, id);
  const body = await request.json();
  // Mover de holding: o destino tem que ser seu; tirar da holding, só o administrador geral.
  if (body.holdingId) await assertHolding(user, body.holdingId);
  else if (body.holdingId !== undefined && !isSuperadmin(user.role)) {
    throw new AccessError(403, "só o administrador geral tira uma empresa da holding");
  }
  const company = await prisma.company.update({
    where: { id },
    data: {
      name: body.name,
      cnpj: body.cnpj || null,
      color: body.color,
      ...(body.holdingId !== undefined ? { holdingId: body.holdingId || null } : {}),
    },
  });
  return Response.json(company);
});

export const DELETE = guarded(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  await assertCompany(user, id);
  await prisma.company.delete({ where: { id } });
  return new Response(null, { status: 204 });
});
