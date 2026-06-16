-- AlterTable
ALTER TABLE "BankCharge" ADD COLUMN "company" TEXT;

-- AlterTable
ALTER TABLE "Card" ADD COLUMN "company" TEXT;

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issuer" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "secrets" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Credential_issuer_idx" ON "Credential"("issuer");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_issuer_company_key" ON "Credential"("issuer", "company");
