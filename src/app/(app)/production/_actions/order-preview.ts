"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { fullFinishedCost } from "@/lib/finished-goods-cost";
import { orderUnitsDec } from "@/lib/batch-stats";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { PRODUCTION_EDIT_ROLES as EDIT_ROLES } from "@/lib/production-access";
import { checkOrgRefs } from "@/lib/org-guard";
import { MAX_QTY, zNum, parseNumber } from "@/lib/input";
import { syncCompletedOrderCost, usageSchema, applyUsageEdit, applyExpenseEdit, applyProducedQuantity } from "./shared";

// ---------- Предпросмотр правки («что изменится») ----------

export type OrderEdit =
  | { kind: "usage"; usageId: string; lotId: string; quantity: string; commission4: boolean }
  | { kind: "expense"; expenseId: string; categoryId: string; amount: string; description: string }
  | { kind: "param"; field: "clientWorkPricePerUnit" | "plannedQuantity" | "producedQuantity"; value: string }
  | { kind: "vat"; rate: string };

export type EditPreview = {
  error?: string;
  completed?: boolean;
  /** Себестоимость ТЗ: сырьё + 4% (по флажкам) + расходы + работа, как в итоге карточки (без шкур подрядчика). */
  cost?: { before: string; after: string };
  /** На 1 изделие (факт у завершённого, иначе план). */
  unit?: { before: string; after: string } | null;
  lots?: { name: string; unit: string; before: string; after: string }[];
  /** Стоимость готовой продукции на складе (только у завершённого ТЗ). */
  stock?: { before: string; after: string } | null;
  note?: string;
};

class PreviewRollback extends Error {
  constructor(public result: EditPreview) {
    super("preview-rollback");
  }
}

async function editSnapshot(tx: Prisma.TransactionClient, orderId: string, lotIds: string[]) {
  const o = await tx.productionOrder.findUniqueOrThrow({ where: { id: orderId }, include: { materialUsages: true, expenses: true } });
  const qty = orderUnitsDec(o);
  const total = fullFinishedCost(o, qty).total;
  const lots = await tx.rawMaterialLot.findMany({
    where: { id: { in: lotIds }, organizationId: o.organizationId },
    select: { id: true, lotNumber: true, quantityRemaining: true, rawMaterial: { select: { name: true, unit: true } } },
  });
  const stock =
    o.status === "COMPLETED"
      ? await tx.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: o.finishedWarehouseId, productModelId: o.productModelId } } })
      : null;
  return {
    total,
    unit: qty.isZero() ? null : total.div(qty),
    lots,
    stock: stock ? stock.quantity.mul(stock.avgUnitCost) : null,
    completed: o.status === "COMPLETED",
  };
}

/**
 * Предпросмотр правки ТЗ: выполняет ту же запись (applyUsageEdit / applyExpenseEdit / syncCompletedOrderCost / applyProducedQuantity),
 * читает «до» и «после» и ОТКАТЫВАЕТ транзакцию — в базе ничего не остаётся. Окно «что изменится» показывает эти цифры, запись делают прежние действия.
 */
export async function previewOrderEdit(orderId: string, edit: OrderEdit): Promise<EditPreview> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const order = await prisma.productionOrder.findFirst({ where: { id: orderId, organizationId: orgId }, include: { materialUsages: true, expenses: true } });
  if (!order) return { error: "ТЗ не найдено" };

  if (edit.kind === "vat") {
    return { completed: order.status === "COMPLETED", note: "Сумма с НДС и себестоимость не меняются: меняется только разбивка «без НДС / НДС» по всем строкам списаний ТЗ." };
  }

  let lotIds: string[] = [];
  let run: (tx: Prisma.TransactionClient) => Promise<void>;

  if (edit.kind === "usage") {
    const usage = order.materialUsages.find((u) => u.id === edit.usageId);
    if (!usage) return { error: "Списание не найдено" };
    const parsed = usageSchema.safeParse({ lotId: edit.lotId, quantity: edit.quantity });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message };
    lotIds = [...new Set([usage.lotId, parsed.data.lotId])];
    run = (tx) => applyUsageEdit(tx, orgId, orderId, usage, parsed.data.lotId, parsed.data.quantity, edit.commission4);
  } else if (edit.kind === "expense") {
    const expense = order.expenses.find((e) => e.id === edit.expenseId);
    if (!expense) return { error: "Расход не найден" };
    const parsed = z.object({ categoryId: z.string().min(1, "Выберите статью расходов"), amount: zNum("Сумма", { positive: true }) }).safeParse({ categoryId: edit.categoryId, amount: edit.amount });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message };
    const badCat = await checkOrgRefs(orgId, { expenseCategory: parsed.data.categoryId });
    if (badCat) return { error: badCat };
    run = (tx) => applyExpenseEdit(tx, orgId, orderId, expense.id, parsed.data.categoryId, parsed.data.amount, edit.description.trim() || null);
  } else {
    const v = edit.value.trim();
    if (edit.field === "clientWorkPricePerUnit") {
      let price: Decimal | null = null;
      if (v) {
        const n = parseNumber(v, "Стоимость работ за ед.");
        if ("error" in n) return { error: n.error };
        price = new Decimal(n.value);
      }
      run = async (tx) => {
        await tx.productionOrder.update({ where: { id: orderId }, data: { clientWorkPricePerUnit: price } });
        if (order.status === "COMPLETED" && !(price ?? new Decimal(0)).equals(order.clientWorkPricePerUnit ?? new Decimal(0))) await syncCompletedOrderCost(tx, orderId, orgId);
      };
    } else if (edit.field === "plannedQuantity") {
      const q = zNum("Плановое количество", { positive: true, max: MAX_QTY }).safeParse(v);
      if (!q.success) return { error: q.error.issues[0]?.message };
      const nq = new Decimal(q.data as number);
      if (nq.lessThan(order.producedQuantity)) return { error: `Плановое количество не может быть меньше уже произведённого (${order.producedQuantity.toString()} шт.)` };
      run = async (tx) => {
        await tx.productionOrder.update({ where: { id: orderId }, data: { plannedQuantity: nq } });
      };
    } else {
      if (order.status !== "COMPLETED") return { error: "Фактическое количество правится только у завершённого ТЗ" };
      const q = zNum("Количество", { positive: true, max: MAX_QTY }).safeParse(v);
      if (!q.success) return { error: q.error.issues[0]?.message };
      const nq = new Decimal(q.data as number);
      run = async (tx) => {
        if (!nq.equals(order.producedQuantity)) await applyProducedQuantity(tx, orgId, orderId, order, nq);
      };
    }
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        const before = await editSnapshot(tx, orderId, lotIds);
        await run(tx);
        const after = await editSnapshot(tx, orderId, lotIds);
        const lots = before.lots.map((b) => {
          const a = after.lots.find((l) => l.id === b.id);
          return { name: `${b.rawMaterial.name}, лот ${b.lotNumber ?? "без номера"}`, unit: b.rawMaterial.unit, before: b.quantityRemaining.toString(), after: (a?.quantityRemaining ?? b.quantityRemaining).toString() };
        });
        throw new PreviewRollback({
          completed: before.completed,
          cost: { before: before.total.toFixed(2), after: after.total.toFixed(2) },
          unit: before.unit && after.unit ? { before: before.unit.toFixed(2), after: after.unit.toFixed(2) } : null,
          lots,
          stock: before.stock && after.stock ? { before: before.stock.toFixed(2), after: after.stock.toFixed(2) } : null,
        });
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  } catch (e) {
    if (e instanceof PreviewRollback) return e.result;
    return { error: e instanceof Error ? e.message : "Не удалось рассчитать, что изменится" };
  }
  return { error: "Не удалось рассчитать, что изменится" };
}
