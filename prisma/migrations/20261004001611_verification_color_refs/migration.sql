-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedBy" TEXT;

-- AlterTable
ALTER TABLE "ProductionBatch" ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedBy" TEXT,
ADD COLUMN     "verifyNote" TEXT;

-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN     "colorRefId" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedBy" TEXT,
ADD COLUMN     "verifyNote" TEXT;

-- AlterTable
ALTER TABLE "ProductionPayment" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedBy" TEXT;

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedBy" TEXT,
ADD COLUMN     "verifyNote" TEXT;

-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN     "colorRefId" TEXT;

-- AlterTable
ALTER TABLE "RawMaterialLot" ADD COLUMN     "colorRefId" TEXT;

-- CreateTable
CREATE TABLE "ColorRef" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ColorRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ColorRef_organizationId_idx" ON "ColorRef"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ColorRef_organizationId_name_key" ON "ColorRef"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "ColorRef" ADD CONSTRAINT "ColorRef_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_colorRefId_fkey" FOREIGN KEY ("colorRefId") REFERENCES "ColorRef"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialLot" ADD CONSTRAINT "RawMaterialLot_colorRefId_fkey" FOREIGN KEY ("colorRefId") REFERENCES "ColorRef"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_colorRefId_fkey" FOREIGN KEY ("colorRefId") REFERENCES "ColorRef"("id") ON DELETE SET NULL ON UPDATE CASCADE;
