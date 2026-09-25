/**
 * The source spreadsheets write the same article code two ways: Latin
 * ("M001K") in newer files (FW26 purchase report, production-tracking
 * calendar) and Cyrillic look-alike ("МОО1К", note the double Cyrillic О)
 * in the older registry. "Реестр (единый)"'s own sheet "Лист16" (hidden)
 * carries the official Latin→Cyrillic mapping for ~24 codes — used here to
 * rename the Cyrillic ProductModel rows to their canonical Latin name.
 * Two more (М001Е→M001E, М025→M025) aren't in that table but were created
 * by scripts/import-supply-plan.ts as empty duplicates of an existing
 * Latin model with real production history — merged (not just renamed).
 *
 * Idempotent: renaming a name that no longer exists, or merging when only
 * one side exists, is a no-op.
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/merge-latin-cyrillic-models.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const RENAME_MAP: Record<string, string> = {
  М001А: "M001A", МОО1К: "M001K", М002: "M002", М002А: "M002A", М003: "M003", М004: "M004",
  М005: "M005", М006: "M006", М009: "M009", М010: "M010", М011: "M011", М011А: "M011A",
  М012: "M012", М013: "M013", М015: "M015", М016: "M016", М017: "M017", М018: "M018",
  М019: "M019", М020: "M020", М021: "M021", М022: "M022", МН02: "MH02", МН09: "MH09",
};

const MERGE_PAIRS: [string, string][] = [
  ["М001Е", "M001E"],
  ["М025", "M025"],
];

async function main() {
  let renamed = 0;
  for (const [cyr, latin] of Object.entries(RENAME_MAP)) {
    const r = await prisma.productModel.updateMany({ where: { name: cyr }, data: { name: latin } });
    renamed += r.count;
  }
  console.log(`Renamed ${renamed} models to their canonical Latin code.`);

  for (const [cyr, latin] of MERGE_PAIRS) {
    const cyrModel = await prisma.productModel.findFirst({ where: { name: cyr } });
    const latinModel = await prisma.productModel.findFirst({ where: { name: latin } });
    if (!cyrModel || !latinModel) continue;
    const moved = await prisma.supplyPlanEntry.updateMany({
      where: { productModelId: cyrModel.id },
      data: { productModelId: latinModel.id },
    });
    await prisma.productModel.delete({ where: { id: cyrModel.id } });
    console.log(`Merged ${cyr} into ${latin} (moved ${moved.count} supply plan entries).`);
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
