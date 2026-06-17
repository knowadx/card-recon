import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hashPassword, isManager, isSuperadmin, accessibleHoldingIds } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function requireManager() {
  const u = await getCurrentUser();
  if (!u || !isManager(u.role)) return null;
  return u;
}

/** Holdings que o gestor pode conceder + operações dentro delas. Superadmin = tudo. */
async function manageScope(user: { id: string; role: string }) {
  if (isSuperadmin(user.role)) return { all: true as const, holdingIds: [] as string[], operationIds: [] as string[] };
  const h = await accessibleHoldingIds(user.id, user.role);
  const holdingIds = h === "all" ? [] : h;
  const ops = await prisma.operation.findMany({ where: { holdingId: { in: holdingIds } }, select: { id: true } });
  return { all: false as const, holdingIds, operationIds: ops.map((o) => o.id) };
}

export async function GET() {
  const me = await requireManager();
  if (!me) return Response.json({ error: "forbidden" }, { status: 403 });
  const scope = await manageScope(me);

  const where = scope.all
    ? {}
    : {
        // a "equipe" do admin: quem é membro das holdings dele ou das operações dentro delas (+ ele mesmo),
        // mas nunca superadmins
        AND: [
          { role: { not: "superadmin" } },
          {
            OR: [
              { id: me.id },
              { memberships: { some: { holdingId: { in: scope.holdingIds } } } },
              { operationMemberships: { some: { operationId: { in: scope.operationIds } } } },
            ],
          },
        ],
      };

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "asc" },
    include: {
      memberships: { include: { holding: true } },
      operationMemberships: { include: { operation: true } },
    },
  });
  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isActive: u.isActive,
      holdings: u.memberships.map((m) => ({ id: m.holdingId, name: m.holding.name })),
      operations: u.operationMemberships.map((m) => ({ id: m.operationId, name: m.operation.name })),
    })),
  );
}

export async function POST(request: Request) {
  const me = await requireManager();
  if (!me) return Response.json({ error: "forbidden" }, { status: 403 });
  const scope = await manageScope(me);
  const { email, password, name, role, holdingIds, operationIds } = await request.json().catch(() => ({}));
  if (!email || !password) return Response.json({ error: "email e senha obrigatórios" }, { status: 400 });

  // só superadmin cria superadmin; admin cria member|admin
  const newRole = role === "superadmin" ? (scope.all ? "superadmin" : "member") : role === "admin" ? "admin" : "member";

  // admin só concede holdings/operações dentro do escopo dele
  let hIds: string[] = Array.isArray(holdingIds) ? holdingIds : [];
  let oIds: string[] = Array.isArray(operationIds) ? operationIds : [];
  if (!scope.all) {
    hIds = hIds.filter((id) => scope.holdingIds.includes(id));
    oIds = oIds.filter((id) => scope.operationIds.includes(id));
  }

  try {
    const user = await prisma.user.create({
      data: {
        email: String(email).toLowerCase(),
        passwordHash: hashPassword(String(password)),
        name: name ?? null,
        role: newRole,
        memberships: hIds.length ? { create: hIds.map((holdingId: string) => ({ holdingId })) } : undefined,
        operationMemberships: oIds.length ? { create: oIds.map((operationId: string) => ({ operationId })) } : undefined,
      },
    });
    return NextResponse.json({ ok: true, id: user.id });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
