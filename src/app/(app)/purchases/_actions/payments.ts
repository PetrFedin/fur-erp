"use server";

import { refFields } from "@/lib/payment-refs";
import { revalidateAll } from "@/lib/revalidate-all";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { Decimal } from "@prisma/client/runtime/library";
import { zMoney } from "@/lib/input";
import { auctionName, loadAuctionSummaries, lockAuction, PAY_EPS } from "@/lib/auction-payments";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { formatMoney } from "@/lib/utils";
import { resetByPurchase, resetVerification } from "@/lib/verification";
import { staleError, PAYMENT_EDIT_V } from "@/lib/concurrency";
import { dateField, EDIT_ROLES, type FormState } from "./shared";

// ---------- Payments ----------

const paymentSchema = z.object({
  amount: zMoney("Сумма"),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"], { message: "Выберите способ оплаты" }),
  paidAt: z.string().min(1, "Укажите дату оплаты").pipe(dateField("Некорректная дата оплаты")),
  notes: z.string().trim().max(1000).optional(),
});

export async function addPurchasePayment(purchaseId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId: orgId },
  });
  if (!purchase) return { error: "Закупка не найдена" };
  if (purchase.status === "CANCELLED") return { error: "Закупка отменена — оплату добавить нельзя" };

  const parsed = paymentSchema.safeParse({
    amount: formData.get("amount"),
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля оплаты" };
  const amount = new Decimal(parsed.data.amount);
  const confirmed = formData.get("confirmOverpay") === "1";
  const auction = auctionName(purchase.auctionSession);

  // Та же защита от переплаты и та же блокировка, что при оплате аукциона целиком:
  // параллельные оплаты одного аукциона идут по очереди и не обходят проверку.
  const result = await prisma.$transaction(async (tx): Promise<FormState> => {
    if (auction) {
      await lockAuction(tx, orgId, auction);
      const [s] = await loadAuctionSummaries(tx, orgId, [auction]);
      if (s) {
        const after = s.paid.add(amount);
        if (after.sub(s.total).greaterThan(PAY_EPS) && !confirmed) {
          return {
            confirm: `Оплачено станет ${formatMoney(after.toString())} при стоимости аукциона ${formatMoney(s.total.toString())} — переплата ${formatMoney(after.sub(s.total).toString())}. Всё равно записать?`,
          };
        }
      }
    } else {
      const full = await tx.purchase.findFirst({
        where: { id: purchaseId, organizationId: orgId },
        include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" }, select: { amount: true } } },
      });
      if (full) {
        const total = purchaseTotalInclVat(full);
        const after = full.payments.reduce((x, p) => x.add(p.amount), new Decimal(0)).add(amount);
        if (after.sub(total).greaterThan(PAY_EPS) && !confirmed) {
          return {
            confirm: `Оплачено станет ${formatMoney(after.toString())} при стоимости закупки ${formatMoney(total.toString())} — переплата ${formatMoney(after.sub(total).toString())}. Всё равно записать?`,
          };
        }
      }
    }
    await tx.payment.create({
      data: {
        organizationId: orgId,
        supplierId: purchase.supplierId,
        purchaseId,
        amount,
        // Сумма платежа вводится и учитывается в рублях (см. «Оплачено»/остаток
        // в рублях), поэтому валюту закупки (USD…) сюда не пишем.
        currency: "RUB",
        method: parsed.data.method,
        status: "COMPLETED",
        paidAt: new Date(parsed.data.paidAt),
        notes: parsed.data.notes,
      },
    });
    return {};
  });
  if (result.error || result.confirm) return result;

  await resetByPurchase(purchaseId);
  revalidateAll(orgId);
  return {};
}

/** Удаляет оплату закупки (та же защита и блокировка аукциона, что при добавлении). */
export async function removePurchasePayment(purchaseId: string, paymentId: string): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId: orgId },
    select: { id: true, auctionSession: true },
  });
  if (!purchase) return { error: "Закупка не найдена" };
  const auction = auctionName(purchase.auctionSession);

  const deleted = await prisma.$transaction(async (tx) => {
    if (auction) await lockAuction(tx, orgId, auction);
    const res = await tx.payment.deleteMany({ where: { id: paymentId, organizationId: orgId, purchaseId: purchase.id } });
    return res.count;
  });
  if (deleted === 0) return { error: "Оплата не найдена (возможно, уже удалена)" };

  await resetByPurchase(purchaseId);
  revalidateAll(orgId);
  return {};
}

const PAY_STATUSES = ["COMPLETED", "PENDING"] as const;

/**
 * Правка оплаты закупки: сумма, дата, способ, статус (оплачена / запланирована), заметка, № п/п (docRef),
 * перенос на другую закупку того же поставщика. Переплату проверяем так же, как при добавлении (без самой правимой оплаты).
 * Любая правка сбрасывает «подтверждено» у оплаты и подтверждение закупки/аукциона.
 */
export async function updatePurchasePayment(purchaseId: string, paymentId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const existing = await prisma.payment.findFirst({
    where: { id: paymentId, organizationId: orgId, purchaseId },
    include: { purchase: { select: { id: true, auctionSession: true, status: true } } },
  });
  if (!existing || !existing.purchase) return { error: "Оплата не найдена (возможно, уже удалена или перенесена)" };
  const stale = staleError(formData, existing, PAYMENT_EDIT_V);
  if (stale) return { error: stale };

  const parsed = paymentSchema.safeParse({
    amount: formData.get("amount"),
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля оплаты" };
  const statusRaw = String(formData.get("status") ?? existing.status);
  const status = (PAY_STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as "COMPLETED" | "PENDING") : existing.status === "PENDING" ? "PENDING" : "COMPLETED";
  const docRef = (formData.get("docRef") as string)?.trim().slice(0, 200) || null;
  const targetId = String(formData.get("targetPurchaseId") ?? "").trim() || purchaseId;
  const amount = new Decimal(parsed.data.amount);
  const confirmed = formData.get("confirmOverpay") === "1";

  const target =
    targetId === purchaseId
      ? existing.purchase
      : await prisma.purchase.findFirst({
          where: { id: targetId, organizationId: orgId, supplierId: existing.supplierId, status: { not: "CANCELLED" } },
          select: { id: true, auctionSession: true, status: true },
        });
  if (!target) return { error: "Закупка для переноса не найдена: можно переносить только на закупку того же поставщика" };

  const oldAuction = auctionName(existing.purchase.auctionSession);
  const auction = auctionName(target.auctionSession);

  const result = await prisma.$transaction(async (tx): Promise<FormState> => {
    if (auction) await lockAuction(tx, orgId, auction);
    if (oldAuction && oldAuction !== auction) await lockAuction(tx, orgId, oldAuction);
    if (status === "COMPLETED") {
      let total: Decimal | null = null;
      let paid: Decimal | null = null;
      let label = "закупки";
      if (auction) {
        const [s] = await loadAuctionSummaries(tx, orgId, [auction]);
        if (s) {
          total = s.total;
          paid = s.paid;
          label = "аукциона";
        }
      } else {
        const full = await tx.purchase.findFirst({
          where: { id: target.id, organizationId: orgId },
          include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" }, select: { id: true, amount: true } } },
        });
        if (full) {
          total = purchaseTotalInclVat(full);
          paid = full.payments.reduce((x, p) => x.add(p.amount), new Decimal(0));
        }
      }
      if (total && paid) {
        const sameScope = auction ? oldAuction === auction : existing.purchaseId === target.id;
        const base = sameScope && existing.status === "COMPLETED" ? paid.sub(existing.amount) : paid;
        const after = base.add(amount);
        const moneyUnchanged = sameScope && existing.status === "COMPLETED" && amount.eq(existing.amount);
        if (!moneyUnchanged && after.sub(total).greaterThan(PAY_EPS) && !confirmed) {
          return {
            confirm: `Оплачено станет ${formatMoney(after.toString())} при стоимости ${label === "аукциона" ? "аукциона" : "закупки"} ${formatMoney(total.toString())} — переплата ${formatMoney(after.sub(total).toString())}. Всё равно записать?`,
          };
        }
      }
    }
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        purchaseId: target.id,
        amount,
        method: parsed.data.method,
        status,
        paidAt: new Date(parsed.data.paidAt),
        notes: (formData.get("notes") as string)?.trim() || null,
        docRef,
        ...refFields(docRef),
      },
    });
    return {};
  });
  if (result.error || result.confirm) return result;

  await resetVerification(prisma, orgId, {
    paymentIds: [paymentId],
    purchaseIds: [purchaseId, target.id],
    auctions: [oldAuction, auction],
  });
  revalidateAll(orgId);
  return {};
}
