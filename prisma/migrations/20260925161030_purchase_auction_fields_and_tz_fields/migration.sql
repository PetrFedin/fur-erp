-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN     "lining" TEXT,
ADD COLUMN     "materialDescription" TEXT;

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "auctionSession" TEXT,
ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "transferDocument" TEXT;
