/**
 * Lining fabric was imported as one synthetic RawMaterialLot PER ТЗ usage
 * (74 lots across 7 fabrics: e.g. "Подкладочная ткань №24" alone had 25
 * separate lot rows, one per production order, all from the same purchase
 * З-2026-0035, all at the same price) — a specific-identification model
 * copied from how fur lots work. The user explicitly asked for lining to
 * be tracked "под номерами без повторов суммами" (by fabric number,
 * without duplicates, as sums): one aggregate stock pool per fabric
 * number, not one row per usage event.
 *
 * This consolidates, per lining RawMaterial (unit === "M"):
 *  - picks the earliest lot as the canonical aggregate lot
 *  - sums quantityReceived/quantityRemaining/costs across all its lots
 *    into that canonical lot (weighted-average unit cost, exact here since
 *    price was uniform per material, but computed generally)
 *  - reassigns every ProductionMaterialUsage.lotId and StockMovement.lotId
 *    that pointed at a non-canonical lot onto the canonical lot
 *  - merges every PurchaseItem for that material into the canonical one
 *    (sums quantity/subtotal; all observed at one uniform unitPrice, so a
 *    plain quantity-weighted average is used defensively in case that
 *    ever isn't true) and deletes the rest
 *  - deletes the now-redundant lots
 *  - clears the canonical lot's lotNumber (it's no longer one specific
 *    lot) and leaves a note recording how many receipts were merged
 *
 * Idempotent: a material already down to one lot is a no-op.
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/consolidate-lining-lots.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();

async function main() {
  const materials = await prisma.rawMaterial.findMany({ where: { unit: "M" } });

  for (const material of materials) {
    const lots = await prisma.rawMaterialLot.findMany({
      where: { rawMaterialId: material.id },
      orderBy: { receivedDate: "asc" },
      include: { purchaseItem: true },
    });
    if (lots.length <= 1) {
      console.log(`${material.name}: already 1 lot, skipping`);
      continue;
    }

    const canonical = lots[0];
    const rest = lots.slice(1);

    const sum = (field: "quantityReceived" | "quantityRemaining" | "totalCost" | "materialCostExclVat" | "materialVatAmount") =>
      lots.reduce((s, l) => s.add(l[field]), new Decimal(0));

    const totalReceived = sum("quantityReceived");
    const totalRemaining = sum("quantityRemaining");
    const totalCost = sum("totalCost");
    const totalMaterialExclVat = sum("materialCostExclVat");
    const totalMaterialVat = sum("materialVatAmount");
    const newUnitCost = totalReceived.isZero() ? canonical.unitCost : totalCost.div(totalReceived);

    // expenseCostExclVat/expenseVatAmount only exist on lots created after
    // the VAT-split migration; older lining lots (created before it) may
    // not have them populated — sum defensively, defaulting missing to 0.
    const totalExpenseExclVat = lots.reduce(
      (s, l) => s.add((l as unknown as { expenseCostExclVat?: Decimal }).expenseCostExclVat ?? new Decimal(0)),
      new Decimal(0)
    );
    const totalExpenseVat = lots.reduce(
      (s, l) => s.add((l as unknown as { expenseVatAmount?: Decimal }).expenseVatAmount ?? new Decimal(0)),
      new Decimal(0)
    );

    const items = lots.map((l) => l.purchaseItem).filter((i): i is NonNullable<typeof i> => !!i);
    const canonicalItem = canonical.purchaseItem;
    const totalItemQty = items.reduce((s, i) => s.add(i.quantity), new Decimal(0));
    const totalItemSubtotal = items.reduce((s, i) => s.add(i.subtotal), new Decimal(0));
    const weightedUnitPrice = totalItemQty.isZero()
      ? canonicalItem?.unitPrice ?? new Decimal(0)
      : totalItemSubtotal.div(totalItemQty);

    await prisma.$transaction(async (tx) => {
      const restLotIds = rest.map((l) => l.id);
      const restItemIds = items.filter((i) => i.id !== canonicalItem?.id).map((i) => i.id);

      await tx.productionMaterialUsage.updateMany({
        where: { lotId: { in: restLotIds } },
        data: { lotId: canonical.id },
      });
      await tx.stockMovement.updateMany({
        where: { lotId: { in: restLotIds } },
        data: { lotId: canonical.id },
      });

      if (canonicalItem) {
        await tx.purchaseItem.update({
          where: { id: canonicalItem.id },
          data: {
            quantity: totalItemQty,
            unitPrice: weightedUnitPrice,
            subtotal: totalItemSubtotal,
          },
        });
      }

      await tx.rawMaterialLot.update({
        where: { id: canonical.id },
        data: {
          quantityReceived: totalReceived,
          quantityRemaining: totalRemaining,
          unitCost: newUnitCost,
          totalCost,
          materialCostExclVat: totalMaterialExclVat,
          materialVatAmount: totalMaterialVat,
          ...(("expenseCostExclVat" in canonical)
            ? { expenseCostExclVat: totalExpenseExclVat, expenseVatAmount: totalExpenseVat }
            : {}),
          lotNumber: null,
          notes: `Агрегированный остаток по ткани — объединено ${lots.length} поступлений при консолидации (scripts/consolidate-lining-lots.ts).`,
        },
      });

      // Detach the non-canonical purchase items from their (about to be
      // deleted) lots before deleting the lots, then delete both.
      await tx.rawMaterialLot.deleteMany({ where: { id: { in: restLotIds } } });
      if (restItemIds.length > 0) {
        await tx.purchaseItem.deleteMany({ where: { id: { in: restItemIds } } });
      }
    });

    console.log(
      `${material.name}: merged ${lots.length} lots -> 1 (received=${totalReceived.toString()}, remaining=${totalRemaining.toString()}, unitCost=${newUnitCost.toFixed(2)})`
    );
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
