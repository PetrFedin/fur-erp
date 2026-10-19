-- CreateTable
CREATE TABLE "ReconciliationGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "counterparty" TEXT,
    "contract" TEXT,
    "year" INTEGER,
    "period" TEXT,
    "status" TEXT NOT NULL DEFAULT 'empty',
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "dbPurchases" TEXT[],
    "dbBatch" INTEGER,
    "advanceRub" DECIMAL(14,2),
    "details" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'ui',
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByName" TEXT,
    "deleteReason" TEXT,

    CONSTRAINT "ReconciliationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "no" TEXT,
    "date" DATE,
    "year" INTEGER,
    "amountRub" DECIMAL(14,2) NOT NULL,
    "vatRate" DECIMAL(5,2),
    "vatRub" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "purpose" TEXT NOT NULL DEFAULT '',
    "fileId" TEXT,
    "fileTitle" TEXT,
    "updNo" TEXT,
    "updDate" DATE,
    "refPurchase" TEXT,
    "refBatch" INTEGER,
    "refTz" TEXT,
    "refDocumentId" TEXT,
    "noInvoice" BOOLEAN NOT NULL DEFAULT false,
    "superseded" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "approvals" JSONB NOT NULL DEFAULT '[]',
    "notes" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ui',
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedByName" TEXT,
    "deleteReason" TEXT,

    CONSTRAINT "ReconciliationInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationInvoiceGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "shareRub" DECIMAL(14,2),
    "posInGroup" INTEGER NOT NULL DEFAULT 0,
    "posInInvoice" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReconciliationInvoiceGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationInvoicePayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "paidAt" DATE,
    "dateApprox" BOOLEAN NOT NULL DEFAULT false,
    "amountRub" DECIMAL(14,2) NOT NULL,
    "ppNo" TEXT,
    "basis" TEXT,
    "evidence" TEXT NOT NULL DEFAULT 'fact',
    "source" TEXT NOT NULL DEFAULT '',
    "fileId" TEXT,
    "note" TEXT,

    CONSTRAINT "ReconciliationInvoicePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationPaymentLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentId" TEXT,
    "productionPaymentId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationPaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationCheck" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "checkedDate" DATE NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL DEFAULT 'manual',
    "byUserId" TEXT,
    "byName" TEXT,
    "note" TEXT,
    "details" JSONB,

    CONSTRAINT "ReconciliationCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconciliationGroup_organizationId_section_idx" ON "ReconciliationGroup"("organizationId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationGroup_organizationId_key_key" ON "ReconciliationGroup"("organizationId", "key");

-- CreateIndex
CREATE INDEX "ReconciliationInvoice_organizationId_section_idx" ON "ReconciliationInvoice"("organizationId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationInvoice_organizationId_key_key" ON "ReconciliationInvoice"("organizationId", "key");

-- CreateIndex
CREATE INDEX "ReconciliationInvoiceGroup_groupId_idx" ON "ReconciliationInvoiceGroup"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationInvoiceGroup_invoiceId_groupId_key" ON "ReconciliationInvoiceGroup"("invoiceId", "groupId");

-- CreateIndex
CREATE INDEX "ReconciliationInvoicePayment_invoiceId_idx" ON "ReconciliationInvoicePayment"("invoiceId");

-- CreateIndex
CREATE INDEX "ReconciliationPaymentLink_organizationId_idx" ON "ReconciliationPaymentLink"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationPaymentLink_invoiceId_paymentId_key" ON "ReconciliationPaymentLink"("invoiceId", "paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationPaymentLink_invoiceId_productionPaymentId_key" ON "ReconciliationPaymentLink"("invoiceId", "productionPaymentId");

-- CreateIndex
CREATE INDEX "ReconciliationCheck_organizationId_checkedDate_idx" ON "ReconciliationCheck"("organizationId", "checkedDate");

-- AddForeignKey
ALTER TABLE "ReconciliationGroup" ADD CONSTRAINT "ReconciliationGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationInvoice" ADD CONSTRAINT "ReconciliationInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationInvoiceGroup" ADD CONSTRAINT "ReconciliationInvoiceGroup_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ReconciliationInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationInvoiceGroup" ADD CONSTRAINT "ReconciliationInvoiceGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ReconciliationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationInvoicePayment" ADD CONSTRAINT "ReconciliationInvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ReconciliationInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationPaymentLink" ADD CONSTRAINT "ReconciliationPaymentLink_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ReconciliationInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationCheck" ADD CONSTRAINT "ReconciliationCheck_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

