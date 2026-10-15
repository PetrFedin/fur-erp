-- Подрядчики: Supplier.isContractor / suppliesRaw, договоры (SupplierContract), ProductionOrder.contractorId, ProductionPayment.contractorId.
-- Идемпотентно (можно прогнать повторно). Перенос: Веллмех становится подрядчиком, договоры №2502 (купля-продажа) и №1605 (подряд)
-- заводятся записями, у ТЗ с договором №1605 подрядчик = Веллмех (как определялось раньше по номеру договора).

ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "suppliesRaw" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "isContractor" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  CREATE TYPE "ContractKind" AS ENUM ('SUPPLY', 'WORK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SupplierContract" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "date" TIMESTAMP(3),
  "kind" "ContractKind" NOT NULL,
  "note" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierContract_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SupplierContract_organizationId_supplierId_number_key" ON "SupplierContract"("organizationId", "supplierId", "number");
CREATE INDEX IF NOT EXISTS "SupplierContract_organizationId_idx" ON "SupplierContract"("organizationId");
CREATE INDEX IF NOT EXISTS "SupplierContract_supplierId_idx" ON "SupplierContract"("supplierId");
DO $$ BEGIN
  ALTER TABLE "SupplierContract" ADD CONSTRAINT "SupplierContract_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "SupplierContract" ADD CONSTRAINT "SupplierContract_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ProductionOrder" ADD COLUMN IF NOT EXISTS "contractorId" TEXT;
CREATE INDEX IF NOT EXISTS "ProductionOrder_contractorId_idx" ON "ProductionOrder"("contractorId");
DO $$ BEGIN
  ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ProductionPayment" ADD COLUMN IF NOT EXISTS "contractorId" TEXT;
CREATE INDEX IF NOT EXISTS "ProductionPayment_contractorId_idx" ON "ProductionPayment"("contractorId");
DO $$ BEGIN
  ALTER TABLE "ProductionPayment" ADD CONSTRAINT "ProductionPayment_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Перенос данных. Веллмех: единственный поставщик организации с таким названием (если не один — ничего не трогаем).
WITH w AS (
  SELECT s."organizationId", MIN(s."id") AS id
  FROM "Supplier" s
  WHERE s."name" ~* 'в[еэ]лл?м[еэ][хк]'
  GROUP BY s."organizationId"
  HAVING COUNT(*) = 1
)
UPDATE "Supplier" s SET "isContractor" = true FROM w WHERE s."id" = w.id;

INSERT INTO "SupplierContract" ("id", "organizationId", "supplierId", "number", "date", "kind", "note")
SELECT 'ctr_' || md5(s."id" || ':2502'), s."organizationId", s."id", '2502', TIMESTAMP '2025-02-26', 'SUPPLY', 'Договор купли-продажи сырья'
FROM "Supplier" s WHERE s."isContractor" AND s."name" ~* 'в[еэ]лл?м[еэ][хк]'
ON CONFLICT DO NOTHING;
INSERT INTO "SupplierContract" ("id", "organizationId", "supplierId", "number", "date", "kind", "note")
SELECT 'ctr_' || md5(s."id" || ':1605'), s."organizationId", s."id", '1605', TIMESTAMP '2025-05-16', 'WORK', 'Договор подряда (пошив по ТЗ)'
FROM "Supplier" s WHERE s."isContractor" AND s."name" ~* 'в[еэ]лл?м[еэ][хк]'
ON CONFLICT DO NOTHING;

-- ТЗ с договором подряда №1605 → подрядчик Веллмех (только там, где подрядчик ещё не задан).
UPDATE "ProductionOrder" o SET "contractorId" = c."supplierId"
FROM "SupplierContract" c
WHERE c."organizationId" = o."organizationId" AND c."number" = '1605' AND c."kind" = 'WORK'
  AND o."contractorId" IS NULL
  AND o."contractNumber" ~ '(^|[^0-9])1605([^0-9]|$)';

-- Оплаты за работу: получатель = единственный подрядчик связанных ТЗ (разные или нет ТЗ — остаётся пустым).
UPDATE "ProductionPayment" p SET "contractorId" = x.cid
FROM (
  SELECT l."productionPaymentId" AS pid, MIN(o."contractorId") AS cid
  FROM (
    SELECT "productionPaymentId", "productionOrderId" FROM "ProductionPaymentOrder"
    UNION
    SELECT "productionPaymentId", "productionOrderId" FROM "PaymentAllocation"
  ) l
  JOIN "ProductionOrder" o ON o."id" = l."productionOrderId"
  GROUP BY l."productionPaymentId"
  HAVING COUNT(DISTINCT o."contractorId") = 1 AND COUNT(*) FILTER (WHERE o."contractorId" IS NULL) = 0
) x
WHERE p."id" = x.pid AND p."contractorId" IS NULL;
