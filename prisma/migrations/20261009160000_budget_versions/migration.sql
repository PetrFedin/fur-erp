-- Версии бюджета: несколько бюджетов на сезон, статус, комментарий, исходная версия, автор.
DROP INDEX "BudgetScenario_organizationId_season_key";
ALTER TABLE "BudgetScenario" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "BudgetScenario" ADD COLUMN "comment" TEXT;
ALTER TABLE "BudgetScenario" ADD COLUMN "parentId" TEXT;
ALTER TABLE "BudgetScenario" ADD COLUMN "createdBy" TEXT;
-- Существующий бюджет сезона становится первой версией: правки (params, lines) не трогаем.
UPDATE "BudgetScenario" SET "createdBy" = "updatedBy", "name" = "season" WHERE "name" = 'Бюджет ' || "season";
CREATE INDEX "BudgetScenario_organizationId_season_idx" ON "BudgetScenario"("organizationId", "season");
