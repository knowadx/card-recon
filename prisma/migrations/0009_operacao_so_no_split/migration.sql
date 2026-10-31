-- Operação mora SÓ no split da transação (decisão do dono em 2026-10-30): sai o padrão da conta, a cópia
-- na transação e a holding dona da operação (vira lista global, como categoria).
--
-- Portão: só apaga se nada se perde. Medido em produção antes: 0 de 22 contas com operação e as 10
-- transações marcadas têm a mesma operação num split. Se aparecer diferente, a migration ABORTA (o
-- deploy volta inteiro) em vez de sumir com marcação.
DO $$
DECLARE
  contas int;
  orfas int;
BEGIN
  SELECT count(*) INTO contas FROM "Account" WHERE "operationId" IS NOT NULL;
  SELECT count(*) INTO orfas FROM "Transaction" t
   WHERE t."operationId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "TransactionSplit" s WHERE s."transactionId" = t.id AND s."operationId" = t."operationId");
  IF contas > 0 OR orfas > 0 THEN
    RAISE EXCEPTION 'operação fora do split: % conta(s) com operação, % transação(ões) com operação que não está em nenhum split dela', contas, orfas;
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "Operation" DROP CONSTRAINT "Operation_holdingId_fkey";

-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_operationId_fkey";

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_operationId_fkey";

-- DropIndex
DROP INDEX "Operation_holdingId_idx";

-- DropIndex
DROP INDEX "Account_operationId_idx";

-- DropIndex
DROP INDEX "Transaction_operationId_idx";

-- AlterTable
ALTER TABLE "Operation" DROP COLUMN "holdingId";

-- AlterTable
ALTER TABLE "Account" DROP COLUMN "operationId";

-- AlterTable
ALTER TABLE "Transaction" DROP COLUMN "operationId";
