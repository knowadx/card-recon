import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, findMemberOperation } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** POST /api/meta/disconnect { operationId } — remove a credencial Meta da operação (só quem opera ou superadmin). */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "não autenticado" }, { status: 401 });
  const { operationId } = await request.json().catch(() => ({}));
  if (!operationId) return NextResponse.json({ ok: false, error: "operationId ausente" }, { status: 400 });

  const op = await findMemberOperation(user, operationId);
  if (!op) return NextResponse.json({ ok: false, error: "sem acesso" }, { status: 403 });

  await prisma.credential.deleteMany({ where: { issuer: "meta", operationId: op.id } });
  return NextResponse.json({ ok: true });
}
