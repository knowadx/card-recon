/*
  Warnings:

  - You are about to drop the column `metaCheck` on the `Transaction` table. All the data in the column will be lost.
  - You are about to drop the column `metaCheckNote` on the `Transaction` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL,
    "reference" TEXT,
    "fee" REAL DEFAULT 0,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cardLast4" TEXT,
    "cardLabel" TEXT,
    "isMetaCharge" BOOLEAN NOT NULL DEFAULT false,
    "metaRef" TEXT,
    "billAmount" REAL,
    "billCurrency" TEXT,
    "operationId" TEXT,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("accountId", "amount", "billAmount", "billCurrency", "cardLabel", "cardLast4", "currency", "date", "description", "fee", "id", "ignored", "importedAt", "isMetaCharge", "operationId", "reference") SELECT "accountId", "amount", "billAmount", "billCurrency", "cardLabel", "cardLast4", "currency", "date", "description", "fee", "id", "ignored", "importedAt", "isMetaCharge", "operationId", "reference" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE INDEX "Transaction_accountId_idx" ON "Transaction"("accountId");
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");
CREATE INDEX "Transaction_isMetaCharge_idx" ON "Transaction"("isMetaCharge");
CREATE INDEX "Transaction_cardLast4_idx" ON "Transaction"("cardLast4");
CREATE INDEX "Transaction_operationId_idx" ON "Transaction"("operationId");
CREATE UNIQUE INDEX "Transaction_accountId_reference_key" ON "Transaction"("accountId", "reference");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
