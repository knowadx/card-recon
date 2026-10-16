-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Credential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issuer" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "secrets" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "operationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Credential_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Credential" ("company", "createdAt", "id", "isActive", "issuer", "secrets", "token", "updatedAt") SELECT "company", "createdAt", "id", "isActive", "issuer", "secrets", "token", "updatedAt" FROM "Credential";
DROP TABLE "Credential";
ALTER TABLE "new_Credential" RENAME TO "Credential";
CREATE INDEX "Credential_issuer_idx" ON "Credential"("issuer");
CREATE INDEX "Credential_operationId_idx" ON "Credential"("operationId");
CREATE UNIQUE INDEX "Credential_issuer_company_key" ON "Credential"("issuer", "company");
CREATE UNIQUE INDEX "Credential_issuer_operationId_key" ON "Credential"("issuer", "operationId");
CREATE TABLE "new_MetaAdAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT,
    "accountStatus" INTEGER,
    "company" TEXT,
    "operationId" TEXT,
    "bmId" TEXT,
    "bmName" TEXT,
    "fundingCardBrand" TEXT,
    "fundingCardLast4" TEXT,
    "fundingRaw" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MetaAdAccount_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MetaAdAccount" ("accountId", "accountStatus", "bmId", "bmName", "company", "currency", "fundingCardBrand", "fundingCardLast4", "fundingRaw", "id", "name", "updatedAt") SELECT "accountId", "accountStatus", "bmId", "bmName", "company", "currency", "fundingCardBrand", "fundingCardLast4", "fundingRaw", "id", "name", "updatedAt" FROM "MetaAdAccount";
DROP TABLE "MetaAdAccount";
ALTER TABLE "new_MetaAdAccount" RENAME TO "MetaAdAccount";
CREATE UNIQUE INDEX "MetaAdAccount_accountId_key" ON "MetaAdAccount"("accountId");
CREATE INDEX "MetaAdAccount_fundingCardLast4_idx" ON "MetaAdAccount"("fundingCardLast4");
CREATE INDEX "MetaAdAccount_operationId_idx" ON "MetaAdAccount"("operationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
