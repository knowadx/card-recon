import { prisma } from "./db";

/**
 * Recalcula "Possui Fatura" (Transaction.hasReceipt) = a cobrança Meta tem código `facebk`
 * (metaRef) E esse código bate com um PDF salvo (MetaReceipt.referenceNumber).
 * Chave única do check de vazamento: extrato → código → PDF. Roda no import de PDFs e de CSV.
 * Idempotente; cria a coluna se não existir (Turso). Retorna a contagem com fatura.
 */
export async function recomputeHasReceipt(): Promise<{ comFatura: number; metaSemFatura: number }> {
  // garante a coluna em prod (Turso) — no-op se já existe
  try { await prisma.$executeRawUnsafe(`ALTER TABLE "Transaction" ADD COLUMN "hasReceipt" BOOLEAN NOT NULL DEFAULT 0`); } catch { /* já existe */ }

  await prisma.$executeRawUnsafe(`UPDATE "Transaction" SET "hasReceipt" = 0`);
  await prisma.$executeRawUnsafe(
    `UPDATE "Transaction" SET "hasReceipt" = 1
     WHERE "isMetaCharge" = 1 AND "metaRef" IS NOT NULL
       AND lower("metaRef") IN (SELECT lower("referenceNumber") FROM "MetaReceipt" WHERE "referenceNumber" IS NOT NULL)`,
  );

  const [comFatura, metaSemFatura] = await Promise.all([
    prisma.transaction.count({ where: { isMetaCharge: true, hasReceipt: true } }),
    prisma.transaction.count({ where: { isMetaCharge: true, hasReceipt: false } }),
  ]);
  return { comFatura, metaSemFatura };
}
