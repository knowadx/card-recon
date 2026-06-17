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
    "isMetaCharge" BOOLEAN NOT NULL DEFAULT false,
    "metaCheck" TEXT,
    "metaCheckNote" TEXT,
    "operationId" TEXT,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("accountId", "amount", "cardLast4", "currency", "date", "description", "fee", "id", "ignored", "importedAt", "isMetaCharge", "metaCheck", "metaCheckNote", "reference") SELECT "accountId", "amount", "cardLast4", "currency", "date", "description", "fee", "id", "ignored", "importedAt", "isMetaCharge", "metaCheck", "metaCheckNote", "reference" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE INDEX "Transaction_accountId_idx" ON "Transaction"("accountId");
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");
CREATE INDEX "Transaction_isMetaCharge_idx" ON "Transaction"("isMetaCharge");
CREATE INDEX "Transaction_cardLast4_idx" ON "Transaction"("cardLast4");
CREATE INDEX "Transaction_operationId_idx" ON "Transaction"("operationId");
CREATE UNIQUE INDEX "Transaction_accountId_reference_key" ON "Transaction"("accountId", "reference");
CREATE TABLE "new_TransactionSplit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "note" TEXT,
    "accountingDate" DATETIME,
    "managerialCategoryId" TEXT,
    "accountingCategoryId" TEXT,
    "operationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TransactionSplit_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransactionSplit_managerialCategoryId_fkey" FOREIGN KEY ("managerialCategoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TransactionSplit_accountingCategoryId_fkey" FOREIGN KEY ("accountingCategoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TransactionSplit_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TransactionSplit" ("accountingCategoryId", "accountingDate", "amount", "createdAt", "id", "managerialCategoryId", "note", "transactionId") SELECT "accountingCategoryId", "accountingDate", "amount", "createdAt", "id", "managerialCategoryId", "note", "transactionId" FROM "TransactionSplit";
DROP TABLE "TransactionSplit";
ALTER TABLE "new_TransactionSplit" RENAME TO "TransactionSplit";
CREATE INDEX "TransactionSplit_transactionId_idx" ON "TransactionSplit"("transactionId");
CREATE INDEX "TransactionSplit_managerialCategoryId_idx" ON "TransactionSplit"("managerialCategoryId");
CREATE INDEX "TransactionSplit_accountingCategoryId_idx" ON "TransactionSplit"("accountingCategoryId");
CREATE INDEX "TransactionSplit_operationId_idx" ON "TransactionSplit"("operationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
