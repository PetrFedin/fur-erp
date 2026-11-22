-- Витрина сырья для аналитики: всё, чтобы строить страницу без обращения к лотам, движениям и ТЗ.
ALTER TABLE "DmLot"
  ADD COLUMN "kindName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "auctionLabel" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "colorName" TEXT,
  ADD COLUMN "attrs" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "itemsQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
  ADD COLUMN "jIn" DECIMAL(18,3) NOT NULL DEFAULT 0,
  ADD COLUMN "jProdOut" DECIMAL(18,3) NOT NULL DEFAULT 0,
  ADD COLUMN "jOtherOut" DECIMAL(18,3) NOT NULL DEFAULT 0,
  ADD COLUMN "remCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "remCostExcl" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "purchaseNumber" TEXT;
ALTER TABLE "DmLotUse"
  ADD COLUMN "orderLabel" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "orderWo" TEXT,
  ADD COLUMN "modelId" TEXT NOT NULL DEFAULT '';
CREATE TABLE "DmLotBridge" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "furKind" TEXT NOT NULL,
  "auction" TEXT NOT NULL,
  "auctionLabel" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "qtyReceived" DECIMAL(18,3) NOT NULL,
  "qtyRemaining" DECIMAL(18,3) NOT NULL,
  "totalCost" DECIMAL(18,2) NOT NULL,
  "totalCostExcl" DECIMAL(18,2) NOT NULL,
  "usedCost" DECIMAL(18,2) NOT NULL,
  "usedCostExcl" DECIMAL(18,2) NOT NULL,
  "remCost" DECIMAL(18,2) NOT NULL,
  "remCostExcl" DECIMAL(18,2) NOT NULL,
  "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DmLotBridge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DmLotBridge_organizationId_key_key" ON "DmLotBridge"("organizationId", "key");
