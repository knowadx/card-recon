import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/add-metaref-column — adiciona a coluna Transaction.metaRef em produção.
 * Seguro e idempotente (ignora "duplicate column"). Exige login. Rode UMA vez antes de
 * sincronizar os bancos com o código novo (que grava metaRef).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE "Transaction" ADD COLUMN "metaRef" TEXT');
    return NextResponse.json({ ok: true, added: "metaRef" });
  } catch (e) {
    const msg = (e as Error).message;
    if (/duplicate column|already exists/i.test(msg)) return NextResponse.json({ ok: true, alreadyExists: true });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
