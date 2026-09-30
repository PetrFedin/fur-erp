/**
 * Audit of every fur lot's material against the Excel registry's "остатки"
 * sheet (the user's confirmed source of truth: "расчеты в екселе правильные
 * по каждому тз и максимально детализированы") found 6 lots filed under
 * the wrong material in the DB. Bought/remaining quantities match Excel
 * exactly for all six, so these are the same lots, just mislabeled:
 *
 *  - 106, 107, 109, 1333, 1358: Excel says "Соболь", DB had "Норка".
 *    (Independent confirmation: ТЗ132's signed appendix lists lots 106,
 *    107, 109, 1358 in a "Соболь дикий выделанный" table.) 57 pcs of
 *    sable stock were being counted as mink.
 *  - 505055: Excel says "Норка" ("Mink am. Pastel M"), DB had "Соболь"
 *    with a garbled grade — "Соболь дикий выделанный (лавандер 2039)
 *    шкура норки американская пастель" — two unrelated descriptions
 *    concatenated (the sable half belongs to lot 634). Grade is reset to
 *    the part that matches both the Excel description and the ТЗ126
 *    appendix's material line: "шкура норки американская пастель".
 *
 * Deliberately NOT changed: lot 160045. Excel's category cell says
 * "Норка" but its own description is "Arctic marble frost fox" and every
 * ТЗ appendix that uses it says "лиса арктическая" — the DB's "Лиса" is
 * right; the Excel category cell is the typo.
 *
 * Reassigns rawMaterialId on the lot and everything that denormalizes it
 * (purchase items via lotId, material usages, stock movements).
 * Idempotent: a lot already on the target material is skipped.
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/fix-mislabeled-lot-materials.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FIXES: { lotNumber: string; toMaterial: string; grade?: string }[] = [
  { lotNumber: "106", toMaterial: "Соболь" },
  { lotNumber: "107", toMaterial: "Соболь" },
  { lotNumber: "109", toMaterial: "Соболь" },
  { lotNumber: "1333", toMaterial: "Соболь" },
  { lotNumber: "1358", toMaterial: "Соболь" },
  { lotNumber: "505055", toMaterial: "Норка", grade: "шкура норки американская пастель" },
];

async function main() {
  for (const fix of FIXES) {
    const target = await prisma.rawMaterial.findFirstOrThrow({ where: { name: fix.toMaterial } });
    const lots = await prisma.rawMaterialLot.findMany({
      where: { lotNumber: fix.lotNumber, rawMaterialId: { not: target.id } },
    });
    if (lots.length === 0) {
      console.log(`Lot ${fix.lotNumber}: already on "${fix.toMaterial}", skipping.`);
      continue;
    }
    if (lots.length > 1) {
      console.log(`Lot ${fix.lotNumber}: ${lots.length} lots share this number — needs manual review, skipping.`);
      continue;
    }
    const lot = lots[0];
    await prisma.$transaction([
      prisma.rawMaterialLot.update({
        where: { id: lot.id },
        data: { rawMaterialId: target.id, ...(fix.grade ? { grade: fix.grade } : {}) },
      }),
      prisma.purchaseItem.updateMany({
        where: { lotId: lot.id },
        data: { rawMaterialId: target.id, ...(fix.grade ? { grade: fix.grade } : {}) },
      }),
      prisma.productionMaterialUsage.updateMany({ where: { lotId: lot.id }, data: { rawMaterialId: target.id } }),
      prisma.stockMovement.updateMany({ where: { lotId: lot.id }, data: { rawMaterialId: target.id } }),
    ]);
    console.log(`Lot ${fix.lotNumber}: moved to "${fix.toMaterial}".`);
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
