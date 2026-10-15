import { prisma } from "@/lib/db";
import { isSuperadmin } from "@/lib/auth";
import { AccessError, assertHolding, companyScope, guarded, requireUser } from "@/lib/access";

export const GET = guarded(async () => {
  try {
    const user = await requireUser();
    const companies = await prisma.company.findMany({
      where: await companyScope(user),
      include: { holding: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    });
    return Response.json(companies);
  } catch (e) {
    if (e instanceof AccessError) throw e;
    console.error(e);
    return Response.json({ error: "Erro interno" }, { status: 500 });
  }
});

export const POST = guarded(async (request: Request) => {
  const user = await requireUser();
  const body = await request.json();
  // Empresa nasce dentro de uma holding sua. "Sem holding" só o administrador geral cria
  // (para os demais ela ficaria invisível logo depois de criada).
  if (body.holdingId) await assertHolding(user, body.holdingId);
  else if (!isSuperadmin(user.role)) throw new AccessError(403, "escolha a holding da empresa");
  const company = await prisma.company.create({
    data: { name: body.name, cnpj: body.cnpj || null, color: body.color || "#6366f1", holdingId: body.holdingId || null },
  });
  return Response.json(company, { status: 201 });
});
