"use server";

import { revalidatePath } from "next/cache";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canVerify } from "@/lib/verify-access";
import { parseDateInput, zMoney } from "@/lib/input";
import { applyUnverify, applyVerify, loadVerifyModel, loadVerifyRow, resetVerification, type VerifyKind } from "@/lib/verification";
import { VERIFY_KINDS } from "@/lib/verification-kinds";

/**
 * Подтверждение строк («Подтверждено ✓») и быстрая правка прямо в очереди /verify.
 * Любая правка суммы/даты/номера документа сбрасывает подтверждение строки и связанных строк (resetVerification).
 */

export type VerifyState = { error?: string; ok?: boolean; message?: string };

const isKind = (k: string): k is VerifyKind => (VERIFY_KINDS as string[]).includes(k);

function revalidateAll() {
  for (const p of ["/verify", "/payments", "/dashboard", "/lots", "/documents", "/reconciliation", "/attention", "/purchases", "/production", "/production/batches"]) revalidatePath(p);
  revalidatePath("/purchases/[id]", "page");
  revalidatePath("/production/[id]", "page");
  revalidatePath("/production/batches/[number]", "page");
}

async function ctxOf(kind: VerifyKind) {
  const session = await requireSession();
  if (!canVerify(session.user.role, kind)) return { error: "Недостаточно прав для подтверждения этой строки" as const };
  return { orgId: session.user.organizationId, userId: session.user.id as string, role: session.user.role };
}

/** «Подтвердить»: если замечаний нет — сразу; если есть — только с примечанием (решение владельца). */
export async function verifyRow(kind: string, id: string, note?: string): Promise<VerifyState> {
  if (!isKind(kind)) return { error: "Неизвестный вид строки" };
  const c = await ctxOf(kind);
  if ("error" in c) return { error: c.error };
  const row = await loadVerifyRow(prisma, c.orgId, kind, id, { userId: c.userId, canUpload: true, canMark: true });
  if (!row) return { error: "Строка не найдена" };
  if (row.verified) return { ok: true, message: "Уже подтверждено" };
  const err = await applyVerify(prisma, c.orgId, kind, id, c.userId, { ready: row.ready, blockers: row.blockers }, note ?? null);
  if (err) return { error: err };
  revalidateAll();
  return { ok: true, message: "Подтверждено" };
}

export async function unverifyRow(kind: string, id: string): Promise<VerifyState> {
  if (!isKind(kind)) return { error: "Неизвестный вид строки" };
  const c = await ctxOf(kind);
  if ("error" in c) return { error: c.error };
  const err = await applyUnverify(prisma, c.orgId, kind, id);
  if (err) return { error: err };
  // партия опирается на ТЗ, аукцион — на закупки: снятие у ТЗ снимает и партию
  if (kind === "order") await resetVerification(prisma, c.orgId, { orderIds: [id] });
  if (kind === "purchase") await resetVerification(prisma, c.orgId, { purchaseIds: [id] });
  revalidateAll();
  return { ok: true, message: "Подтверждение снято" };
}

/** Аукцион целиком: снять подтверждение со всех его закупок. */
export async function unverifyPurchases(ids: string[]): Promise<VerifyState> {
  const c = await ctxOf("purchase");
  if ("error" in c) return { error: c.error };
  for (const id of ids) await applyUnverify(prisma, c.orgId, "purchase", id);
  revalidateAll();
  return { ok: true, message: "Подтверждение снято" };
}

/** Аукцион целиком: подтвердить все его закупки (каждая проверяется по своим блокерам). */
export async function verifyPurchases(ids: string[], note?: string): Promise<VerifyState> {
  const c = await ctxOf("purchase");
  if ("error" in c) return { error: c.error };
  const model = await loadVerifyModel(prisma, c.orgId, { userId: c.userId, kinds: ["purchase"], canUpload: true, canMark: true });
  let done = 0;
  let blocked = 0;
  for (const id of ids) {
    const row = model.rows.find((r) => r.key === `purchase:${id}`);
    if (!row || row.verified) continue;
    const err = await applyVerify(prisma, c.orgId, "purchase", id, c.userId, { ready: row.ready, blockers: row.blockers }, note ?? null);
    if (err) blocked++;
    else done++;
  }
  revalidateAll();
  if (done === 0 && blocked > 0) return { error: `Есть замечания у ${blocked} закупок: подтвердить можно только с примечанием.` };
  return { ok: true, message: `Подтверждено закупок: ${done}${blocked ? `; не подтверждено из-за замечаний: ${blocked}` : ""}` };
}

/**
 * Массовое «Подтвердить все готовые (без блокеров)»: только строки, у которых блокеров нет (проверяется заново на сервере).
 * Порядок: оплаты → закупки → ТЗ → партии (партия опирается на подтверждённые ТЗ).
 */
export async function bulkVerifyReady(keys: string[]): Promise<VerifyState> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const userId = session.user.id as string;
  const allowed = new Set(keys);
  let done = 0;
  const per: Record<string, number> = {};
  const stages: VerifyKind[][] = [["payment", "prodPayment", "purchase", "order"], ["batch"]];
  for (const kinds of stages) {
    const want = kinds.filter((k) => canVerify(session.user.role, k));
    if (want.length === 0) continue;
    const model = await loadVerifyModel(prisma, orgId, { userId, kinds: want, canUpload: true, canMark: true });
    for (const r of model.rows) {
      if (!allowed.has(r.key) || r.verified || !r.ready) continue;
      const err = await applyVerify(prisma, orgId, r.kind, r.id, userId, { ready: true, blockers: [] }, null);
      if (!err) {
        done++;
        per[r.kind] = (per[r.kind] ?? 0) + 1;
      }
    }
  }
  revalidateAll();
  return { ok: true, message: `Подтверждено строк: ${done}` };
}

// ------------------------------------------------------------------------------------------ быстрая правка в строке

const clean = (v: FormDataEntryValue | null, max = 300) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

/** Оплата (поставщику или производства): дата, сумма, номер п/п / основание. */
export async function patchPaymentRow(kind: string, id: string, formData: FormData): Promise<VerifyState> {
  if (kind !== "payment" && kind !== "prodPayment") return { error: "Неизвестный вид строки" };
  const c = await ctxOf(kind);
  if ("error" in c) return { error: c.error };
  const dateRaw = clean(formData.get("date"), 20);
  const paidAt = dateRaw ? parseDateInput(dateRaw) : null;
  if (dateRaw && !paidAt) return { error: "Некорректная дата" };
  if (paidAt && (paidAt.getUTCFullYear() < 2020 || paidAt.getUTCFullYear() > 2100)) return { error: "Дата вне диапазона 2020–2100" };
  const amountRaw = clean(formData.get("amount"), 30);
  let amount: Decimal | null = null;
  if (amountRaw) {
    const a = zMoney("Сумма").safeParse(amountRaw);
    if (!a.success) return { error: a.error.issues[0]?.message ?? "Сумма: некорректное значение" };
    amount = new Decimal(a.data as number).toDecimalPlaces(2);
    if (!amount.greaterThan(0)) return { error: "Сумма должна быть больше нуля" };
  }
  const ref = clean(formData.get("ref"));
  const data = { ...(paidAt ? { paidAt } : {}), ...(amount ? { amount } : {}), docRef: ref || null };
  if (kind === "payment") {
    const r = await prisma.payment.updateMany({ where: { id, organizationId: c.orgId }, data });
    if (!r.count) return { error: "Оплата не найдена" };
    await resetVerification(prisma, c.orgId, { paymentIds: [id] });
  } else {
    const r = await prisma.productionPayment.updateMany({ where: { id, organizationId: c.orgId }, data });
    if (!r.count) return { error: "Оплата не найдена" };
    await resetVerification(prisma, c.orgId, { prodPaymentIds: [id] });
  }
  revalidateAll();
  return { ok: true, message: "Сохранено, подтверждение сброшено" };
}

/** Закупка: дата заказа, номер документа (счёт/УПД), реквизиты передаточного документа. */
export async function patchPurchaseRow(id: string, formData: FormData): Promise<VerifyState> {
  const c = await ctxOf("purchase");
  if ("error" in c) return { error: c.error };
  const dateRaw = clean(formData.get("date"), 20);
  const orderDate = dateRaw ? parseDateInput(dateRaw) : null;
  if (dateRaw && !orderDate) return { error: "Некорректная дата" };
  const r = await prisma.purchase.updateMany({
    where: { id, organizationId: c.orgId },
    data: { ...(orderDate ? { orderDate } : {}), invoiceNumber: clean(formData.get("number"), 100) || null, transferDocument: clean(formData.get("ref")) || null },
  });
  if (!r.count) return { error: "Закупка не найдена" };
  await resetVerification(prisma, c.orgId, { purchaseIds: [id] });
  revalidateAll();
  return { ok: true, message: "Сохранено, подтверждение сброшено" };
}

/** ТЗ: дата ТЗ и номер ТЗ по документу. */
export async function patchOrderRow(id: string, formData: FormData): Promise<VerifyState> {
  const c = await ctxOf("order");
  if ("error" in c) return { error: c.error };
  const dateRaw = clean(formData.get("date"), 20);
  const workOrderDate = dateRaw ? parseDateInput(dateRaw) : null;
  if (dateRaw && !workOrderDate) return { error: "Некорректная дата" };
  const r = await prisma.productionOrder.updateMany({
    where: { id, organizationId: c.orgId },
    data: { workOrderDate: dateRaw ? workOrderDate : null, workOrderNumber: clean(formData.get("number"), 50) || null },
  });
  if (!r.count) return { error: "ТЗ не найдено" };
  await resetVerification(prisma, c.orgId, { orderIds: [id] });
  revalidateAll();
  return { ok: true, message: "Сохранено, подтверждение сброшено" };
}
