ALTER TABLE "DmStock" ADD COLUMN "unitCostReportEur" DECIMAL(18,4), ADD COLUMN "stockCostReportEur" DECIMAL(18,2);
UPDATE "DmStock" SET "unitCostReportRub" = NULL, "stockCostReportRub" = NULL;
