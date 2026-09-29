/**
 * Fresh duplicate-article audit (third pass), run after
 * merge-latin-cyrillic-models.ts and merge-remaining-model-dupes.ts.
 * Normalizes every ProductModel.name by mapping visually-identical
 * Cyrillic look-alike letters to their Latin equivalents (А→A, В→B, Е→E,
 * К→K, М→M, Н→H, О→O, Р→P, С→C, Т→T, У→Y, Х→X, upper+lowercase) and groups
 * by the normalized form. Two new pairs turned up that the earlier two
 * passes missed: "МН06"/"MH06" and "МН17"/"MH17" (Cyrillic М+Н vs Latin
 * M+H — earlier passes only covered pairs starting with Cyrillic М alone
 * or specific listed codes, not this МН- prefix family).
 *
 * Both sides of both pairs have real, independent production history
 * (ProductionOrder, FinishedGoodsMovement, FinishedGoodsStock) — not an
 * empty duplicate — so this does a full merge, same pattern as
 * merge-remaining-model-dupes.ts: reassign ProductionOrder/
 * SupplyPlanEntry/ProductModelMaterial/FinishedGoodsMovement to the
 * canonical Latin model, combine FinishedGoodsStock by weighted average,
 * keep sellingPrice if only one side has it, then delete the Cyrillic row.
 *
 * Idempotent: a pair with nothing left on the Cyrillic side is a no-op.
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/merge-fresh-model-dupes.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PAIRS: [string, string][] = [
  ["МН06", "MH06"],
  ["МН17", "MH17"],
];

async function main() {
  for (const [cyr, latin] of PAIRS) {
    const c = await prisma.productModel.findFirst({ where: { name: cyr } });
    const l = await prisma.productModel.findFirst({ where: { name: latin } });
    if (!c || !l) {
      console.log(`Skip ${cyr}/${latin}: not both present (cyr=${!!c}, latin=${!!l})`);
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.productionOrder.updateMany({ where: { productModelId: c.id }, data: { productModelId: l.id } });
      await tx.supplyPlanEntry.updateMany({ where: { productModelId: c.id }, data: { productModelId: l.id } });
      await tx.productModelMaterial.updateMany({ where: { productModelId: c.id }, data: { productModelId: l.id } });
      await tx.finishedGoodsMovement.updateMany({ where: { productModelId: c.id }, data: { productModelId: l.id } });

      const cStocks = await tx.finishedGoodsStock.findMany({ where: { productModelId: c.id } });
      for (const cs of cStocks) {
        const ls = await tx.finishedGoodsStock.findUnique({
          where: { warehouseId_productModelId: { warehouseId: cs.warehouseId, productModelId: l.id } },
        });
        if (ls) {
          const newQty = ls.quantity.add(cs.quantity);
          const newValue = ls.quantity.mul(ls.avgUnitCost).add(cs.quantity.mul(cs.avgUnitCost));
          const newAvg = newQty.isZero() ? ls.avgUnitCost : newValue.div(newQty);
          await tx.finishedGoodsStock.update({ where: { id: ls.id }, data: { quantity: newQty, avgUnitCost: newAvg } });
          await tx.finishedGoodsStock.delete({ where: { id: cs.id } });
        } else {
          await tx.finishedGoodsStock.update({ where: { id: cs.id }, data: { productModelId: l.id } });
        }
      }

      if (!l.sellingPrice && c.sellingPrice) {
        await tx.productModel.update({ where: { id: l.id }, data: { sellingPrice: c.sellingPrice } });
      }
      await tx.productModel.delete({ where: { id: c.id } });
    });
    console.log(`Merged ${cyr} -> ${latin}`);
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
