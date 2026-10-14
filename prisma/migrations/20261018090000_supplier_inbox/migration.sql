-- Входящие от поставщика (Веллмех): расчёты по лотам аукционов и ТЗ — черновики на проверку.
CREATE TYPE "InboxStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED');
CREATE TYPE "InboxKind" AS ENUM ('AUCTION_CALC', 'TZ');
CREATE TYPE "InboxFileKind" AS ENUM ('AUCTION_INVOICE', 'PAYMENT_INVOICE', 'SPECIFICATION', 'UPD', 'OTHER');

CREATE TABLE "SupplierInbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "kind" "InboxKind" NOT NULL,
    "status" "InboxStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "note" TEXT,
    "reviewNote" TEXT,
    "sentAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdEntityType" TEXT,
    "createdEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplierInbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierInboxFile" (
    "id" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "kind" "InboxFileKind" NOT NULL DEFAULT 'OTHER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierInboxFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierInbox_organizationId_status_idx" ON "SupplierInbox"("organizationId", "status");
CREATE INDEX "SupplierInbox_supplierId_status_idx" ON "SupplierInbox"("supplierId", "status");
CREATE INDEX "SupplierInboxFile_inboxId_idx" ON "SupplierInboxFile"("inboxId");

ALTER TABLE "SupplierInbox" ADD CONSTRAINT "SupplierInbox_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInboxFile" ADD CONSTRAINT "SupplierInboxFile_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "SupplierInbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
