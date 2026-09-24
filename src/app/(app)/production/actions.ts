"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { consumeRawMaterialStock, receiveRawMaterialStock, receiveFinishedGoodsStock } from "@/lib/stock";
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
  startDate: z.string().optional(),
  notes: z.string().trim().optional(),
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
    startDate: formData.get("startDate") || undefined,
    notes: formData.get("notes") || undefined,
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
        startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : new Date(),
        notes: parsed.data.notes,
        createdById: session.user.id,
      },
    });
  });

  revalidatePath("/production");
  redirect(`/production/${order.id}`);
}

async function getOpenOrder(organizationId: string, orderId: string) {
  return prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
    include: { productModel: { include: { materials: true } } },
  });
}

// ---------- Material consumption ----------

const usageSchema = z.object({
  rawMaterialId: z.string().min(1, "Выберите сырьё"),
  quantity: z.coerce.number().positive("Количество должно быть больше 0"),
});

export async function addMaterialUsage(orderId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getOpenOrder(session.user.organizationId, orderId);
  if (!order) return { error: "Заказ не найден или уже завершён" };

  const parsed = usageSchema.safeParse({
    rawMaterialId: formData.get("rawMaterialId"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  try {
    await prisma.$transaction(async (tx) => {
      const { unitCost, totalCost } = await consumeRawMaterialStock(tx, {
        organizationId: session.user.organizationId,
        warehouseId: order.rawWarehouseId,
        rawMaterialId: parsed.data.rawMaterialId,
        quantity: parsed.data.quantity,
        type: "PRODUCTION_OUT",
        productionOrderId: orderId,
      });

      await tx.productionMaterialUsage.create({
        data: {
          productionOrderId: orderId,
          rawMaterialId: parsed.data.rawMaterialId,
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

/** Consumes exactly the BOM-defined quantities for the order's planned quantity, in one go. */
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
        const quantity = line.quantityPerUnit.mul(order.plannedQuantity);
        const { unitCost, totalCost } = await consumeRawMaterialStock(tx, {
          organizationId: session.user.organizationId,
          warehouseId: order.rawWarehouseId,
          rawMaterialId: line.rawMaterialId,
          quantity,
          type: "PRODUCTION_OUT",
          productionOrderId: orderId,
          notes: "Списано по норме (BOM)",
        });

        await tx.productionMaterialUsage.create({
          data: {
            productionOrderId: orderId,
            rawMaterialId: line.rawMaterialId,
            quantity,
            unitCost,
            totalCost,
          },
        });
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
    await receiveRawMaterialStock(tx, {
      organizationId: session.user.organizationId,
      warehouseId: order.rawWarehouseId,
      rawMaterialId: usage.rawMaterialId,
      quantity: usage.quantity,
      unitCost: usage.unitCost,
      totalCost: usage.totalCost,
      type: "ADJUSTMENT_IN",
      notes: "Отмена списания в производство",
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
