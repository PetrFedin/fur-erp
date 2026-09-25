"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { consumeFromLot, returnToLot, receiveFinishedGoodsStock } from "@/lib/stock";
import { nextDocumentNumber } from "@/lib/numbering";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";

const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;

export type FormState = { error?: string };

// ---------- Order header ----------

const orderSchema = z.object({
  productModelId: z.string().min(1, "Выберите модель изделия"),
  rawWarehouseId: z.string().min(1, "Выберите склад сырья"),
  finishedWarehouseId: z.string().min(1, "Выберите склад готовой продукции"),
  plannedQuantity: z.coerce.number().positive("Плановое количество должно быть больше 0"),
  color: z.string().trim().optional(),
  size: z.string().trim().optional(),
  materialDescription: z.string().trim().optional(),
  lining: z.string().trim().optional(),
  startDate: z.string().optional(),
  notes: z.string().trim().optional(),
  clientId: z.string().trim().optional(),
  contractNumber: z.string().trim().optional(),
  workOrderNumber: z.string().trim().optional(),
  workOrderDate: z.string().optional(),
  clientWorkPricePerUnit: z.coerce
    .number()
    .nonnegative()
    .optional()
    .or(z.nan().transform(() => undefined)),
  retailPrice: z.coerce
    .number()
    .nonnegative()
    .optional()
    .or(z.nan().transform(() => undefined)),
});

export async function createProductionOrder(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = orderSchema.safeParse({
    productModelId: formData.get("productModelId"),
    rawWarehouseId: formData.get("rawWarehouseId"),
    finishedWarehouseId: formData.get("finishedWarehouseId"),
    plannedQuantity: formData.get("plannedQuantity"),
    color: formData.get("color") || undefined,
    size: formData.get("size") || undefined,
    materialDescription: formData.get("materialDescription") || undefined,
    lining: formData.get("lining") || undefined,
    startDate: formData.get("startDate") || undefined,
    notes: formData.get("notes") || undefined,
    clientId: formData.get("clientId") || undefined,
    contractNumber: formData.get("contractNumber") || undefined,
    workOrderNumber: formData.get("workOrderNumber") || undefined,
    workOrderDate: formData.get("workOrderDate") || undefined,
    clientWorkPricePerUnit: formData.get("clientWorkPricePerUnit") || undefined,
    retailPrice: formData.get("retailPrice") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const order = await prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, "productionOrder", session.user.organizationId, "П");
    return tx.productionOrder.create({
      data: {
        organizationId: session.user.organizationId,
        number,
        productModelId: parsed.data.productModelId,
        rawWarehouseId: parsed.data.rawWarehouseId,
        finishedWarehouseId: parsed.data.finishedWarehouseId,
        plannedQuantity: parsed.data.plannedQuantity,
        color: parsed.data.color,
        size: parsed.data.size,
        materialDescription: parsed.data.materialDescription,
        lining: parsed.data.lining,
        startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : new Date(),
        notes: parsed.data.notes,
        clientId: parsed.data.clientId || undefined,
        contractNumber: parsed.data.contractNumber,
        workOrderNumber: parsed.data.workOrderNumber,
        workOrderDate: parsed.data.workOrderDate ? new Date(parsed.data.workOrderDate) : undefined,
        clientWorkPricePerUnit: parsed.data.clientWorkPricePerUnit,
        retailPrice: parsed.data.retailPrice,
        createdById: session.user.id,
      },
    });
  });

  revalidatePath("/production");
  redirect(`/production/${order.id}`);
}

// Retail price is really an attribute of the article, not of one specific
// ТЗ (matches the source spreadsheet, where "ПРЦ" is one number per
// article) — so setting it here also updates the ProductModel, and every
// other open/completed order of that model, so /articles and every ТЗ of
// this model show the same price and markup without drifting apart.
export async function updateRetailPrice(orderId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = z.coerce.number().nonnegative().safeParse(formData.get("retailPrice"));
  if (!parsed.success) return;

  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId },
  });
  if (!order) return;

  await prisma.$transaction([
    prisma.productionOrder.updateMany({
      where: { productModelId: order.productModelId, organizationId: session.user.organizationId },
      data: { retailPrice: parsed.data },
    }),
    prisma.productModel.update({
      where: { id: order.productModelId },
      data: { sellingPrice: parsed.data },
    }),
  ]);

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/production");
  revalidatePath("/articles");
}

// Any ТЗ can be edited regardless of status — completed orders are the
// normal case once the historical registry is imported, and mistakes in
// what was entered (wrong lot, wrong quantity, a forgotten expense) need
// to stay fixable. See syncCompletedOrderCost below for how a COMPLETED
// order's fixed cost snapshot (and the finished-goods stock valuation it
// already fed) stays correct after such an edit.
async function getEditableOrder(organizationId: string, orderId: string) {
  return prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId },
    include: { productModel: { include: { materials: true } } },
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
async function syncCompletedOrderCost(tx: Prisma.TransactionClient, orderId: string, organizationId: string) {
  const order = await tx.productionOrder.findUnique({
    where: { id: orderId },
    include: { materialUsages: true, expenses: true },
  });
  if (!order || order.status !== "COMPLETED" || order.producedQuantity.isZero()) return;

  const materialCost = order.materialUsages.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
  const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const totalCost = materialCost.add(expenseCost);
  const unitCost = totalCost.div(order.producedQuantity);
  const delta = totalCost.sub(order.totalCost ?? new Decimal(0));

  await tx.productionOrder.update({
    where: { id: orderId },
    data: { materialCost, expenseCost, totalCost, unitCost },
  });

  if (delta.isZero()) return;

  const stock = await tx.finishedGoodsStock.findUnique({
    where: {
      warehouseId_productModelId: { warehouseId: order.finishedWarehouseId, productModelId: order.productModelId },
    },
  });
  if (!stock) return;

  const newTotalValue = stock.quantity.mul(stock.avgUnitCost).add(delta);
  const newAvgUnitCost = stock.quantity.isZero() ? stock.avgUnitCost : newTotalValue.div(stock.quantity);
  await tx.finishedGoodsStock.update({ where: { id: stock.id }, data: { avgUnitCost: newAvgUnitCost } });
  await tx.finishedGoodsMovement.create({
    data: {
      organizationId,
      warehouseId: order.finishedWarehouseId,
      productModelId: order.productModelId,
      type: delta.greaterThan(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
      quantity: 0,
      unitCost: order.producedQuantity.isZero() ? 0 : delta.abs().div(order.producedQuantity),
      totalCost: delta.abs(),
      productionOrderId: orderId,
      notes: "Корректировка себестоимости после правки завершённого ТЗ",
    },
  });
}

// ---------- Material consumption (draws from a specific lot — see src/lib/stock.ts) ----------

const usageSchema = z.object({
  lotId: z.string().min(1, "Выберите лот"),
  quantity: z.coerce.number().positive("Количество должно быть больше 0"),
});

export async function addMaterialUsage(orderId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return { error: "Заказ не найден" };

  const parsed = usageSchema.safeParse({
    lotId: formData.get("lotId"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  try {
    await prisma.$transaction(async (tx) => {
      const { unitCost, totalCost, rawMaterialId } = await consumeFromLot(tx, {
        organizationId: session.user.organizationId,
        lotId: parsed.data.lotId,
        quantity: parsed.data.quantity,
        productionOrderId: orderId,
      });

      await tx.productionMaterialUsage.create({
        data: {
          productionOrderId: orderId,
          rawMaterialId,
          lotId: parsed.data.lotId,
          quantity: parsed.data.quantity,
          unitCost,
          totalCost,
        },
      });

      if (order.status === "PLANNED") {
        await tx.productionOrder.update({ where: { id: orderId }, data: { status: "IN_PROGRESS" } });
      }
      await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Не удалось списать сырьё" };
  }

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/lots");
  return {};
}

// Bulk entry: paste "лот  количество" pairs (one per line, tab- or
// multi-space-separated) copied straight from a ТЗ spreadsheet instead of
// picking each lot one at a time — real orders here run up to a few dozen
// lot lines. Lot numbers are matched within this order's raw-material
// warehouse; unmatched or insufficient lines are reported back, matched
// ones are still applied.
export type BulkUsageState = { error?: string; created?: number; skipped?: string[] };

export async function addMaterialUsagesBulk(
  orderId: string,
  _prev: BulkUsageState,
  formData: FormData
): Promise<BulkUsageState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return { error: "Заказ не найден" };

  const raw = (formData.get("rows") as string | null)?.trim();
  if (!raw) return { error: "Вставьте хотя бы одну строку" };

  const lots = await prisma.rawMaterialLot.findMany({
    where: { organizationId: session.user.organizationId, warehouseId: order.rawWarehouseId },
  });
  const lotByNumber = new Map(lots.filter((l) => l.lotNumber).map((l) => [l.lotNumber!.trim().toLowerCase(), l]));

  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const skipped: string[] = [];
  let created = 0;

  for (const line of lines) {
    const cells = line.split("\t").length > 1 ? line.split("\t") : line.split(/ {2,}/);
    const [lotNumberRaw, quantityRaw] = cells.map((c) => c?.trim());
    const quantity = Number((quantityRaw ?? "").replace(",", "."));
    const lot = lotNumberRaw ? lotByNumber.get(lotNumberRaw.toLowerCase()) : undefined;

    if (!lot || !Number.isFinite(quantity) || quantity <= 0) {
      skipped.push(line);
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const { unitCost, totalCost, rawMaterialId } = await consumeFromLot(tx, {
          organizationId: session.user.organizationId,
          lotId: lot.id,
          quantity,
          productionOrderId: orderId,
        });
        await tx.productionMaterialUsage.create({
          data: { productionOrderId: orderId, rawMaterialId, lotId: lot.id, quantity, unitCost, totalCost },
        });
        if (order.status === "PLANNED") {
          await tx.productionOrder.update({ where: { id: orderId }, data: { status: "IN_PROGRESS" } });
        }
        await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
      });
      created++;
    } catch {
      skipped.push(line);
    }
  }

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/lots");
  return { created, skipped: skipped.length ? skipped : undefined };
}

/**
 * Consumes the BOM-defined quantities for the order's planned quantity,
 * picking lots automatically (oldest received first) until each material's
 * required quantity is covered — a quick-fill convenience. Each line is
 * still a normal ProductionMaterialUsage the technologist can review/undo;
 * for deliberate lot choice (matching skins by color/quality) use the
 * manual form instead.
 */
export async function applyBomToOrder(orderId: string): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return { error: "Заказ не найден" };
  if (order.productModel.materials.length === 0) {
    return { error: "У модели не задана норма расхода (BOM)" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const line of order.productModel.materials) {
        let remaining = line.quantityPerUnit.mul(order.plannedQuantity);

        const availableLots = await tx.rawMaterialLot.findMany({
          where: {
            organizationId: session.user.organizationId,
            warehouseId: order.rawWarehouseId,
            rawMaterialId: line.rawMaterialId,
            quantityRemaining: { gt: 0 },
          },
          orderBy: { receivedDate: "asc" },
        });

        for (const lot of availableLots) {
          if (remaining.lessThanOrEqualTo(0)) break;
          const take = Decimal.min(remaining, lot.quantityRemaining);

          const { unitCost, totalCost } = await consumeFromLot(tx, {
            organizationId: session.user.organizationId,
            lotId: lot.id,
            quantity: take,
            productionOrderId: orderId,
            notes: "Списано по норме (BOM)",
          });

          await tx.productionMaterialUsage.create({
            data: {
              productionOrderId: orderId,
              rawMaterialId: line.rawMaterialId,
              lotId: lot.id,
              quantity: take,
              unitCost,
              totalCost,
            },
          });

          remaining = remaining.sub(take);
        }

        if (remaining.greaterThan(0)) {
          throw new Error(
            `Недостаточно сырья «${(await tx.rawMaterial.findUnique({ where: { id: line.rawMaterialId } }))?.name}» на складе (не хватает ${remaining.toString()})`
          );
        }
      }

      if (order.status === "PLANNED") {
        await tx.productionOrder.update({ where: { id: orderId }, data: { status: "IN_PROGRESS" } });
      }
      await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Не удалось списать сырьё по норме" };
  }

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/lots");
  return {};
}

export async function removeMaterialUsage(orderId: string, usageId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return;

  const usage = await prisma.productionMaterialUsage.findFirst({
    where: { id: usageId, productionOrderId: orderId },
  });
  if (!usage) return;

  await prisma.$transaction(async (tx) => {
    await returnToLot(tx, {
      organizationId: session.user.organizationId,
      lotId: usage.lotId,
      quantity: usage.quantity,
    });
    await tx.productionMaterialUsage.delete({ where: { id: usageId } });
    await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
  });

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/lots");
}

// ---------- Production expenses ----------

const expenseSchema = z.object({
  categoryId: z.string().min(1, "Выберите статью расходов"),
  amount: z.coerce.number().positive("Сумма должна быть больше 0"),
  description: z.string().trim().optional(),
});

export async function addProductionExpense(orderId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return;

  const parsed = expenseSchema.safeParse({
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return;

  await prisma.$transaction(async (tx) => {
    await tx.productionExpense.create({
      data: { productionOrderId: orderId, ...parsed.data },
    });
    await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
  });

  revalidatePath(`/production/${orderId}`);
}

export async function removeProductionExpense(orderId: string, expenseId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return;

  await prisma.$transaction(async (tx) => {
    await tx.productionExpense.delete({ where: { id: expenseId } });
    await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
  });
  revalidatePath(`/production/${orderId}`);
}

// ---------- Completion: snapshots cost and receives finished goods ----------

const completeSchema = z.object({
  producedQuantity: z.coerce.number().positive("Количество должно быть больше 0"),
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
  if (!order) return { error: "Заказ не найден" };

  const parsed = completeSchema.safeParse({ producedQuantity: formData.get("producedQuantity") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const materialCost = order.materialUsages.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
  const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const totalCost = materialCost.add(expenseCost);
  const unitCost = totalCost.div(parsed.data.producedQuantity);

  await prisma.$transaction(async (tx) => {
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
      unitCost,
      totalCost,
      type: "PRODUCTION_IN",
      productionOrderId: orderId,
    });
  });

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/production");
  revalidatePath("/finished-stock");
  return {};
}

// Correcting the produced quantity after completion (e.g. an import typo)
// changes unitCost too (same total cost, different divisor) and needs its
// own finished-goods adjustment, since the quantity fed to stock changes,
// not just its cost — syncCompletedOrderCost only handles the cost-only
// case, so this is a separate, quantity-aware adjustment.
export async function updateProducedQuantity(
  orderId: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = z.coerce.number().positive("Количество должно быть больше 0").safeParse(formData.get("producedQuantity"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId, status: "COMPLETED" },
  });
  if (!order) return { error: "Заказ не найден или ещё не завершён" };

  const newQuantity = new Decimal(parsed.data);
  if (newQuantity.equals(order.producedQuantity)) return {};

  const totalCost = order.totalCost ?? new Decimal(0);
  const newUnitCost = totalCost.div(newQuantity);
  const oldContribution = order.producedQuantity.mul(order.unitCost ?? new Decimal(0));
  const newContribution = newQuantity.mul(newUnitCost);

  await prisma.$transaction(async (tx) => {
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
        organizationId: session.user.organizationId,
        warehouseId: order.finishedWarehouseId,
        productModelId: order.productModelId,
        type: newQuantity.greaterThan(order.producedQuantity) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
        quantity: newQuantity.sub(order.producedQuantity).abs(),
        unitCost: newUnitCost,
        totalCost: newContribution.sub(oldContribution).abs(),
        productionOrderId: orderId,
        notes: "Корректировка фактически произведённого количества после завершения ТЗ",
      },
    });
  });

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/production");
  revalidatePath("/finished-stock");
  revalidatePath("/articles");
  return {};
}

// ---------- Payments from the client (separate ledger from supplier payments) ----------

const productionPaymentSchema = z.object({
  amount: z.coerce.number().positive("Сумма должна быть больше 0"),
  paymentType: z.enum(["ADVANCE", "PARTIAL", "FINAL"]),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]),
  paidAt: z.string().min(1),
  notes: z.string().trim().optional(),
});

// One payment can cover several ТЗ at once (a client paying a lump sum
// against a running tab) — orderId is always included, plus whichever
// sibling orders (same client) were checked in the form.
export async function addProductionPayment(orderId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId },
  });
  if (!order) return;

  const parsed = productionPaymentSchema.safeParse({
    amount: formData.get("amount"),
    paymentType: formData.get("paymentType") || "FINAL",
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return;

  const extraOrderIds = formData.getAll("orderIds").map(String);
  const orderIds = Array.from(new Set([orderId, ...extraOrderIds]));
  const validOrders = await prisma.productionOrder.findMany({
    where: { id: { in: orderIds }, organizationId: session.user.organizationId },
    select: { id: true },
  });

  await prisma.productionPayment.create({
    data: {
      organizationId: session.user.organizationId,
      clientId: order.clientId,
      amount: parsed.data.amount,
      paymentType: parsed.data.paymentType,
      method: parsed.data.method,
      status: "COMPLETED",
      paidAt: new Date(parsed.data.paidAt),
      notes: parsed.data.notes,
      orders: { create: validOrders.map((o) => ({ productionOrderId: o.id })) },
    },
  });

  revalidatePath(`/production/${orderId}`);
  for (const id of orderIds) revalidatePath(`/production/${id}`);
}

export async function removeProductionPayment(orderId: string, paymentId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId },
  });
  if (!order) return;

  const payment = await prisma.productionPayment.findFirst({
    where: { id: paymentId, organizationId: session.user.organizationId },
    include: { orders: true },
  });
  if (!payment) return;

  await prisma.productionPayment.delete({ where: { id: paymentId } });
  for (const alloc of payment.orders) revalidatePath(`/production/${alloc.productionOrderId}`);
}

export async function cancelProductionOrder(orderId: string) {
  const session = await requireRole(...EDIT_ROLES);
  await prisma.productionOrder.updateMany({
    where: {
      id: orderId,
      organizationId: session.user.organizationId,
      status: "PLANNED",
      materialUsages: { none: {} },
    },
    data: { status: "CANCELLED" },
  });
  revalidatePath(`/production/${orderId}`);
  revalidatePath("/production");
}
