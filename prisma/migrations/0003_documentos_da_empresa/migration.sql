-- Documentos da empresa (módulo 1): o Document passa a ter DOIS donos possíveis — anexo de
-- transação OU documento da empresa (com tipo, validade e renovação). Gerado com
-- `prisma migrate diff` + as regras que o Prisma não expressa (CHECK) + os tipos iniciais.

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "expiresAt" DATE,
ADD COLUMN     "issuedAt" DATE,
ADD COLUMN     "replacesId" TEXT,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "typeId" TEXT,
ADD COLUMN     "uploadedById" TEXT,
ALTER COLUMN "transactionId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "DocumentType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentType_name_key" ON "DocumentType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Document_path_key" ON "Document"("path");

-- CreateIndex
CREATE UNIQUE INDEX "Document_replacesId_key" ON "Document"("replacesId");

-- CreateIndex
CREATE INDEX "Document_companyId_idx" ON "Document"("companyId");

-- CreateIndex
CREATE INDEX "Document_expiresAt_idx" ON "Document"("expiresAt");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "DocumentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Exatamente UM dono: anexo de transação OU documento da empresa (nunca os dois, nunca nenhum).
ALTER TABLE "Document" ADD CONSTRAINT "Document_um_dono" CHECK (num_nonnulls("transactionId", "companyId") = 1);

-- Documento da empresa sempre tem tipo (o filtro e o aviso de vencimento dependem dele).
ALTER TABLE "Document" ADD CONSTRAINT "Document_empresa_tem_tipo" CHECK ("companyId" IS NULL OR "typeId" IS NOT NULL);

-- Lista inicial de tipos (decisão do dono em 2026-10-16: lista editável, começando com estes).
INSERT INTO "DocumentType" ("id", "name") VALUES
  ('dt_contrato_social', 'Contrato social'),
  ('dt_certidao', 'Certidão'),
  ('dt_imposto_de_renda', 'Imposto de renda'),
  ('dt_alvara_licenca', 'Alvará/licença'),
  ('dt_procuracao', 'Procuração'),
  ('dt_contrato', 'Contrato'),
  ('dt_outro', 'Outro');
