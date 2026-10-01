-- CreateEnum
CREATE TYPE "PurchaseDocumentKind" AS ENUM ('AUCTION_INVOICE', 'SPECIFICATION', 'ADVANCE_INVOICE', 'CALC_SHEET', 'UPD', 'OTHER');

-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN     "costPlan" JSONB;

-- CreateTable
CREATE TABLE "PurchaseDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "batch" TEXT,
    "kind" "PurchaseDocumentKind" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseDocument_organizationId_batch_idx" ON "PurchaseDocument"("organizationId", "batch");

-- CreateIndex
CREATE INDEX "PurchaseDocument_purchaseId_idx" ON "PurchaseDocument"("purchaseId");

-- AddForeignKey
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
