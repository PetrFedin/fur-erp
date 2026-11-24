"use server";

import { z } from "zod";
import { revalidateAll } from "@/lib/revalidate-all";
import { resetByOrder } from "@/lib/verification";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { receiveFinishedGoodsStock } from "@/lib/stock";
import { FG_FULL_COST_NOTE, fullFinishedCost } from "@/lib/finished-goods-cost";
import { Decimal } from "@prisma/client/runtime/library";
import { PRODUCTION_EDIT_ROLES as EDIT_ROLES } from "@/lib/production-access";
import { MAX_QTY, zNum } from "@/lib/input";
import { type FormState, applyProducedQuantity } from "./shared";

// ---------- Completion: snapshots cost and receives finished goods ----------

const completeSchema = z.object({
  producedQuantity: zNum("Количество", { positive: true, max: MAX_QTY }),
});

export async function completeProductionOrder(
  orderId: string,
  formData: FormData
): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
    include: { materialUsages: true, expenses: true },
  });
  if (!order) return { error: "ТЗ не найдено" };
  // Без списаний завершать можно только после явного подтверждения (форма шлёт confirmNoUsages=1): ТЗ с лоскутом или давальческим сырьём бывают.
  if (order.materialUsages.length === 0 && formData.get("confirmNoUsages") !== "1") {
    return {
      error:
        "В ТЗ нет списаний сырья — на склад готовой продукции продукция встанет без стоимости сырья. Подтвердите завершение без списаний.",
    };
  }

  const parsed = completeSchema.safeParse({ producedQuantity: formData.get("producedQuantity") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  // Снимок ТЗ (Главная, партии, «Изделия») — сырьё + расходы, как и раньше.
  const materialCost = order.materialUsages.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
  const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const totalCost = materialCost.add(expenseCost);
  const unitCost = totalCost.div(parsed.data.producedQuantity);
  // Склад готовой продукции — по ПОЛНОЙ себестоимости: плюс 4% и работа (lib/finished-goods-cost.ts).
  const fg = fullFinishedCost(order, parsed.data.producedQuantity);
  const fgUnitCost = fg.total.div(parsed.data.producedQuantity);

  const raced = await prisma.$transaction(async (tx) => {
    // Атомарный переход статуса: две вкладки не должны оприходовать продукцию дважды.
    const moved = await tx.productionOrder.updateMany({
      where: { id: orderId, organizationId: session.user.organizationId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
      data: { status: "COMPLETED" },
    });
    if (moved.count === 0) return true;
    await tx.productionOrder.update({
      where: { id: orderId },
      data: {
        status: "COMPLETED",
        producedQuantity: parsed.data.producedQuantity,
        materialCost,
        expenseCost,
        totalCost,
        unitCost,
        endDate: new Date(),
      },
    });

    await receiveFinishedGoodsStock(tx, {
      organizationId: session.user.organizationId,
      warehouseId: order.finishedWarehouseId,
      productModelId: order.productModelId,
      quantity: parsed.data.producedQuantity,
      unitCost: fgUnitCost,
      totalCost: fg.total,
      type: "PRODUCTION_IN",
      productionOrderId: orderId,
      notes: FG_FULL_COST_NOTE,
    });
    return false;
  });
  if (raced) return { error: "ТЗ уже завершено" };

  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
  return {};
}

/**
 * Переключатель «Поставлен» в таблице ТЗ: включение = приход готовой продукции по плановому количеству (то же, что «Завершить ТЗ»:
 * остаток на складе готовой продукции и снимок себестоимости). Выключить завершённое нельзя. Несколько id — позиции одного ТЗ.
 */
export async function markOrdersDelivered(orderIds: string[], confirmNoUsages: boolean): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const ids = Array.from(new Set(orderIds)).slice(0, 50);
  const orders = await prisma.productionOrder.findMany({
    where: { id: { in: ids }, organizationId: session.user.organizationId, status: { in: ["PLANNED", "IN_PROGRESS"] }, producedQuantity: 0 },
    select: { id: true, plannedQuantity: true },
  });
  if (orders.length === 0) return { error: "ТЗ уже поставлено или отменено" };
  for (const o of orders) {
    const fd = new FormData();
    fd.set("producedQuantity", o.plannedQuantity.toString());
    if (confirmNoUsages) fd.set("confirmNoUsages", "1");
    const r = await completeProductionOrder(o.id, fd);
    if (r.error) return r;
  }
  return {};
}

export async function updateProducedQuantity(
  orderId: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = zNum("Количество", { positive: true, max: MAX_QTY }).safeParse(formData.get("producedQuantity"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId, status: "COMPLETED" },
    include: { materialUsages: true, expenses: true },
  });
  if (!order) return { error: "ТЗ не найдено или ещё не завершено" };

  const newQuantity = new Decimal(parsed.data as number);
  if (newQuantity.equals(order.producedQuantity)) return {};

  await prisma.$transaction((tx) => applyProducedQuantity(tx, session.user.organizationId, orderId, order, newQuantity));

  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
  return {};
}
