"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { PRODUCTION_EDIT_ROLES } from "@/lib/production-access";
import { parseDateInput, zMoney, zNum } from "@/lib/input";
import { isPickedFile } from "@/lib/purchase-files";
import { removeStoredFiles } from "@/lib/fitting-files";
import { readOneDriveFile, writeDriveFile } from "@/lib/drive-files";
import { batchOrderInclude, batchTotals, orderStat } from "@/lib/batch-stats";
import { MANUAL_PREFIX } from "@/lib/doc-panel";
import { lockAuction } from "@/lib/auction-payments";
import { formatMoney } from "@/lib/utils";
import { resetVerification } from "@/lib/verification";

/**
 * «Отметить оплату» по партии или ТЗ (оплата от заказчика за работу).
 * Создаёт ProductionPayment COMPLETED и связывает его с ТЗ партии (ProductionPaymentOrder): с одним ТЗ — если оплата по нему,
 * со всеми действующими ТЗ партии — если по партии. Сумма по ТЗ в базе не хранится: доля ТЗ — пропорционально работе
 * (только в расчёте/показе). Без платёжки — confirmed = false и docRef «отмечено вручную …».
 * Откат — удаление оплаты (кнопка «Откатить» в панели).
 */

export type MarkProdState = { error?: string; ok?: boolean; confirm?: string };
const EPS = new Decimal("0.005");

const todayIso = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

function revalidateAll(orderIds: string[], batchNumber: number | null) {
  revalidatePath("/production");
  revalidatePath("/production/batches");
  if (batchNumber != null) revalidatePath(`/production/batches/${batchNumber}`);
  for (const id of orderIds) revalidatePath(`/production/${id}`);
  revalidatePath("/payments");
  revalidatePath("/documents");
  revalidatePath("/reconciliation");
  revalidatePath("/attention");
  revalidatePath("/clients/[id]", "page");
}

export async function markProductionPayment(scope: "batch" | "order", id: string, formData: FormData): Promise<MarkProdState> {
  const session = await requireRole(...PRODUCTION_EDIT_ROLES);
  const orgId = session.user.organizationId;

  const rawMode = String(formData.get("mode") ?? "full");
  const mode = rawMode === "amount" ? "amount" : rawMode === "percent" ? "percent" : "full";
  const paidRaw = String(formData.get("paidAt") ?? "").trim();
  if (!paidRaw) return { error: "Укажите дату оплаты" };
  const paidAt = parseDateInput(paidRaw);
  if (!paidAt) return { error: "Некорректная дата оплаты" };
  const y = paidAt.getUTCFullYear();
  if (y < 2020 || y > 2100) return { error: "Дата вне допустимого диапазона (2020–2100)" };
  const paidIso = paidAt.toISOString().slice(0, 10);
  let amountIn = 0;
  let percentIn = 0;
  if (mode === "amount") {
    const a = zMoney("Сумма").safeParse(formData.get("amount"));
    if (!a.success) return { error: a.error.issues[0]?.message ?? "Сумма: некорректное значение" };
    amountIn = a.data as number;
  } else if (mode === "percent") {
    const p = zNum("Процент", { positive: true, max: 100 }).safeParse(formData.get("percent"));
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Процент: некорректное значение" };
    percentIn = p.data as number;
  }
  const basis = String(formData.get("basis") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300);
  const fileEntries = formData.getAll("file").filter(isPickedFile);
  if (fileEntries.length > 1) return { error: "Прикрепите один файл платёжки" };
  let read: Awaited<ReturnType<typeof readOneDriveFile>> | null = null;
  if (fileEntries.length === 1) {
    read = await readOneDriveFile(formData);
    if ("error" in read) return { error: read.error };
  }
  if (!read && !basis) return { error: "Укажите основание: № платёжки или название письма/документа — либо приложите файл платёжки" };
  if (paidIso > todayIso() && formData.get("confirmFuture") !== "1") return { confirm: `Дата оплаты (${paidIso}) в будущем. Всё равно отметить?` };

  const stored = read && "file" in read ? await writeDriveFile(orgId, read.file) : null;
  let batchNumber: number | null = null;
  let touched: string[] = [];
  let result: MarkProdState;
  try {
    result = await prisma.$transaction(async (tx): Promise<MarkProdState> => {
      let orders: { id: string; clientId: string | null }[];
      let due: Decimal;
      let paid: Decimal;
      if (scope === "batch") {
        const b = await tx.productionBatch.findFirst({ where: { id, organizationId: orgId }, select: { id: true, number: true } });
        if (!b) return { error: "Партия не найдена" };
        batchNumber = b.number;
        await lockAuction(tx, orgId, "prod-batch:" + b.id);
        const all = await tx.productionOrder.findMany({ where: { batchId: b.id, organizationId: orgId }, include: batchOrderInclude });
        const t = batchTotals(all);
        due = t.work;
        paid = t.paid;
        orders = all.filter((o) => o.status !== "CANCELLED").map((o) => ({ id: o.id, clientId: o.clientId }));
        if (orders.length === 0) return { error: "В партии нет действующих ТЗ" };
      } else {
        const o = await tx.productionOrder.findFirst({ where: { id, organizationId: orgId }, include: batchOrderInclude });
        if (!o) return { error: "ТЗ не найдено" };
        if (o.status === "CANCELLED") return { error: "ТЗ отменено — оплату отмечать нельзя" };
        if (o.batchId) return { error: "ТЗ входит в партию — оплата ведётся по партии, отметьте её на карточке партии" };
        await lockAuction(tx, orgId, "prod-order:" + o.id);
        const t = batchTotals([o]);
        due = orderStat(o).work;
        paid = t.paid;
        orders = [{ id: o.id, clientId: o.clientId }];
      }
      if (!due.greaterThan(0)) return { error: "Цена работы не задана — сумму к оплате определить нельзя. Введите цену работы в ТЗ или укажите оплату в карточке ТЗ." };
      const remaining = due.sub(paid);
      if (!remaining.greaterThan(EPS)) return { error: "Остатка к оплате нет — отмечать нечего" };
      let amount: Decimal;
      if (mode === "full") amount = remaining.toDecimalPlaces(2);
      else if (mode === "percent") amount = due.mul(percentIn).div(100).toDecimalPlaces(2);
      else amount = new Decimal(amountIn).toDecimalPlaces(2);
      if (amount.lessThan("0.01")) return { error: "Сумма меньше 1 копейки" };
      if (amount.sub(remaining).greaterThan(EPS)) {
        return { error: `Сумма ${formatMoney(amount.toString())} больше остатка ${formatMoney(remaining.toString())}. Для переплаты добавьте оплату в карточке ТЗ.` };
      }
      const how = mode === "full" ? "оплачено полностью" : mode === "percent" ? `оплачено ${percentIn}% работы` : "оплачено частично";
      const pay = await tx.productionPayment.create({
        data: {
          organizationId: orgId,
          clientId: orders.find((o) => o.clientId)?.clientId ?? null,
          amount,
          paymentType: mode === "full" ? "FINAL" : "PARTIAL",
          method: "BANK_TRANSFER",
          status: "COMPLETED",
          paidAt,
          notes: `Отмечено вручную (${how}) ${todayIso()}${basis ? `: ${basis}` : ""}`.slice(0, 1000),
          docRef: `${MANUAL_PREFIX}${basis ? `: ${basis}` : ""}`.slice(0, 300),
          confirmed: Boolean(stored),
          orders: { create: orders.map((o) => ({ productionOrderId: o.id })) },
        },
      });
      if (stored && read && "file" in read) {
        await tx.driveDocument.create({
          data: {
            organizationId: orgId,
            driveFileId: `local-${randomUUID()}`,
            title: `Платёжка: оплата ${paidIso}`,
            docType: "PAYMENT_PROOF",
            mimeType: stored.storedMime,
            sizeBytes: stored.storedSize,
            ...stored,
            storedAt: new Date(),
            productionPaymentId: pay.id,
          },
        });
      }
      touched = orders.map((o) => o.id);
      return { ok: true };
    });
  } catch (e) {
    if (stored) await removeStoredFiles([stored.storagePath]);
    throw e;
  }
  if (!result.ok) {
    if (stored) await removeStoredFiles([stored.storagePath]);
    return result;
  }
  await resetVerification(prisma, orgId, { orderIds: touched });
  revalidateAll(touched, batchNumber);
  return result;
}

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
  revalidateAll(pay.orders.map((o) => o.productionOrderId), pay.orders[0]?.productionOrder.batch?.number ?? null);
  return { ok: true };
}
