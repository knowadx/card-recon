import { defineConfig } from "vitest/config";
import path from "node:path";

import { testDatabaseUrl } from "./tests/pg";

// TEST_DB permite rodar suítes em paralelo, cada uma no seu banco (padrão: test.db → pf_test)

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    // um banco de teste por suíte → arquivos de teste rodam em sequência
    fileParallelism: false,
    env: {
      DATABASE_URL: testDatabaseUrl(),
      // login SÓ pela Cloudflare: os testes usam uma equipe/AUD de teste (chave em tests/accessTestKeys.ts)
      ACCESS_TEAM_DOMAIN: "pixel-teste.cloudflareaccess.com",
      ACCESS_AUD: "aud-de-teste",
    },
  },
});
