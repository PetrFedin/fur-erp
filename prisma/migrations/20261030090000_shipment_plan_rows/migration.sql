-- Лист отгрузок: план и факт по датам со статусами производства.
CREATE TABLE "ShipmentPlanRow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "article" TEXT NOT NULL,
    "productModelId" TEXT,
    "productionOrderId" TEXT,
    "category" TEXT,
    "color" TEXT,
    "size" TEXT,
    "fur" TEXT,
    "lining" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentPlanRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShipmentPlanRow_organizationId_date_idx" ON "ShipmentPlanRow"("organizationId", "date");
CREATE INDEX "ShipmentPlanRow_organizationId_status_idx" ON "ShipmentPlanRow"("organizationId", "status");

ALTER TABLE "ShipmentPlanRow" ADD CONSTRAINT "ShipmentPlanRow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
