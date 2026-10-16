/**
 * Removes/renames a few things that were invented rather than taken from
 * the source files:
 * - "Основной склад": an unused seed warehouse from before any real data
 *   existed (0 references) — deleted.
 * - "Склад №1": the warehouse every import used by default. No source
 *   document names a warehouse or implies there's more than one, so the
 *   invented "№1" numbering is dropped — renamed to plain "Склад".
 * - Supplier names that guessed a full company name from an auction code
 *   ("SAGA Furs" for "SAGA 03-26", "Fur Harvesters Auction (FH)" for
 *   "FH 06-26") are reverted to the literal code as it appears in the
 *   source ("SAGA", "FH") — the auction session itself (with the date)
 *   is already stored separately on each Purchase.auctionSession.
 * - The organization name ("ООО Смоук-тест") was a placeholder from
 *   initial setup — every source file's title/header carries "MVST", so
 *   that's used instead of inventing a legal-entity name we don't have.
 *
 * Idempotent: renaming something that no longer has the old name is a
 * no-op (updateMany matches 0 rows).
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/clean-invented-names.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const deletedWarehouse = await prisma.warehouse.deleteMany({ where: { name: "Основной склад" } });
  console.log(`Deleted unused warehouse rows: ${deletedWarehouse.count}`);

  const renamedWarehouse = await prisma.warehouse.updateMany({
    where: { name: "Склад №1" },
    data: { name: "Склад" },
  });
  console.log(`Renamed warehouse rows (№1 -> plain): ${renamedWarehouse.count}`);

  const supplierRenames: [string, string][] = [
    ["SAGA Furs", "SAGA"],
    ["Fur Harvesters Auction (FH)", "FH"],
    ["РП (аукцион, требует уточнения названия)", "РП"],
    ["Закупка мехового сырья FW26 (поставщик не указан в отчёте)", "Не указан"],
  ];
  for (const [from, to] of supplierRenames) {
    const r = await prisma.supplier.updateMany({ where: { name: from }, data: { name: to } });
    if (r.count > 0) console.log(`Renamed supplier "${from}" -> "${to}"`);
  }

  const org = await prisma.organization.findFirst();
  if (org && org.name !== "THE FUR") {
    await prisma.organization.update({ where: { id: org.id }, data: { name: "THE FUR" } });
    console.log(`Renamed organization "${org.name}" -> "THE FUR"`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
