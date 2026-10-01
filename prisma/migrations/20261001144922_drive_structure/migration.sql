-- CreateEnum
CREATE TYPE "DriveDocType" AS ENUM ('AUCTION_INVOICE', 'UPD', 'CALC_SHEET', 'SPECIFICATION', 'CONTRACT', 'TZ_APPENDIX', 'PAYMENT_PROOF', 'PAYMENT_INVOICE', 'APPROVAL_EMAIL', 'BALANCE', 'OTHER');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "confirmed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "docRef" TEXT;

-- AlterTable
ALTER TABLE "ProductionMaterialUsage" ADD COLUMN     "commission4" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "ProductionPayment" ADD COLUMN     "confirmed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "docRef" TEXT;

-- CreateTable
CREATE TABLE "ProductionBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "year" INTEGER,
    "plannedUnits" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "docType" "DriveDocType" NOT NULL DEFAULT 'OTHER',
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "drivePath" TEXT,
    "viewUrl" TEXT,
    "docDate" TIMESTAMP(3),
    "docNumber" TEXT,
    "year" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchaseId" TEXT,
    "lotId" TEXT,
    "productionOrderId" TEXT,
    "productionBatchId" TEXT,
    "paymentId" TEXT,
    "productionPaymentId" TEXT,
    "clientId" TEXT,
    "supplierId" TEXT,

    CONSTRAINT "DriveDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionBatch_organizationId_idx" ON "ProductionBatch"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatch_organizationId_number_key" ON "ProductionBatch"("organizationId", "number");

-- CreateIndex
CREATE INDEX "DriveDocument_organizationId_driveFileId_idx" ON "DriveDocument"("organizationId", "driveFileId");

-- CreateIndex
CREATE INDEX "DriveDocument_purchaseId_idx" ON "DriveDocument"("purchaseId");

-- CreateIndex
CREATE INDEX "DriveDocument_lotId_idx" ON "DriveDocument"("lotId");

-- CreateIndex
CREATE INDEX "DriveDocument_productionOrderId_idx" ON "DriveDocument"("productionOrderId");

-- CreateIndex
CREATE INDEX "DriveDocument_productionBatchId_idx" ON "DriveDocument"("productionBatchId");

-- CreateIndex
CREATE INDEX "DriveDocument_paymentId_idx" ON "DriveDocument"("paymentId");

-- CreateIndex
CREATE INDEX "DriveDocument_productionPaymentId_idx" ON "DriveDocument"("productionPaymentId");

-- CreateIndex
CREATE INDEX "DriveDocument_clientId_idx" ON "DriveDocument"("clientId");

-- CreateIndex
CREATE INDEX "DriveDocument_supplierId_idx" ON "DriveDocument"("supplierId");

-- CreateIndex
CREATE INDEX "ProductionOrder_batchId_idx" ON "ProductionOrder"("batchId");

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveDocument" ADD CONSTRAINT "DriveDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveDocument" ADD CONSTRAINT "DriveDocument_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveDocument" ADD CONSTRAINT "DriveDocument_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "RawMaterialLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveDocument" ADD CONSTRAINT "DriveDocument_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveDocument" ADD CONSTRAINT "DriveDocument_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "ProductionBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveDocument" ADD CONSTRAINT "DriveDocument_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveDocument" ADD CONSTRAINT "DriveDocument_productionPaymentId_fkey" FOREIGN KEY ("productionPaymentId") REFERENCES "ProductionPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveDocument" ADD CONSTRAINT "DriveDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveDocument" ADD CONSTRAINT "DriveDocument_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
