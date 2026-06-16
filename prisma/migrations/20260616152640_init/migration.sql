-- CreateTable
CREATE TABLE "BusinessManager" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AdAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "accountStatus" INTEGER,
    "bmId" TEXT,
    "fundingCardBrand" TEXT,
    "fundingCardLast4" TEXT,
    "fundingRaw" TEXT,
    "amountSpent" REAL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AdAccount_bmId_fkey" FOREIGN KEY ("bmId") REFERENCES "BusinessManager" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issuer" TEXT NOT NULL,
    "bankCardId" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "brand" TEXT,
    "label" TEXT,
    "currency" TEXT,
    "state" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BankCharge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issuer" TEXT NOT NULL,
    "bankTxId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL,
    "merchantRaw" TEXT,
    "cardLast4" TEXT,
    "isMetaCharge" BOOLEAN NOT NULL DEFAULT false,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SpendSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adAccountId" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "spend" REAL NOT NULL,
    "currency" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpendSnapshot_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AdAccount_accountId_key" ON "AdAccount"("accountId");

-- CreateIndex
CREATE INDEX "AdAccount_bmId_idx" ON "AdAccount"("bmId");

-- CreateIndex
CREATE INDEX "AdAccount_fundingCardLast4_idx" ON "AdAccount"("fundingCardLast4");

-- CreateIndex
CREATE INDEX "Card_last4_idx" ON "Card"("last4");

-- CreateIndex
CREATE UNIQUE INDEX "Card_issuer_bankCardId_key" ON "Card"("issuer", "bankCardId");

-- CreateIndex
CREATE INDEX "BankCharge_cardLast4_idx" ON "BankCharge"("cardLast4");

-- CreateIndex
CREATE INDEX "BankCharge_date_idx" ON "BankCharge"("date");

-- CreateIndex
CREATE INDEX "BankCharge_isMetaCharge_idx" ON "BankCharge"("isMetaCharge");

-- CreateIndex
CREATE UNIQUE INDEX "BankCharge_issuer_bankTxId_key" ON "BankCharge"("issuer", "bankTxId");

-- CreateIndex
CREATE INDEX "SpendSnapshot_adAccountId_idx" ON "SpendSnapshot"("adAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "SpendSnapshot_adAccountId_periodStart_periodEnd_key" ON "SpendSnapshot"("adAccountId", "periodStart", "periodEnd");
