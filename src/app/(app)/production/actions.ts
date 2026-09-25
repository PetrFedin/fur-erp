"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { consumeFromLot, returnToLot, receiveFinishedGoodsStock } from "@/lib/stock";
import { nextDocumentNumber } from "@/lib/numbering";
import { Decimal } from "@prisma/client/runtime/library";

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

export async function updateRetailPrice(orderId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = z.coerce.number().nonnegative().safeParse(formData.get("retailPrice"));
  if (!parsed.success) return;

  await prisma.productionOrder.updateMany({
    where: { id: orderId, organizationId: session.user.organizationId },
    data: { retailPrice: parsed.data },
  });
  revalidatePath(`/production/${orderId}`);
}

async function getOpenOrder(organizationId: string, orderId: string) {
  return prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
    include: { productModel: { include: { materials: true } } },
  });
}

// ---------- Material consumption (draws from a specific lot — see src/lib/stock.ts) ----------

const usageSchema = z.object({
  lotId: z.string().min(1, "Выберите лот"),
  quantity: z.coerce.number().positive("Количество должно быть больше 0"),
});

export async function addMaterialUsage(orderId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getOpenOrder(session.user.organizationId, orderId);
  if (!order) return { error: "Заказ не найден или уже завершён" };

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
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Не удалось списать сырьё" };
  }

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/stock");
  return {};
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
  const order = await getOpenOrder(session.user.organizationId, orderId);
  if (!order) return { error: "Заказ не найден или уже завершён" };
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
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Не удалось списать сырьё по норме" };
  }

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/stock");
  return {};
}

export async function removeMaterialUsage(orderId: string, usageId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getOpenOrder(session.user.organizationId, orderId);
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
  });

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/stock");
}

// ---------- Production expenses ----------

const expenseSchema = z.object({
  categoryId: z.string().min(1, "Выберите статью расходов"),
  amount: z.coerce.number().positive("Сумма должна быть больше 0"),
  description: z.string().trim().optional(),
});

export async function addProductionExpense(orderId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getOpenOrder(session.user.organizationId, orderId);
  if (!order) return;

  const parsed = expenseSchema.safeParse({
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return;

  await prisma.productionExpense.create({
    data: { productionOrderId: orderId, ...parsed.data },
  });

  revalidatePath(`/production/${orderId}`);
}

export async function removeProductionExpense(orderId: string, expenseId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getOpenOrder(session.user.organizationId, orderId);
  if (!order) return;

  await prisma.productionExpense.delete({ where: { id: expenseId } });
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
  if (!order) return { error: "Заказ не найден или уже завершён" };

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
