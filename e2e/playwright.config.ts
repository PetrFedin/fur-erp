import { defineConfig } from "@playwright/test";

// Сквозные тесты идут в системном Chrome (без скачивания браузеров) против
// изолированной копии базы: см. scripts/e2e.sh. Адрес — E2E_BASE_URL.
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "/tmp/fur-e2e-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3201",
    channel: "chrome",
    locale: "ru-RU",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 900 },
  },
});
