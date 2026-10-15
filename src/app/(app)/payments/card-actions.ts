"use server";

import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { PRODUCTION_EDIT_ROLES } from "@/lib/production-access";
import { parseDateInput, zMoney } from "@/lib/input";
import { revalidateAll } from "@/lib/revalidate-all";
import { resetVerification } from "@/lib/verification";
import { staleError, PAYMENT_CARD_V, PRODUCTION_CARD_V } from "@/lib/concurrency";
import { auctionName, lockAuction, loadAuctionSummaries, PAY_EPS } from "@/lib/auction-payments";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { autoAllocatePayment } from "@/lib/payment-alloc";
import { siblingPayments } from "@/lib/payment-parts";
import { cleanRefNo, parseDocRef, rebuildDocRef } from "@/lib/payment-refs";
import { parsePaymentCode } from "@/lib/payments-registry";
import { formatMoney } from "@/lib/utils";
import { removePurchasePayment } from "../purchases/actions";
import { removeProductionPayment } from "../production/actions";
import { deleteAdvancePayment, deleteAuctionPayment } from "./actions";

/**
 * Правка и удаление оплаты в её карточке /payments/[id].
 * Не дублирует соседние действия: проверки те же (роль, версия строки, переплата, блокировка аукциона, сброс подтверждения),
 * а удаление передаётся существующим действиям (removePurchasePayment, deleteAdvancePayment, deleteAuctionPayment, removeProductionPayment).
 * Двухшаговое сохранение: сначала сервер возвращает «что изменится» (confirm), после согласия форма уходит повторно с confirmChange=1.
 */

export type CardChange = { label: string; from: string; to: string };
export type CardConfirm = { changes: CardChange[]; effects: string[]; warns: string[]; danger: boolean };
export type CardState = { error?: string; ok?: boolean; confirm?: CardConfirm };

const METHODS = ["CASH", "BANK_TRANSFER", "CARD", "OTHER"] as const;
const METHOD_RU: Record<string, string> = { BANK_TRANSFER: "банковский перевод", CASH: "наличные", CARD: "карта", OTHER: "другое" };
const ru = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join(".");
const money = (d: Decimal | number | string) => formatMoney(d.toString());
const txt = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "—");

/** № счёта и № п/п оплаты: из полей, а если они ещё пусты — из старого разбора docRef (так показывает и карточка). */
const effRefs = (r: { invoiceNo: string | null; ppNo: string | null; docRef: string | null }) => {
  const p = parseDocRef(r.docRef);
  return { invoiceNo: r.invoiceNo ?? p.invoiceNo ?? "", ppNo: r.ppNo ?? p.ppNo ?? "" };
};

type Common = { amount: Decimal; paidAt: Date; paidIso: string; method: (typeof METHODS)[number]; ppNo: string; invoiceNo: string; notes: string | null };

function parseCommon(fd: FormData): Common | { error: string } {
  const a = zMoney("Сумма").safeParse(String(fd.get("amount") ?? "").trim());
  if (!a.success) return { error: a.error.issues[0]?.message ?? "Сумма: некорректное значение" };
  const amount = new Decimal(a.data as number).toDecimalPlaces(2);
  if (!amount.greaterThan(0)) return { error: "Сумма должна быть больше нуля" };
  const paidAt = parseDateInput(String(fd.get("paidAt") ?? "").trim());
  if (!paidAt) return { error: "Укажите дату оплаты" };
  const y = paidAt.getUTCFullYear();
  if (y < 2020 || y > 2100) return { error: "Дата вне допустимого диапазона (2020–2100)" };
  const m = String(fd.get("method") ?? "");
  if (!(METHODS as readonly string[]).includes(m)) return { error: "Выберите способ оплаты" };
  const notes = String(fd.get("notes") ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, 1000);
  return {
    amount, paidAt, paidIso: paidAt.toISOString().slice(0, 10), method: m as Common["method"],
    ppNo: cleanRefNo(String(fd.get("ppNo") ?? "")), invoiceNo: cleanRefNo(String(fd.get("invoiceNo") ?? "")), notes: notes || null,
  };
}

type Scope = { key: string; label: string; total: Decimal; paid: Decimal };

/** Стоимость и оплачено того, к чему привязана оплата: аукцион (партия) или одна закупка. Нет привязки — null. */
async function scopeOf(tx: Prisma.TransactionClient, orgId: string, link: { purchaseId: string | null; auctionSession: string | null; purchaseAuction?: string | null }): Promise<Scope | null> {
  const au = auctionName(link.auctionSession ?? link.purchaseAuction ?? null);
  if (au) {
    const [s] = await loadAuctionSummaries(tx, orgId, [au]);
    return s ? { key: `a:${au}`, label: `партия «${au}»`, total: s.total, paid: s.paid } : null;
  }
  if (!link.purchaseId) return null;
  const pu = await tx.purchase.findFirst({
    where: { id: link.purchaseId, organizationId: orgId },
    include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" }, select: { amount: true } } },
  });
  if (!pu) return null;
  return { key: `p:${pu.id}`, label: `закупка ${pu.number}`, total: purchaseTotalInclVat(pu), paid: pu.payments.reduce((x, p) => x.add(p.amount), new Decimal(0)) };
}

/** Правка оплаты поставщику (s-…) и оплаты за работу подрядчику (c-…). */
export async function updatePaymentCard(code: string, formData: FormData): Promise<CardState> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const parsedCode = parsePaymentCode(code);
  if (!parsedCode) return { error: "Оплата не найдена" };
  const need = parsedCode.kind === "raw" ? ACCESS.supplierPayments : PRODUCTION_EDIT_ROLES;
  if (!hasRole(session.user.role, need)) return { error: "Недостаточно прав для правки этой оплаты" };
  const c = parseCommon(formData);
  if ("error" in c) return { error: c.error };
  const confirmChange = formData.get("confirmChange") === "1";
  return parsedCode.kind === "raw" ? updateRaw(orgId, parsedCode.id, c, formData, confirmChange) : updateProd(orgId, parsedCode.id, c, formData, confirmChange);
}

async function updateRaw(orgId: string, id: string, c: Common, fd: FormData, confirmChange: boolean): Promise<CardState> {
  const existing = await prisma.payment.findFirst({
    where: { id, organizationId: orgId },
    include: { purchase: { select: { id: true, number: true, auctionSession: true, status: true } } },
  });
  if (!existing) return { error: "Оплата не найдена (возможно, уже удалена)" };
  const stale = staleError(fd, existing, PAYMENT_CARD_V);
  if (stale) return { error: stale };

  // Привязка: перенос возможен между закупками одного поставщика (как в updatePurchasePayment); оплата аукциона целиком остаётся на аукционе.
  const targetRaw = String(fd.get("targetPurchaseId") ?? "").trim();
  const lump = !existing.purchaseId && !!existing.auctionSession;
  const targetId = lump ? null : targetRaw === "" ? existing.purchaseId : targetRaw === "__none" ? null : targetRaw;
  let target: { id: string; number: string; auctionSession: string | null } | null = null;
  if (targetId && targetId !== existing.purchaseId) {
    target = await prisma.purchase.findFirst({ where: { id: targetId, organizationId: orgId, supplierId: existing.supplierId, status: { not: "CANCELLED" } }, select: { id: true, number: true, auctionSession: true } });
    if (!target) return { error: "Закупка для переноса не найдена: можно переносить только на закупку того же поставщика" };
  } else if (targetId && existing.purchase) target = existing.purchase;
  if (!targetId && existing.purchaseId) return { error: "Снять привязку у оплаты закупки здесь нельзя: перенесите её на другую закупку или удалите оплату" };

  const oldAu = auctionName(existing.auctionSession ?? existing.purchase?.auctionSession ?? null);
  const newAu = lump ? oldAu : auctionName(target?.auctionSession ?? null);
  const moved = (target?.id ?? null) !== existing.purchaseId;
  const amountChanged = !c.amount.equals(existing.amount);
  const dateChanged = ru(c.paidAt) !== ru(existing.paidAt);
  const financial = amountChanged || dateChanged || moved;
  const exRefs = effRefs(existing);
  const refsChanged = c.ppNo !== exRefs.ppNo || c.invoiceNo !== exRefs.invoiceNo;
  const methodChanged = c.method !== existing.method;
  const notesChanged = (c.notes ?? "") !== (existing.notes ?? "");

  const result = await prisma.$transaction(async (tx): Promise<CardState & { siblingIds?: string[] }> => {
    for (const name of [...new Set([oldAu, newAu].filter((x): x is string => !!x))].sort()) await lockAuction(tx, orgId, name);
    const cur = await tx.payment.findFirst({ where: { id, organizationId: orgId } });
    if (!cur) return { error: "Оплата уже удалена" };

    // Остальные части той же оплаты (мастер «Внести оплату» разносит одну оплату на несколько записей).
    const siblings = await siblingPayments(tx, orgId, cur);

    const warns: string[] = [];
    const effects: string[] = [];
    if (cur.status === "COMPLETED" && (amountChanged || moved)) {
      const before = await scopeOf(tx, orgId, { purchaseId: cur.purchaseId, auctionSession: cur.auctionSession, purchaseAuction: existing.purchase?.auctionSession });
      const after = lump ? before : await scopeOf(tx, orgId, { purchaseId: target?.id ?? null, auctionSession: null, purchaseAuction: target?.auctionSession });
      const left = (s: Scope, paid: Decimal) => `остаток к оплате ${money(Decimal.max(s.total.sub(paid), 0))}`;
      if (before && after && before.key === after.key) {
        const paid2 = before.paid.sub(cur.amount).add(c.amount);
        effects.push(`Оплачено по ${before.label}: ${money(before.paid)} → ${money(paid2)}; ${left(before, before.paid)} → ${left(before, paid2)}.`);
        if (paid2.sub(before.total).greaterThan(PAY_EPS)) warns.push(`Переплата по ${before.label}: оплачено ${money(paid2)} при стоимости ${money(before.total)}.`);
      } else {
        if (before) effects.push(`Из ${before.label} уйдёт ${money(cur.amount)}: оплачено ${money(before.paid)} → ${money(before.paid.sub(cur.amount))}; ${left(before, before.paid)} → ${left(before, before.paid.sub(cur.amount))}.`);
        else effects.push(`Оплата сейчас без привязки: это аванс ${money(cur.amount)}, он уменьшает общий долг поставщику.`);
        if (after) {
          const p2 = after.paid.add(c.amount);
          effects.push(`В ${after.label} придёт ${money(c.amount)}: оплачено ${money(after.paid)} → ${money(p2)}; ${left(after, after.paid)} → ${left(after, p2)}.`);
          if (p2.sub(after.total).greaterThan(PAY_EPS)) warns.push(`Переплата по ${after.label}: оплачено станет ${money(p2)} при стоимости ${money(after.total)}.`);
        } else effects.push(`Оплата ${money(c.amount)} станет авансом без привязки.`);
      }
    } else if (dateChanged && !amountChanged) effects.push("Суммы оплаченного и остатки не меняются.");
    if (siblings.length > 0) effects.push(`Эта оплата разнесена на ${siblings.length + 1} записей: дата, способ, № счёта и № п/п изменятся у всех частей; сумма, привязка и заметка — только у этой.`);

    const changes: CardChange[] = [];
    if (amountChanged) changes.push({ label: "Сумма", from: money(cur.amount), to: money(c.amount) });
    if (dateChanged) changes.push({ label: "Дата", from: ru(cur.paidAt), to: ru(c.paidAt) });
    if (methodChanged) changes.push({ label: "Способ", from: METHOD_RU[cur.method] ?? cur.method, to: METHOD_RU[c.method] });
    const curRefs = effRefs(cur);
    if (c.invoiceNo !== curRefs.invoiceNo) changes.push({ label: "№ счёта", from: txt(curRefs.invoiceNo), to: txt(c.invoiceNo) });
    if (c.ppNo !== curRefs.ppNo) changes.push({ label: "№ п/п", from: txt(curRefs.ppNo), to: txt(c.ppNo) });
    if (moved) changes.push({ label: "Привязка", from: existing.purchase ? `закупка ${existing.purchase.number}` : oldAu ? `партия «${oldAu}»` : "без привязки", to: target ? `закупка ${target.number}` : "без привязки" });
    if (notesChanged) changes.push({ label: "Заметка", from: txt(cur.notes), to: txt(c.notes) });
    if (changes.length === 0) return { ok: true };

    const resets = financial || refsChanged;
    const danger = warns.length > 0 || (resets && !!cur.confirmedAt);
    if (resets && cur.confirmedAt) effects.push("Отметка «подтверждена» будет снята: оплату нужно подтвердить заново.");
    else if (resets) effects.push("Подтверждение закупки или партии, к которым относится оплата, будет сброшено.");
    if ((financial || (resets && cur.confirmedAt)) && !confirmChange) return { confirm: { changes, effects, warns, danger } };
    if (warns.length > 0 && !confirmChange) return { confirm: { changes, effects, warns, danger } };

    const docRef = c.ppNo !== curRefs.ppNo || c.invoiceNo !== curRefs.invoiceNo || dateChanged ? rebuildDocRef(cur.docRef, { ppNo: c.ppNo, invoiceNo: c.invoiceNo, paidIso: c.paidIso }) : cur.docRef;
    const shared = { paidAt: c.paidAt, method: c.method, invoiceNo: c.invoiceNo || null, ppNo: c.ppNo || null, docRef };
    await tx.payment.update({
      where: { id },
      data: { ...shared, amount: c.amount, notes: c.notes, ...(amountChanged ? { percent: null } : {}), ...(lump ? {} : { purchaseId: target?.id ?? null }) },
    });
    if (siblings.length > 0) await tx.payment.updateMany({ where: { id: { in: siblings.map((s) => s.id) } }, data: shared });
    return { ok: true, siblingIds: siblings.map((s) => s.id) };
  });
  if (!result.ok || result.confirm || result.error) return result;
  if (result.siblingIds === undefined) return { ok: true }; // ничего не изменено

  if (financial || refsChanged) {
    await resetVerification(prisma, orgId, {
      paymentIds: [id, ...result.siblingIds],
      purchaseIds: [existing.purchaseId, target?.id],
      auctions: [oldAu, newAu],
    });
  }
  revalidateAll(orgId);
  return { ok: true };
}

async function updateProd(orgId: string, id: string, c: Common, fd: FormData, confirmChange: boolean): Promise<CardState> {
  const existing = await prisma.productionPayment.findFirst({
    where: { id, organizationId: orgId },
    include: { allocations: { select: { amount: true, source: true } } },
  });
  if (!existing) return { error: "Оплата не найдена (возможно, уже удалена)" };
  const stale = staleError(fd, existing, PRODUCTION_CARD_V);
  if (stale) return { error: stale };
  const amountChanged = !c.amount.equals(existing.amount);
  const dateChanged = ru(c.paidAt) !== ru(existing.paidAt);
  const exRefs = effRefs(existing);
  const refsChanged = c.ppNo !== exRefs.ppNo || c.invoiceNo !== exRefs.invoiceNo;
  const methodChanged = c.method !== existing.method;
  const notesChanged = (c.notes ?? "") !== (existing.notes ?? "");

  const alloc = existing.allocations.reduce((s, a) => s.add(a.amount), new Decimal(0));
  if (amountChanged && existing.allocations.some((a) => a.source === "MANUAL") && alloc.greaterThan(c.amount)) {
    return { error: `Новая сумма меньше уже разнесённого вручную по ТЗ (${money(alloc)}). Сначала уменьшите разнесение оплаты.` };
  }
  const changes: CardChange[] = [];
  if (amountChanged) changes.push({ label: "Сумма", from: money(existing.amount), to: money(c.amount) });
  if (dateChanged) changes.push({ label: "Дата", from: ru(existing.paidAt), to: ru(c.paidAt) });
  if (methodChanged) changes.push({ label: "Способ", from: METHOD_RU[existing.method] ?? existing.method, to: METHOD_RU[c.method] });
  if (c.invoiceNo !== exRefs.invoiceNo) changes.push({ label: "№ счёта", from: txt(exRefs.invoiceNo), to: txt(c.invoiceNo) });
  if (c.ppNo !== exRefs.ppNo) changes.push({ label: "№ п/п", from: txt(exRefs.ppNo), to: txt(c.ppNo) });
  if (notesChanged) changes.push({ label: "Заметка", from: txt(existing.notes), to: txt(c.notes) });
  if (changes.length === 0) return { ok: true };

  const financial = amountChanged || dateChanged;
  const resets = financial || refsChanged;
  const effects: string[] = [];
  if (amountChanged) effects.push(`Разнесено по ТЗ ${money(alloc)}; не разнесено было ${money(existing.amount.sub(alloc))}, станет ${money(Decimal.max(c.amount.sub(alloc), 0))} (разнесение пересчитается автоматически, ручное сохранится).`);
  if (resets && existing.confirmedAt) effects.push("Отметка «подтверждена» будет снята: оплату нужно подтвердить заново.");
  else if (resets) effects.push("Подтверждение ТЗ и партии, к которым относится оплата, будет сброшено.");
  if (financial || (resets && existing.confirmedAt)) {
    if (!confirmChange) return { confirm: { changes, effects, warns: [], danger: resets && !!existing.confirmedAt } };
  }

  const docRef = refsChanged || dateChanged ? rebuildDocRef(existing.docRef, { ppNo: c.ppNo, invoiceNo: c.invoiceNo, paidIso: c.paidIso }) : existing.docRef;
  await prisma.$transaction(async (tx) => {
    await tx.productionPayment.update({ where: { id }, data: { amount: c.amount, paidAt: c.paidAt, method: c.method, notes: c.notes, docRef, invoiceNo: c.invoiceNo || null, ppNo: c.ppNo || null } });
    if (amountChanged) await autoAllocatePayment(tx, orgId, id);
  });
  if (resets) await resetVerification(prisma, orgId, { prodPaymentIds: [id] });
  revalidateAll(orgId);
  return { ok: true };
}

/** Удаление оплаты из её карточки: исполняют существующие действия (по виду оплаты). */
export async function deletePaymentCard(code: string): Promise<{ error?: string; ok?: boolean }> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const parsed = parsePaymentCode(code);
  if (!parsed) return { error: "Оплата не найдена" };
  const need = parsed.kind === "raw" ? ACCESS.supplierPayments : PRODUCTION_EDIT_ROLES;
  if (!hasRole(session.user.role, need)) return { error: "Недостаточно прав для удаления этой оплаты" };

  if (parsed.kind === "raw") {
    const p = await prisma.payment.findFirst({ where: { id: parsed.id, organizationId: orgId }, select: { purchaseId: true, auctionSession: true } });
    if (!p) return { error: "Оплата не найдена (возможно, уже удалена)" };
    const r = p.purchaseId ? await removePurchasePayment(p.purchaseId, parsed.id) : p.auctionSession ? await deleteAuctionPayment(parsed.id) : await deleteAdvancePayment(parsed.id);
    if (r && "error" in r && r.error) return { error: r.error };
    return { ok: true };
  }
  const p = await prisma.productionPayment.findFirst({ where: { id: parsed.id, organizationId: orgId }, select: { orders: { select: { productionOrderId: true }, take: 1 } } });
  if (!p) return { error: "Оплата не найдена (возможно, уже удалена)" };
  const orderId = p.orders[0]?.productionOrderId;
  if (orderId) await removeProductionPayment(orderId, parsed.id);
  else {
    await prisma.productionPayment.delete({ where: { id: parsed.id } });
    revalidateAll(orgId);
  }
  const still = await prisma.productionPayment.count({ where: { id: parsed.id } });
  return still ? { error: "Не удалось удалить оплату" } : { ok: true };
}
