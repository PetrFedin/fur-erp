-- Документы поставщика во «Входящих» и календарь поставщика по артикулу.
ALTER TYPE "InboxKind" ADD VALUE IF NOT EXISTS 'DOCUMENT';

ALTER TABLE "CalendarEvent" ADD COLUMN "supplierId" TEXT,
ADD COLUMN "status" TEXT,
ADD COLUMN "factDate" TIMESTAMP(3),
ADD COLUMN "color" TEXT,
ADD COLUMN "size" TEXT,
ADD COLUMN "docNote" TEXT;

CREATE INDEX "CalendarEvent_supplierId_date_idx" ON "CalendarEvent"("supplierId", "date");

ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
