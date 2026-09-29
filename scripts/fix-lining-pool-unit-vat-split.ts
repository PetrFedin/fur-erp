/**
 * Fixes a bug in consolidate-lining-lots.ts (commit cfc5cd6): it summed
 * RawMaterialLot.materialCostExclVat/materialVatAmount across the merged
 * lots as if they were totals, but (confirmed against fur lots, where
 * materialCostExclVat exactly equals the PurchaseItem's excl-VAT
 * unitPrice) these are PER-UNIT fields, same as unitCost — they needed a
 * quantity-weighted average, not a sum. unitCost/totalCost/
 * quantityReceived/quantityRemaining were summed correctly (those really
 * are totals); only the two material-VAT-split fields were wrong.
 *
 * All 6 affected lining lots currently have expenseCostExclVat/
 * expenseVatAmount = 0 (no PurchaseExpense rows exist yet) and a uniform
 * vatRate, so materialCostExclVat can be derived exactly from the
 * (correct) unitCost: materialCostExclVat = unitCost / (1 + vatRate/100),
 * materialVatAmount = unitCost - materialCostExclVat. This script uses
 * that closed form rather than re-deriving a weighted average from
 * upstream data that's already been deleted by the consolidation —
 * verified it reproduces the untouched "Подкладочная ткань №2" lot's
 * already-correct values exactly, as a sanity check, before trusting it
 * for the other 6.
 *
 * Idempotent: re-running is a no-op once fields already satisfy the
 * identity above (within rounding).
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/fix-lining-pool-unit-vat-split.ts
 */
import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();

async function main() {
  const materials = await prisma.rawMaterial.findMany({ where: { unit: "M" } });
  let fixed = 0;
  let skipped = 0;

  for (const material of materials) {
    const lot = await prisma.rawMaterialLot.findFirst({ where: { rawMaterialId: material.id } });
    if (!lot) continue;

    if (!lot.expenseCostExclVat.isZero() || !lot.expenseVatAmount.isZero()) {
      console.log(`Skip ${material.name}: has non-zero allocated-expense VAT split, closed form doesn't apply — needs manual review`);
      skipped++;
      continue;
    }

    const correctMaterialExclVat = lot.unitCost.div(new Decimal(1).add(lot.vatRate.div(100)));
    const correctMaterialVat = lot.unitCost.sub(correctMaterialExclVat);

    const alreadyCorrect =
      lot.materialCostExclVat.sub(correctMaterialExclVat).abs().lessThan(0.01) &&
      lot.materialVatAmount.sub(correctMaterialVat).abs().lessThan(0.01);
    if (alreadyCorrect) {
      console.log(`Skip ${material.name}: already correct`);
      skipped++;
      continue;
    }

    await prisma.rawMaterialLot.update({
      where: { id: lot.id },
      data: {
        materialCostExclVat: correctMaterialExclVat,
        materialVatAmount: correctMaterialVat,
      },
    });
    console.log(
      `${material.name}: materialCostExclVat ${lot.materialCostExclVat.toString()} -> ${correctMaterialExclVat.toFixed(2)}, ` +
        `materialVatAmount ${lot.materialVatAmount.toString()} -> ${correctMaterialVat.toFixed(2)}`
    );
    fixed++;
  }

  console.log(`\nFixed: ${fixed}, skipped: ${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
