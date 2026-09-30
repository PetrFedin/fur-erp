-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PLANNED', 'SHIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FittingStatus" AS ENUM ('PLANNED', 'HELD_REMARKS', 'HELD_OK');

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "plannedDate" TIMESTAMP(3) NOT NULL,
    "shippedDate" TIMESTAMP(3),
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentLine" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "size" TEXT,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ShipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fitting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "fittingDate" TIMESTAMP(3) NOT NULL,
    "size" TEXT,
    "status" "FittingStatus" NOT NULL DEFAULT 'PLANNED',
    "comment" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fitting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FittingPhoto" (
    "id" TEXT NOT NULL,
    "fittingId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FittingPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shipment_organizationId_status_idx" ON "Shipment"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Shipment_plannedDate_idx" ON "Shipment"("plannedDate");

-- CreateIndex
CREATE INDEX "ShipmentLine_shipmentId_idx" ON "ShipmentLine"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentLine_productionOrderId_idx" ON "ShipmentLine"("productionOrderId");

-- CreateIndex
CREATE INDEX "Fitting_organizationId_idx" ON "Fitting"("organizationId");

-- CreateIndex
CREATE INDEX "Fitting_productionOrderId_idx" ON "Fitting"("productionOrderId");

-- CreateIndex
CREATE INDEX "FittingPhoto_fittingId_idx" ON "FittingPhoto"("fittingId");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fitting" ADD CONSTRAINT "Fitting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fitting" ADD CONSTRAINT "Fitting_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FittingPhoto" ADD CONSTRAINT "FittingPhoto_fittingId_fkey" FOREIGN KEY ("fittingId") REFERENCES "Fitting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
