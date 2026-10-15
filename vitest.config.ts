import { defineConfig } from "vitest/config";
import path from "node:path";

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
      DATABASE_URL: "file:./test.db",
      SESSION_SECRET: "segredo-de-teste",
      ACCESS_TEAM_DOMAIN: "",
      ACCESS_AUD: "",
    },
  },
});
