-- Средневзвешенный маркап: в расчёт входят только изделия, у которых есть себестоимость по ТЗ (и, для остатка, розничная цена).
-- Нет закупочной вообще → маркапа нет, артикул ни в числителе, ни в знаменателе не участвует.
CREATE OR REPLACE VIEW "vDmMarkupSoldWeighted" AS
SELECT "organizationId", "season", "modelCode",
  sum("retail_rub") AS retail_rub, sum("sold" * "unit_cost_rub") AS cost_rub, sum("sold") AS sold_pcs,
  sum("retail_rub") / NULLIF(sum("sold" * "unit_cost_rub"), 0) AS markup
FROM "vDmMarkupSold" WHERE "markup" IS NOT NULL
GROUP BY "organizationId", "season", "modelCode";

CREATE OR REPLACE VIEW "vDmMarkupStockWeighted" AS
SELECT "organizationId", "modelCode",
  sum("stock" * "retailPrice") AS retail_rub, sum("stock" * "unit_cost_rub") AS cost_rub, sum("stock") AS stock_pcs,
  sum("stock" * "retailPrice") / NULLIF(sum("stock" * "unit_cost_rub"), 0) AS markup
FROM "vDmMarkupStock" WHERE "markup" IS NOT NULL AND "stock" > 0
GROUP BY "organizationId", "modelCode";
