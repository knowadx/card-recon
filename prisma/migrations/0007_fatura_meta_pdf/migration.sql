-- PDF da fatura da Meta guardado no Cloudflare R2 (pedido do dono em 2026-10-24: "importação do Meta pode também").
-- Só preenche depois que o servidor confere que o arquivo chegou no R2.
ALTER TABLE "MetaReceipt" ADD COLUMN "fileKey" TEXT;
ALTER TABLE "MetaReceipt" ADD COLUMN "fileSize" INTEGER;
