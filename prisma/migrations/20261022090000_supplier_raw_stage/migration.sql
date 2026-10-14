-- CreateTable
CREATE TABLE "SupplierRawStage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "lotId" TEXT,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "place" TEXT,
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "factStart" TIMESTAMP(3),
    "factEnd" TIMESTAMP(3),
    "qty" INTEGER,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierRawStage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierRawStage_organizationId_purchaseId_idx" ON "SupplierRawStage"("organizationId", "purchaseId");

-- CreateIndex
CREATE INDEX "SupplierRawStage_supplierId_status_idx" ON "SupplierRawStage"("supplierId", "status");

-- AddForeignKey
ALTER TABLE "SupplierRawStage" ADD CONSTRAINT "SupplierRawStage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRawStage" ADD CONSTRAINT "SupplierRawStage_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRawStage" ADD CONSTRAINT "SupplierRawStage_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRawStage" ADD CONSTRAINT "SupplierRawStage_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "RawMaterialLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

