-- AlterTable
ALTER TABLE "ProductModel" ADD COLUMN     "categoryRefId" TEXT;

-- CreateTable
CREATE TABLE "CategoryRef" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CategoryRef_organizationId_idx" ON "CategoryRef"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryRef_organizationId_name_key" ON "CategoryRef"("organizationId", "name");

-- CreateIndex
CREATE INDEX "ProductModel_categoryRefId_idx" ON "ProductModel"("categoryRefId");

-- AddForeignKey
ALTER TABLE "CategoryRef" ADD CONSTRAINT "CategoryRef_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModel" ADD CONSTRAINT "ProductModel_categoryRefId_fkey" FOREIGN KEY ("categoryRefId") REFERENCES "CategoryRef"("id") ON DELETE SET NULL ON UPDATE CASCADE;
