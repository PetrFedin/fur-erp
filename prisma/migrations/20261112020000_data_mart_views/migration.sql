-- Представления отчётов над массивом: все таблицы, отчёты и графики читают только их.

CREATE OR REPLACE VIEW "vDmSeasonTotals" AS
SELECT k."organizationId", s."season",
  sum(s."conf") AS conf, sum(s."deliv") AS deliv,
  sum(s."soldAll") AS sold_all, sum(s."soldSsn") AS sold_season, sum(s."soldOld") AS sold_old,
  sum(s."confEur") AS conf_eur, sum(s."delivEur") AS deliv_eur,
  sum(s."rubAll") AS rub, sum(s."discAll") AS disc, sum(s."scAll") AS sc_eur
FROM "DmSkuSeason" s JOIN "DmSku" k ON k."id" = s."skuId"
GROUP BY k."organizationId", s."season";

CREATE OR REPLACE VIEW "vDmStockSku" AS
SELECT k."organizationId", k."skuKey", k."modelCode", k."acode", k."color", k."colorCanon", k."size", k."cls", k."fur", k."cat1", k."cat2",
  t."deliv", t."sold", t."stock", greatest(t."stock", 0) AS stock_shown,
  t."retailPrice", t."stockRetailRub", t."unitCostAvgRub", t."stockCostAvgRub", t."unitCostReportRub", t."costSource", t."flags"
FROM "DmSku" k JOIN "DmStock" t ON t."skuId" = k."id";

CREATE OR REPLACE VIEW "vDmStockModel" AS
SELECT "organizationId", "modelCode",
  sum("deliv") AS deliv, sum("sold") AS sold, sum("stock") AS stock,
  sum("stockRetailRub") AS stock_retail_rub, sum("stockCostAvgRub") AS stock_cost_rub
FROM "vDmStockSku" GROUP BY "organizationId", "modelCode";

CREATE OR REPLACE VIEW "vDmPurchaseChain" AS
SELECT p."organizationId", p."purchaseId", p."number", p."supplier", p."currency", p."orderDate", p."receivedDate", p."invoiceNumber", p."transferDoc",
  p."itemsSum", p."itemsGross", p."expensesSum", p."lotsCostSum", p."paidSum", p."lotsCount",
  coalesce(sum(l."qtyReceived"), 0) AS qty_received, coalesce(sum(l."qtyUsed"), 0) AS qty_used, coalesce(sum(l."usedCost"), 0) AS used_cost,
  p."lotsCostSum" - p."paidSum" AS debt_rub_equiv
FROM "DmPurchase" p LEFT JOIN "DmLot" l ON l."organizationId" = p."organizationId" AND l."purchaseId" = p."purchaseId"
GROUP BY p."id";

CREATE OR REPLACE VIEW "vDmLotToOrder" AS
SELECT u."organizationId", u."lotId", l."lotNumber", l."material", l."colorCanon", p."number" AS purchase_number, p."supplier",
  u."orderId", u."orderNumber", u."model", u."qty", u."unitCost", u."totalCost", u."date", u."commission4"
FROM "DmLotUse" u JOIN "DmLot" l ON l."organizationId" = u."organizationId" AND l."lotId" = u."lotId"
LEFT JOIN "DmPurchase" p ON p."organizationId" = l."organizationId" AND p."purchaseId" = l."purchaseId";

CREATE OR REPLACE VIEW "vDmOrderCost" AS
SELECT o."organizationId", o."orderId", o."orderNumber", o."model",
  o."material_rub", coalesce(e."expenses_rub", 0) AS expenses_rub, coalesce(a."allocated_rub", 0) AS paid_work_rub
FROM (SELECT "organizationId", "orderId", min("orderNumber") AS "orderNumber", min("model") AS "model", sum("totalCost") AS material_rub FROM "DmLotUse" GROUP BY 1, 2) o
LEFT JOIN (SELECT "organizationId", "orderId", sum("amount") AS expenses_rub FROM "DmOrderExpense" GROUP BY 1, 2) e ON e."organizationId" = o."organizationId" AND e."orderId" = o."orderId"
LEFT JOIN (SELECT "organizationId", "orderId", sum("amount") AS allocated_rub FROM "DmPaymentAlloc" GROUP BY 1, 2) a ON a."organizationId" = o."organizationId" AND a."orderId" = o."orderId";

CREATE OR REPLACE VIEW "vDmPaymentsBySupplier" AS
SELECT "organizationId", "flow", "counterparty", "currency",
  count(*) AS payments, sum("amount") FILTER (WHERE "status" = 'COMPLETED') AS paid, sum("amount") FILTER (WHERE "status" <> 'COMPLETED') AS pending,
  count(*) FILTER (WHERE NOT "confirmed") AS unconfirmed
FROM "DmPayment" GROUP BY "organizationId", "flow", "counterparty", "currency";

CREATE OR REPLACE VIEW "vDmMovementByMonth" AS
SELECT "organizationId", date_trunc('month', "date")::date AS month, "kind", "season", sum("pcs") AS pcs, sum("retailRub") AS retail_rub
FROM "DmMovement" GROUP BY 1, 2, 3, 4;
