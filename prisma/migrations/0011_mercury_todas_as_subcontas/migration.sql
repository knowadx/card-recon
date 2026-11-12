-- Mercury puxa TODAS as sub-contas numa conta só (decisão do dono em 2026-11-12: "não deveria ter que fazer
-- três cadastros, a Mercury já poderia sincronizar tudo"). Contas Mercury já configuradas e com token PRÓPRIO
-- passam a "todas". A cobertura de API que elas tinham veio de UMA sub-conta só — não prova o conjunto, então
-- sai: o próximo sync completo (que lê todas) grava a cobertura de novo. Sem token próprio: fica como está.
DELETE FROM "ImportCoverage" ic
 USING "Account" a
 WHERE ic."accountId" = a."id" AND ic."source" = 'api'
   AND a."bank" = 'Mercury' AND a."syncConfig" IS NOT NULL AND a."apiToken" IS NOT NULL
   AND (a."syncConfig"::jsonb ->> 'mercuryAccountId') IS DISTINCT FROM 'todas';

UPDATE "Account"
   SET "syncConfig" = jsonb_set("syncConfig"::jsonb, '{mercuryAccountId}', '"todas"')::text
 WHERE "bank" = 'Mercury' AND "syncConfig" IS NOT NULL AND "apiToken" IS NOT NULL
   AND ("syncConfig"::jsonb ->> 'mercuryAccountId') IS DISTINCT FROM 'todas';
