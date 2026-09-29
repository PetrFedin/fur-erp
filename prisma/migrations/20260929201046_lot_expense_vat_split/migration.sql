-- AlterTable
ALTER TABLE "RawMaterialLot" ADD COLUMN     "expenseCostExclVat" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "expenseVatAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
