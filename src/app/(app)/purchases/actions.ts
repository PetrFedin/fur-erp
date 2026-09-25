"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { createRawMaterialLot } from "@/lib/stock";
import { nextDocumentNumber } from "@/lib/numbering";
import { Decimal } from "@prisma/client/runtime/library";

const EDIT_ROLES = ["OWNER", "ADMIN", "PURCHASER"] as const;
const WAREHOUSE_ROLES = ["OWNER", "ADMIN", "PURCHASER", "WAREHOUSE"] as const;

export type FormState = { error?: string };

// ---------- Purchase header ----------

const purchaseSchema = z.object({
  supplierId: z.string().min(1, "Выберите поставщика"),
  warehouseId: z.string().min(1, "Выберите склад"),
  currency: z.string().trim().min(1).default("RUB"),
  exchangeRate: z.coerce.number().positive("Курс должен быть больше 0").default(1),
  orderDate: z.string().min(1),
  expectedDate: z.string().optional(),
  notes: z.string().trim().optional(),
});

export async function createPurchase(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = purchaseSchema.safeParse({
    supplierId: formData.get("supplierId"),
    warehouseId: formData.get("warehouseId"),
    currency: formData.get("currency") || "RUB",
    exchangeRate: formData.get("exchangeRate") || 1,
    orderDate: formData.get("orderDate"),
    expectedDate: formData.get("expectedDate") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const purchase = await prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, "purchase", session.user.organizationId, "З");
    return tx.purchase.create({
      data: {
        organizationId: session.user.organizationId,
        number,
        supplierId: parsed.data.supplierId,
        warehouseId: parsed.data.warehouseId,
        currency: parsed.data.currency,
        exchangeRate: parsed.data.currency === "RUB" ? 1 : parsed.data.exchangeRate,
        orderDate: new Date(parsed.data.orderDate),
        expectedDate: parsed.data.expectedDate ? new Date(parsed.data.expectedDate) : undefined,
        notes: parsed.data.notes,
        createdById: session.user.id,
      },
    });
  });

  revalidatePath("/purchases");
  redirect(`/purchases/${purchase.id}`);
}

export async function updatePurchaseExchangeRate(purchaseId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const rate = z.coerce.number().positive().safeParse(formData.get("exchangeRate"));
  if (!rate.success) return;

  await prisma.purchase.updateMany({
    where: { id: purchaseId, organizationId: session.user.organizationId, status: { notIn: ["RECEIVED", "CANCELLED"] } },
    data: { exchangeRate: rate.data },
  });
  revalidatePath(`/purchases/${purchaseId}`);
}

export async function setPurchaseStatus(
  purchaseId: string,
  status: "DRAFT" | "ORDERED" | "IN_TRANSIT" | "CANCELLED"
) {
  const session = await requireRole(...EDIT_ROLES);
  await prisma.purchase.updateMany({
    where: {
      id: purchaseId,
      organizationId: session.user.organizationId,
      status: { notIn: ["RECEIVED", "CANCELLED"] },
    },
    data: { status },
  });
  revalidatePath(`/purchases/${purchaseId}`);
}

// ---------- Line items ----------

const itemSchema = z.object({
  rawMaterialId: z.string().min(1, "Выберите сырьё"),
  quantity: z.coerce.number().positive("Количество должно быть больше 0"),
  unitPrice: z.coerce.number().nonnegative("Цена не может быть отрицательной"),
  lotNumber: z.string().trim().optional(),
  grade: z.string().trim().optional(),
  color: z.string().trim().optional(),
});

export async function addPurchaseItem(purchaseId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) return;

  const parsed = itemSchema.safeParse({
    rawMaterialId: formData.get("rawMaterialId"),
    quantity: formData.get("quantity"),
    unitPrice: formData.get("unitPrice"),
    lotNumber: formData.get("lotNumber") || undefined,
    grade: formData.get("grade") || undefined,
    color: formData.get("color") || undefined,
  });
  if (!parsed.success) return;

  const subtotal = new Decimal(parsed.data.quantity).mul(parsed.data.unitPrice);

  await prisma.purchaseItem.create({
    data: {
      purchaseId,
      rawMaterialId: parsed.data.rawMaterialId,
      quantity: parsed.data.quantity,
      unitPrice: parsed.data.unitPrice,
      subtotal,
      lotNumber: parsed.data.lotNumber,
      grade: parsed.data.grade,
      color: parsed.data.color,
    },
  });

  revalidatePath(`/purchases/${purchaseId}`);
}

export async function removePurchaseItem(purchaseId: string, itemId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) return;

  await prisma.purchaseItem.delete({ where: { id: itemId } });
  revalidatePath(`/purchases/${purchaseId}`);
}

// ---------- Expenses ----------

const expenseSchema = z.object({
  categoryId: z.string().min(1, "Выберите статью расходов"),
  amount: z.coerce.number().positive("Сумма должна быть больше 0"),
  description: z.string().trim().optional(),
});

export async function addPurchaseExpense(purchaseId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) return;

  const parsed = expenseSchema.safeParse({
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return;

  await prisma.purchaseExpense.create({
    data: { purchaseId, ...parsed.data },
  });

  revalidatePath(`/purchases/${purchaseId}`);
}

export async function removePurchaseExpense(purchaseId: string, expenseId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) return;

  await prisma.purchaseExpense.delete({ where: { id: expenseId } });
  revalidatePath(`/purchases/${purchaseId}`);
}

// ---------- Payments ----------

const paymentSchema = z.object({
  amount: z.coerce.number().positive("Сумма должна быть больше 0"),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]),
  paidAt: z.string().min(1),
  notes: z.string().trim().optional(),
});

export async function addPurchasePayment(purchaseId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId: session.user.organizationId },
  });
  if (!purchase) return;

  const parsed = paymentSchema.safeParse({
    amount: formData.get("amount"),
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return;

  await prisma.payment.create({
    data: {
      organizationId: session.user.organizationId,
      supplierId: purchase.supplierId,
      purchaseId,
      amount: parsed.data.amount,
      currency: purchase.currency,
      method: parsed.data.method,
      status: "COMPLETED",
      paidAt: new Date(parsed.data.paidAt),
      notes: parsed.data.notes,
    },
  });

  revalidatePath(`/purchases/${purchaseId}`);
  revalidatePath("/payments");
}

// ---------- Receiving: this is where landed cost + stock-in happens ----------

export async function receivePurchase(purchaseId: string): Promise<FormState> {
  const session = await requireRole(...WAREHOUSE_ROLES);

  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId: session.user.organizationId },
    include: { items: true, expenses: true },
  });
  if (!purchase) return { error: "Закупка не найдена" };
  if (purchase.status === "RECEIVED") return { error: "Закупка уже оприходована" };
  if (purchase.status === "CANCELLED") return { error: "Закупка отменена" };
  if (purchase.items.length === 0) return { error: "В закупке нет позиций сырья" };

  // Purchase expenses (customs, auction fees, dressing, transport, ...) are
  // always recorded in RUB; item prices are in the purchase's currency and
  // get converted here. Expenses are allocated across items proportionally
  // by their (already-RUB) subtotal share, then rolled into that item's lot
  // as a fixed landed cost — see src/lib/stock.ts.
  const totalExpenses = purchase.expenses.reduce((sum, e) => sum.add(e.amount), new Decimal(0));
  const totalItemsSubtotalRub = purchase.items.reduce(
    (sum, i) => sum.add(i.subtotal.mul(purchase.exchangeRate)),
    new Decimal(0)
  );

  await prisma.$transaction(async (tx) => {
    for (const item of purchase.items) {
      const subtotalRub = item.subtotal.mul(purchase.exchangeRate);
      const allocatedExpense = totalItemsSubtotalRub.isZero()
        ? new Decimal(0)
        : totalExpenses.mul(subtotalRub).div(totalItemsSubtotalRub);
      const landedTotal = subtotalRub.add(allocatedExpense);

      await createRawMaterialLot(tx, {
        organizationId: session.user.organizationId,
        warehouseId: purchase.warehouseId,
        rawMaterialId: item.rawMaterialId,
        lotNumber: item.lotNumber,
        grade: item.grade,
        color: item.color,
        quantity: item.quantity,
        unitCost: landedTotal.div(item.quantity),
        totalCost: landedTotal,
        purchaseId: purchase.id,
        purchaseItemId: item.id,
      });
    }

    await tx.purchase.update({
      where: { id: purchase.id },
      data: { status: "RECEIVED", receivedDate: new Date() },
    });
  });

  revalidatePath(`/purchases/${purchaseId}`);
  revalidatePath("/stock");
  revalidatePath("/purchases");
  return {};
}

async function getEditablePurchase(organizationId: string, purchaseId: string) {
  return prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId, status: { notIn: ["RECEIVED", "CANCELLED"] } },
  });
}
