-- Бюджет сезона (раздел «Бюджет»)
CREATE TABLE "BudgetScenario" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,

    CONSTRAINT "BudgetScenario_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BudgetScenario_organizationId_season_key" ON "BudgetScenario"("organizationId", "season");

ALTER TABLE "BudgetScenario" ADD CONSTRAINT "BudgetScenario_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
