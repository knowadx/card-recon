-- CreateTable
CREATE TABLE "MetaBillingCharge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT,
    "bmId" TEXT,
    "bmName" TEXT,
    "operationId" TEXT,
    "amountUsd" REAL NOT NULL,
    "currency" TEXT NOT NULL,
    "chargedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "MetaBillingCharge_transactionId_key" ON "MetaBillingCharge"("transactionId");

-- CreateIndex
CREATE INDEX "MetaBillingCharge_accountId_idx" ON "MetaBillingCharge"("accountId");

-- CreateIndex
CREATE INDEX "MetaBillingCharge_chargedAt_idx" ON "MetaBillingCharge"("chargedAt");

-- CreateIndex
CREATE INDEX "MetaBillingCharge_amountUsd_idx" ON "MetaBillingCharge"("amountUsd");

-- CreateIndex
CREATE INDEX "MetaBillingCharge_operationId_idx" ON "MetaBillingCharge"("operationId");
