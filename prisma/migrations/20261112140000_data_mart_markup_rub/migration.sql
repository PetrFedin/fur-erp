-- Маркап = розничная цена (если она есть) ÷ себестоимость по ТЗ, всё в рублях; курс не нужен.
DROP VIEW IF EXISTS "vDmMarkupStock";
DROP VIEW IF EXISTS "vDmMarkupSold";

CREATE VIEW "vDmMarkupStock" AS
SELECT "organizationId", "skuKey", "modelCode", "acode", "colorCanon", "size", "stock_shown" AS stock,
  "retailPrice", "unitCostAvgRub" AS unit_cost_rub,
  CASE WHEN "unitCostAvgRub" > 0 AND "retailPrice" IS NOT NULL THEN "retailPrice" / "unitCostAvgRub" END AS markup
FROM "vDmStockSku";

-- По продажам: розница проданных штук до скидки (NS RUR + Discount RUR из отчёта) ÷ себестоимость этих штук по ТЗ.
CREATE VIEW "vDmMarkupSold" AS
SELECT k."organizationId", s."season", k."modelCode", k."acode", k."colorCanon", k."size",
  s."soldAll" AS sold, s."rubAll" + s."discAll" AS retail_rub, t."unitCostAvgRub" AS unit_cost_rub,
  CASE WHEN s."soldAll" > 0 AND t."unitCostAvgRub" > 0 THEN (s."rubAll" + s."discAll") / (s."soldAll" * t."unitCostAvgRub") END AS markup
FROM "DmSkuSeason" s JOIN "DmSku" k ON k."id" = s."skuId" JOIN "DmStock" t ON t."skuId" = k."id";
