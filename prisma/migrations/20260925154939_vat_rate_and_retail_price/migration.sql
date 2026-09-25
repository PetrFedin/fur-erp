/*
  Warnings:

  - Added the required column `materialCostExclVat` to the `RawMaterialLot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `materialVatAmount` to the `RawMaterialLot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `vatRate` to the `RawMaterialLot` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN     "retailPrice" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "PurchaseExpense" ADD COLUMN     "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN     "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 20;

-- AlterTable
-- Backfill existing lots (pre-dates VAT tracking) with a 20% assumption and
-- the whole landed cost treated as the material component, then drop the
-- temporary defaults so future inserts must supply real values.
ALTER TABLE "RawMaterialLot" ADD COLUMN     "materialCostExclVat" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "materialVatAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 20;

UPDATE "RawMaterialLot" SET "materialCostExclVat" = "unitCost", "materialVatAmount" = 0;

ALTER TABLE "RawMaterialLot" ALTER COLUMN "materialCostExclVat" DROP DEFAULT,
ALTER COLUMN "materialVatAmount" DROP DEFAULT,
ALTER COLUMN "vatRate" DROP DEFAULT;
