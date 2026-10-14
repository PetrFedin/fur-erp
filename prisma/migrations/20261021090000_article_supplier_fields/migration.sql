-- Данные об артикуле, которые присылает внешний поставщик (необязательные): расценка работы за единицу и расход шкур на изделие.
ALTER TABLE "ProductModel" ADD COLUMN "supplierWorkPrice" DECIMAL(14,2),
ADD COLUMN "supplierFurPerUnit" DECIMAL(10,3);
