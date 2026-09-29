/**
 * Backfills RawMaterialLot.expenseCostExclVat / expenseVatAmount for lots
 * created before these fields existed (see the "lot_expense_vat_split"
 * migration and its schema comment).
 *
 * receivePurchase allocates a purchase's expense pool across its items by a
 * single ratio per item (that item's incl-VAT subtotal share of the
 * purchase's total incl-VAT items subtotal), then applies that ratio to the
 * *inclusive* expense total to get the item's allocated expense. Applying
 * the same ratio to the expense pool's own excl-VAT total and VAT-amount
 * total is exact, not an approximation — excl + vatAmount = incl by
 * construction, so ratio*excl + ratio*vatAmount = ratio*incl always holds.
 * This script recomputes that exact split from each lot's own purchase
 * (items + expenses), which is unchanged since receipt, and writes it.
 *
 * Lots with no purchaseId (manual/adjustment lots) never had expenses
 * allocated — left at their default 0/0.
 *
 * Idempotent: re-running recomputes the same values.
 *
 * Run: npx tsx scripts/backfill-lot-expense-vat-split.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const Decimal = Prisma.Decimal;

function grossUp(base: Prisma.Decimal, vatRate: Prisma.Decimal) {
  return base.add(base.mul(vatRate).div(100));
}

async function main() {
  const purchases = await prisma.purchase.findMany({
    include: { items: true, expenses: true },
  });

  let updated = 0;
  let skippedZeroExpenses = 0;

  for (const purchase of purchases) {
    if (purchase.expenses.length === 0) {
      skippedZeroExpenses += purchase.items.length;
      continue;
    }

    const totalExpensesExclVat = purchase.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
    const totalExpensesInclVat = purchase.expenses.reduce(
      (s, e) => s.add(grossUp(e.amount, e.vatRate)),
      new Decimal(0)
    );
    const totalExpensesVatAmount = totalExpensesInclVat.sub(totalExpensesExclVat);

    const itemsInclVatRub = purchase.items.map((item) => {
      const baseRub = item.subtotal.mul(purchase.exchangeRate);
      return { item, inclVatRub: grossUp(baseRub, item.vatRate) };
    });
    const totalItemsInclVatRub = itemsInclVatRub.reduce((s, i) => s.add(i.inclVatRub), new Decimal(0));
    if (totalItemsInclVatRub.isZero()) continue;

    for (const { item, inclVatRub } of itemsInclVatRub) {
      const ratio = inclVatRub.div(totalItemsInclVatRub);
      const expenseCostExclVatTotal = totalExpensesExclVat.mul(ratio);
      const expenseVatAmountTotal = totalExpensesVatAmount.mul(ratio);

      const lot = await prisma.rawMaterialLot.findUnique({ where: { purchaseItemId: item.id } });
      if (!lot) continue; // item not yet received into a lot

      // Divide by the lot's ORIGINAL received quantity (not current
      // quantityRemaining, which shrinks as production consumes it) — these
      // are per-unit landed-cost figures, fixed at receipt.
      const expenseCostExclVat = lot.quantityReceived.isZero()
        ? new Decimal(0)
        : expenseCostExclVatTotal.div(lot.quantityReceived);
      const expenseVatAmount = lot.quantityReceived.isZero()
        ? new Decimal(0)
        : expenseVatAmountTotal.div(lot.quantityReceived);

      await prisma.rawMaterialLot.update({
        where: { id: lot.id },
        data: { expenseCostExclVat, expenseVatAmount },
      });
      updated++;
    }
  }

  console.log(`Updated ${updated} lots. Skipped ${skippedZeroExpenses} items with no purchase expenses.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
