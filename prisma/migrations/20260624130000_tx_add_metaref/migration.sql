-- Adiciona metaRef (código do descritor Meta extraído do extrato). Seguro e não-destrutivo.
ALTER TABLE "Transaction" ADD COLUMN "metaRef" TEXT;
