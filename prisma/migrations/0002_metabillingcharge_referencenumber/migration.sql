-- coluna que existia só em produção (Turso), fora das migrations; preservada na migração
ALTER TABLE "MetaBillingCharge" ADD COLUMN "referenceNumber" TEXT;
