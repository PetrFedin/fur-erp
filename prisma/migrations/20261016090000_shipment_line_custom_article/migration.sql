-- Отгрузки: строка может быть без ТЗ — «свой» артикул, которого ещё нет в ТЗ.
-- Только ослабление и добавление: старые строки не меняются.
ALTER TABLE "ShipmentLine" ALTER COLUMN "productionOrderId" DROP NOT NULL;
ALTER TABLE "ShipmentLine" ADD COLUMN "customArticle" TEXT;
