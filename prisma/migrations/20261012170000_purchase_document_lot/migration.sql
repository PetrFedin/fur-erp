-- Документы лота (УПД, счёт, спецификация): необязательная привязка документа закупки к лоту. Аддитивно, без потери данных.
ALTER TABLE "PurchaseDocument" ADD COLUMN "lotId" TEXT;
CREATE INDEX "PurchaseDocument_lotId_idx" ON "PurchaseDocument"("lotId");
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "RawMaterialLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
