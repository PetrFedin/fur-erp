-- Витрина лотов: суммы сразу во всех вариантах показа (с НДС / без НДС, без 4 % / с 4 %), единица, аукцион, год и месяц закупки.
ALTER TABLE "DmLot"
  ADD COLUMN "unit" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "auction" TEXT,
  ADD COLUMN "purchaseYear" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "purchaseMonth" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "unitCostExcl" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "totalCostExcl" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "usedCostExcl" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "usedExtraIncl" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "usedExtraExcl" DECIMAL(18,2) NOT NULL DEFAULT 0;
CREATE INDEX "DmLot_organizationId_purchaseYear_idx" ON "DmLot"("organizationId", "purchaseYear");
