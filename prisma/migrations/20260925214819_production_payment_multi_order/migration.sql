/*
  Warnings:

  - You are about to drop the column `productionOrderId` on the `ProductionPayment` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ProductionPaymentType" AS ENUM ('ADVANCE', 'PARTIAL', 'FINAL');

-- DropForeignKey
ALTER TABLE "ProductionPayment" DROP CONSTRAINT "ProductionPayment_productionOrderId_fkey";

-- DropIndex
DROP INDEX "ProductionPayment_productionOrderId_idx";

-- AlterTable
ALTER TABLE "ProductionPayment" DROP COLUMN "productionOrderId",
ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "paymentType" "ProductionPaymentType" NOT NULL DEFAULT 'FINAL';

-- CreateTable
CREATE TABLE "ProductionPaymentOrder" (
    "id" TEXT NOT NULL,
    "productionPaymentId" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,

    CONSTRAINT "ProductionPaymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionPaymentOrder_productionOrderId_idx" ON "ProductionPaymentOrder"("productionOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionPaymentOrder_productionPaymentId_productionOrderI_key" ON "ProductionPaymentOrder"("productionPaymentId", "productionOrderId");

-- CreateIndex
CREATE INDEX "ProductionPayment_clientId_idx" ON "ProductionPayment"("clientId");

-- AddForeignKey
ALTER TABLE "ProductionPayment" ADD CONSTRAINT "ProductionPayment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPaymentOrder" ADD CONSTRAINT "ProductionPaymentOrder_productionPaymentId_fkey" FOREIGN KEY ("productionPaymentId") REFERENCES "ProductionPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPaymentOrder" ADD CONSTRAINT "ProductionPaymentOrder_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
