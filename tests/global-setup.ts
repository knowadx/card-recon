import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createClient } from "@libsql/client";

/**
 * Banco de teste NOVO a cada rodada, sem reset de banco nenhum:
 *  1. gera o SQL do schema.prisma (prisma migrate diff — só leitura);
 *  2. cria um arquivo test.db do zero e aplica esse SQL.
 * Nunca toca dev.db nem produção (o caminho é fixo).
 */
export default async function setup() {
  const sql = execFileSync(
    "npx",
    ["prisma", "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const f of ["test.db", "test.db-journal", "test.db-wal", "test.db-shm"]) rmSync(f, { force: true });
  const db = createClient({ url: "file:./test.db" });
  await db.executeMultiple(sql);
  db.close();
}
