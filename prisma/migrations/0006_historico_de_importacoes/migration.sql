-- Histórico de importações do Fechamento Meta (CSV Revolut e faturas PDF) — pedido do dono em 2026-10-16:
-- "onde isso fica registrado? como sei o que deu certo?". Gerado com `prisma migrate diff`.

-- CreateTable
CREATE TABLE "ImportLog" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT,
    "userId" TEXT,
    "periodFrom" DATE,
    "periodTo" DATE,
    "companyIds" TEXT[],
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportLog_createdAt_idx" ON "ImportLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ImportLog" ADD CONSTRAINT "ImportLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

