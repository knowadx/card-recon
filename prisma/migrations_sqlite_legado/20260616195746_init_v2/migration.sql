-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "cnpj" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "bank" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "syncConfig" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "parentId" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "plSection" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
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
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccountingSplit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "note" TEXT,
    "accountingDate" DATETIME,
    "accountingCategoryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountingSplit_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccountingSplit_accountingCategoryId_fkey" FOREIGN KEY ("accountingCategoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransactionSplit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "note" TEXT,
    "accountingDate" DATETIME,
    "managerialCategoryId" TEXT,
    "accountingCategoryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TransactionSplit_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransactionSplit_managerialCategoryId_fkey" FOREIGN KEY ("managerialCategoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TransactionSplit_accountingCategoryId_fkey" FOREIGN KEY ("accountingCategoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DashboardChart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#00b9a5',
    "order" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'currency',
    "format" TEXT NOT NULL DEFAULT 'auto',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DashboardChartLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chartId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "factor" INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL DEFAULT 0,
    "yAxis" TEXT NOT NULL DEFAULT 'left',
    CONSTRAINT "DashboardChartLine_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "DashboardChart" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DashboardChartLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlanSeries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#f59e0b',
    "seriesType" TEXT NOT NULL DEFAULT 'line',
    "unit" TEXT NOT NULL DEFAULT 'currency',
    "format" TEXT NOT NULL DEFAULT 'auto',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "formulaOp" TEXT,
    "formulaSeriesAId" TEXT,
    "formulaSeriesBId" TEXT,
    "formulaChartAId" TEXT,
    "formulaChartBId" TEXT
);

-- CreateTable
CREATE TABLE "PlanSeriesValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "value" REAL NOT NULL,
    CONSTRAINT "PlanSeriesValue_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "PlanSeries" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChartSeriesLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chartId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "yAxis" TEXT NOT NULL DEFAULT 'left',
    CONSTRAINT "ChartSeriesLink_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "DashboardChart" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChartSeriesLink_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "PlanSeries" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "currency" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "rateToUsd" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimetype" TEXT,
    "size" INTEGER,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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

-- CreateTable
CREATE TABLE "MetaAdAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT,
    "accountStatus" INTEGER,
    "company" TEXT,
    "bmId" TEXT,
    "bmName" TEXT,
    "fundingCardBrand" TEXT,
    "fundingCardLast4" TEXT,
    "fundingRaw" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CardWhitelist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "last4" TEXT NOT NULL,
    "label" TEXT,
    "company" TEXT,
    "addedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_cnpj_key" ON "Company"("cnpj");

-- CreateIndex
CREATE INDEX "Account_companyId_idx" ON "Account"("companyId");

-- CreateIndex
CREATE INDEX "Transaction_accountId_idx" ON "Transaction"("accountId");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_isMetaCharge_idx" ON "Transaction"("isMetaCharge");

-- CreateIndex
CREATE INDEX "Transaction_cardLast4_idx" ON "Transaction"("cardLast4");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_accountId_reference_key" ON "Transaction"("accountId", "reference");

-- CreateIndex
CREATE INDEX "AccountingSplit_transactionId_idx" ON "AccountingSplit"("transactionId");

-- CreateIndex
CREATE INDEX "AccountingSplit_accountingCategoryId_idx" ON "AccountingSplit"("accountingCategoryId");

-- CreateIndex
CREATE INDEX "TransactionSplit_transactionId_idx" ON "TransactionSplit"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionSplit_managerialCategoryId_idx" ON "TransactionSplit"("managerialCategoryId");

-- CreateIndex
CREATE INDEX "TransactionSplit_accountingCategoryId_idx" ON "TransactionSplit"("accountingCategoryId");

-- CreateIndex
CREATE INDEX "DashboardChartLine_chartId_idx" ON "DashboardChartLine"("chartId");

-- CreateIndex
CREATE INDEX "DashboardChartLine_categoryId_idx" ON "DashboardChartLine"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanSeriesValue_seriesId_month_key" ON "PlanSeriesValue"("seriesId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "ChartSeriesLink_chartId_seriesId_key" ON "ChartSeriesLink"("chartId", "seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_currency_month_key" ON "ExchangeRate"("currency", "month");

-- CreateIndex
CREATE INDEX "Document_transactionId_idx" ON "Document"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE INDEX "Membership_companyId_idx" ON "Membership"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_companyId_key" ON "Membership"("userId", "companyId");

-- CreateIndex
CREATE INDEX "Credential_issuer_idx" ON "Credential"("issuer");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_issuer_company_key" ON "Credential"("issuer", "company");

-- CreateIndex
CREATE UNIQUE INDEX "MetaAdAccount_accountId_key" ON "MetaAdAccount"("accountId");

-- CreateIndex
CREATE INDEX "MetaAdAccount_fundingCardLast4_idx" ON "MetaAdAccount"("fundingCardLast4");

-- CreateIndex
CREATE INDEX "CardWhitelist_last4_idx" ON "CardWhitelist"("last4");

-- CreateIndex
CREATE UNIQUE INDEX "CardWhitelist_last4_company_key" ON "CardWhitelist"("last4", "company");
