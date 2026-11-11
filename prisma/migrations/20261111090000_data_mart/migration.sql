-- CreateTable
CREATE TABLE "DmSku" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "modelCode" TEXT NOT NULL,
    "acode" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "cls" TEXT NOT NULL,
    "fur" TEXT,
    "cat1" TEXT,
    "cat2" TEXT,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmSku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmSkuSeason" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "conf" DECIMAL(14,3) NOT NULL,
    "deliv" DECIMAL(14,3) NOT NULL,
    "confEur" DECIMAL(18,4) NOT NULL,
    "delivEur" DECIMAL(18,4) NOT NULL,
    "soldAll" DECIMAL(14,3) NOT NULL,
    "soldSsn" DECIMAL(14,3) NOT NULL,
    "soldOld" DECIMAL(14,3) NOT NULL,
    "rubAll" DECIMAL(18,4) NOT NULL,
    "discAll" DECIMAL(18,4) NOT NULL,
    "scAll" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "DmSkuSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmStock" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "deliv" DECIMAL(14,3) NOT NULL,
    "sold" DECIMAL(14,3) NOT NULL,
    "stock" DECIMAL(14,3) NOT NULL,
    "retailPrice" DECIMAL(18,2),
    "stockRetailRub" DECIMAL(18,2) NOT NULL,
    "unitCostAvgRub" DECIMAL(18,2),
    "unitCostReportRub" DECIMAL(18,2),
    "stockCostAvgRub" DECIMAL(18,2),
    "stockCostReportRub" DECIMAL(18,2),
    "costSource" TEXT,
    "flags" TEXT[],

    CONSTRAINT "DmStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmCostParty" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unitCostRub" DECIMAL(18,2) NOT NULL,
    "workRub" DECIMAL(18,2) NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DmCostParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "modelCode" TEXT NOT NULL,
    "acode" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "season" TEXT NOT NULL,
    "pcs" INTEGER NOT NULL,
    "retailRub" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "DmMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmCheck" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "expected" DECIMAL(20,4),
    "actual" DECIMAL(20,4),
    "status" TEXT NOT NULL,
    "note" TEXT,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DmSku_organizationId_modelCode_idx" ON "DmSku"("organizationId", "modelCode");

-- CreateIndex
CREATE UNIQUE INDEX "DmSku_organizationId_acode_color_size_key" ON "DmSku"("organizationId", "acode", "color", "size");

-- CreateIndex
CREATE UNIQUE INDEX "DmSkuSeason_skuId_season_key" ON "DmSkuSeason"("skuId", "season");

-- CreateIndex
CREATE UNIQUE INDEX "DmStock_skuId_key" ON "DmStock"("skuId");

-- CreateIndex
CREATE INDEX "DmCostParty_organizationId_orderNumber_idx" ON "DmCostParty"("organizationId", "orderNumber");

-- CreateIndex
CREATE INDEX "DmCostParty_skuId_idx" ON "DmCostParty"("skuId");

-- CreateIndex
CREATE INDEX "DmMovement_organizationId_modelCode_idx" ON "DmMovement"("organizationId", "modelCode");

-- CreateIndex
CREATE INDEX "DmMovement_organizationId_date_idx" ON "DmMovement"("organizationId", "date");

-- CreateIndex
CREATE INDEX "DmCheck_organizationId_key_idx" ON "DmCheck"("organizationId", "key");

-- AddForeignKey
ALTER TABLE "DmSkuSeason" ADD CONSTRAINT "DmSkuSeason_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "DmSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmStock" ADD CONSTRAINT "DmStock_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "DmSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmCostParty" ADD CONSTRAINT "DmCostParty_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "DmSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

