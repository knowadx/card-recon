import { prisma } from "./db";

/**
 * Recalcula "Possui Fatura" (Transaction.hasReceipt) = a cobrança Meta tem código `facebk`
 * (metaRef) E esse código bate com um PDF salvo (MetaReceipt.referenceNumber).
 * Chave única do check de vazamento: extrato → código → PDF. Roda no import de PDFs e de CSV.
 * Idempotente. Retorna a contagem com fatura. (A coluna nasce na migration; não há DDL aqui.)
 */
export async function recomputeHasReceipt(): Promise<{ comFatura: number; metaSemFatura: number }> {
  await prisma.$executeRawUnsafe(`UPDATE "Transaction" SET "hasReceipt" = FALSE`);
  await prisma.$executeRawUnsafe(
    `UPDATE "Transaction" SET "hasReceipt" = TRUE
     WHERE "isMetaCharge" = TRUE AND "metaRef" IS NOT NULL
       AND lower("metaRef") IN (SELECT lower("referenceNumber") FROM "MetaReceipt" WHERE "referenceNumber" IS NOT NULL)`,
  );

  const [comFatura, metaSemFatura] = await Promise.all([
    prisma.transaction.count({ where: { isMetaCharge: true, hasReceipt: true } }),
    prisma.transaction.count({ where: { isMetaCharge: true, hasReceipt: false } }),
  ]);
  return { comFatura, metaSemFatura };
}
