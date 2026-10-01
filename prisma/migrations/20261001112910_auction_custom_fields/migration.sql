-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN');

-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN     "extra" JSONB;

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entity" TEXT NOT NULL DEFAULT 'PURCHASE_ITEM',
    "name" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL DEFAULT 'TEXT',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomField_organizationId_entity_position_idx" ON "CustomField"("organizationId", "entity", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_organizationId_entity_name_key" ON "CustomField"("organizationId", "entity", "name");

-- AddForeignKey
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
