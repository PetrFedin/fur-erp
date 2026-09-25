/*
  Warnings:

  - You are about to drop the `RawMaterialStock` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `lotId` to the `ProductionMaterialUsage` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "RawMaterialStock" DROP CONSTRAINT "RawMaterialStock_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "RawMaterialStock" DROP CONSTRAINT "RawMaterialStock_rawMaterialId_fkey";

-- DropForeignKey
ALTER TABLE "RawMaterialStock" DROP CONSTRAINT "RawMaterialStock_warehouseId_fkey";

-- AlterTable
ALTER TABLE "ProductionMaterialUsage" ADD COLUMN     "lotId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "clientWorkPricePerUnit" DECIMAL(14,2),
ADD COLUMN     "color" TEXT,
ADD COLUMN     "contractNumber" TEXT,
ADD COLUMN     "size" TEXT,
ADD COLUMN     "workOrderDate" TIMESTAMP(3),
ADD COLUMN     "workOrderNumber" TEXT;

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "exchangeRate" DECIMAL(14,6) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN     "lotNumber" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "lotId" TEXT;

-- DropTable
DROP TABLE "RawMaterialStock";

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inn" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawMaterialLot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rawMaterialId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "lotNumber" TEXT,
    "grade" TEXT,
    "color" TEXT,
    "purchaseId" TEXT,
    "purchaseItemId" TEXT,
    "quantityReceived" DECIMAL(14,3) NOT NULL,
    "quantityRemaining" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "receivedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawMaterialLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_organizationId_idx" ON "Client"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RawMaterialLot_purchaseItemId_key" ON "RawMaterialLot"("purchaseItemId");

-- CreateIndex
CREATE INDEX "RawMaterialLot_organizationId_idx" ON "RawMaterialLot"("organizationId");

-- CreateIndex
CREATE INDEX "RawMaterialLot_warehouseId_rawMaterialId_idx" ON "RawMaterialLot"("warehouseId", "rawMaterialId");

-- CreateIndex
CREATE INDEX "RawMaterialLot_organizationId_lotNumber_idx" ON "RawMaterialLot"("organizationId", "lotNumber");

-- CreateIndex
CREATE INDEX "ProductionMaterialUsage_lotId_idx" ON "ProductionMaterialUsage"("lotId");

-- CreateIndex
CREATE INDEX "StockMovement_lotId_idx" ON "StockMovement"("lotId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialLot" ADD CONSTRAINT "RawMaterialLot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialLot" ADD CONSTRAINT "RawMaterialLot_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "RawMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialLot" ADD CONSTRAINT "RawMaterialLot_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialLot" ADD CONSTRAINT "RawMaterialLot_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialLot" ADD CONSTRAINT "RawMaterialLot_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES "PurchaseItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "RawMaterialLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionMaterialUsage" ADD CONSTRAINT "ProductionMaterialUsage_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "RawMaterialLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
