import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": p("./src"),
      "server-only": p("./scripts/stubs/empty.js"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Тесты с базой поднимают контейнер PostgreSQL сами (tests/helpers/db.ts); первый запуск тянет образ.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
