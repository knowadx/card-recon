// Aplica todas as migrations Prisma (SQL) num banco libSQL/Turso.
// Uso: TURSO_URL=... TURSO_TOKEN=... node scripts/apply-migrations.mjs
import { createClient } from "@libsql/client";
import { readFileSync, readdirSync } from "fs";
import path from "path";

const url = process.env.TURSO_URL;
const authToken = process.env.TURSO_TOKEN;
if (!url) throw new Error("TURSO_URL ausente");

const client = createClient({ url, authToken });

// RESET=1 → derruba todas as tabelas antes de aplicar (schema mudou v1→v2)
if (process.env.RESET === "1") {
  const t = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  for (const row of t.rows) {
    await client.execute(`DROP TABLE IF EXISTS "${row.name}"`);
  }
  console.log("reset: tabelas derrubadas");
}

const dir = "prisma/migrations";
const migs = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const m of migs) {
  const sqlPath = path.join(dir, m, "migration.sql");
  let sql;
  try {
    sql = readFileSync(sqlPath, "utf8");
  } catch {
    continue;
  }
  await client.executeMultiple(sql);
  console.log("applied:", m);
}

const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
console.log("tables:", tables.rows.map((r) => r.name).join(", "));
