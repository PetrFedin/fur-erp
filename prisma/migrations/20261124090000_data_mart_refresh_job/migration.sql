-- Очередь пересборки витрины: одна строка на организацию, переживает перезапуск сервера, безопасна при нескольких экземплярах (FOR UPDATE SKIP LOCKED).
CREATE TABLE "DmRefreshJob" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "runAt" TIMESTAMP(3) NOT NULL,
  "again" BOOLEAN NOT NULL DEFAULT false,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "lockedUntil" TIMESTAMP(3),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastStartedAt" TIMESTAMP(3),
  "lastFinishedAt" TIMESTAMP(3),
  CONSTRAINT "DmRefreshJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DmRefreshJob_organizationId_key" ON "DmRefreshJob"("organizationId");
CREATE INDEX "DmRefreshJob_status_runAt_idx" ON "DmRefreshJob"("status", "runAt");
