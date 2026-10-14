-- Отгрузки: приёмка по строкам, «на ком» этап, загрузка документов этапа, подтверждение приёмки.
-- Только добавление: старые данные не меняются.
ALTER TYPE "ShipmentStatus" ADD VALUE 'ACCEPTED';

ALTER TABLE "Shipment" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "acceptedBy" TEXT,
ADD COLUMN     "acceptEventId" TEXT;

ALTER TABLE "ShipmentLine" ADD COLUMN     "acceptedQty" INTEGER,
ADD COLUMN     "returnedQty" INTEGER;

ALTER TABLE "ShipmentEvent" ADD COLUMN     "side" TEXT;

ALTER TABLE "DriveDocument" ADD COLUMN     "shipmentEventId" TEXT;

CREATE INDEX "DriveDocument_shipmentEventId_idx" ON "DriveDocument"("shipmentEventId");

ALTER TABLE "DriveDocument" ADD CONSTRAINT "DriveDocument_shipmentEventId_fkey" FOREIGN KEY ("shipmentEventId") REFERENCES "ShipmentEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
