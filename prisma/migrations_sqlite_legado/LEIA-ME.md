# Migrations antigas (SQLite/Turso) — só histórico

Não são mais aplicadas. O PixelFinance passou para Postgres (padrão do Hash) com um histórico novo
que começa em `prisma/migrations/0001_init_postgres`, gerado do `schema.prisma`.

Por que não reaproveitar: este histórico não aplicava do zero (`20260624124143` já cria `metaRef`
e `20260624130000` cria de novo → "duplicate column"), e parte do esquema de produção vinha de DDL
rodado em tempo de execução (MetaReceipt, hasReceipt), sem migration.
