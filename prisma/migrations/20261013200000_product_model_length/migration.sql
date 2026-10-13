-- Длина артикула (Short / Regular / Long) из системы продаж. Только добавление колонки.
ALTER TABLE "ProductModel" ADD COLUMN "lengthClass" TEXT;
