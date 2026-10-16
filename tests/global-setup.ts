import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";
import { TEST_CONTAINER, TEST_PG, testDbName } from "./pg";

/**
 * Banco de teste NOVO a cada rodada, num Postgres descartável em Docker (127.0.0.1:54329):
 *  1. sobe o container se não estiver de pé;
 *  2. recria o banco desta suíte (pf_<TEST_DB>) — só dentro desse container de teste;
 *  3. aplica a migration REAL (prisma/migrations/0001_init_postgres) — assim ela também é testada.
 */
function docker(args: string[]) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function waitReady(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const c = new pg.Client({ ...TEST_PG, database: "postgres" });
    try {
      await c.connect();
      await c.end();
      return;
    } catch {
      await c.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("Postgres de teste não subiu em 30 s");
}

export default async function setup() {
  const running = docker(["ps", "--filter", `name=^${TEST_CONTAINER}$`, "--format", "{{.Names}}"]);
  if (running !== TEST_CONTAINER) {
    const exists = docker(["ps", "-a", "--filter", `name=^${TEST_CONTAINER}$`, "--format", "{{.Names}}"]);
    if (exists === TEST_CONTAINER) docker(["start", TEST_CONTAINER]);
    else
      docker([
        "run", "-d", "--name", TEST_CONTAINER,
        "-e", `POSTGRES_PASSWORD=${TEST_PG.password}`,
        "-p", `${TEST_PG.host}:${TEST_PG.port}:5432`,
        "postgres:16-alpine",
      ]);
  }
  await waitReady();

  const db = testDbName();
  const admin = new pg.Client({ ...TEST_PG, database: "postgres" });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${db}"`);
  await admin.end();

  const client = new pg.Client({ ...TEST_PG, database: db });
  await client.connect();
  await client.query(readFileSync("prisma/migrations/0001_init_postgres/migration.sql", "utf8"));
  await client.end();
}
