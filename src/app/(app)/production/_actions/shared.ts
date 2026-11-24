import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { consumeFromLot, returnToLot } from "@/lib/stock";
import { FG_FULL_COST_NOTE, fullFinishedCost, orderStockContribution } from "@/lib/finished-goods-cost";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { MAX_QTY, zNum } from "@/lib/input";

export type FormState = { error?: string };

export type ResolvedLot = { line: number; lotId: string; quantity: number };

// Resolves parsed lot lines against lots that still have stock. An ambiguous
// number is never guessed — listed instead. Every problem is collected.
// `warehouseId` limits the search to one raw-material warehouse (ТЗ card);
// creation searches all warehouses.
export async function resolveLotLines(
  organizationId: string,
  lines: { line: number; lotNumber: string; quantity: number }[],
  warehouseId?: string
): Promise<{ resolved: ResolvedLot[]; errors: string[] }> {
  const resolved: ResolvedLot[] = [];
  const errors: string[] = [];
  if (lines.length === 0) return { resolved, errors };
  const lots = await prisma.rawMaterialLot.findMany({
    where: {
      organizationId,
      quantityRemaining: { gt: 0 },
      lotNumber: { not: null },
      ...(warehouseId ? { warehouseId } : {}),
    },
    include: { rawMaterial: { select: { name: true } }, purchase: { select: { number: true } } },
  });
  const byNumber = new Map<string, typeof lots>();
  for (const l of lots) {
    const k = l.lotNumber!.trim().toLowerCase();
    byNumber.set(k, [...(byNumber.get(k) ?? []), l]);
  }
  const needed = new Map<string, Decimal>();
  for (const ln of lines) {
    const cands = byNumber.get(ln.lotNumber.toLowerCase()) ?? [];
    if (cands.length === 0) {
      errors.push(`строка ${ln.line}: лот ${ln.lotNumber} не найден (или нет остатка)`);
      continue;
    }
    if (cands.length > 1) {
      const opts = cands
        .map((c) => `${c.rawMaterial.name}${c.purchase ? `, закупка ${c.purchase.number}` : ""}, остаток ${c.quantityRemaining.toString()}`)
        .join("; ");
      errors.push(`строка ${ln.line}: лот ${ln.lotNumber} неоднозначен, найдено ${cands.length}: ${opts}`);
      continue;
    }
    const lot = cands[0];
    const total = (needed.get(lot.id) ?? new Decimal(0)).add(ln.quantity);
    if (lot.quantityRemaining.lessThan(total)) {
      errors.push(
        `строка ${ln.line}: лот ${ln.lotNumber} — мало остатка: есть ${lot.quantityRemaining.toString()}, нужно ${total.toString()}`
      );
      continue;
    }
    needed.set(lot.id, total);
    resolved.push({ line: ln.line, lotId: lot.id, quantity: ln.quantity });
  }
  const lineNo = (e: string) => Number(/^строка (\d+)/.exec(e)?.[1] ?? 0);
  errors.sort((x, y) => lineNo(x) - lineNo(y));
  return { resolved, errors };
}

// Any ТЗ can be edited regardless of status — completed orders are the
// normal case once the historical registry is imported, and mistakes in
// what was entered (wrong lot, wrong quantity, a forgotten expense) need
// to stay fixable. See syncCompletedOrderCost below for how a COMPLETED
// order's fixed cost snapshot (and the finished-goods stock valuation it
// already fed) stays correct after such an edit.
export async function getEditableOrder(organizationId: string, orderId: string) {
  return prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId },
    include: { productModel: { include: { materials: true } }, batch: { select: { number: true } } },
  });
}

/**
 * After a material-usage or expense edit on a COMPLETED order, recomputes
 * materialCost/expenseCost/totalCost/unitCost from the current lines (same
 * formula as completeProductionOrder) and carries the resulting delta into
 * the finished-goods stock valuation this order already fed at completion
 * time, so /finished-stock and /articles don't go stale. No-op for
 * PLANNED/IN_PROGRESS orders (nothing snapshotted yet) or zero-quantity ones.
 */
export async function syncCompletedOrderCost(tx: Prisma.TransactionClient, orderId: string, organizationId: string) {
  const order = await tx.productionOrder.findUnique({
    where: { id: orderId },
    include: { materialUsages: true, expenses: true },
  });
  if (!order || order.status !== "COMPLETED" || order.producedQuantity.isZero()) return;

  const materialCost = order.materialUsages.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
  const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const totalCost = materialCost.add(expenseCost);
  const unitCost = totalCost.div(order.producedQuantity);
  const snapshotDelta = totalCost.sub(order.totalCost ?? new Decimal(0));

  // Стоимость ТЗ на складе ГП: если ТЗ уже ведётся по полной себестоимости (с работой и 4%) — приводим вклад ТЗ к ней;
  // иначе (старое завершённое ТЗ, пересчёт не делали) — как раньше, только изменение снимка.
  const contribution = await orderStockContribution(tx, orderId);
  const full = fullFinishedCost(order, order.producedQuantity);
  const stockDelta = contribution.marked ? full.total.sub(contribution.count === 0 ? (order.totalCost ?? new Decimal(0)) : contribution.net) : snapshotDelta;

  await tx.productionOrder.update({
    where: { id: orderId },
    data: { materialCost, expenseCost, totalCost, unitCost },
  });

  if (stockDelta.abs().lt(0.005)) return;

  const stock = await tx.finishedGoodsStock.findUnique({
    where: {
      warehouseId_productModelId: { warehouseId: order.finishedWarehouseId, productModelId: order.productModelId },
    },
  });
  if (!stock) return;

  const newTotalValue = stock.quantity.mul(stock.avgUnitCost).add(stockDelta);
  const newAvgUnitCost = stock.quantity.isZero() ? stock.avgUnitCost : newTotalValue.div(stock.quantity);
  await tx.finishedGoodsStock.update({ where: { id: stock.id }, data: { avgUnitCost: newAvgUnitCost } });
  await tx.finishedGoodsMovement.create({
    data: {
      organizationId,
      warehouseId: order.finishedWarehouseId,
      productModelId: order.productModelId,
      type: stockDelta.greaterThan(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
      quantity: 0,
      unitCost: order.producedQuantity.isZero() ? 0 : stockDelta.abs().div(order.producedQuantity),
      totalCost: stockDelta.abs(),
      productionOrderId: orderId,
      notes: contribution.marked ? `Корректировка себестоимости после правки завершённого ТЗ. ${FG_FULL_COST_NOTE}` : "Корректировка себестоимости после правки завершённого ТЗ",
    },
  });
}

// ---------- Material consumption (draws from a specific lot — see src/lib/stock.ts) ----------

export const usageSchema = z.object({
  lotId: z.string().min(1, "Выберите лот"),
  quantity: zNum("Количество", { positive: true, max: MAX_QTY }),
});

// Editing an already-entered usage line — same underlying fix as
// updatePurchaseItem, but the safety story is different: unlike a
// received purchase item (where consumption into production is
// deliberately out of scope to unwind), a COMPLETED order's cost snapshot
// is already designed to be recomputed after a material-usage edit —
// that's the whole job of syncCompletedOrderCost, which add/removeMaterialUsage
// already call regardless of order status (see getEditableOrder's comment).
// So there's no separate "was this order completed" block here: any lot/
// quantity change is applied by reversing the old consumption back onto its
// old lot and drawing the new quantity from the (possibly different) new
// lot, exactly like a remove+add would — consumeFromLot's own
// quantityRemaining check then naturally covers "can't consume more than
// what's left", correctly accounting for this usage's own current amount
// because that amount was just returned to the lot first.
/** Запись правки списания (общая для сохранения и предпросмотра «что изменится»): вернуть старое количество в лот, списать новое, пересчитать завершённое ТЗ. */
export async function applyUsageEdit(
  tx: Prisma.TransactionClient,
  organizationId: string,
  orderId: string,
  usage: { id: string; lotId: string; quantity: Decimal },
  lotId: string,
  quantity: number | Decimal,
  commission4: boolean,
) {
  await returnToLot(tx, { organizationId, lotId: usage.lotId, quantity: usage.quantity, notes: "Возврат перед правкой списания" });
  const { unitCost, totalCost, rawMaterialId } = await consumeFromLot(tx, { organizationId, lotId, quantity, productionOrderId: orderId });
  await tx.productionMaterialUsage.update({
    where: { id: usage.id },
    data: { lotId, rawMaterialId, quantity, unitCost, totalCost, commission4 },
  });
  await syncCompletedOrderCost(tx, orderId, organizationId);
}

// Editing an already-entered expense line — wrong category/amount or a typo
// in the description. No lot/stock side-effects to reverse here (unlike
// material usage), so this is a plain update plus the same
// syncCompletedOrderCost cascade add/removeProductionExpense already run.
// `description` is read straight off formData rather than through
// expenseSchema's `.optional()` parsing: that treats a blank field as "not
// specified" (right for addProductionExpense, where blank means "leave
// unset"), but on an edit blank means "clear it", and Prisma reads
// `undefined` as "don't touch this field" — the same bug just fixed for
// purchase-item edits in b17a9bd, avoided here by mapping blank to `null`
// explicitly instead of reusing parsed.data.description.
/** Запись правки расхода (общая для сохранения и предпросмотра). */
export async function applyExpenseEdit(tx: Prisma.TransactionClient, organizationId: string, orderId: string, expenseId: string, categoryId: string, amount: number | Decimal, description: string | null) {
  await tx.productionExpense.update({ where: { id: expenseId }, data: { categoryId, amount, description } });
  await syncCompletedOrderCost(tx, orderId, organizationId);
}

// Correcting the produced quantity after completion (e.g. an import typo)
// changes unitCost too (same total cost, different divisor) and needs its
// own finished-goods adjustment, since the quantity fed to stock changes,
// not just its cost — syncCompletedOrderCost only handles the cost-only
// case, so this is a separate, quantity-aware adjustment.
/** Запись нового фактического количества завершённого ТЗ (общая для сохранения и предпросмотра): себестоимость единицы и остаток готовой продукции. */
export async function applyProducedQuantity(
  tx: Prisma.TransactionClient,
  organizationId: string,
  orderId: string,
  order: Prisma.ProductionOrderGetPayload<{ include: { materialUsages: true; expenses: true } }>,
  newQuantity: Decimal,
) {
  const totalCost = order.totalCost ?? new Decimal(0);
  const newUnitCost = totalCost.div(newQuantity);
  let oldContribution = order.producedQuantity.mul(order.unitCost ?? new Decimal(0));
  let newContribution = newQuantity.mul(newUnitCost);
  let fgUnit = newUnitCost;
  let fgNote = "Корректировка фактически произведённого количества после завершения ТЗ";

  {
    // ТЗ ведётся на складе по полной себестоимости (с работой и 4%): работа зависит от количества, поэтому вклад пересчитываем целиком.
    const contribution = await orderStockContribution(tx, orderId);
    if (contribution.marked) {
      const full = fullFinishedCost(order, newQuantity);
      oldContribution = contribution.net;
      newContribution = full.total;
      fgUnit = full.total.div(newQuantity);
      fgNote = `${fgNote}. ${FG_FULL_COST_NOTE}`;
    }
    await tx.productionOrder.update({
      where: { id: orderId },
      data: { producedQuantity: newQuantity, unitCost: newUnitCost },
    });

    const stock = await tx.finishedGoodsStock.findUnique({
      where: {
        warehouseId_productModelId: { warehouseId: order.finishedWarehouseId, productModelId: order.productModelId },
      },
    });
    if (!stock) return;

    const newStockQuantity = stock.quantity.sub(order.producedQuantity).add(newQuantity);
    const newStockValue = stock.quantity.mul(stock.avgUnitCost).sub(oldContribution).add(newContribution);
    const newAvgUnitCost = newStockQuantity.isZero() ? stock.avgUnitCost : newStockValue.div(newStockQuantity);

    await tx.finishedGoodsStock.update({
      where: { id: stock.id },
      data: { quantity: newStockQuantity, avgUnitCost: newAvgUnitCost },
    });
    await tx.finishedGoodsMovement.create({
      data: {
        organizationId,
        warehouseId: order.finishedWarehouseId,
        productModelId: order.productModelId,
        type: newQuantity.greaterThan(order.producedQuantity) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
        quantity: newQuantity.sub(order.producedQuantity).abs(),
        unitCost: fgUnit,
        totalCost: newContribution.sub(oldContribution).abs(),
        productionOrderId: orderId,
        notes: fgNote,
      },
    });
  }
}
