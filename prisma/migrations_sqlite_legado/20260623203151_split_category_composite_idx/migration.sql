-- CreateIndex
CREATE INDEX "TransactionSplit_managerialCategoryId_transactionId_idx" ON "TransactionSplit"("managerialCategoryId", "transactionId");

-- CreateIndex
CREATE INDEX "TransactionSplit_accountingCategoryId_transactionId_idx" ON "TransactionSplit"("accountingCategoryId", "transactionId");
