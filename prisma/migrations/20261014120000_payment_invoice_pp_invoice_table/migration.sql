-- Номер счёта и номер п/п отдельными полями у оплат (docRef остаётся).
ALTER TABLE "Payment" ADD COLUMN     "invoiceNo" TEXT,
ADD COLUMN     "ppNo" TEXT;

ALTER TABLE "ProductionPayment" ADD COLUMN     "invoiceNo" TEXT,
ADD COLUMN     "ppNo" TEXT;

-- Счёт поставщика.
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "supplierId" TEXT,
    "amountInclVat" DECIMAL(14,2),
    "vatRate" DECIMAL(5,2),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Invoice_organizationId_supplierId_number_idx" ON "Invoice"("organizationId", "supplierId", "number");

ALTER TABLE "Purchase" ADD COLUMN     "invoiceId" TEXT;

CREATE INDEX "Purchase_invoiceId_idx" ON "Purchase"("invoiceId");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
