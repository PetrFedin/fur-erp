import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import { Prisma } from "@prisma/client";
import { createRawMaterialLot, addOrPoolLiningLot } from "@/lib/stock";

/**
 * Приёмка закупки на склад (создание лотов и движений склада) внутри УЖЕ ОТКРЫТОЙ транзакции.
 * Единственная реализация: ею пользуются receivePurchase (кнопка «Принять на склад») и мастер «Новая партия»
 * (создание закупки + лотов + приёмка в одной транзакции). Расчёт стоимости лотов — как раньше, без изменений.
 */

export class AlreadyReceivedError extends Error {}

/** Блокирует строку закупки до конца транзакции: правки расчёта и приёмка сериализуются. */
export async function lockPurchase(tx: Prisma.TransactionClient, purchaseId: string, orgId: string) {
  const rows = await tx.$queryRaw<{ status: string; exchangeRate: Prisma.Decimal | string }[]>`
    SELECT "status", "exchangeRate" FROM "Purchase"
    WHERE "id" = ${purchaseId} AND "organizationId" = ${orgId} FOR UPDATE`;
  return rows[0] ?? null;
}

function parseCostPlan(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const d = (k: string) => (r[k] != null ? new Decimal(String(r[k])) : null);
  const unitCostInclVat = d("unitCostInclVat");
  const materialExclVat = d("materialExclVat");
  const materialVat = d("materialVat");
  const expenseExclVat = d("expenseExclVat");
  const expenseVat = d("expenseVat");
  if (!unitCostInclVat || !materialExclVat || !materialVat || !expenseExclVat || !expenseVat) return null;
  return {
    unitCostInclVat,
    materialExclVat,
    materialVat,
    expenseExclVat,
    expenseVat,
    costBreakdown: r["costBreakdown"] as import("@prisma/client").Prisma.InputJsonValue,
  };
}


const grossUp = (base: Decimal, vatRate: Decimal) => base.add(base.mul(vatRate).div(100));

/** Принимает закупку на склад в транзакции `tx`. Бросает AlreadyReceivedError, если закупка уже принята/отменена. */
export async function receivePurchaseInTx(tx: Prisma.TransactionClient, purchaseId: string, orgId: string): Promise<void> {
  // Блокируем строку закупки: правки расчёта (updateCostPlanItem/Rate) берут ту же
  // блокировку, поэтому приёмка и правки идут строго по очереди. Статус — под замком.
  const locked = await lockPurchase(tx, purchaseId, orgId);
  if (!locked || locked.status === "RECEIVED" || locked.status === "CANCELLED") throw new AlreadyReceivedError();

  // Атомарный переход статуса: если параллельная приёмка уже выиграла,
  // count = 0 и лоты не создаются (иначе склад задвоился бы).
  const claimed = await tx.purchase.updateMany({
    where: { id: purchaseId, organizationId: orgId, status: { notIn: ["RECEIVED", "CANCELLED"] } },
    data: { status: "RECEIVED", receivedDate: new Date() },
  });
  if (claimed.count === 0) throw new AlreadyReceivedError();

  // Позиции и расходы читаем уже после захвата — правки, закоммиченные
  // до этого момента, попадают в приёмку.
  const purchase = await tx.purchase.findFirst({
    where: { id: purchaseId, organizationId: orgId },
    include: { items: { include: { rawMaterial: true } }, expenses: true },
  });
  if (!purchase) throw new Error("Закупка не найдена");
  if (purchase.items.length === 0) throw new Error("В закупке нет позиций");

  const totalExpensesExclVat = purchase.expenses.reduce((sum, e) => sum.add(e.amount), new Decimal(0));
  const totalExpensesInclVat = purchase.expenses.reduce(
    (sum, e) => sum.add(grossUp(e.amount, e.vatRate)),
    new Decimal(0)
  );
  // VAT amount of the total expense pool — used below to split each lot's
  // allocated share the same way materialCostExclVat/materialVatAmount
  // already split the item's own price. See RawMaterialLot.expenseCostExclVat
  // for why applying the item's allocation ratio to this split is exact.
  const totalExpensesVatAmount = totalExpensesInclVat.sub(totalExpensesExclVat);

  // Полная стоимость позиции (с НДС, ₽) — база для распределения расходов.
  // Для позиции с расчётом из расчётного листа (costPlan) это стоимость
  // единицы из расчёта × количество, для обычной — цена × курс + НДС.
  const rows = purchase.items.map((item) => {
    const plan = parseCostPlan(item.costPlan);
    const baseRub = item.subtotal.mul(purchase.exchangeRate);
    const inclVatRub = grossUp(baseRub, item.vatRate);
    const fullInclVatRub = plan ? plan.unitCostInclVat.mul(item.quantity) : inclVatRub;
    return { item, plan, baseRub, inclVatRub, fullInclVatRub };
  });
  const totalFullInclVatRub = rows.reduce((sum, r) => sum.add(r.fullInclVatRub), new Decimal(0));

  for (const { item, plan, baseRub, inclVatRub, fullInclVatRub } of rows) {
    // Same ratio drives both the inclusive allocation and its excl-VAT /
    // VAT-amount split — exact, since the ratio is applied uniformly to
    // the whole expense pool (excl + vat = incl by construction).
    const allocationRatio = totalFullInclVatRub.isZero() ? new Decimal(0) : fullInclVatRub.div(totalFullInclVatRub);
    const allocatedExpense = totalExpensesInclVat.mul(allocationRatio);
    const allocatedExpenseExclVat = totalExpensesExclVat.mul(allocationRatio);
    const allocatedExpenseVatAmount = totalExpensesVatAmount.mul(allocationRatio);
    const qty = item.quantity;

    // Позиция с расчётом (costPlan): стоимость единицы из расчёта
    // (выделка/транспорт — на штуку, а не от цены) + доля расходов закупки.
    let costBreakdown: Prisma.InputJsonValue | undefined;
    if (plan) {
      costBreakdown = plan.costBreakdown;
      if (allocatedExpense.gt(0)) {
        const bd = (plan.costBreakdown ?? {}) as { items?: { label: string; value: number }[] };
        costBreakdown = {
          ...(bd as object),
          items: [
            ...(Array.isArray(bd.items) ? bd.items : []),
            { label: "Расходы закупки (доля), ₽", value: Number(allocatedExpense.div(qty).toDecimalPlaces(2).toString()) },
          ],
        } as Prisma.InputJsonValue;
      }
    }

    const lotArgs = {
      organizationId: orgId,
      warehouseId: purchase.warehouseId,
      rawMaterialId: item.rawMaterialId,
      lotNumber: item.lotNumber,
      grade: item.grade,
      color: item.color,
      colorRefId: item.colorRefId,
      quantity: qty,
      unitCost: plan ? plan.unitCostInclVat.add(allocatedExpense.div(qty)) : inclVatRub.add(allocatedExpense).div(qty),
      totalCost: plan ? plan.unitCostInclVat.mul(qty).add(allocatedExpense) : inclVatRub.add(allocatedExpense),
      vatRate: item.vatRate,
      materialCostExclVat: plan ? plan.materialExclVat : baseRub.div(qty),
      materialVatAmount: plan ? plan.materialVat : inclVatRub.sub(baseRub).div(qty),
      expenseCostExclVat: plan
        ? plan.expenseExclVat.add(allocatedExpenseExclVat.div(qty))
        : allocatedExpenseExclVat.div(qty),
      expenseVatAmount: plan
        ? plan.expenseVat.add(allocatedExpenseVatAmount.div(qty))
        : allocatedExpenseVatAmount.div(qty),
      purchaseId: purchase.id,
      purchaseItemId: item.id,
      ...(costBreakdown !== undefined ? { costBreakdown } : {}),
    };

    // Lining fabric (tracked by the metre) is one aggregate pool per
    // fabric, not one lot per receipt — see cfc5cd6 and
    // addOrPoolLiningLot's own comment. Fur (and every other unit) keeps
    // the original specific-identification behavior: a fresh lot every
    // time.
    if (item.rawMaterial.unit === "M") {
      await addOrPoolLiningLot(tx, lotArgs);
    } else {
      await createRawMaterialLot(tx, lotArgs);
    }
  }
}
