-- AlterTable
ALTER TABLE "ProductModel" ADD COLUMN     "aliases" TEXT[],
ADD COLUMN     "salesCode" TEXT,
ADD COLUMN     "salesName" TEXT;

-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN     "seasonId" TEXT;

-- CreateTable
CREATE TABLE "FurRef" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "aliases" TEXT[],
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FurRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "seasonId" TEXT,
    "modelId" TEXT,
    "articleCode" TEXT NOT NULL,
    "articleName" TEXT,
    "color" TEXT,
    "furType" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionPlanSize" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ProductionPlanSize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "articleCode" TEXT NOT NULL,
    "articleName" TEXT,
    "quantity" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "seasonId" TEXT,
    "planId" TEXT,
    "orderId" TEXT,
    "notes" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FurRef_organizationId_idx" ON "FurRef"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FurRef_organizationId_name_key" ON "FurRef"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Season_organizationId_idx" ON "Season"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Season_organizationId_code_key" ON "Season"("organizationId", "code");

-- CreateIndex
CREATE INDEX "ProductionPlan_organizationId_idx" ON "ProductionPlan"("organizationId");

-- CreateIndex
CREATE INDEX "ProductionPlan_seasonId_idx" ON "ProductionPlan"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionPlanSize_planId_size_key" ON "ProductionPlanSize"("planId", "size");

-- CreateIndex
CREATE INDEX "CalendarEvent_organizationId_date_idx" ON "CalendarEvent"("organizationId", "date");

-- CreateIndex
CREATE INDEX "CalendarEvent_seasonId_idx" ON "CalendarEvent"("seasonId");

-- AddForeignKey
ALTER TABLE "FurRef" ADD CONSTRAINT "FurRef_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlan" ADD CONSTRAINT "ProductionPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlan" ADD CONSTRAINT "ProductionPlan_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlanSize" ADD CONSTRAINT "ProductionPlanSize_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;
