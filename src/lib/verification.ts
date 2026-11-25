import { memoRequest, objId } from "@/lib/req-memo";
import "server-only";
import { DRIVE_DOC_TYPE_LABELS } from "@/lib/drive-docs";
import { loadRegistry } from "@/lib/reconciliation-registry";

/**
 * ЕДИНАЯ ЛОГИКА «ПОДТВЕРЖДЕНО» — один источник правды для чекбоксов, страницы /verify, реестра сверки,
 * «Что не заведено» и скрипта автоподтверждения (scripts/auto-verify-by-documents.ts).
 *
 * Что значит «подтверждено» (строка отмечена человеком или автоматически по документам):
 *  • Платёж поставщику / оплата производства — оплата проведена (не «запланирована»), флаг «подтверждена» стоит
 *    (платёжка приложена либо основание названо), есть ДОКУМЕНТ-ОСНОВАНИЕ: файл платёжки (или счёт/письмо/УПД, привязанное
 *    к оплате) либо п/п с номером, либо письмо «оплачено» с датой; есть дата и сумма; оплата привязана к закупке/аукциону
 *    (производства — к ТЗ). Хранится в confirmed + confirmedAt + confirmedBy.
 *  • Закупка / аукцион — мех принят; все обязательные документы закупки/аукциона приложены (правила «Покрытия документами»);
 *    сумма в базе = сумме УПД/счёта по реестру сверки (±1 ₽); лоты и количество, счета и оплата в реестре сверки сошлись;
 *    оплата завершена и по каждой оплате есть платёжка. Хранится в Purchase.verifiedAt/verifiedBy/verifyNote.
 *  • ТЗ — приложение ТЗ загружено к самому ТЗ; дата ТЗ есть и не шаблонная; партия, заказчик, количество и цена работы заданы;
 *    состав материалов (списания) задан; в реестре сверки партии «ТЗ-приложения = база» (количество/работа совпали с документом).
 *  • Партия — все её действующие ТЗ подтверждены; обязательные документы партии (расчёт, счёт) есть; оплата за работу
 *    сопоставлена (оплачено полностью, по каждой оплате есть платёжка/п/п); замечания реестра сверки сняты.
 * Подтвердить можно и вопреки замечаниям — только с обязательным примечанием (решение владельца), оно сохраняется.
 * Любая правка суммы, документа или даты после подтверждения СБРАСЫВАЕТ подтверждение (resetVerification — в server actions).
 */

import type { Db, VerifyModel, VerifyOpts, VerifyRow, VerifyCounts, Readiness, ModelCtx } from "@/lib/_verification/types";
import { addPaymentRows, addProdPaymentRows } from "@/lib/_verification/model-payments";
import { addPurchaseRows } from "@/lib/_verification/model-purchases";
import { addProductionRows } from "@/lib/_verification/model-production";
import { loadVerifyFlagsImpl } from "@/lib/_verification/flags";

// Типы, основания, шаги загрузки модели, сводка и запись — в src/lib/_verification/ (прежние пути импорта сохранены переэкспортом).
export type { Blocker, Readiness, VerifyRow, VerifyModel, VerifyOpts, VerifyFlag, VerifyFlags, VerifyCounts } from "@/lib/_verification/types";
export { ROUND_TOL_RUB, stampOf, ppNoOf, refEvidence, registryKnowsPp, registryFactFor, templateDateIssue, isCountedPayment } from "@/lib/_verification/evidence";
export { applyVerify, applyUnverify, resetVerification, resetByPurchase, resetByAuction, resetByOrder, resetByProdPayment, resetByBatch, resetByDriveDoc, resetByPurchaseDoc, type ResetScope } from "@/lib/_verification/write";

import { VERIFY_KINDS, type VerifyKind } from "@/lib/verification-kinds";

export { VERIFY_KINDS, KIND_LABEL, type VerifyKind } from "@/lib/verification-kinds";
export { remarkOf, payNoteOf } from "@/lib/verify-remark";

/** Основание автоподтверждения (verifiedBy = «auto:<основание>»). */
export const AUTO_BASIS = "auto:docs-chain-2026-10-04";

// ===================================================================================================== ЗАГРУЗКА МОДЕЛИ

export async function loadVerifyModel(db: Db, orgId: string, opts: VerifyOpts = {}): Promise<VerifyModel> {
  const want = new Set(opts.kinds ?? VERIFY_KINDS);
  const only = opts.only;
  const reg0 = await loadRegistry(orgId);
  const users = await db.user.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name ?? "сотрудник"]));
  const userId = opts.userId ?? null;
  const rows: VerifyRow[] = [];
  const extra: VerifyModel["extra"] = { paymentPp: new Map(), purchaseNumber: new Map(), purchaseGroupId: new Map(), orderBatchNumber: new Map(), batchNumber: new Map() };
  const pick = (kind: VerifyKind) => want.has(kind) && (!only || only.kind === kind);

  const ctx: ModelCtx = { db, orgId, opts, only, reg0, userId, names, rows, extra, pick };

  // ----------------------------------------------------------------------------------- платежи поставщику
  if (pick("payment")) await addPaymentRows(ctx);

  // ------------------------------------------------------------------------------------ оплаты производства
  if (pick("prodPayment")) await addProdPaymentRows(ctx);

  // ------------------------------------------------------------------------------------------------ закупки
  if (pick("purchase")) await addPurchaseRows(ctx);

  // --------------------------------------------------------------------------------------- ТЗ и партии
  if (pick("order") || pick("batch")) await addProductionRows(ctx);
  return { rows, extra };
}

/** computeReadiness: что именно не сходится у строки (для кнопки «Подтвердить»). Берётся из загруженной модели. */
export function computeReadiness(model: VerifyModel, kind: VerifyKind, id: string): Readiness | null {
  const r = model.rows.find((x) => x.key === `${kind}:${id}`);
  return r ? { ready: r.ready, blockers: r.blockers } : null;
}

/** Одна строка с готовностью (карточки, списки). */
export async function loadVerifyRow(db: Db, orgId: string, kind: VerifyKind, id: string, opts: Omit<VerifyOpts, "kinds" | "only"> = {}): Promise<VerifyRow | null> {
  const m = await loadVerifyModel(db, orgId, { ...opts, kinds: [kind], only: { kind, id } });
  return m.rows[0] ?? null;
}

/** Все строки одного вида (списки). */
export async function loadVerifyRows(db: Db, orgId: string, kind: VerifyKind, opts: Omit<VerifyOpts, "kinds" | "only"> = {}): Promise<VerifyRow[]> {
  const m = await loadVerifyModel(db, orgId, { ...opts, kinds: [kind] });
  return m.rows;
}

export function countRows(allRows: VerifyRow[]): VerifyCounts {
  const rows = allRows.filter((r) => !r.zero);
  const verified = rows.filter((r) => r.verified).length;
  const waiting = rows.length - verified;
  return { total: rows.length, verified, waiting, ready: rows.filter((r) => !r.verified && r.ready).length, auto: rows.filter((r) => r.verified && r.auto).length };
}

/** Ссылка на документы строки — для подписей. */
export const docTypeLabel = (t: keyof typeof DRIVE_DOC_TYPE_LABELS) => DRIVE_DOC_TYPE_LABELS[t];

export const loadVerifyFlags = memoRequest("verifyFlags", loadVerifyFlagsImpl, (db, orgId, year) => `${objId(db)}|${orgId}|${year ?? ""}`);
