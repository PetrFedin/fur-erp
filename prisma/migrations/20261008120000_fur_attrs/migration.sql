-- CreateTable
CREATE TABLE "FurAttrRef" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT,
    "furKind" TEXT,
    "aliases" TEXT[],
    "description" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "autoDetect" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FurAttrRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawMaterialLotAttr" (
    "lotId" TEXT NOT NULL,
    "attrId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawMaterialLotAttr_pkey" PRIMARY KEY ("lotId","attrId")
);

-- CreateTable
CREATE TABLE "ProductionOrderAttr" (
    "orderId" TEXT NOT NULL,
    "attrId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionOrderAttr_pkey" PRIMARY KEY ("orderId","attrId")
);

-- CreateIndex
CREATE INDEX "FurAttrRef_organizationId_idx" ON "FurAttrRef"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FurAttrRef_organizationId_name_key" ON "FurAttrRef"("organizationId", "name");

-- CreateIndex
CREATE INDEX "RawMaterialLotAttr_attrId_idx" ON "RawMaterialLotAttr"("attrId");

-- CreateIndex
CREATE INDEX "ProductionOrderAttr_attrId_idx" ON "ProductionOrderAttr"("attrId");

-- AddForeignKey
ALTER TABLE "FurAttrRef" ADD CONSTRAINT "FurAttrRef_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialLotAttr" ADD CONSTRAINT "RawMaterialLotAttr_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "RawMaterialLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialLotAttr" ADD CONSTRAINT "RawMaterialLotAttr_attrId_fkey" FOREIGN KEY ("attrId") REFERENCES "FurAttrRef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderAttr" ADD CONSTRAINT "ProductionOrderAttr_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderAttr" ADD CONSTRAINT "ProductionOrderAttr_attrId_fkey" FOREIGN KEY ("attrId") REFERENCES "FurAttrRef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
