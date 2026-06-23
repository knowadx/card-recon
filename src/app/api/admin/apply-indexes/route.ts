import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isSuperadmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/apply-indexes — aplica os índices de performance no banco (idempotente).
 * Só superadmin. Usa CREATE INDEX IF NOT EXISTS, então é seguro rodar quantas vezes quiser.
 */
export async function GET() {
  const s = await getSession();
  if (!s || !isSuperadmin(s.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

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
}
