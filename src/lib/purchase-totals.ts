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

/**
 * VAT-exclusive counterpart of purchaseTotalInclVat — item prices and
 * expense amounts are already stored excl-VAT, so this is a direct sum, no
 * VAT math needed (only the currency conversion for item prices).
 */
export function purchaseTotalExclVat(purchase: { exchangeRate: Prisma.Decimal; items: Item[]; expenses: Expense[] }) {
  const itemsExclVatRub = purchase.items.reduce((s, i) => s.add(i.subtotal.mul(purchase.exchangeRate)), new Decimal(0));
  const expensesExclVat = purchase.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  return itemsExclVatRub.add(expensesExclVat);
}

type LotCostFields = {
  materialCostExclVat: Prisma.Decimal;
  expenseCostExclVat: Prisma.Decimal;
};

/**
 * A lot's fully correct excl-VAT unit landed cost: the raw-material excl-VAT
 * component plus this lot's excl-VAT share of allocated purchase expenses
 * (see the schema comment on RawMaterialLot.expenseCostExclVat for why this
 * split is exact, not approximated).
 */
export function lotUnitCostExclVat(lot: LotCostFields) {
  return lot.materialCostExclVat.add(lot.expenseCostExclVat);
}

/**
 * Excl-VAT counterpart of a ProductionOrder's materialCost, computed live
 * from its (historical, already-fixed) materialUsages and each usage's lot
 * — see the module comment on ProductionMaterialUsage for why this is safe
 * to compute live rather than needing its own stored snapshot column.
 * ProductionExpense has no vatRate field at all (no VAT is tracked for
 * production expenses in this schema), so expenseCost has no excl-VAT
 * counterpart to derive — it is shown as-is in both modes.
 */
export function materialCostExclVat(usages: { quantity: Prisma.Decimal; lot: LotCostFields }[]) {
  return usages.reduce((s, u) => s.add(u.quantity.mul(lotUnitCostExclVat(u.lot))), new Decimal(0));
}
