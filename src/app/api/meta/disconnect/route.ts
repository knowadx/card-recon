import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** POST /api/meta/disconnect { operationId } — remove a credencial Meta da operação (admin ou membro). */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "não autenticado" }, { status: 401 });
  const { operationId } = await request.json().catch(() => ({}));
  if (!operationId) return NextResponse.json({ ok: false, error: "operationId ausente" }, { status: 400 });

  const op = await prisma.operation.findFirst({
    where:
      user.role === "admin"
        ? { id: operationId }
        : { id: operationId, memberships: { some: { userId: user.id } } },
    select: { id: true },
  });
  if (!op) return NextResponse.json({ ok: false, error: "sem acesso" }, { status: 403 });

  await prisma.credential.deleteMany({ where: { issuer: "meta", operationId: op.id } });
  return NextResponse.json({ ok: true });
}
