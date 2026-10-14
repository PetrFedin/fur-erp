-- Отгрузки как карточки с хронологией этапов: только добавление полей и таблиц, старые данные не меняются.
ALTER TABLE "Shipment" ADD COLUMN     "name" TEXT,
ADD COLUMN     "supplierId" TEXT,
ADD COLUMN     "batchId" TEXT;

ALTER TABLE "ShipmentLine" ADD COLUMN     "color" TEXT,
ADD COLUMN     "furKind" TEXT,
ADD COLUMN     "comment" TEXT;

CREATE TABLE "ShipmentEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "timeKnown" BOOLEAN NOT NULL DEFAULT true,
    "responsibleUserId" TEXT,
    "responsibleName" TEXT,
    "place" TEXT,
    "details" TEXT,
    "docLinks" TEXT,
    "expected" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ShipmentEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShipmentEventLine" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "shipmentLineId" TEXT NOT NULL,
    "qty" INTEGER,
    "accepted" INTEGER,
    "rejected" INTEGER,
    "returned" INTEGER,
    "comment" TEXT,

    CONSTRAINT "ShipmentEventLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Shipment_supplierId_idx" ON "Shipment"("supplierId");
CREATE INDEX "Shipment_batchId_idx" ON "Shipment"("batchId");
CREATE INDEX "ShipmentEvent_shipmentId_idx" ON "ShipmentEvent"("shipmentId");
CREATE INDEX "ShipmentEvent_occurredAt_idx" ON "ShipmentEvent"("occurredAt");
CREATE INDEX "ShipmentEventLine_eventId_idx" ON "ShipmentEventLine"("eventId");
CREATE INDEX "ShipmentEventLine_shipmentLineId_idx" ON "ShipmentEventLine"("shipmentLineId");

ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShipmentEventLine" ADD CONSTRAINT "ShipmentEventLine_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ShipmentEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShipmentEventLine" ADD CONSTRAINT "ShipmentEventLine_shipmentLineId_fkey" FOREIGN KEY ("shipmentLineId") REFERENCES "ShipmentLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
