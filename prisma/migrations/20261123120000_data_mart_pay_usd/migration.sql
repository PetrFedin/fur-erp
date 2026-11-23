-- Витрина: оплаты и долг по аукционам и закупкам, цена шкуры в долларах по лотам.
ALTER TABLE "DmLot" ADD COLUMN "usdUnit" DECIMAL(18,4);
ALTER TABLE "DmPurchase" ADD COLUMN "payTotal" DECIMAL(18,2) NOT NULL DEFAULT 0, ADD COLUMN "paidShare" DECIMAL(18,2) NOT NULL DEFAULT 0;
CREATE TABLE "DmAuction" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "purchases" INTEGER NOT NULL,
  "total" DECIMAL(18,2) NOT NULL,
  "paid" DECIMAL(18,2) NOT NULL,
  "remaining" DECIMAL(18,2) NOT NULL,
  "status" TEXT NOT NULL,
  "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DmAuction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DmAuction_organizationId_name_key" ON "DmAuction"("organizationId", "name");
