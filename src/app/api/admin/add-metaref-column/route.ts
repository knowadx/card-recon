import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { guarded, requireSuperadmin } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/add-metaref-column — adiciona a coluna Transaction.metaRef em produção.
 * Seguro e idempotente (ignora "duplicate column"). Só o administrador geral (superadmin). Rode UMA vez antes de
 * sincronizar os bancos com o código novo (que grava metaRef).
 */
export const GET = guarded(async () => {
  await requireSuperadmin();
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE "Transaction" ADD COLUMN "metaRef" TEXT');
    return NextResponse.json({ ok: true, added: "metaRef" });
  } catch (e) {
    const msg = (e as Error).message;
    if (/duplicate column|already exists/i.test(msg)) return NextResponse.json({ ok: true, alreadyExists: true });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
});
