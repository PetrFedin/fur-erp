-- Отгрузки: стадия строки (просмотр / доработка / готов к отгрузке), номер изделия, пункты доработки.
-- Только добавление: старые данные не меняются.
CREATE TYPE "ShipmentLineStage" AS ENUM ('REVIEW', 'REWORK', 'READY');
CREATE TYPE "ShipmentReworkState" AS ENUM ('OPEN', 'DONE', 'MORE');

ALTER TABLE "ShipmentLine" ADD COLUMN     "stage" "ShipmentLineStage" NOT NULL DEFAULT 'REVIEW',
ADD COLUMN     "itemNo" TEXT,
ADD COLUMN     "stageChangedAt" TIMESTAMP(3),
ADD COLUMN     "stageChangedBy" TEXT;

CREATE TABLE "ShipmentLineRework" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "state" "ShipmentReworkState" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ShipmentLineRework_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShipmentLineRework_lineId_idx" ON "ShipmentLineRework"("lineId");

ALTER TABLE "ShipmentLineRework" ADD CONSTRAINT "ShipmentLineRework_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ShipmentLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
