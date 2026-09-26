/**
 * Three more Cyrillic/Latin article-code duplicates slipped past the
 * original merge (scripts/merge-latin-cyrillic-models.ts only covered the
 * ~24 pairs in the registry's own "Лист16" mapping): "М001К" (mixed
 * Cyrillic letters + real digits) next to "M001K" (all Latin, already
 * merged from "МОО1К"), and "МОО2"/"МОО3" (Cyrillic double-О typo) next
 * to "M002"/"M003". Same article, same real production history on both
 * sides (orders, finished-goods stock) — unlike the first pass, these had
 * actual data on both sides, so this does a proper merge, not just a
 * rename: reassigns ProductionOrder/SupplyPlanEntry/ProductModelMaterial/
 * FinishedGoodsMovement, and combines each side's FinishedGoodsStock by
 * weighted average (not just dropped) before deleting the Cyrillic row.
 *
 * Idempotent: a pair with nothing left on the Cyrillic side is a no-op.
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/merge-remaining-model-dupes.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PAIRS: [string, string][] = [
  ["М001К", "M001K"],
  ["МОО2", "M002"],
  ["МОО3", "M003"],
];

async function main() {
  for (const [cyr, latin] of PAIRS) {
    const c = await prisma.productModel.findFirst({ where: { name: cyr } });
    const l = await prisma.productModel.findFirst({ where: { name: latin } });
    if (!c || !l) continue;

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
