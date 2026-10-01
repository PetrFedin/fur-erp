-- AlterTable
ALTER TABLE "DriveDocument" ADD COLUMN     "storagePath" TEXT,
ADD COLUMN     "storedAt" TIMESTAMP(3),
ADD COLUMN     "storedMime" TEXT,
ADD COLUMN     "storedName" TEXT,
ADD COLUMN     "storedSize" INTEGER;
