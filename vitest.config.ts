import { defineConfig } from "vitest/config";
import path from "node:path";

// TEST_DB permite rodar suítes em paralelo, cada uma no seu arquivo (padrão: test.db)
const testDb = process.env.TEST_DB ?? "test.db";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    // banco SQLite de teste num arquivo só → arquivos de teste rodam em sequência
    fileParallelism: false,
    env: {
      DATABASE_URL: `file:./${testDb}`,
      SESSION_SECRET: "segredo-de-teste",
      ACCESS_TEAM_DOMAIN: "",
      ACCESS_AUD: "",
    },
  },
});
