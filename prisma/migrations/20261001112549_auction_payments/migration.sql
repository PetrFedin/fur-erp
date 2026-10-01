-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('ADVANCE', 'PARTIAL', 'FINAL', 'OTHER');

-- AlterEnum
ALTER TYPE "PurchaseDocumentKind" ADD VALUE 'PAYMENT_PROOF';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "auctionSession" TEXT,
ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "kind" "PaymentKind" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "percent" DECIMAL(7,3);

-- CreateIndex
CREATE INDEX "Payment_organizationId_auctionSession_idx" ON "Payment"("organizationId", "auctionSession");

-- CreateIndex
CREATE INDEX "Payment_documentId_idx" ON "Payment"("documentId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "PurchaseDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
