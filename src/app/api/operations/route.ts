import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Operações visíveis: admin = todas; senão as concedidas ao usuário. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauth" }, { status: 401 });
  const where =
    user.role === "admin"
      ? {}
      : { memberships: { some: { userId: user.id } } };
  const operations = await prisma.operation.findMany({
    where,
    include: {
      holding: { select: { id: true, name: true } },
      accounts: { select: { id: true, name: true } },
      credentials: { where: { issuer: "meta" }, select: { id: true, isActive: true, updatedAt: true } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(
    operations.map(({ credentials, ...rest }) => {
      const meta = credentials[0];
      return { ...rest, metaConnected: !!meta?.isActive, metaUpdatedAt: meta?.updatedAt ?? null };
    }),
  );
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  const { name, type, holdingId } = await request.json().catch(() => ({}));
  if (!name) return Response.json({ error: "name obrigatório" }, { status: 400 });
  const op = await prisma.operation.create({
    data: { name, type: type === "holding" ? "holding" : "own", holdingId: holdingId || null },
  });
  return NextResponse.json(op, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id ausente" }, { status: 400 });
  await prisma.account.updateMany({ where: { operationId: id }, data: { operationId: null } });
  await prisma.operation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
