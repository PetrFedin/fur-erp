"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { PRODUCTION_EDIT_ROLES } from "@/lib/production-access";
import { removeStoredFiles } from "@/lib/fitting-files";
import { readOneDriveFile, writeDriveFile } from "@/lib/drive-files";
import { resetVerification } from "@/lib/verification";
import { allocatedCentsByOrder, orderWorkCents } from "@/lib/payment-alloc";
import { checkAllocation, fromCents, toCents, type AllocLine } from "@/lib/payment-alloc-core";

/**
 * Приложить платёжку к существующей оплате работы (партия/ТЗ). Отметка новой оплаты вынесена в единую форму оплаты:
 * src/components/payment-form.tsx + payments/pay-actions.ts.
 */

export type MarkProdState = { error?: string; ok?: boolean; confirm?: string };


/** Приложить платёжку к существующей оплате производства: оплата становится «подтверждена». */
export async function attachProductionPaymentProof(paymentId: string, formData: FormData): Promise<MarkProdState> {
  const session = await requireRole(...PRODUCTION_EDIT_ROLES);
  const orgId = session.user.organizationId;
  const pay = await prisma.productionPayment.findFirst({
    where: { id: paymentId, organizationId: orgId },
    select: { id: true, paidAt: true, status: true, orders: { select: { productionOrderId: true, productionOrder: { select: { batch: { select: { number: true } } } } } } },
  });
  if (!pay) return { error: "Оплата не найдена" };
  if (pay.status === "CANCELLED") return { error: "Оплата отменена" };
  const read = await readOneDriveFile(formData);
  if ("error" in read) return { error: read.error };
  const stored = await writeDriveFile(orgId, read.file);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.driveDocument.create({
        data: {
          organizationId: orgId,
          driveFileId: `local-${randomUUID()}`,
          title: `Платёжка: оплата ${pay.paidAt.toISOString().slice(0, 10)}`,
          docType: "PAYMENT_PROOF",
          mimeType: stored.storedMime,
          sizeBytes: stored.storedSize,
          ...stored,
          storedAt: new Date(),
          productionPaymentId: pay.id,
        },
      });
      await tx.productionPayment.update({ where: { id: pay.id }, data: { confirmed: true } });
    });
  } catch (e) {
    await removeStoredFiles([stored.storagePath]);
    throw e;
  }
  await resetVerification(prisma, orgId, { prodPaymentIds: [pay.id], orderIds: pay.orders.map((o) => o.productionOrderId) });
  revalidateAll(orgId);
  return { ok: true };
}

/**
 * Разнесение оплаты по ТЗ вручную: заменяет все строки разнесения платежа (ТЗ + сумма) и помечает их MANUAL.
 * Правило: Σ строк <= сумма платежа (иначе отказ); превышение работы ТЗ — только после подтверждения.
 * Строки приходят JSON-ом в поле `lines`: [{ orderId, amount }]. Пустой список — платёж целиком «неразнесённый аванс».
 */
export async function saveProductionPaymentAllocation(paymentId: string, formData: FormData): Promise<MarkProdState> {
  const session = await requireRole(...PRODUCTION_EDIT_ROLES);
  const orgId = session.user.organizationId;
  const pay = await prisma.productionPayment.findFirst({
    where: { id: paymentId, organizationId: orgId },
    select: { id: true, amount: true, status: true, orders: { select: { productionOrderId: true } }, allocations: { select: { productionOrderId: true } } },
  });
  if (!pay) return { error: "Оплата не найдена (возможно, уже удалена)" };
  if (pay.status === "CANCELLED") return { error: "Оплата отменена — разнесение не меняется" };
  let raw: { orderId?: unknown; amount?: unknown }[];
  try {
    raw = JSON.parse(String(formData.get("lines") ?? "[]"));
    if (!Array.isArray(raw)) throw new Error("bad");
  } catch {
    return { error: "Не удалось прочитать строки разнесения — обновите страницу" };
  }
  const lines: AllocLine[] = [];
  for (const r of raw) {
    const cents = toCents(String(r.amount ?? "0").replace(/\s/g, "").replace(",", "."));
    if (!r.orderId || !Number.isFinite(cents)) return { error: "В строке разнесения не указано ТЗ или сумма" };
    lines.push({ orderId: String(r.orderId), amountCents: cents });
  }
  const err = checkAllocation(toCents(pay.amount), lines);
  if (err) return { error: err };
  const ids = lines.map((l) => l.orderId);
  const orders = ids.length
    ? await prisma.productionOrder.findMany({
        where: { id: { in: ids }, organizationId: orgId },
        select: { id: true, number: true, workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true },
      })
    : [];
  if (orders.length !== ids.length) return { error: "Одно из ТЗ не найдено — обновите страницу" };
  if (orders.some((o) => o.status === "CANCELLED")) return { error: "ТЗ отменено — на него нельзя разнести оплату" };
  // Потолок: работа ТЗ минус разнесённое от других платежей. Превышение — только по подтверждению.
  if (formData.get("confirmOverpay") !== "1") {
    const others = await allocatedCentsByOrder(prisma, orgId, ids, paymentId);
    const over = lines
      .map((l) => {
        const o = orders.find((x) => x.id === l.orderId)!;
        const room = orderWorkCents(o) - (others.get(o.id) ?? 0);
        return { o, extra: l.amountCents - room };
      })
      .filter((x) => x.extra > 1);
    if (over.length) {
      const names = over.slice(0, 3).map((x) => `ТЗ №${x.o.workOrderNumber ?? x.o.number} (+${fromCents(x.extra)} ₽)`).join(", ");
      return { confirm: `Разнесено больше работы по ТЗ: ${names}${over.length > 3 ? " и др." : ""}. Остаток по этим ТЗ станет отрицательным (переплата). Сохранить?` };
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.paymentAllocation.deleteMany({ where: { productionPaymentId: pay.id } });
    if (lines.length) {
      await tx.paymentAllocation.createMany({
        data: lines.map((l) => ({ organizationId: orgId, productionPaymentId: pay.id, productionOrderId: l.orderId, amount: fromCents(l.amountCents), source: "MANUAL" as const })),
      });
      // платёж «покрывает» все ТЗ, на которые разнесён
      await tx.productionPaymentOrder.createMany({ data: ids.map((productionOrderId) => ({ productionPaymentId: pay.id, productionOrderId })), skipDuplicates: true });
    }
  });
  revalidateAll(orgId);
  return { ok: true };
}
