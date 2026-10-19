-- Поступления товара и розничные продажи по датам (выгрузка «поступления и продажи»). Только новая таблица; идемпотентно.
DO $$ BEGIN
  CREATE TYPE "SalesLineKind" AS ENUM ('RECEIPT', 'SALE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SalesReceiptLine" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "kind" "SalesLineKind" NOT NULL,
  "orderNo" TEXT NOT NULL,
  "season" TEXT NOT NULL,
  "article" TEXT NOT NULL,
  "fabric" TEXT,
  "colorId" TEXT,
  "modelCode" TEXT,
  "level2" TEXT,
  "level3" TEXT,
  "level4" TEXT,
  "level5" TEXT,
  "date" DATE NOT NULL,
  "pcs" INTEGER,
  "retailEur" DECIMAL(16,4),
  "retailEurExVat" DECIMAL(16,4),
  "retailRub" DECIMAL(16,4),
  "retailRubExVat" DECIMAL(16,4),
  "discountEur" DECIMAL(16,4),
  "discountEurExVat" DECIMAL(16,4),
  "discountRub" DECIMAL(16,4),
  "discountRubExVat" DECIMAL(16,4),
  "importTag" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesReceiptLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SalesReceiptLine_organizationId_sourceKey_key" ON "SalesReceiptLine"("organizationId", "sourceKey");
CREATE INDEX IF NOT EXISTS "SalesReceiptLine_organizationId_kind_date_idx" ON "SalesReceiptLine"("organizationId", "kind", "date");
CREATE INDEX IF NOT EXISTS "SalesReceiptLine_organizationId_modelCode_idx" ON "SalesReceiptLine"("organizationId", "modelCode");
CREATE INDEX IF NOT EXISTS "SalesReceiptLine_organizationId_season_idx" ON "SalesReceiptLine"("organizationId", "season");
DO $$ BEGIN
  ALTER TABLE "SalesReceiptLine" ADD CONSTRAINT "SalesReceiptLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
