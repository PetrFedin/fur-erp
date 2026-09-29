-- Flip the RawMaterialLot <-> PurchaseItem relation so the FK lives on
-- PurchaseItem (non-unique) instead of on RawMaterialLot (unique).
--
-- Why: RawMaterialLot.purchaseItemId was @unique, i.e. strictly one
-- PurchaseItem per lot. That's correct for fur (specific identification:
-- every receipt creates its own lot), but lining fabric (RawMaterial.unit
-- === "M") was consolidated in cfc5cd6 into one aggregate pool lot per
-- fabric, and every future purchase of that fabric needs to add a NEW
-- PurchaseItem row (one per receipt document, for traceability) pointing at
-- that SAME existing lot — which a unique FK on the lot side cannot express.
-- Moving the FK onto PurchaseItem.lotId (a plain nullable, non-unique
-- foreign key) lets many PurchaseItems point at one lot; fur still ends up
-- one-to-one in practice, just no longer enforced by a DB constraint.
--
-- Step 1: add the new column, nullable.
ALTER TABLE "PurchaseItem" ADD COLUMN "lotId" TEXT;

-- Step 2: backfill from the existing one-to-one link before dropping it.
UPDATE "PurchaseItem" pi
SET "lotId" = rml.id
FROM "RawMaterialLot" rml
WHERE rml."purchaseItemId" = pi.id;

-- Step 3: index + FK on the new column.
CREATE INDEX "PurchaseItem_lotId_idx" ON "PurchaseItem"("lotId");
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "RawMaterialLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 4: drop the old FK/unique index/column on RawMaterialLot.
ALTER TABLE "RawMaterialLot" DROP CONSTRAINT "RawMaterialLot_purchaseItemId_fkey";
DROP INDEX "RawMaterialLot_purchaseItemId_key";
ALTER TABLE "RawMaterialLot" DROP COLUMN "purchaseItemId";
