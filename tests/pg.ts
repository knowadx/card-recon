/**
 * Postgres de TESTE: container Docker descartável, só em 127.0.0.1:54329. Nunca aponta para
 * produção — host, porta e senha são fixos aqui. Cada suíte (TEST_DB) tem o seu banco.
 */
export const TEST_PG = { host: "127.0.0.1", port: 54329, user: "postgres", password: "teste-local" };
export const TEST_CONTAINER = "pixelfinance-test-pg";

/** "test-int.db" → "pf_test_int" (nome de banco válido) */
export function testDbName(raw = process.env.TEST_DB ?? "test.db"): string {
  return "pf_" + raw.replace(/\.db$/, "").replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}

export function testDatabaseUrl(db = testDbName()): string {
  return `postgresql://${TEST_PG.user}:${TEST_PG.password}@${TEST_PG.host}:${TEST_PG.port}/${db}`;
}
