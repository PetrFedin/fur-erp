-- CreateEnum
CREATE TYPE "AuctionKind" AS ENUM ('FUR', 'LINING', 'MATERIALS', 'OTHER');

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "auctionId" TEXT;

-- CreateTable
CREATE TABLE "Auction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT,
    "house" TEXT,
    "kind" "AuctionKind" NOT NULL DEFAULT 'FUR',
    "year" INTEGER,
    "month" INTEGER,
    "currency" TEXT,
    "auctionDate" TIMESTAMP(3),
    "aliases" TEXT[],
    "isService" BOOLEAN NOT NULL DEFAULT false,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Auction_organizationId_idx" ON "Auction"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Auction_organizationId_name_key" ON "Auction"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Purchase_auctionId_idx" ON "Purchase"("auctionId");

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
