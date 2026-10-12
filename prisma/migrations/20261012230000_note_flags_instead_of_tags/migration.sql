-- Признаки, которые раньше читались из текста примечаний (служебных меток): теперь отдельные поля. Только добавление колонок.
ALTER TABLE "Purchase" ADD COLUMN "isContractorRaw" BOOLEAN;
ALTER TABLE "Purchase" ADD COLUMN "listLabel" TEXT;
ALTER TABLE "ProductionOrder" ADD COLUMN "batchNotRequired" BOOLEAN;
