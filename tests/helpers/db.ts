// Временная база PostgreSQL для тестов: контейнер создаётся на прогон, миграции Prisma применяются на пустую базу.
// Боевую базу (DATABASE_URL из .env, контейнер fur-erp-db-1, порт 5436) тесты не читают: URL выдаёт сам контейнер.
import { execFileSync } from "node:child_process";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";

const FORBIDDEN_PORTS = new Set(["5436"]);

export type TestDb = { prisma: PrismaClient; url: string; stop: () => Promise<void> };

export async function startTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("fur_erp_test")
    .start();
  const url = container.getConnectionUri();
  const port = new URL(url).port;
  if (FORBIDDEN_PORTS.has(port)) {
    await container.stop();
    throw new Error(`Тестовая база оказалась на порту ${port}, занятом боевой базой — прогон остановлен.`);
  }
  // Свой URL контейнера подменяет любой DATABASE_URL из окружения, в том числе боевой.
  process.env.DATABASE_URL = url;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  return {
    prisma,
    url,
    stop: async () => {
      await prisma.$disconnect();
      await container.stop();
    },
  };
}
