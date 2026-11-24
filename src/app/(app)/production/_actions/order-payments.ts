"use server";

import { refFields } from "@/lib/payment-refs";
import { z } from "zod";
import { revalidateAll } from "@/lib/revalidate-all";
import { resetByOrder } from "@/lib/verification";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { Decimal } from "@prisma/client/runtime/library";
import { PRODUCTION_EDIT_ROLES as EDIT_ROLES } from "@/lib/production-access";
import { zNum, parseDateInput } from "@/lib/input";
import { staleError, PRODUCTION_PAYMENT_V } from "@/lib/concurrency";
import { resetByProdPayment } from "@/lib/verification";
import { autoAllocatePayment } from "@/lib/payment-alloc";
import { formatNum } from "@/lib/utils";
import { type FormState } from "./shared";

const CANCELLED_ERROR = "ТЗ отменено — оплаты добавлять нельзя";

// ---------- Payments from the client (separate ledger from supplier payments) ----------

const productionPaymentSchema = z.object({
  amount: zNum("Сумма", { positive: true }),
  paymentType: z.enum(["ADVANCE", "PARTIAL", "FINAL"]),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"], { message: "Выберите способ оплаты" }),
  paidAt: z
    .string()
    .min(1, "Укажите дату оплаты")
    .refine((s) => parseDateInput(s) !== null, "Некорректная дата оплаты"),
  notes: z.string().trim().max(1000).optional(),
});

// One payment can cover several ТЗ at once (a client paying a lump sum
// against a running tab) — orderId is always included, plus whichever
// sibling orders (same client) were checked in the form.
export async function addProductionPayment(orderId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId },
  });
  if (!order) return { error: "ТЗ не найдено" };
  if (order.status === "CANCELLED") return { error: CANCELLED_ERROR };

  const parsed = productionPaymentSchema.safeParse({
    amount: formData.get("amount"),
    paymentType: formData.get("paymentType") || "FINAL",
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue?.path[0] === "paidAt" ? "Укажите дату оплаты" : issue?.message };
  }

  const extraOrderIds = formData.getAll("orderIds").map(String);
  const orderIds = Array.from(new Set([orderId, ...extraOrderIds]));
  const validOrders = await prisma.productionOrder.findMany({
    where: {
      id: { in: orderIds },
      organizationId: session.user.organizationId,
      OR: [{ id: orderId }, { status: { not: "CANCELLED" } }],
    },
    select: { id: true },
  });

  // Платёж и его разнесение по ТЗ (пропорционально работе, в пределах остатка работы) — одной транзакцией.
  await prisma.$transaction(async (tx) => {
    const created = await tx.productionPayment.create({
      data: {
        organizationId: session.user.organizationId,
        clientId: order.clientId,
        contractorId: order.contractorId,
        amount: parsed.data.amount,
        paymentType: parsed.data.paymentType,
        method: parsed.data.method,
        status: "COMPLETED",
        paidAt: new Date(parsed.data.paidAt),
        notes: parsed.data.notes,
        orders: { create: validOrders.map((o) => ({ productionOrderId: o.id })) },
      },
    });
    await autoAllocatePayment(tx, session.user.organizationId, created.id);
  });

  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
  for (const id of orderIds) await resetByOrder(id);
  return {};
}

export async function removeProductionPayment(orderId: string, paymentId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId },
  });
  if (!order) return;

  const payment = await prisma.productionPayment.findFirst({
    where: {
      id: paymentId,
      organizationId: session.user.organizationId,
      orders: { some: { productionOrderId: orderId } },
    },
    include: { orders: true },
  });
  if (!payment) return;

  await prisma.productionPayment.delete({ where: { id: paymentId } });
  for (const alloc of payment.orders) await resetByOrder(alloc.productionOrderId);
  revalidateAll(session.user.organizationId);
}

/**
 * Правка оплаты работы: сумма, тип, способ, дата, № п/п, заметка и набор ТЗ, которые она покрывает.
 * Остаток по ТЗ и по партии пересчитывается сам (он считается из оплат); «подтверждено» сбрасывается.
 */
export async function updateProductionPayment(orderId: string, paymentId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const payment = await prisma.productionPayment.findFirst({
    where: { id: paymentId, organizationId: orgId, orders: { some: { productionOrderId: orderId } } },
    include: { orders: { select: { productionOrderId: true } } },
  });
  if (!payment) return { error: "Оплата не найдена (возможно, уже удалена)" };
  const stale = staleError(formData, payment, PRODUCTION_PAYMENT_V);
  if (stale) return { error: stale };
  const parsed = productionPaymentSchema.safeParse({
    amount: formData.get("amount"),
    paymentType: formData.get("paymentType") || payment.paymentType,
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue?.path[0] === "paidAt" ? "Укажите дату оплаты" : issue?.message };
  }
  const wanted = Array.from(new Set(formData.getAll("orderIds").map(String).filter(Boolean)));
  if (wanted.length === 0) return { error: "Отметьте хотя бы одно ТЗ, которое покрывает оплата" };
  const valid = await prisma.productionOrder.findMany({
    where: { id: { in: wanted }, organizationId: orgId },
    select: { id: true },
  });
  if (valid.length !== wanted.length) return { error: "Одно из выбранных ТЗ не найдено — обновите страницу" };
  const docRef = (formData.get("docRef") as string)?.trim().slice(0, 200) || null;
  const oldIds = payment.orders.map((o) => o.productionOrderId);

  // Разнесение по ТЗ: строки на ТЗ, которые платёж больше не покрывает, снимаются; Σ разнесений не может превысить новую сумму.
  const keptAlloc = await prisma.paymentAllocation.findMany({ where: { productionPaymentId: paymentId, productionOrderId: { in: wanted } }, select: { amount: true, source: true } });
  const keptSum = keptAlloc.reduce((s, a) => s.add(a.amount), new Decimal(0));
  if (keptAlloc.some((a) => a.source === "MANUAL") && keptSum.greaterThan(new Decimal(String(parsed.data.amount)))) {
    return { error: `Новая сумма меньше уже разнесённого вручную по ТЗ (${formatNum(Number(keptSum.toString()), 1)} ₽). Сначала уменьшите разнесение оплаты.` };
  }
  await prisma.$transaction(async (tx) => {
    await tx.productionPayment.update({
      where: { id: paymentId },
      data: {
        amount: parsed.data.amount,
        paymentType: parsed.data.paymentType,
        method: parsed.data.method,
        paidAt: new Date(parsed.data.paidAt),
        notes: (formData.get("notes") as string)?.trim() || null,
        docRef,
        ...refFields(docRef),
      },
    });
    await tx.productionPaymentOrder.deleteMany({ where: { productionPaymentId: paymentId, productionOrderId: { notIn: wanted } } });
    await tx.paymentAllocation.deleteMany({ where: { productionPaymentId: paymentId, productionOrderId: { notIn: wanted } } });
    await tx.productionPaymentOrder.createMany({
      data: wanted.filter((id) => !oldIds.includes(id)).map((productionOrderId) => ({ productionPaymentId: paymentId, productionOrderId })),
      skipDuplicates: true,
    });
    await autoAllocatePayment(tx, orgId, paymentId);
  });
  const all = Array.from(new Set([...oldIds, ...wanted]));
  await resetByProdPayment(orgId, paymentId, all);
  revalidateAll(orgId);
  return {};
}
