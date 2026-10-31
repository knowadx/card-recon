-- Cobertura de importação por conta (decisão do dono em 2026-10-30): cada importação que leu um período
-- inteiro grava o trecho coberto. Substitui Account.syncedThrough (só dizia "até", nunca "desde", e era da
-- conta inteira mesmo quando o sync puxava só uma extração da Mercury).

-- CreateTable
CREATE TABLE "ImportCoverage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "importLogId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportCoverage_accountId_idx" ON "ImportCoverage"("accountId");

-- AddForeignKey
ALTER TABLE "ImportCoverage" ADD CONSTRAINT "ImportCoverage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportCoverage" ADD CONSTRAINT "ImportCoverage_importLogId_fkey" FOREIGN KEY ("importLogId") REFERENCES "ImportLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportCoverage" ADD CONSTRAINT "ImportCoverage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- OFX já importados: o histórico guarda o período do arquivo e o NOME da conta (summary.conta) + a empresa.
-- Período do arquivo = dias inteiros (o fim do OFX é o último dia, inclusivo → cobre até a meia-noite seguinte).
INSERT INTO "ImportCoverage" ("id", "accountId", "from", "to", "source", "importLogId", "userId", "createdAt")
SELECT 'ofx_' || l."id", a."id", l."periodFrom"::timestamp, (l."periodTo" + 1)::timestamp, 'ofx', l."id", l."userId", l."createdAt"
  FROM "ImportLog" l
  JOIN "Account" a ON a."companyId" = ANY (l."companyIds") AND a."name" = (l."summary"::json ->> 'conta')
 WHERE l."kind" = 'ofx' AND l."periodFrom" IS NOT NULL AND l."periodTo" IS NOT NULL;

-- O "sincronizada até" das contas com API não diz DESDE quando — não vira cobertura (seria inventar).
-- A cobertura delas nasce no próximo sync completo.
-- AlterTable
ALTER TABLE "Account" DROP COLUMN "syncedThrough";
