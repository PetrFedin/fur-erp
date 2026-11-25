import type { Commission4Mode } from "@/lib/commission4-mode";
import { effectiveUsageVat, lineWith4, usageInput } from "@/lib/commission4";
import { lotUnitCostExclVat } from "@/lib/purchase-totals";
import { UsageRow } from "../usage-row";
import { lotOptionLabel } from "../lot-label";
import { ExpenseRow } from "../expense-row";
import { removeMaterialUsage, removeProductionExpense, updateMaterialUsage, updateProductionExpense, updateUsageVat } from "../../actions";
import type { CardOrder } from "./include";

/** Строки списаний ТЗ (мех или подкладка) со своими действиями правки и удаления. */
export function usageRowsOf(list: CardOrder["materialUsages"], isLining: boolean, { id, c4Mode, canEdit }: { id: string; c4Mode: Commission4Mode; canEdit: boolean }) {
  const boundRemoveUsage = removeMaterialUsage.bind(null, id);
  const boundUpdateUsage = updateMaterialUsage.bind(null, id);
  const boundUpdateUsageVat = updateUsageVat.bind(null, id);
  return list.map((u) => {
    const line = lineWith4(usageInput(u), c4Mode);
    const qty = u.quantity;
    return (
      <UsageRow
        key={u.id}
        usage={{
          id: u.id,
          lotLabel: lotOptionLabel({ lotNumber: u.lot.lotNumber, grade: u.lot.grade, color: u.lot.color, rawMaterialName: u.rawMaterial.name, quantityRemaining: u.lot.quantityRemaining.toString(), unitCost: u.lot.unitCost.toString(), vatRate: u.lot.vatRate.toString() }),
          rawMaterialName: u.rawMaterial.name,
          lotId: u.lotId,
          lotNumber: u.lot.lotNumber,
          purchaseId: u.lot.purchase?.id ?? null,
          purchaseNumber: u.lot.purchase?.number ?? null,
          quantity: qty.toString(),
          unit: u.rawMaterial.unit,
          unitIncl: qty.isZero() ? "0" : line.incl.div(qty).toString(),
          unitExcl: qty.isZero() ? "0" : line.excl.div(qty).toString(),
          lotCostExclVat: lineWith4({ incl: u.lot.materialCostExclVat, excl: u.lot.materialCostExclVat, commission4: u.commission4 }, c4Mode).excl.toString(),
          c4Mode,
          commission4: u.commission4,
          lotVatRate: u.lot.vatRate.toString(),
          vatRate: String(effectiveUsageVat(u)),
          vatOwn: u.vatRate != null,
          totalCost: line.incl.toString(),
          totalCostExclVat: line.excl.toString(),
          costBreakdown: u.lot.costBreakdown,
          lotUnitCostExcl: lotUnitCostExclVat(u.lot).toString(),
          lotUnitCostIncl: u.lot.unitCost.toString(),
        }}
        orderId={id}
        lining={isLining}
        readOnly={!canEdit}
        updateAction={boundUpdateUsage.bind(null, u.id)}
        vatAction={boundUpdateUsageVat.bind(null, u.id)}
        removeAction={async () => {
          "use server";
          await boundRemoveUsage(u.id);
        }}
      />
    );
  });
}

/** Строки доп. расходов ТЗ со своими действиями правки и удаления. */
export function expenseRowsOf(expenses: CardOrder["expenses"], expenseCategories: { id: string; name: string }[], { id, canEdit }: { id: string; canEdit: boolean }) {
  const boundRemoveExpense = removeProductionExpense.bind(null, id);
  const boundUpdateExpense = updateProductionExpense.bind(null, id);
  return expenses.map((e) => (
    <ExpenseRow
      key={e.id}
      orderId={id}
      expense={{ id: e.id, categoryId: e.categoryId, categoryName: e.category.name, amount: e.amount.toString(), description: e.description }}
      categories={expenseCategories}
      readOnly={!canEdit}
      updateAction={boundUpdateExpense.bind(null, e.id)}
      removeAction={async () => {
        "use server";
        await boundRemoveExpense(e.id);
      }}
    />
  ));
}
