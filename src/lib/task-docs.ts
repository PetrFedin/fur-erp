import "server-only";
import { memoRequest, objId } from "@/lib/req-memo";
import type { Prisma, PrismaClient } from "@prisma/client";
import { auctionKey } from "@/lib/auction-key";
import { auctionName } from "@/lib/auction-payments";
import { PURCHASE_KIND_TO_TYPE } from "@/lib/doc-coverage";
import type { DriveDocTypeKey } from "@/lib/drive-docs";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import type { AttentionEntity } from "@/lib/attention";
import {
  DECISIONS, DECISION_KEY_PREFIX, DOC_TASKS, KIND_ACCEPTS, SEARCH_SINCE,
  type Decision, type DocTask,
} from "@/lib/task-docs-catalog";

/**
 * Задачи центра «Контроль → Задачи» по документам и решениям. Открыта или закрыта — вычисляется из данных на каждый запрос:
 *  - задача по конкретной оплате закрыта, когда оплата подтверждена (confirmed + confirmedAt) или к ней приложена платёжка;
 *  - задача по закупкам закрыта, когда на этих закупках (или их оплатах) появился документ нужного типа, добавленный
 *    после поиска в Drive (SEARCH_SINCE) — загруженный файл или ссылка на Drive.
 * Ручного «закрыть» нет. Решения владельца хранятся в SystemState (ключ `owner-decision:<id>`), правка уходит в журнал изменений.
 * Долг поставщику не пересчитывается: сумма акта сверки берётся из loadSupplierDebt.
 */

type Db = PrismaClient | Prisma.TransactionClient;
export type TaskPriority = "red" | "yellow" | "gray";

export type DocTaskView = {
  task: DocTask;
  open: boolean;
  /** Входит ли в счётчик (открыта и не «после поставки»). */
  counts: boolean;
  priority: TaskPriority;
  amount: number | null;
  /** Дней просрочки (срок прошёл, задача открыта). */
  overdueDays: number | null;
  dueText: string | null;
  /** «К какой записи»: ссылка на карточку. */
  recordHref: string;
  /** «Загрузить документ»: страница, где есть загрузка на этой записи. */
  uploadHref: string;
  /** Чем закрыта: «платёжка приложена», «оплата подтверждена», «документов: 1»… */
  closedBy: string | null;
  /** Сколько нужных документов уже есть / сколько нужно. */
  have: number;
  need: number;
  /** Запись для проверки не найдена в базе (сумма или номер изменились): задача остаётся открытой. */
  missing: string | null;
  paymentIds: string[];
};

export type DecisionView = {
  decision: Decision;
  open: boolean;
  choice: { key: string; label: string; note: string | null; at: string; byName: string | null } | null;
};

export type TaskBlocks = {
  docTasks: DocTaskView[];
  decisions: DecisionView[];
  /** Открытые задачи на документы (без «после поставки»). */
  openDocs: number;
  urgentDocs: number;
  laterDocs: number;
  closedDocs: number;
  openDecisions: number;
  /** Оплаты, которые теперь описаны задачами: из «Нет платёжек» / «Аванс без привязки» они убираются, чтобы не считаться дважды. */
  coveredPaymentIds: string[];
  debtRub: string;
  /** Сумма под вопросом по открытым задачам с конкретной суммой (без акта сверки на весь долг). */
  openAmount: number;
};

const day = (d: Date) => d.toISOString().slice(0, 10);
const fix2 = (n: number | string | { toString(): string }) => Number(n.toString()).toFixed(2);
const cmpDays = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

function priorityOf(amount: number | null, overdue: number | null, later: boolean): TaskPriority {
  if (later) return "gray";
  if ((overdue ?? 0) > 0) return "red";
  const a = amount ?? 0;
  return a >= 10_000_000 ? "red" : a >= 1_000_000 ? "yellow" : "gray";
}

type PayRow = {
  id: string; amount: Prisma.Decimal; paidAt: Date; confirmed: boolean; confirmedAt: Date | null;
  purchaseId: string | null; auctionSession: string | null; documentId: string | null;
};
type DocRow = { id: string; key: string; title: string; number: string | null; type: DriveDocTypeKey; purchaseId: string | null; paymentId: string | null };

function payHref(p: PayRow): string {
  if (p.purchaseId) return `/purchases/${p.purchaseId}`;
  const a = auctionName(p.auctionSession);
  return a ? `/payments?auction=${encodeURIComponent(a)}#auction-block` : "/payments";
}

async function loadTaskBlocksImpl(db: Db, organizationId: string, now = new Date()): Promise<TaskBlocks> {
  const today = day(now);
  const [purchases, payments, driveDocs, fileDocs, states, debt] = await Promise.all([
    db.purchase.findMany({ where: { organizationId }, select: { id: true, number: true, auctionSession: true } }),
    db.payment.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      select: { id: true, amount: true, paidAt: true, confirmed: true, confirmedAt: true, purchaseId: true, auctionSession: true, documentId: true },
    }),
    db.driveDocument.findMany({
      where: { organizationId, createdAt: { gte: SEARCH_SINCE } },
      select: { id: true, driveFileId: true, title: true, docNumber: true, docType: true, purchaseId: true, paymentId: true, lot: { select: { purchaseId: true } } },
    }),
    db.purchaseDocument.findMany({
      where: { organizationId, createdAt: { gte: SEARCH_SINCE } },
      select: { id: true, title: true, originalName: true, kind: true, purchaseId: true, batch: true },
    }),
    db.systemState.findMany({ where: { organizationId, key: { startsWith: DECISION_KEY_PREFIX } }, select: { key: true, value: true } }),
    loadSupplierDebt(db, organizationId),
  ]);

  const byNumber = new Map(purchases.map((p) => [p.number, p]));

  // ---- документы (после SEARCH_SINCE) единым списком: ссылки Drive и файлы закупок
  const docs: DocRow[] = driveDocs.map((d) => ({
    id: d.id, key: `d:${d.driveFileId}`, title: d.title, number: d.docNumber, type: d.docType,
    purchaseId: d.purchaseId ?? d.lot?.purchaseId ?? null, paymentId: d.paymentId,
  }));
  const batchDocs: { id: string; batch: string }[] = [];
  const fileById = new Map<string, DocRow>();
  for (const f of fileDocs) {
    const row: DocRow = { id: f.id, key: `f:${f.id}`, title: `${f.title} ${f.originalName}`, number: null, type: PURCHASE_KIND_TO_TYPE[f.kind] ?? "OTHER", purchaseId: f.purchaseId, paymentId: null };
    fileById.set(f.id, row);
    if (f.purchaseId) docs.push(row);
    else if (f.batch) batchDocs.push({ id: f.id, batch: f.batch });
  }

  // ---- поиск оплаты по сумме (и дате)
  const matchPayment = (ref: { amount: number; paidOn: string }): PayRow | null => {
    const same = payments.filter((p) => fix2(p.amount) === fix2(ref.amount));
    if (same.length === 0) return null;
    return same.find((p) => day(p.paidAt) === ref.paidOn) ?? [...same].sort((a, b) => Math.abs(cmpDays(day(a.paidAt), ref.paidOn)) - Math.abs(cmpDays(day(b.paidAt), ref.paidOn)))[0];
  };
  const paymentProof = (p: PayRow): boolean => {
    if (docs.some((d) => d.paymentId === p.id && d.type === "PAYMENT_PROOF")) return true;
    const f = p.documentId ? fileById.get(p.documentId) : null;
    return !!f && f.type === "PAYMENT_PROOF";
  };

  // Оплаты, которые ищут задачи по конкретной оплате: их документы не засчитываются задачам по закупкам.
  const claimed = new Set<string>();
  for (const t of DOC_TASKS) for (const r of t.payments ?? []) { const p = matchPayment(r); if (p) claimed.add(p.id); }

  const cum = new Map<string, number>(); // накопленная потребность по одинаковым (вид + закупки) задачам
  const views: DocTaskView[] = [];
  for (const t of DOC_TASKS) {
    const accepts = t.accepts ?? KIND_ACCEPTS[t.kind];
    const need = t.min ?? 1;
    const re = t.needle ? new RegExp(t.needle, "i") : null;
    let have = 0;
    let open = true;
    let closedBy: string | null = null;
    let missing: string | null = null;
    const paymentIds: string[] = [];
    let recordHref = "/payments";
    let uploadHref = "/payments";

    if (t.payments?.length) {
      let done = 0;
      let verified = 0;
      for (const ref of t.payments) {
        const p = matchPayment(ref);
        if (!p) { missing = `оплата ${fix2(ref.amount)} ₽ от ${ref.paidOn.split("-").reverse().join(".")} не найдена в базе`; continue; }
        paymentIds.push(p.id);
        if (paymentIds.length === 1) { recordHref = payHref(p); uploadHref = recordHref; }
        const proof = paymentProof(p);
        const ver = p.confirmed && !!p.confirmedAt;
        if (proof || ver) done++;
        if (ver && !proof) verified++;
      }
      have = done;
      open = missing != null || done < t.payments.length;
      if (!open) closedBy = verified > 0 ? "оплата подтверждена" : "платёжка приложена";
    } else {
      const ids = new Set<string>();
      const batchNames = new Set<string>();
      for (const n of t.purchases ?? []) {
        const p = byNumber.get(n);
        if (p) { ids.add(p.id); const a = auctionName(p.auctionSession); if (a) batchNames.add(auctionKey(a)); }
      }
      if (!t.orgWide && ids.size === 0) missing = "закупки не найдены в базе";
      const payIds = new Set<string>();
      for (const p of payments) if (!claimed.has(p.id) && p.purchaseId && ids.has(p.purchaseId)) payIds.add(p.id);
      for (const r of t.alsoPayments ?? []) { const p = matchPayment(r); if (p) payIds.add(p.id); }
      const matches = (d: DocRow) => accepts.includes(d.type) && (!re || re.test(`${d.title} ${d.number ?? ""}`));
      const found = new Set<string>();
      for (const d of docs) {
        const inScope = t.orgWide || (d.purchaseId != null && ids.has(d.purchaseId)) || (d.paymentId != null && payIds.has(d.paymentId));
        if (inScope && matches(d)) found.add(d.key);
      }
      for (const b of batchDocs) {
        const f = fileById.get(b.id);
        if (f && batchNames.has(auctionKey(b.batch)) && matches(f)) found.add(f.key);
      }
      const gk = `${t.kind}|${t.orgWide ? "*" : [...ids].sort().join(",")}`;
      const before = cum.get(gk) ?? 0;
      cum.set(gk, before + need);
      have = Math.max(0, Math.min(need, found.size - before));
      open = found.size < before + need;
      if (!open) closedBy = `документов: ${need}`;
      const anchor = t.purchases?.[0] ? byNumber.get(t.purchases[0]) : undefined;
      if (anchor) { recordHref = `/purchases/${anchor.id}`; uploadHref = recordHref; }
      else if (t.orgWide) { recordHref = "/documents"; uploadHref = "/documents"; }
    }

    const amount = t.amount ?? Number(debt.debt.toString());
    const overdueDays = open && !t.accountedNote && t.due && t.due < today ? cmpDays(today, t.due) : null;
    const dueText = t.accountedNote ? `${t.accountedNote} (срок по счёту — ${t.due ? t.due.split("-").reverse().join(".") : "—"})` : t.due ? `${t.due.split("-").reverse().join(".")}${t.dueNote ? ` · ${t.dueNote}` : ""}` : null;
    views.push({
      task: t, open, counts: open && !t.later, priority: open ? priorityOf(amount, overdueDays, !!t.later) : "gray",
      amount, overdueDays, dueText, recordHref, uploadHref, closedBy, have, need, missing: open ? missing : null, paymentIds,
    });
  }

  // ---- решения владельца
  const stateByKey = new Map(states.map((s) => [s.key, s.value as Record<string, unknown>]));
  // «Аванс июль 2026»: суммы считаются по данным (платежи по счетам №141 и №143), а не хранятся в тексте — после каждого разнесения они сами обновляются.
  const advPays = await db.productionPayment.findMany({
    where: { organizationId, status: "COMPLETED" },
    select: { amount: true, docRef: true, allocations: { select: { amount: true, productionOrder: { select: { status: true } } } } },
  });
  let advTotal = 0, advAlloc = 0;
  for (const p of advPays) {
    if (!/сч[её]т\s*№\s*(141|143)(?!\d)/i.test(p.docRef ?? "")) continue;
    advTotal += Number(p.amount.toString());
    advAlloc += p.allocations.filter((a) => a.productionOrder.status !== "CANCELLED").reduce((x, a) => x + Number(a.amount.toString()), 0);
  }
  const advRest = Math.max(0, Math.round((advTotal - advAlloc) * 100) / 100);
  const rub = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`.replace(/\u00a0/g, " ");
  const mln = (n: number) => `${(Math.round(n / 10_000) / 100).toLocaleString("ru-RU")} млн`;
  const decisions: DecisionView[] = DECISIONS.map((base) => {
    const decision: Decision = base.id !== "advance-15-9" || advTotal <= 0 ? base : {
      ...base,
      title: `Аванс июль 2026: разнесено ${mln(advAlloc)}, без привязки ${advRest > 0.5 ? `остаётся ${rub(advRest)}` : "ничего не осталось"} из ${rub(advTotal)}`,
      why: `По счетам №141 и №143 мы перечислили ${rub(advTotal)}; по ТЗ и партиям разнесено ${rub(advAlloc)}. ${advRest > 0.5 ? `Без привязки остаётся ${rub(advRest)}: ТЗ М023×6, М026×3, М001Е×1 и остаток по счёту №143 — это запрос Веллмеху. Разнести можно в «Оплаты → За работу → Неразнесённые авансы».` : "Весь аванс отнесён к ТЗ."} На долг по работе подрядчику не влияет.`,
      amount: advRest,
    };
    const v = stateByKey.get(DECISION_KEY_PREFIX + decision.id);
    const opt = v ? decision.options.find((o) => o.key === v.choice) : null;
    const choice = v && opt
      ? { key: opt.key, label: opt.label, note: typeof v.note === "string" && v.note ? v.note : null, at: String(v.at ?? ""), byName: typeof v.byName === "string" ? v.byName : null }
      : null;
    return { decision, open: !choice, choice };
  });

  const covered = new Set<string>();
  for (const v of views) if (v.open) v.paymentIds.forEach((id) => covered.add(id));
  const counted = views.filter((v) => v.counts);
  return {
    docTasks: views,
    decisions,
    openDocs: counted.length,
    urgentDocs: counted.filter((v) => v.priority === "red").length,
    laterDocs: views.filter((v) => v.open && v.task.later).length,
    closedDocs: views.filter((v) => !v.open).length,
    openDecisions: decisions.filter((d) => d.open).length,
    coveredPaymentIds: [...covered],
    debtRub: debt.debt.toFixed(2),
    openAmount: counted.reduce((s, v) => s + (v.task.amount ?? 0), 0),
  };
}

/** Убирает из замечаний «Нет платёжек» и «Аванс без привязки» оплаты, по которым уже есть открытая задача на документ (один факт — одно место). */
export function stripCoveredPayments(all: AttentionEntity[], coveredPaymentIds: string[]): AttentionEntity[] {
  if (coveredPaymentIds.length === 0) return all;
  const ids = new Set(coveredPaymentIds.map((id) => `payment:${id}`));
  const out: AttentionEntity[] = [];
  for (const e of all) {
    if (!ids.has(e.id)) { out.push(e); continue; }
    const problems = e.problems.filter((p) => p.group !== "no-receipt" && p.group !== "advance-unlinked");
    if (problems.length === 0) continue;
    out.push({ ...e, problems, priority: problems[0].priority });
  }
  return out;
}

export const loadTaskBlocks = memoRequest("taskBlocks", loadTaskBlocksImpl, (db, orgId, now) => (now ? null : `${objId(db)}|${orgId}`));
