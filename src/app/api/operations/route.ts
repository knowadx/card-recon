import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, accessibleHoldingIds, isSuperadmin, isManager } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Operações visíveis: superadmin = todas; admin = as da(s) holding(s) dele + as que é membro; member = as que é membro. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauth" }, { status: 401 });
  let where: Record<string, unknown> = {};
  if (!isSuperadmin(user.role)) {
    const holdings = await accessibleHoldingIds(user.id, user.role);
    const hids = holdings === "all" ? [] : holdings;
    where = {
      OR: [
        ...(hids.length ? [{ holdingId: { in: hids } }] : []),
        { memberships: { some: { userId: user.id } } },
      ],
    };
  }
  const operations = await prisma.operation.findMany({
    where,
    include: {
      holding: { select: { id: true, name: true } },
      accounts: { select: { id: true, name: true } },
      credentials: { where: { issuer: "meta" }, select: { id: true, isActive: true, updatedAt: true, secrets: true } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(
    operations.map(({ credentials, ...rest }) => {
      const meta = credentials[0];
      let metaProfile: string | null = null;
      try { metaProfile = meta?.secrets ? (JSON.parse(meta.secrets).metaUserName ?? null) : null; } catch { /* ignore */ }
      return { ...rest, metaConnected: !!meta?.isActive, metaUpdatedAt: meta?.updatedAt ?? null, metaProfile };
    }),
  );
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isManager(user.role)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { name, type, holdingId } = await request.json().catch(() => ({}));
  if (!name) return Response.json({ error: "name obrigatório" }, { status: 400 });

  // admin (não-superadmin) só cria operação dentro de uma holding dele
  if (!isSuperadmin(user.role)) {
    const holdings = await accessibleHoldingIds(user.id, user.role);
    const hids = holdings === "all" ? [] : holdings;
    if (!holdingId || !hids.includes(holdingId)) {
      return Response.json({ error: "escolha uma holding sua" }, { status: 403 });
    }
  }
  const op = await prisma.operation.create({
    data: { name, type: type === "holding" ? "holding" : "own", holdingId: holdingId || null },
  });
  return NextResponse.json(op, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isManager(user.role)) return Response.json({ error: "forbidden" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id ausente" }, { status: 400 });

  // admin só remove operação da própria holding
  if (!isSuperadmin(user.role)) {
    const op = await prisma.operation.findUnique({ where: { id }, select: { holdingId: true } });
    const holdings = await accessibleHoldingIds(user.id, user.role);
    const hids = holdings === "all" ? [] : holdings;
    if (!op?.holdingId || !hids.includes(op.holdingId)) {
      return Response.json({ error: "sem acesso a essa operação" }, { status: 403 });
    }
  }
  await prisma.account.updateMany({ where: { operationId: id }, data: { operationId: null } });
  await prisma.operation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
