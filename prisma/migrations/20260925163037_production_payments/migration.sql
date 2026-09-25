-- CreateTable
CREATE TABLE "ProductionPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionPayment_organizationId_idx" ON "ProductionPayment"("organizationId");

-- CreateIndex
CREATE INDEX "ProductionPayment_productionOrderId_idx" ON "ProductionPayment"("productionOrderId");

-- AddForeignKey
ALTER TABLE "ProductionPayment" ADD CONSTRAINT "ProductionPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPayment" ADD CONSTRAINT "ProductionPayment_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
