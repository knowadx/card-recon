-- Conexão Revolut passa a ser guardada pelo ID da empresa, não pelo NOME (2026-10-30).
-- As empresas foram renomeadas (PubViews OÜ → PUBVIEWS OÜ, Synaptica OÜ → SYNAPTICA OÜ) e a conexão
-- guardada pelo nome sumiu pro sync e pra tela. Converte as existentes casando o nome sem diferenciar
-- maiúsculas; credencial que não casa com nenhuma empresa fica como está.
UPDATE "Credential" cr
   SET company = c.id
  FROM "Company" c
 WHERE cr.issuer = 'revolut'
   AND lower(cr.company) = lower(c.name);
