-- Fechamento Meta só libera mês com a importação terminada (decisão do dono em 2026-10-16): toda
-- conta de banco configurada tem que ter sido sincronizada DEPOIS do fim do mês. O próprio sync grava
-- syncedThrough daqui pra frente (src/lib/sync/common.ts markSynced).

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "syncedThrough" TIMESTAMP(3);


-- Ponto de partida pras contas JÁ configuradas: a última importação registrada (evidência de que
-- um sync rodou até aquele momento). Conta configurada sem nenhuma transação fica vazia (= não sincronizada).
UPDATE "Account" a
SET "syncedThrough" = (SELECT max(t."importedAt") FROM "Transaction" t WHERE t."accountId" = a."id")
WHERE a."syncConfig" IS NOT NULL;
