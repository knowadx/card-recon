-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Holding" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'own',
    "color" TEXT NOT NULL DEFAULT '#0ea5e9',
    "holdingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "holdingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bank" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiToken" TEXT,
    "syncConfig" TEXT,
    "operationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "parentId" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "plSection" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "reference" TEXT,
    "fee" DOUBLE PRECISION DEFAULT 0,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cardLast4" TEXT,
    "cardLabel" TEXT,
    "isMetaCharge" BOOLEAN NOT NULL DEFAULT false,
    "metaRef" TEXT,
    "hasReceipt" BOOLEAN NOT NULL DEFAULT false,
    "metaCheck" TEXT,
    "metaCheckNote" TEXT,
    "billAmount" DOUBLE PRECISION,
    "billCurrency" TEXT,
    "operationId" TEXT,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingSplit" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "accountingDate" TIMESTAMP(3),
    "accountingCategoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionSplit" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "accountingDate" TIMESTAMP(3),
    "managerialCategoryId" TEXT,
    "accountingCategoryId" TEXT,
    "operationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardChart" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#00b9a5',
    "order" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'currency',
    "format" TEXT NOT NULL DEFAULT 'auto',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardChart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardChartLine" (
    "id" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "factor" INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL DEFAULT 0,
    "yAxis" TEXT NOT NULL DEFAULT 'left',

    CONSTRAINT "DashboardChartLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanSeries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#f59e0b',
    "seriesType" TEXT NOT NULL DEFAULT 'line',
    "unit" TEXT NOT NULL DEFAULT 'currency',
    "format" TEXT NOT NULL DEFAULT 'auto',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "formulaOp" TEXT,
    "formulaSeriesAId" TEXT,
    "formulaSeriesBId" TEXT,
    "formulaChartAId" TEXT,
    "formulaChartBId" TEXT,

    CONSTRAINT "PlanSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanSeriesValue" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PlanSeriesValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChartSeriesLink" (
    "id" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "yAxis" TEXT NOT NULL DEFAULT 'left',

    CONSTRAINT "ChartSeriesLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "rateToUsd" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimetype" TEXT,
    "size" INTEGER,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "secrets" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "operationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaReceipt" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "accountId" TEXT,
    "accountName" TEXT,
    "cardLast4" TEXT,
    "amountUsd" DOUBLE PRECISION,
    "date" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaAdAccount" (
    "id" TEXT NOT NULL,
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
    "amountSpent" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaAdAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaBillingCharge" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT,
    "bmId" TEXT,
    "bmName" TEXT,
    "operationId" TEXT,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "chargedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaBillingCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardWhitelist" (
    "id" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "label" TEXT,
    "company" TEXT,
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardWhitelist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Operation_holdingId_idx" ON "Operation"("holdingId");

-- CreateIndex
CREATE INDEX "OperationMembership_userId_idx" ON "OperationMembership"("userId");

-- CreateIndex
CREATE INDEX "OperationMembership_operationId_idx" ON "OperationMembership"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "OperationMembership_userId_operationId_key" ON "OperationMembership"("userId", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_cnpj_key" ON "Company"("cnpj");

-- CreateIndex
CREATE INDEX "Company_holdingId_idx" ON "Company"("holdingId");

-- CreateIndex
CREATE INDEX "Account_companyId_idx" ON "Account"("companyId");

-- CreateIndex
CREATE INDEX "Account_operationId_idx" ON "Account"("operationId");

-- CreateIndex
CREATE INDEX "Transaction_accountId_idx" ON "Transaction"("accountId");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_isMetaCharge_idx" ON "Transaction"("isMetaCharge");

-- CreateIndex
CREATE INDEX "Transaction_cardLast4_idx" ON "Transaction"("cardLast4");

-- CreateIndex
CREATE INDEX "Transaction_operationId_idx" ON "Transaction"("operationId");

-- CreateIndex
CREATE INDEX "Transaction_hasReceipt_idx" ON "Transaction"("hasReceipt");

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
CREATE INDEX "TransactionSplit_operationId_idx" ON "TransactionSplit"("operationId");

-- CreateIndex
CREATE INDEX "TransactionSplit_managerialCategoryId_transactionId_idx" ON "TransactionSplit"("managerialCategoryId", "transactionId");

-- CreateIndex
CREATE INDEX "TransactionSplit_accountingCategoryId_transactionId_idx" ON "TransactionSplit"("accountingCategoryId", "transactionId");

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
CREATE INDEX "Membership_holdingId_idx" ON "Membership"("holdingId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_holdingId_key" ON "Membership"("userId", "holdingId");

-- CreateIndex
CREATE INDEX "Credential_issuer_idx" ON "Credential"("issuer");

-- CreateIndex
CREATE INDEX "Credential_operationId_idx" ON "Credential"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_issuer_company_key" ON "Credential"("issuer", "company");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_issuer_operationId_key" ON "Credential"("issuer", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "MetaReceipt_transactionId_key" ON "MetaReceipt"("transactionId");

-- CreateIndex
CREATE INDEX "MetaReceipt_referenceNumber_idx" ON "MetaReceipt"("referenceNumber");

-- CreateIndex
CREATE INDEX "MetaReceipt_accountId_idx" ON "MetaReceipt"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "MetaAdAccount_accountId_key" ON "MetaAdAccount"("accountId");

-- CreateIndex
CREATE INDEX "MetaAdAccount_fundingCardLast4_idx" ON "MetaAdAccount"("fundingCardLast4");

-- CreateIndex
CREATE INDEX "MetaAdAccount_operationId_idx" ON "MetaAdAccount"("operationId");

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

-- CreateIndex
CREATE INDEX "CardWhitelist_last4_idx" ON "CardWhitelist"("last4");

-- CreateIndex
CREATE UNIQUE INDEX "CardWhitelist_last4_company_key" ON "CardWhitelist"("last4", "company");

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "Holding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationMembership" ADD CONSTRAINT "OperationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationMembership" ADD CONSTRAINT "OperationMembership_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "Holding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingSplit" ADD CONSTRAINT "AccountingSplit_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingSplit" ADD CONSTRAINT "AccountingSplit_accountingCategoryId_fkey" FOREIGN KEY ("accountingCategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_managerialCategoryId_fkey" FOREIGN KEY ("managerialCategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_accountingCategoryId_fkey" FOREIGN KEY ("accountingCategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardChartLine" ADD CONSTRAINT "DashboardChartLine_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "DashboardChart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardChartLine" ADD CONSTRAINT "DashboardChartLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSeriesValue" ADD CONSTRAINT "PlanSeriesValue_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "PlanSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartSeriesLink" ADD CONSTRAINT "ChartSeriesLink_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "DashboardChart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartSeriesLink" ADD CONSTRAINT "ChartSeriesLink_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "PlanSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "Holding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaAdAccount" ADD CONSTRAINT "MetaAdAccount_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

