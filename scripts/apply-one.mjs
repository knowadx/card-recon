// Aplica UMA migration (não-destrutivo) no Turso de produção.
// Uso: DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... node scripts/apply-one.mjs <nome_da_migration>
import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import path from "path";

const name = process.argv[2];
if (!name) throw new Error("Passe o nome da migration. Ex: node scripts/apply-one.mjs 20260617153054_meta_per_operation");

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) throw new Error("DATABASE_URL ausente");

const sql = readFileSync(path.join("prisma/migrations", name, "migration.sql"), "utf8");
const client = createClient({ url, authToken });
await client.executeMultiple(sql);
console.log(`✅ migration ${name} aplicada em ${url.split("@").pop()}`);
