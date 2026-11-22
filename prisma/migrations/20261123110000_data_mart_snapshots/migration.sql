-- Снимки готовых расчётов экранов (Главная, «Сырьё») по годам и режимам 4 %.
CREATE TABLE "DmSnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "builtAt" TIMESTAMP(3) NOT NULL,
  "buildMs" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "DmSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DmSnapshot_organizationId_key_key" ON "DmSnapshot"("organizationId", "key");
