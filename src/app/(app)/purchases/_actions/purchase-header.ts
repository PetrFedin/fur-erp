"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { cancelReceivedPurchaseInTx, purchaseCancelBlocker } from "@/lib/purchase-cancel";
import { receivePurchaseInTx, AlreadyReceivedError } from "@/lib/purchase-receive";
import { Prisma } from "@prisma/client";
import { checkOrgRefs } from "@/lib/org-guard";
import { zNum, parseDateInput } from "@/lib/input";
import { auctionName } from "@/lib/auction-payments";
import { resetByPurchase, resetVerification } from "@/lib/verification";
import { staleError, PURCHASE_V } from "@/lib/concurrency";
import { getDefaultWarehouseId } from "@/lib/default-warehouse";
import { syncPurchaseInvoice } from "@/lib/invoice-sync";
import { dateField, currencyField, EDIT_ROLES, WAREHOUSE_ROLES, type FormState, purchaseAuctionFromForm, getEditablePurchase } from "./shared";

const COSTPLAN_PURCHASE_LOCK =
  "В закупке есть позиции с расчётом из расчётного листа — валюту менять нельзя, а курс меняется формой «Курс закупки» в блоке «Расчёт себестоимости по лотам» (она пересчитывает расчёт всех лотов).";

async function hasCostPlanItems(purchaseId: string, organizationId: string) {
  const n = await prisma.purchaseItem.count({ where: { purchaseId, purchase: { organizationId }, costPlan: { not: Prisma.DbNull } } });
  return n > 0;
}

export async function updatePurchaseExchangeRate(purchaseId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const rate = zNum("Курс", { positive: true, max: 1_000_000 }).safeParse(formData.get("exchangeRate"));
  if (!rate.success) return { error: rate.error.issues[0]?.message ?? "Некорректный курс" };

  if (await hasCostPlanItems(purchaseId, session.user.organizationId)) return { error: COSTPLAN_PURCHASE_LOCK };
  const upd = await prisma.purchase.updateMany({
    where: { id: purchaseId, organizationId: session.user.organizationId, status: { notIn: ["RECEIVED", "CANCELLED"] } },
    data: { exchangeRate: rate.data as number },
  });
  // Закупка не найдена в организации или уже принята: ничего не менялось — подтверждение не сбрасываем.
  if (upd.count === 0) return {};
  await resetByPurchase(purchaseId);
  revalidateAll();
  return {};
}

// Editing the purchase header itself — supplier, warehouse, auction session,
// order date, currency, invoice number, transfer document. Only while
// `editable` (not RECEIVED, not CANCELLED): once received, every line item's
// RawMaterialLot is already costed against this purchase's currency/
// exchangeRate at that moment (see receivePurchase) — changing supplier/
// warehouse/currency afterwards would silently desync already-costed lots
// from the purchase they claim to belong to. This mirrors the same
// `editable` gate the detail page already uses for item edits.
// exchangeRate keeps its own dedicated action (updatePurchaseExchangeRate)
// rather than being duplicated here — but changing `currency` here resets
// exchangeRate to 1 (or leaves it, for RUB) exactly like createPurchase does,
// since a stale rate carried over from a different currency is meaningless
// and must be re-entered.
/** Правка шапки изменила только примечание (не финансовое поле) — подтверждение закупки тогда не сбрасываем. */
function onlyNotesChanged(
  purchase: { supplierId: string; warehouseId: string; currency: string; auctionSession: string | null; auctionId: string | null; invoiceNumber: string | null; invoiceDate: Date | null; transferDocument: string | null; orderDate: Date },
  next: { supplierId: string; warehouseId: string; currency: string; auctionSession: string | null | undefined; auctionId: string | null | undefined; invoiceNumber: string | null; invoiceDate: Date | null; transferDocument: string | null; orderDate: Date },
): boolean {
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  return (
    next.supplierId === purchase.supplierId &&
    next.warehouseId === purchase.warehouseId &&
    next.currency === purchase.currency &&
    (next.auctionSession === undefined || next.auctionSession === purchase.auctionSession) &&
    (next.auctionId === undefined || next.auctionId === purchase.auctionId) &&
    next.invoiceNumber === (purchase.invoiceNumber?.trim() || null) &&
    day(next.invoiceDate) === day(purchase.invoiceDate) &&
    next.transferDocument === (purchase.transferDocument?.trim() || null) &&
    day(next.orderDate) === day(purchase.orderDate)
  );
}

const purchaseHeaderSchema = z.object({
  supplierId: z.string().min(1, "Выберите поставщика"),
  warehouseId: z.string().optional(),
  currency: currencyField,
  auctionSession: z.string().trim().max(500).optional(),
  invoiceNumber: z.string().trim().max(200).optional(),
  transferDocument: z.string().trim().max(200).optional(),
  orderDate: z.string().min(1, "Укажите дату").pipe(dateField()),
});

export async function updatePurchase(purchaseId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);

  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) {
    // Принятая закупка: поставщик, склад и валюта заблокированы (лоты уже посчитаны), но номера документов, дату и аукцион править можно.
    const received = await prisma.purchase.findFirst({ where: { id: purchaseId, organizationId: session.user.organizationId, status: "RECEIVED" } });
    if (received) return updateReceivedPurchaseHeader(session.user.organizationId, received, formData);
    return { error: "Закупку нельзя редактировать — она отменена" };
  }
  const stale = staleError(formData, purchase, PURCHASE_V, purchase.updatedAt);
  if (stale) return { error: stale };

  const parsed = purchaseHeaderSchema.safeParse({
    supplierId: formData.get("supplierId"),
    warehouseId: formData.get("warehouseId") || undefined,
    currency: formData.get("currency") || "RUB",
    auctionSession: formData.get("auctionSession") || undefined,
    invoiceNumber: formData.get("invoiceNumber") || undefined,
    transferDocument: formData.get("transferDocument") || undefined,
    orderDate: formData.get("orderDate"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  // Склад в форме не выбирается: остаётся прежний склад закупки (иначе — по умолчанию).
  const warehouseId = parsed.data.warehouseId || purchase.warehouseId || (await getDefaultWarehouseId(session.user.organizationId)) || "";
  const badRef = await checkOrgRefs(session.user.organizationId, {
    supplier: parsed.data.supplierId,
    warehouse: warehouseId,
  });
  if (badRef) return { error: badRef };

  const currencyChanged = parsed.data.currency !== purchase.currency;
  if (currencyChanged && (await hasCostPlanItems(purchaseId, session.user.organizationId))) return { error: COSTPLAN_PURCHASE_LOCK };

  // Blank optional fields must clear rather than be left untouched — same
  // "read straight off formData" reasoning as updatePurchaseItem's `cosmetic`.
  const auc = await purchaseAuctionFromForm(session.user.organizationId, formData, purchase.auctionSession);
  if ("error" in auc) return { error: auc.error };
  const invoiceNumber = (formData.get("invoiceNumber") as string)?.trim() || null;
  const transferDocument = (formData.get("transferDocument") as string)?.trim() || null;
  const invoiceDateRaw = String(formData.get("invoiceDate") ?? "").trim();
  const invoiceDate = invoiceDateRaw ? parseDateInput(invoiceDateRaw) : null;
  if (invoiceDateRaw && !invoiceDate) return { error: "Укажите корректную дату счёта" };
  const keepVerification = onlyNotesChanged(purchase, {
    supplierId: parsed.data.supplierId, warehouseId, currency: parsed.data.currency,
    auctionSession: auc.auctionSession, auctionId: auc.auctionId,
    invoiceNumber, invoiceDate, transferDocument, orderDate: new Date(parsed.data.orderDate),
  });
  // Примечание правится той же формой; если поля в форме нет (старые вызовы) — не трогаем.
  const notesField = formData.has("notes") ? { notes: (formData.get("notes") as string).trim().slice(0, 4000) || null } : {};

  await prisma.purchase.updateMany({
    where: { id: purchaseId, organizationId: session.user.organizationId, status: { notIn: ["RECEIVED", "CANCELLED"] } },
    data: {
      supplierId: parsed.data.supplierId,
      warehouseId,
      currency: parsed.data.currency,
      // Same pairing rule as createPurchase: RUB is always rate 1; a
      // currency change resets the rate to 1 so a stale rate from the old
      // currency can't leak through — the exchange-rate form forces re-entry.
      ...(currencyChanged ? { exchangeRate: 1 } : {}),
      auctionSession: auc.auctionSession,
      auctionId: auc.auctionId,
      invoiceNumber,
      invoiceDate,
      transferDocument,
      ...notesField,
      orderDate: new Date(parsed.data.orderDate),
    },
  });

  await syncPurchaseInvoice(prisma, purchaseId, { setDate: true });
  if (!keepVerification) await resetByPurchase(purchaseId);
  revalidateAll();
  return {};
}

/**
 * Шапка ПРИНЯТОЙ закупки: можно менять № счёта, УПД, дату заказа и аукцион из справочника.
 * Нельзя (лоты уже посчитаны по этим данным): поставщик, склад, валюта, курс.
 * Смена аукциона блокируется, если по прежнему аукциону есть оплата «аукциона целиком» (иначе оплата осталась бы за старым аукционом).
 */
async function updateReceivedPurchaseHeader(
  orgId: string,
  purchase: Prisma.PurchaseGetPayload<object>,
  formData: FormData,
): Promise<FormState> {
  const stale = staleError(formData, purchase, PURCHASE_V, purchase.updatedAt);
  if (stale) return { error: stale };
  const dateRaw = String(formData.get("orderDate") ?? "").trim();
  if (!dateRaw || parseDateInput(dateRaw) === null) return { error: "Укажите корректную дату заказа" };
  const invoiceNumber = (formData.get("invoiceNumber") as string)?.trim().slice(0, 200) || null;
  const transferDocument = (formData.get("transferDocument") as string)?.trim().slice(0, 200) || null;
  const invoiceDateRaw = String(formData.get("invoiceDate") ?? "").trim();
  const invoiceDate = invoiceDateRaw ? parseDateInput(invoiceDateRaw) : null;
  if (invoiceDateRaw && !invoiceDate) return { error: "Укажите корректную дату счёта" };
  const notesField = formData.has("notes") ? { notes: (formData.get("notes") as string).trim().slice(0, 4000) || null } : {};
  const auc = await purchaseAuctionFromForm(orgId, formData, purchase.auctionSession);
  if ("error" in auc) return { error: auc.error };

  const oldAuction = auctionName(purchase.auctionSession);
  const newText = auc.auctionSession === undefined ? purchase.auctionSession : auc.auctionSession;
  const newAuction = auctionName(newText);
  const auctionChanged = oldAuction !== newAuction;
  if (auctionChanged && oldAuction) {
    const lumpPayments = await prisma.payment.count({ where: { organizationId: orgId, purchaseId: null, auctionSession: oldAuction } });
    if (lumpPayments > 0) {
      return {
        error: `Аукцион менять нельзя: по аукциону «${oldAuction}» есть оплаты «целиком» (${lumpPayments} шт.) — они остались бы за прежним аукционом и расчёты разошлись бы. Сначала перенесите или удалите эти оплаты на странице «Оплаты».`,
      };
    }
  }
  const keepVerification = onlyNotesChanged(purchase, {
    supplierId: purchase.supplierId, warehouseId: purchase.warehouseId, currency: purchase.currency,
    auctionSession: auc.auctionSession, auctionId: auc.auctionId,
    invoiceNumber, invoiceDate, transferDocument, orderDate: new Date(dateRaw),
  });
  await prisma.purchase.updateMany({
    where: { id: purchase.id, organizationId: orgId, status: "RECEIVED" },
    data: {
      orderDate: new Date(dateRaw),
      invoiceNumber,
      invoiceDate,
      transferDocument,
      ...notesField,
      auctionSession: auc.auctionSession,
      auctionId: auc.auctionId,
    },
  });
  await syncPurchaseInvoice(prisma, purchase.id, { setDate: true });
  if (!keepVerification) await resetVerification(prisma, orgId, { purchaseIds: [purchase.id], auctions: [oldAuction, newAuction] });
  revalidateAll(orgId);
  return {};
}

/**
 * «Отменить закупку» для ОШИБОЧНО ПРИНЯТОЙ закупки: возможна, только если по её лотам нет списаний и движений и нет оплат.
 * Одна транзакция: движения приёмки и лоты удаляются (остатки и итоги пересчитываются сами), позиции остаются, статус — «Отменена».
 * Запись в журнале изменений пишет общий слой (удаление лотов и движений, смена статуса).
 */
export async function cancelReceivedPurchase(purchaseId: string): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const reason = await purchaseCancelBlocker(prisma, orgId, purchaseId);
  if (reason) return { error: reason };
  try {
    await prisma.$transaction((tx) => cancelReceivedPurchaseInTx(tx, orgId, purchaseId), { timeout: 60_000, maxWait: 10_000 });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Не удалось отменить закупку" };
  }
  await resetByPurchase(purchaseId);
  revalidateAll(orgId);
  return {};
}

export async function setPurchaseStatus(
  purchaseId: string,
  status: "DRAFT" | "ORDERED" | "IN_TRANSIT" | "CANCELLED"
) {
  const session = await requireRole(...EDIT_ROLES);
  const upd = await prisma.purchase.updateMany({
    where: {
      id: purchaseId,
      organizationId: session.user.organizationId,
      status: { notIn: ["RECEIVED", "CANCELLED"] },
    },
    data: { status },
  });
  if (upd.count === 0) return; // чужая или уже принятая закупка: ничего не менялось — подтверждение не сбрасываем
  await resetByPurchase(purchaseId);
  revalidateAll();
}

// ---------- Receiving: this is where landed cost + stock-in happens ----------

export async function receivePurchase(purchaseId: string): Promise<FormState> {
  const session = await requireRole(...WAREHOUSE_ROLES);
  const orgId = session.user.organizationId;

  // Быстрая проверка для понятных сообщений; настоящая защита от двойной
  // приёмки (две вкладки) — атомарный переход статуса внутри транзакции ниже.
  const pre = await prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId: orgId },
    select: { status: true, _count: { select: { items: true } } },
  });
  if (!pre) return { error: "Закупка не найдена" };
  if (pre.status === "RECEIVED") return { error: "Закупка уже принята на склад" };
  if (pre.status === "CANCELLED") return { error: "Закупка отменена" };
  if (pre._count.items === 0) return { error: "В закупке нет позиций" };

  // Item prices and expense amounts are entered EXCLUDING VAT; each line
  // carries its own rate since it varies lot to lot (the rate in force
  // changes over time — 20% and 22% both appear in the same registry).
  // Expenses are always in RUB; item prices are in the purchase's currency
  // and get converted here. Everything is grossed up to VAT-inclusive RUB,
  // expenses are allocated across items proportionally by their inclusive
  // cost share, and rolled into that item's lot as a fixed landed cost
  // — see src/lib/stock.ts.

  try {
    await prisma.$transaction(
      async (tx) => {
        await receivePurchaseInTx(tx, purchaseId, orgId);
      },
      { timeout: 60_000, maxWait: 10_000 }
    );
  } catch (e) {
    if (e instanceof AlreadyReceivedError) return { error: "Закупка уже принята на склад" };
    throw e;
  }

  await resetByPurchase(purchaseId);
  revalidateAll(orgId);
  return {};
}
