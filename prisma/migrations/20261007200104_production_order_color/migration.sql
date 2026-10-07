-- CreateTable
CREATE TABLE "ProductionOrderColor" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "colorRefId" TEXT NOT NULL,
    "quantity" INTEGER,
    "sizes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionOrderColor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionOrderColor_orderId_idx" ON "ProductionOrderColor"("orderId");

-- CreateIndex
CREATE INDEX "ProductionOrderColor_colorRefId_idx" ON "ProductionOrderColor"("colorRefId");

-- AddForeignKey
ALTER TABLE "ProductionOrderColor" ADD CONSTRAINT "ProductionOrderColor_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderColor" ADD CONSTRAINT "ProductionOrderColor_colorRefId_fkey" FOREIGN KEY ("colorRefId") REFERENCES "ColorRef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
