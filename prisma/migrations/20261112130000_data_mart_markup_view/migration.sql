-- Закупка в рубли только по ТЗ; закупка по отчёту остаётся в евро (справка).
CREATE OR REPLACE VIEW "vDmStockSku" AS
SELECT k."organizationId", k."skuKey", k."modelCode", k."acode", k."color", k."colorCanon", k."size", k."cls", k."fur", k."cat1", k."cat2",
  t."deliv", t."sold", t."stock", greatest(t."stock", 0) AS stock_shown,
  t."retailPrice", t."stockRetailRub", t."unitCostAvgRub", t."stockCostAvgRub", t."unitCostReportRub", t."costSource", t."flags",
  t."unitCostReportEur", t."stockCostReportEur"
FROM "DmSku" k JOIN "DmStock" t ON t."skuId" = k."id";

-- Маркап: курс 110 используется только здесь: от розничных цен (₽) обратно к евро, делим на закупку в евро по отчёту.
CREATE OR REPLACE VIEW "vDmMarkupSold" AS
SELECT k."organizationId", s."season", k."modelCode", k."acode", k."colorCanon", k."size",
  s."rubAll", s."discAll", s."scAll",
  CASE WHEN s."scAll" > 0 THEN (s."rubAll" + s."discAll") / 110.0 / s."scAll" END AS markup
FROM "DmSkuSeason" s JOIN "DmSku" k ON k."id" = s."skuId";

CREATE OR REPLACE VIEW "vDmMarkupStock" AS
SELECT "organizationId", "skuKey", "modelCode", "acode", "colorCanon", "size", "stock_shown" AS stock,
  "retailPrice", "unitCostReportEur" AS unit_cost_eur,
  CASE WHEN "unitCostReportEur" > 0 AND "retailPrice" IS NOT NULL THEN "retailPrice" / 110.0 / "unitCostReportEur" END AS markup
FROM "vDmStockSku";
