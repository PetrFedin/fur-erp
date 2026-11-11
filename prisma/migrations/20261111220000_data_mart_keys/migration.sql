ALTER TABLE "DmSku" ADD COLUMN "skuKey" TEXT NOT NULL DEFAULT '', ADD COLUMN "colorRefId" TEXT, ADD COLUMN "colorCanon" TEXT NOT NULL DEFAULT '';
CREATE INDEX "DmSku_organizationId_skuKey_idx" ON "DmSku"("organizationId", "skuKey");
ALTER TABLE "DmMovement" ADD COLUMN "colorKey" TEXT NOT NULL DEFAULT '';
CREATE TABLE "DmColorAlias" ("id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "alias" TEXT NOT NULL, "colorCanon" TEXT NOT NULL, "colorRefId" TEXT, "origin" TEXT NOT NULL, "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "DmColorAlias_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "DmColorAlias_organizationId_alias_key" ON "DmColorAlias"("organizationId", "alias");
CREATE TABLE "DmRetailPrice" ("id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "skuKey" TEXT NOT NULL, "acode" TEXT NOT NULL, "color" TEXT NOT NULL, "size" TEXT NOT NULL, "price" DECIMAL(18,2) NOT NULL, "asOf" TEXT, "source" TEXT NOT NULL, "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "DmRetailPrice_pkey" PRIMARY KEY ("id"));
CREATE INDEX "DmRetailPrice_organizationId_skuKey_idx" ON "DmRetailPrice"("organizationId", "skuKey");
CREATE TABLE "DmLoad" ("id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "source" TEXT NOT NULL, "sourceKey" TEXT NOT NULL, "asOf" TEXT, "rows" INTEGER NOT NULL, "note" TEXT, "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "DmLoad_pkey" PRIMARY KEY ("id"));
CREATE INDEX "DmLoad_organizationId_source_idx" ON "DmLoad"("organizationId", "source");
