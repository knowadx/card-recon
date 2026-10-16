import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { guarded, requireSuperadmin } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/apply-indexes — aplica os índices de performance no banco (idempotente).
 * Só o administrador geral (superadmin). Ação inofensiva: só CREATE INDEX
 * IF NOT EXISTS, seguro rodar quantas vezes quiser.
 */
export const GET = guarded(async () => {
  await requireSuperadmin();

  const stmts = [
    'CREATE INDEX IF NOT EXISTS "TransactionSplit_managerialCategoryId_transactionId_idx" ON "TransactionSplit"("managerialCategoryId", "transactionId")',
    'CREATE INDEX IF NOT EXISTS "TransactionSplit_accountingCategoryId_transactionId_idx" ON "TransactionSplit"("accountingCategoryId", "transactionId")',
  ];

  const applied: string[] = [];
  for (const sql of stmts) {
    await prisma.$executeRawUnsafe(sql);
    applied.push(sql.match(/"([^"]+_idx)"/)?.[1] ?? sql);
  }

  return NextResponse.json({ ok: true, applied });
});
