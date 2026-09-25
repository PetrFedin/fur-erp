-- CreateEnum
CREATE TYPE "SupplyPlanStatus" AS ENUM ('PLANNED', 'LAUNCHED', 'WITH_FURRIER', 'WITH_TAILOR', 'PRODUCED', 'CANCELLED');

-- CreateTable
CREATE TABLE "SupplyPlanEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productModelId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "status" "SupplyPlanStatus" NOT NULL DEFAULT 'PLANNED',
    "quantity" DECIMAL(14,3) NOT NULL,
    "eventDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyPlanEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplyPlanEntry_organizationId_idx" ON "SupplyPlanEntry"("organizationId");

-- CreateIndex
CREATE INDEX "SupplyPlanEntry_productModelId_idx" ON "SupplyPlanEntry"("productModelId");

-- CreateIndex
CREATE INDEX "SupplyPlanEntry_month_idx" ON "SupplyPlanEntry"("month");

-- AddForeignKey
ALTER TABLE "SupplyPlanEntry" ADD CONSTRAINT "SupplyPlanEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyPlanEntry" ADD CONSTRAINT "SupplyPlanEntry_productModelId_fkey" FOREIGN KEY ("productModelId") REFERENCES "ProductModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
