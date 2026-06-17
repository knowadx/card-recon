import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hashPassword, isManager, isSuperadmin, accessibleHoldingIds } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function requireManager() {
  const u = await getCurrentUser();
  return u && isManager(u.role) ? u : null;
}

async function manageScope(user: { id: string; role: string }) {
  if (isSuperadmin(user.role)) return { all: true as const, holdingIds: [] as string[], operationIds: [] as string[] };
  const h = await accessibleHoldingIds(user.id, user.role);
  const holdingIds = h === "all" ? [] : h;
  const ops = await prisma.operation.findMany({ where: { holdingId: { in: holdingIds } }, select: { id: true } });
  return { all: false as const, holdingIds, operationIds: ops.map((o) => o.id) };
}

/** O gestor (não-superadmin) pode tocar neste usuário? Só se está na holding/operação dele e não é superadmin. */
async function canManageTarget(scope: { all: boolean; holdingIds: string[]; operationIds: string[] }, targetId: string) {
  if (scope.all) return true;
  const t = await prisma.user.findUnique({
    where: { id: targetId },
    select: { role: true, memberships: { select: { holdingId: true } }, operationMemberships: { select: { operationId: true } } },
  });
  if (!t || t.role === "superadmin") return false;
  return (
    t.memberships.some((m) => scope.holdingIds.includes(m.holdingId)) ||
    t.operationMemberships.some((m) => scope.operationIds.includes(m.operationId))
  );
}

/** PATCH /api/users/[id] — { role?, isActive?, password?, holdingIds?, operationIds? } */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireManager();
  if (!me) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const scope = await manageScope(me);
  if (!(await canManageTarget(scope, id))) return Response.json({ error: "sem acesso a esse usuário" }, { status: 403 });
  const body = await request.json().catch(() => ({}));

  const data: Record<string, unknown> = {};
  if (body.role) {
    // admin não promove a superadmin
    data.role = body.role === "superadmin" ? (scope.all ? "superadmin" : "member") : body.role === "admin" ? "admin" : "member";
  }
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (body.password) data.passwordHash = hashPassword(String(body.password));
  if (Object.keys(data).length) await prisma.user.update({ where: { id }, data });

  if (Array.isArray(body.holdingIds)) {
    const ids = scope.all ? body.holdingIds : body.holdingIds.filter((h: string) => scope.holdingIds.includes(h));
    // preserva vínculos fora do escopo do admin; substitui só os que ele pode gerenciar
    await prisma.membership.deleteMany({ where: { userId: id, ...(scope.all ? {} : { holdingId: { in: scope.holdingIds } }) } });
    if (ids.length) await prisma.membership.createMany({ data: ids.map((holdingId: string) => ({ userId: id, holdingId })) });
  }
  if (Array.isArray(body.operationIds)) {
    const ids = scope.all ? body.operationIds : body.operationIds.filter((o: string) => scope.operationIds.includes(o));
    await prisma.operationMembership.deleteMany({ where: { userId: id, ...(scope.all ? {} : { operationId: { in: scope.operationIds } }) } });
    if (ids.length) await prisma.operationMembership.createMany({ data: ids.map((operationId: string) => ({ userId: id, operationId })) });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireManager();
  if (!me) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  if (id === me.id) return Response.json({ error: "não pode remover a si mesmo" }, { status: 400 });
  const scope = await manageScope(me);
  if (!(await canManageTarget(scope, id))) return Response.json({ error: "sem acesso a esse usuário" }, { status: 403 });
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
