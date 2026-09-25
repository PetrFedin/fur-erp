import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";

type Item = { subtotal: Prisma.Decimal; vatRate: Prisma.Decimal };
type Expense = { amount: Prisma.Decimal; vatRate: Prisma.Decimal };

export function grossUp(base: Prisma.Decimal, vatRate: Prisma.Decimal) {
  return base.add(base.mul(vatRate).div(100));
}

/**
 * Item prices/expense amounts are entered excluding VAT; this computes the
 * VAT-inclusive RUB total a purchase actually costs (what's owed to the
 * supplier), matching the landed-cost calculation in purchases/actions.ts.
 */
export function purchaseTotalInclVat(purchase: {
  exchangeRate: Prisma.Decimal;
  items: Item[];
  expenses: Expense[];
}) {
  const itemsInclVatRub = purchase.items.reduce(
    (s, i) => s.add(grossUp(i.subtotal.mul(purchase.exchangeRate), i.vatRate)),
    new Decimal(0)
  );
  const expensesInclVat = purchase.expenses.reduce((s, e) => s.add(grossUp(e.amount, e.vatRate)), new Decimal(0));
  return itemsInclVatRub.add(expensesInclVat);
}
