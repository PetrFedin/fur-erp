import { uniqueOrderCount } from "@/lib/tz-key";
import { orderUnits } from "@/lib/production-totals";
import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as appPrisma } from "@/lib/prisma";
import { auctionName } from "@/lib/auction-payments";
import { isServiceAuction } from "@/lib/auction-names";
import { loadAuctionPanels, type AuctionPanelData } from "@/lib/auction-doc-checklist";
import { buildBatchPanel, loadProductionModel, type BatchPanelData, type Ctx } from "@/lib/production-doc-checklist";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { DRIVE_DOC_TYPE_LABELS } from "@/lib/drive-docs";
import type { Commission4Mode } from "@/lib/commission4-mode";
import type { UploadTarget } from "@/lib/doc-panel";
import { MANUAL_PREFIX } from "@/lib/doc-panel";
import { formatDate, formatMoney } from "@/lib/utils";
import { ALL_GROUPS, ALL_INVOICES, type Group } from "@/app/(app)/reconciliation/model";
import { loadLive, type Live } from "@/app/(app)/reconciliation/live";

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

type Db = PrismaClient | Prisma.TransactionClient;

import { VERIFY_KINDS, type VerifyKind } from "@/lib/verification-kinds";
import { articleLabel } from "@/lib/article-label";
/** Допуск на округление лотов в расчёте себестоимости против УПД (максимум ≈0,65 ₽ на лот × десятки лотов). */
export const ROUND_TOL_RUB = 50;

export { VERIFY_KINDS, KIND_LABEL, type VerifyKind } from "@/lib/verification-kinds";
import { payNoteOf } from "@/lib/verify-remark";
export { remarkOf, payNoteOf } from "@/lib/verify-remark";

/** Основание автоподтверждения (verifiedBy = «auto:<основание>»). */
export const AUTO_BASIS = "auto:docs-chain-2026-10-04";

export type Blocker = { text: string; href?: string; upload?: UploadTarget };
export type Readiness = { ready: boolean; blockers: Blocker[] };

export type VerifyRow = {
  key: string;
  kind: VerifyKind;
  id: string;
  title: string;
  sub: string | null;
  href: string;
  /** Группа для фильтра/сортировки: аукцион, партия. */
  group: string | null;
  year: number | null;
  amountText: string | null;
  verified: boolean;
  auto: boolean;
  /** «04.10.2026 · вы» / «04.10.2026 · авто по документам». */
  stampText: string | null;
  note: string | null;
  ready: boolean;
  blockers: Blocker[];
  /** Поля быстрого ввода прямо в строке (/verify): значения сейчас. */
  edit: { date?: string; amount?: string; ref?: string; number?: string } | null;
  /** Оплата: основание — только письмо «оплачено» (без файла платёжки и п/п) → подпись «согласовано письмом». */
  letter?: boolean;
  /** Оплата на 0 ₽ (напр. «вынесено в оплату закупки»): проверять нечего — в счётчики «ждут проверки» не входит (isCountedPayment). */
  zero?: boolean;
  /** Чем подтверждено реестром сверки (п/п, сумма и дата совпали) — только для оплат. */
  registryFact: string | null;
  /** Пояснение «из чего состоит» для строки (аукцион: закупки). */
  members: string[];
};

export type VerifyModel = {
  rows: VerifyRow[];
  /** Для скрипта: данные, которых нет в строке. */
  extra: {
    paymentPp: Map<string, { ppNo: string | null; amount: number; paidIso: string }>;
    purchaseNumber: Map<string, string>;
    purchaseGroupId: Map<string, string | null>;
    orderBatchNumber: Map<string, number | null>;
    batchNumber: Map<string, number>;
  };
};

const fmtRub = (n: number | Decimal) => formatMoney(new Decimal(n).toDecimalPlaces(2).toString());
const iso = (d: Date) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------- подпись «кто и когда»

export function stampOf(at: Date | null | undefined, by: string | null | undefined, userId: string | null, names: Map<string, string>): { text: string | null; auto: boolean } {
  if (!at) return { text: null, auto: false };
  const auto = !!by && by.startsWith("auto:");
  const who = auto ? "авто по документам" : by && userId && by === userId ? "вы" : by ? (names.get(by) ?? "сотрудник") : "—";
  return { text: `${formatDate(at)} · ${who}`, auto };
}

// ---------------------------------------------------------------------------------------------- основание оплаты

/** Пометки «приблизительно»: дата не из платёжки. */
const APPROX_RE = /дата по (письму|fin|расч[её]ту)|приблизительн|гипотез/i;
const PP_RE = /п\/п\s*№\s*(\d{3,})/i;
const DATE_RE = /\d{2}\.\d{2}\.\d{4}/;
export const ppNoOf = (ref: string | null | undefined): string | null => PP_RE.exec(ref ?? "")?.[1] ?? null;

/** Основание в поле «документ»: п/п с номером или письмо «оплачено» с датой. Пометка «отмечено вручную» и просто «счёт №…» — не основание. */
export function refEvidence(ref: string | null | undefined): "pp" | "letter" | null {
  const r = (ref ?? "").trim();
  if (!r) return null;
  if (ppNoOf(r)) return "pp";
  if (/п\/п/i.test(r) && DATE_RE.test(r)) return "pp";
  if (/письм/i.test(r) && DATE_RE.test(r)) return "letter";
  return null;
}

// ----------------------------------------------------------------------------- факты оплат из реестра сверки (документы)

type RegFact = { amount: number; date: string; ppNo: string | null; basis: string | null };
let factsCache: { byPp: Map<string, RegFact[]>; all: RegFact[] } | null = null;
function registryFacts() {
  if (factsCache) return factsCache;
  const byPp = new Map<string, RegFact[]>();
  const all: RegFact[] = [];
  const seen = new Set<string>();
  for (const inv of ALL_INVOICES) {
    for (const p of inv.paid) {
      if (p.evidence !== "fact" || !p.date || p.dateApprox) continue;
      const k = `${p.ppNo ?? ""}|${p.date}|${p.amountRub}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const f: RegFact = { amount: p.amountRub, date: p.date, ppNo: p.ppNo, basis: p.basis };
      all.push(f);
      if (p.ppNo) byPp.set(p.ppNo, [...(byPp.get(p.ppNo) ?? []), f]);
    }
  }
  factsCache = { byPp, all };
  return factsCache;
}

/** Названа ли такая п/п в документах реестра сверки (для статуса «расходится»: п/п есть, а сумма или дата не совпали). */
export function registryKnowsPp(ppNo: string): boolean {
  return registryFacts().byPp.has(ppNo);
}

/**
 * Подтверждает ли оплату реестр сверки (документы Drive «мех»): тот же п/п (сумма всех оплат БД по этому п/п = сумме в документах)
 * либо, если п/п в основании не назван, — оплата с той же датой и суммой. Только «факт» с датой, без приблизительных.
 * Возвращает описание либо null.
 */
export function registryFactFor(p: { amount: number; paidIso: string; ppNo: string | null }, dbSumByPp: Map<string, number>): string | null {
  const { byPp, all } = registryFacts();
  if (p.ppNo) {
    const facts = byPp.get(p.ppNo);
    if (!facts?.length) return null;
    const reg = facts.reduce((s, f) => s + f.amount, 0);
    const db = dbSumByPp.get(p.ppNo) ?? p.amount;
    if (Math.abs(reg - db) <= 1 && facts.every((f) => f.date === p.paidIso)) return `документы: п/п №${p.ppNo} от ${formatDate(p.paidIso)}, сумма ${fmtRub(reg)}`;
    return null;
  }
  const hit = all.find((f) => f.date === p.paidIso && Math.abs(f.amount - p.amount) <= 1);
  return hit ? `документы: оплата ${formatDate(hit.date)} на ${fmtRub(hit.amount)}${hit.ppNo ? `, п/п №${hit.ppNo}` : ""}` : null;
}

// ------------------------------------------------------------------------------------------------- шаблонные даты ТЗ

const TEMPLATE_DATES: { from: number; to: number; ymd: [number, number, number][] }[] = [
  { from: 113, to: 115, ymd: [[2026, 1, 12]] },
  { from: 118, to: 118, ymd: [[2026, 3, 17], [2026, 1, 12]] },
];
const tzOrdinal = (num: string) => {
  const m = /(\d+)\s*$/.exec(num);
  return m ? parseInt(m[1], 10) : NaN;
};
/** Дата ТЗ — шаблон: 16.05.2025 (дата договора из приложений ТЗ 1–96), 12.01.2026 (ТЗ 113–115), 17.03.2026 (ТЗ 118). */
export function templateDateIssue(number: string, d: Date): string | null {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  if (y === 2025 && m === 5 && day === 16) return `дата ТЗ ${formatDate(d)} — это дата договора, а не ТЗ (шаблон)`;
  const ord = tzOrdinal(number);
  for (const t of TEMPLATE_DATES) if (ord >= t.from && ord <= t.to && t.ymd.some(([yy, mm, dd]) => yy === y && mm === m && dd === day)) return `дата ТЗ ${formatDate(d)} похожа на шаблон — проверьте по оригиналу`;
  return null;
}

const NON_STOCK_RE = /лоскут|бобр|фонди|подрядчик|давальч|сырь[её]\s+(заказчик|клиент|подрядчик)|тут нет продаж/i;

/**
 * Какие документы, привязанные к оплате, считаются основанием «оплата была»: платёжка и баланс/выписка с оплатой.
 * Счёт на оплату, УПД и письмо-согласование — НЕ основание (это «можно оплачивать», а не «оплачено»).
 */
const PROOF_DOC_TYPES = ["PAYMENT_PROOF", "BALANCE"] as const;

// ===================================================================================================== ЗАГРУЗКА МОДЕЛИ

export type VerifyOpts = {
  userId?: string | null;
  canUpload?: boolean;
  canMark?: boolean;
  c4Mode?: Commission4Mode;
  /** Какие виды считать (по умолчанию все). */
  kinds?: VerifyKind[];
  /** Только одна сущность: ускоряет карточки. */
  only?: { kind: VerifyKind; id: string };
};

const groupOfPurchase = (() => {
  let map: Map<string, Group> | null = null;
  return (number: string): Group | null => {
    if (!map) {
      map = new Map();
      for (const g of ALL_GROUPS) if (g.section === "purchase") for (const n of g.dbLink.purchases ?? []) map.set(n, g);
    }
    return map.get(number) ?? null;
  };
})();
const batchGroup = (n: number): Group | null => ALL_GROUPS.find((g) => g.section === "production" && g.dbLink.batch === n) ?? null;

const STATUS_BLOCKER: Record<string, string> = {
  docs: "сверка с документами: по документам сходится, но в базе копейки сверх допуска или оплата не привязана",
  unpaid: "сверка с документами: оплату нечем подтвердить (нет платёжки или п/п)",
  conflict: "сверка с документами: документы не сходятся с базой",
  empty: "сверка с документами: данных в документах нет",
};

export async function loadVerifyModel(db: Db, orgId: string, opts: VerifyOpts = {}): Promise<VerifyModel> {
  const want = new Set(opts.kinds ?? VERIFY_KINDS);
  const only = opts.only;
  const users = await db.user.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name ?? "сотрудник"]));
  const userId = opts.userId ?? null;
  const rows: VerifyRow[] = [];
  const extra: VerifyModel["extra"] = { paymentPp: new Map(), purchaseNumber: new Map(), purchaseGroupId: new Map(), orderBatchNumber: new Map(), batchNumber: new Map() };
  const pick = (kind: VerifyKind) => want.has(kind) && (!only || only.kind === kind);

  // ----------------------------------------------------------------------------------- платежи поставщику
  if (pick("payment")) {
    const pays = await db.payment.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" }, ...(only ? { id: only.id } : {}) },
      select: {
        id: true, amount: true, paidAt: true, status: true, kind: true, docRef: true, confirmed: true, confirmedAt: true, confirmedBy: true,
        documentId: true, purchaseId: true, auctionSession: true, notes: true,
        purchase: { select: { number: true } },
        supplier: { select: { name: true } },
        driveDocuments: { select: { docType: true } },
      },
      orderBy: { paidAt: "asc" },
    });
    const sumByPp = new Map<string, number>();
    for (const p of pays) {
      const pp = ppNoOf(p.docRef);
      if (pp && p.status === "COMPLETED") sumByPp.set(pp, (sumByPp.get(pp) ?? 0) + Number(p.amount));
    }
    for (const p of pays) {
      const blockers: Blocker[] = [];
      const href = p.purchaseId ? `/purchases/${p.purchaseId}` : "/payments";
      const hasFile = !!p.documentId || p.driveDocuments.some((d) => (PROOF_DOC_TYPES as readonly string[]).includes(d.docType));
      const ev = refEvidence(p.docRef);
      const ppNo = ppNoOf(p.docRef);
      const amount = Number(p.amount);
      if (p.status !== "COMPLETED") blockers.push({ text: "оплата только запланирована — деньги ещё не ушли", href });
      if (!(amount > 0)) blockers.push({ text: "сумма не задана", href });
      if (!hasFile && !ev)
        blockers.push({
          text: p.docRef?.toLowerCase().startsWith(MANUAL_PREFIX) ? "оплата отмечена вручную, платёжки и п/п нет" : "нет основания: файла платёжки, п/п с номером или письма «оплачено» с датой",
          href,
          upload: { action: "paymentProof", target: "supplier", paymentId: p.id, label: "Приложить платёжку" },
        });
      if (APPROX_RE.test(`${p.docRef ?? ""} ${p.notes ?? ""}`)) blockers.push({ text: "дата оплаты взята по письму или расчёту, а не из платёжки — уточнить по выписке", href });
      if (!p.purchaseId && !p.auctionSession) blockers.push({ text: "оплата не привязана к закупке или аукциону", href: "/payments" });
      const paidIso = iso(p.paidAt);
      const reg = registryFactFor({ amount, paidIso, ppNo }, sumByPp);
      const st = stampOf(p.confirmedAt, p.confirmedBy, userId, names);
      const verified = p.confirmed && !!p.confirmedAt;
      const target = p.purchase?.number ? `закупка ${p.purchase.number}` : p.auctionSession ? `аукцион ${auctionName(p.auctionSession)}` : "без привязки";
      rows.push({
        key: `payment:${p.id}`, kind: "payment", id: p.id,
        title: `${formatDate(p.paidAt)} · ${fmtRub(p.amount)}`, sub: `${p.supplier.name} · ${target}${p.docRef ? ` · ${p.docRef.slice(0, 80)}` : ""}`,
        href, group: auctionName(p.auctionSession) ?? p.purchase?.number ?? null, year: p.paidAt.getUTCFullYear(), amountText: fmtRub(p.amount),
        verified, auto: verified && st.auto, stampText: verified ? st.text : null, note: payNoteOf(p.notes), letter: !hasFile && ev === "letter",
        ready: blockers.length === 0, blockers,
        edit: { date: paidIso, amount: new Decimal(p.amount).toFixed(2), ref: p.docRef ?? "" },
        registryFact: reg, members: [], zero: !isCountedPayment(amount),
      });
      extra.paymentPp.set(`payment:${p.id}`, { ppNo, amount, paidIso });
    }
  }

  // ------------------------------------------------------------------------------------ оплаты производства
  if (pick("prodPayment")) {
    const pays = await db.productionPayment.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" }, ...(only ? { id: only.id } : {}) },
      select: {
        id: true, amount: true, paidAt: true, status: true, paymentType: true, docRef: true, confirmed: true, confirmedAt: true, confirmedBy: true, notes: true,
        client: { select: { name: true } },
        driveDocuments: { select: { docType: true } },
        orders: { select: { productionOrder: { select: { id: true, batch: { select: { number: true } } } } } },
      },
      orderBy: { paidAt: "asc" },
    });
    const sumByPp = new Map<string, number>();
    for (const p of pays) {
      const pp = ppNoOf(p.docRef);
      if (pp && p.status === "COMPLETED") sumByPp.set(pp, (sumByPp.get(pp) ?? 0) + Number(p.amount));
    }
    for (const p of pays) {
      const blockers: Blocker[] = [];
      const batches = [...new Set(p.orders.map((o) => o.productionOrder.batch?.number).filter((x): x is number => x != null))].sort((a, b) => a - b);
      const href = batches.length === 1 ? `/production/batches/${batches[0]}` : "/payments";
      const hasFile = p.driveDocuments.some((d) => (PROOF_DOC_TYPES as readonly string[]).includes(d.docType));
      const ev = refEvidence(p.docRef);
      const ppNo = ppNoOf(p.docRef);
      const amount = Number(p.amount);
      if (p.status !== "COMPLETED") blockers.push({ text: "оплата только запланирована — деньги ещё не пришли", href });
      if (!(amount > 0)) blockers.push({ text: "сумма не задана", href });
      if (!hasFile && !ev)
        blockers.push({
          text: p.docRef?.toLowerCase().startsWith(MANUAL_PREFIX) ? "оплата отмечена вручную, платёжки и п/п нет" : `в основании только ${p.docRef ? `«${p.docRef.slice(0, 40)}»` : "пусто"}: нужна платёжка, п/п или письмо «оплачено» с датой`,
          href,
          upload: { action: "paymentProof", target: "production", paymentId: p.id, label: "Приложить платёжку" },
        });
      if (APPROX_RE.test(`${p.docRef ?? ""} ${p.notes ?? ""}`)) blockers.push({ text: "дата оплаты взята по письму или расчёту, а не из платёжки — уточнить по выписке", href });
      if (p.orders.length === 0) blockers.push({ text: "оплата не привязана к ТЗ и партии (аванс без разнесения)", href: "/payments" });
      const paidIso = iso(p.paidAt);
      const reg = registryFactFor({ amount, paidIso, ppNo }, sumByPp);
      const st = stampOf(p.confirmedAt, p.confirmedBy, userId, names);
      const verified = p.confirmed && !!p.confirmedAt;
      rows.push({
        key: `prodPayment:${p.id}`, kind: "prodPayment", id: p.id,
        title: `${formatDate(p.paidAt)} · ${fmtRub(p.amount)}`,
        sub: `${p.client?.name ?? "заказчик не указан"} · ${batches.length ? `партия ${batches.join(", ")}` : "без партии"}${p.docRef ? ` · ${p.docRef.slice(0, 80)}` : ""}`,
        href, group: batches.length === 1 ? `Партия ${batches[0]}` : null, year: p.paidAt.getUTCFullYear(), amountText: fmtRub(p.amount),
        verified, auto: verified && st.auto, stampText: verified ? st.text : null, note: payNoteOf(p.notes), letter: !hasFile && ev === "letter",
        ready: blockers.length === 0, blockers,
        edit: { date: paidIso, amount: new Decimal(p.amount).toFixed(2), ref: p.docRef ?? "" },
        registryFact: reg, members: [], zero: !isCountedPayment(amount),
      });
      extra.paymentPp.set(`prodPayment:${p.id}`, { ppNo, amount, paidIso });
    }
  }

  // ------------------------------------------------------------------------------------------------ закупки
  if (pick("purchase")) {
    const purchases = await db.purchase.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" }, ...(only ? { id: only.id } : {}) },
      include: { items: true, expenses: true, supplier: { select: { name: true } } },
      orderBy: [{ orderDate: "asc" }, { number: "asc" }],
    });
    let live: Live | null = null;
    const needLive = purchases.some((p) => groupOfPurchase(p.number));
    if (needLive) live = await loadLive(orgId);
    // Панели «документы и оплата»: аукционы — одним вызовом, закупки вне аукциона — по одной.
    const panelOf = new Map<string, AuctionPanelData>();
    const pOpts = { canUpload: !!opts.canUpload, canMark: !!opts.canMark };
    if (only) {
      const ps = await loadAuctionPanels(db, orgId, { purchaseId: only.id, ...pOpts });
      for (const x of ps) for (const id of x.purchaseIds) panelOf.set(id, x);
    } else {
      const ps = await loadAuctionPanels(db, orgId, pOpts);
      // «Нет информации» и прочие заглушки импорта — не один аукцион, а разные закупки: у каждой своя панель.
      for (const x of ps) if (!isServiceAuction(x.key)) for (const id of x.purchaseIds) panelOf.set(id, x);
      for (const p of purchases) {
        if (panelOf.has(p.id)) continue;
        const one = await loadAuctionPanels(db, orgId, { purchaseId: p.id, ...pOpts });
        for (const x of one) for (const id of x.purchaseIds) panelOf.set(id, x);
      }
    }
    for (const p of purchases) {
      const blockers: Blocker[] = [];
      const href = `/purchases/${p.id}`;
      if (p.status !== "RECEIVED") blockers.push({ text: "закупка в черновике: мех не принят, УПД ещё нет", href });
      if (p.items.length === 0) blockers.push({ text: "в закупке нет лотов", href });
      const g = groupOfPurchase(p.number);
      if (!g) blockers.push({ text: "закупки нет в реестре сверки: сумму проверить не с чем", href: "/reconciliation" });
      else {
        const gHref = `/reconciliation#${encodeURIComponent(g.id)}`;
        const gd = live?.group.get(g.id);
        const docCost = g.doc?.costRub ?? null;
        // Расхождение в копейках-десятках рублей — округление лотов в расчёте себестоимости против УПД, не ошибка.
        const costDiff = docCost != null && gd?.cost != null ? gd.cost - docCost : null;
        const roundingOnly = costDiff != null && Math.abs(costDiff) <= ROUND_TOL_RUB;
        const failed = (g.checks ?? []).filter((c) => !c.ok && !(roundingOnly && /УПД|расч[её]т/i.test(c.label)));
        for (const c of failed) blockers.push({ text: `в реестре сверки не сошлось: ${c.label}`, href: gHref });
        if (g.status !== "ok" && failed.length === 0 && !(roundingOnly && g.status === "docs")) blockers.push({ text: STATUS_BLOCKER[g.status] ?? "сверка с документами: не сходится на 100%", href: gHref });
        if (docCost == null) blockers.push({ text: "в документах нет итоговой суммы (УПД/счёта) — сравнить не с чем", href: gHref });
        else if (costDiff != null) {
          if (Math.abs(costDiff) > ROUND_TOL_RUB) blockers.push({ text: `сумма в базе ≠ УПД на ${fmtRub(Math.abs(costDiff))} (в базе ${fmtRub(gd!.cost!)}, по документам ${fmtRub(docCost)})`, href });
        }
        const docPaid = g.doc?.paidRub ?? null;
        if (docPaid != null && gd && Math.abs(gd.paid - docPaid) > ROUND_TOL_RUB) blockers.push({ text: `оплата в базе ≠ оплате по документам на ${fmtRub(Math.abs(gd.paid - docPaid))}`, href: gHref });
      }
      const panel = panelOf.get(p.id);
      if (!panel) blockers.push({ text: "нет панели документов и оплаты для закупки", href });
      else {
        for (const it of panel.panel.items) {
          if (it.need === "required" && !it.ok) blockers.push({ text: `нет документа: ${it.label}`, href: panel.panel.href ?? href, upload: it.uploads[0] });
        }
        const pay = panel.panel.pay;
        if (pay.state !== "PAID") blockers.push({ text: `оплата: ${pay.label}`, href: panel.panel.href ?? href });
        if (panel.panel.proofMissing > 0) blockers.push({ text: `оплат без платёжки: ${panel.panel.proofMissing}`, href: panel.panel.href ?? href });
      }
      // убрать дубли текста
      const seen = new Set<string>();
      const uniq = blockers.filter((b) => (seen.has(b.text) ? false : (seen.add(b.text), true)));
      const total = purchaseTotalInclVat(p);
      const st = stampOf(p.verifiedAt, p.verifiedBy, userId, names);
      const aName = auctionName(p.auctionSession);
      rows.push({
        key: `purchase:${p.id}`, kind: "purchase", id: p.id,
        title: `Закупка ${p.number}`, sub: `${p.supplier.name}${aName ? ` · ${aName}` : ""} · ${formatDate(p.orderDate)}`,
        href, group: aName ?? p.number, year: p.orderDate.getUTCFullYear(), amountText: fmtRub(total),
        verified: !!p.verifiedAt, auto: !!p.verifiedAt && st.auto, stampText: p.verifiedAt ? st.text : null, note: p.verifyNote,
        ready: uniq.length === 0, blockers: uniq,
        edit: { date: iso(p.orderDate), number: p.invoiceNumber ?? "", ref: p.transferDocument ?? "" },
        registryFact: null, members: [],
      });
      extra.purchaseNumber.set(p.id, p.number);
      extra.purchaseGroupId.set(p.id, g?.id ?? null);
    }
  }

  // --------------------------------------------------------------------------------------- ТЗ и партии
  if (pick("order") || pick("batch")) {
    const c4: Commission4Mode = opts.c4Mode ?? "off";
    const ctx: Ctx = { c4Mode: c4, canUpload: !!opts.canUpload, canMark: !!opts.canMark };
    const m = await loadProductionModel(db, orgId);
    const batchById = new Map(m.raw.batches.map((b) => [b.id, b]));
    const orderRows = new Map<string, VerifyRow>();
    const nonCancelled = m.raw.orders.filter((o) => o.status !== "CANCELLED");

    for (const o of nonCancelled) {
      const batch = o.batchId ? batchById.get(o.batchId) : null;
      const blockers: Blocker[] = [];
      const href = `/production/${o.id}`;
      const own = m.docsByOrder.get(o.id) ?? [];
      if (!own.some((d) => d.docType === "TZ_APPENDIX"))
        blockers.push({ text: "приложение к ТЗ не загружено", href, upload: { action: "driveDoc", entity: "order", id: o.id, docType: "TZ_APPENDIX", label: "Загрузить приложение ТЗ" } });
      if (!o.workOrderDate) blockers.push({ text: "даты ТЗ нет (в приложении только шаблонная дата договора) — внести по оригиналу", href });
      else {
        const t = templateDateIssue(o.number, o.workOrderDate);
        if (t) blockers.push({ text: t, href });
      }
      if (!batch && (o as { batchNotRequired?: boolean | null }).batchNotRequired !== true) blockers.push({ text: "партия не указана", href });
      if (!o.clientId) blockers.push({ text: "заказчик не указан", href });
      const qty = orderUnits(o);
      if (!(qty > 0)) blockers.push({ text: "количество не задано", href });
      if (!o.clientWorkPricePerUnit || !o.clientWorkPricePerUnit.greaterThan(0)) blockers.push({ text: "цена работы не задана", href });
      const nonStock = NON_STOCK_RE.test(`${o.notes ?? ""} ${o.materialDescription ?? ""}`) || (o.materialUsages.length > 0 && o.materialUsages.every((u) => !u.commission4));
      if (o.materialUsages.length === 0 && !nonStock) blockers.push({ text: "состав материалов не задан (нет списаний сырья)", href });
      if (batch) {
        const g = batchGroup(batch.number);
        const chk = g?.checks?.find((c) => /ТЗ-приложения/.test(c.label));
        if (!g) blockers.push({ text: `партии ${batch.number} нет в реестре сверки: количество и работу сверить не с чем`, href: "/reconciliation" });
        else if (!chk || !chk.ok) blockers.push({ text: `в реестре сверки партии ${batch.number}: количество/работа не совпали с приложениями ТЗ`, href: `/reconciliation#${encodeURIComponent(g.id)}` });
      }
      const st = stampOf(o.verifiedAt, o.verifiedBy, userId, names);
      const dateForYear = o.workOrderDate ?? o.endDate ?? o.startDate;
      const row: VerifyRow = {
        key: `order:${o.id}`, kind: "order", id: o.id,
        title: `ТЗ ${o.workOrderNumber ?? o.number}`, sub: `${articleLabel(o.productModel)}${o.client ? ` · ${o.client.name}` : ""} · ${qty.toString()} шт.`,
        href, group: batch ? `Партия ${batch.number}` : null, year: dateForYear ? dateForYear.getUTCFullYear() : (batch?.year ?? null),
        amountText: o.clientWorkPricePerUnit ? fmtRub(o.clientWorkPricePerUnit.mul(qty)) : null,
        verified: !!o.verifiedAt, auto: !!o.verifiedAt && st.auto, stampText: o.verifiedAt ? st.text : null, note: o.verifyNote,
        ready: blockers.length === 0, blockers,
        edit: { date: o.workOrderDate ? iso(o.workOrderDate) : "", number: o.workOrderNumber ?? "" },
        registryFact: null, members: [],
      };
      orderRows.set(o.id, row);
      extra.orderBatchNumber.set(o.id, batch?.number ?? null);
      if (pick("order") && (!only || only.id === o.id)) rows.push(row);
    }

    if (pick("batch")) {
      for (const b of m.raw.batches) {
        if (only && only.id !== b.id) continue;
        const bp: BatchPanelData | null = buildBatchPanel(m, b, ctx);
        if (!bp) continue;
        const blockers: Blocker[] = [];
        const href = `/production/batches/${b.number}`;
        const live = (m.ordersByBatch.get(b.id) ?? []).filter((o) => o.status !== "CANCELLED");
        const unverified = live.filter((o) => !orderRows.get(o.id)?.verified);
        if (unverified.length > 0) {
          const nums = unverified.map((o) => o.workOrderNumber ?? o.number);
          blockers.push({ text: `ТЗ не подтверждены: ${uniqueOrderCount(unverified)} из ${uniqueOrderCount(live)}${live.length > uniqueOrderCount(live) ? ` ТЗ · позиций ${unverified.length} из ${live.length}` : ""} (${nums.slice(0, 8).join(", ")}${nums.length > 8 ? "…" : ""})`, href: `/verify?tab=orders&q=${encodeURIComponent(`Партия ${b.number}`)}` });
        }
        for (const it of bp.panel.items) {
          if (it.key === "TZ_APPENDIX") continue; // по ТЗ — выше
          if (it.need === "required" && !it.ok) blockers.push({ text: `нет документа: ${it.label}`, href, upload: it.uploads[0] });
        }
        const pay = bp.panel.pay;
        if (pay.state !== "PAID") blockers.push({ text: `оплата за работу: ${pay.label}`, href });
        if (bp.panel.proofMissing > 0) blockers.push({ text: `оплат без платёжки/п/п: ${bp.panel.proofMissing}`, href });
        const g = batchGroup(b.number);
        if (!g) blockers.push({ text: "партии нет в реестре сверки", href: "/reconciliation" });
        else {
          for (const c of (g.checks ?? []).filter((x) => !x.ok && !/ТЗ-приложения|Остаток по документам/.test(x.label))) blockers.push({ text: `в реестре сверки не сошлось: ${c.label}`, href: `/reconciliation#${encodeURIComponent(g.id)}` });
        }
        const st = stampOf(b.verifiedAt, b.verifiedBy, userId, names);
        rows.push({
          key: `batch:${b.id}`, kind: "batch", id: b.id,
          title: bp.panel.title, sub: bp.panel.subtitle, href, group: `Партия ${b.number}`, year: b.year ?? bp.year,
          amountText: pay.state === "NOBASE" ? null : pay.totalText,
          verified: !!b.verifiedAt, auto: !!b.verifiedAt && st.auto, stampText: b.verifiedAt ? st.text : null, note: b.verifyNote,
          ready: blockers.length === 0, blockers, edit: null, registryFact: null,
          members: live.map((o) => `${o.workOrderNumber ?? o.number}${orderRows.get(o.id)?.verified ? " ✓" : ""}`),
        });
        extra.batchNumber.set(b.id, b.number);
      }
    }
  }
  return { rows, extra };
}

export type VerifyFlag = { verified: boolean; auto: boolean };
export type VerifyFlags = {
  /** По видам: сколько строк и сколько подтверждено (дёшево, без расчёта блокеров). */
  counts: Record<VerifyKind, { total: number; verified: number; auto: number }>;
  purchaseByNumber: Map<string, VerifyFlag>;
  batchByNumber: Map<number, VerifyFlag>;
  orderById: Map<string, VerifyFlag>;
  /** Суммы оплат поставщику (COMPLETED), ₽: подтверждено / ждёт проверки / из ждущих — без платёжки (флаг «подтверждена» снят). */
  paid: { verified: number; waiting: number; noProof: number };
};

/** Лёгкая сводка «подтверждено / ждёт» для реестра сверки, «Что не заведено», Сводки и подсказки долга. */
export async function loadVerifyFlags(db: Db, orgId: string, year?: string): Promise<VerifyFlags> {
  const [purchases, batches, orders, pays, prodPays] = await Promise.all([
    db.purchase.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" } }, select: { number: true, orderDate: true, verifiedAt: true, verifiedBy: true } }),
    db.productionBatch.findMany({ where: { organizationId: orgId }, select: { number: true, year: true, verifiedAt: true, verifiedBy: true, orders: { select: { status: true } } } }),
    db.productionOrder.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" } }, select: { id: true, verifiedAt: true, verifiedBy: true, workOrderDate: true, endDate: true, startDate: true, batch: { select: { year: true } } } }),
    db.payment.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" } }, select: { amount: true, status: true, paidAt: true, confirmed: true, confirmedAt: true, confirmedBy: true } }),
    db.productionPayment.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" } }, select: { amount: true, paidAt: true, confirmed: true, confirmedAt: true, confirmedBy: true } }),
  ]);
  const y = year && year !== "all" ? Number(year) : null;
  const counts: VerifyFlags["counts"] = {
    payment: { total: 0, verified: 0, auto: 0 }, prodPayment: { total: 0, verified: 0, auto: 0 }, purchase: { total: 0, verified: 0, auto: 0 }, order: { total: 0, verified: 0, auto: 0 }, batch: { total: 0, verified: 0, auto: 0 },
  };
  const add = (k: VerifyKind, yr: number | null | undefined, ok: boolean, by: string | null) => {
    if (y != null && yr !== y) return;
    counts[k].total++;
    if (ok) {
      counts[k].verified++;
      if (by?.startsWith("auto:")) counts[k].auto++;
    }
  };
  const purchaseByNumber = new Map<string, VerifyFlag>();
  for (const p of purchases) {
    add("purchase", p.orderDate.getUTCFullYear(), !!p.verifiedAt, p.verifiedBy);
    purchaseByNumber.set(p.number, { verified: !!p.verifiedAt, auto: !!p.verifiedBy?.startsWith("auto:") });
  }
  const batchByNumber = new Map<number, VerifyFlag>();
  for (const b of batches) {
    if (!b.orders.some((o) => o.status !== "CANCELLED")) continue;
    add("batch", b.year, !!b.verifiedAt, b.verifiedBy);
    batchByNumber.set(b.number, { verified: !!b.verifiedAt, auto: !!b.verifiedBy?.startsWith("auto:") });
  }
  const orderById = new Map<string, VerifyFlag>();
  for (const o of orders) {
    const d = o.workOrderDate ?? o.endDate ?? o.startDate;
    add("order", d ? d.getUTCFullYear() : (o.batch?.year ?? null), !!o.verifiedAt, o.verifiedBy);
    orderById.set(o.id, { verified: !!o.verifiedAt, auto: !!o.verifiedBy?.startsWith("auto:") });
  }
  const paid = { verified: 0, waiting: 0, noProof: 0 };
  for (const p of pays) {
    const ok = p.confirmed && !!p.confirmedAt;
    if (isCountedPayment(p.amount)) add("payment", p.paidAt.getUTCFullYear(), ok, p.confirmedBy);
    if (p.status !== "COMPLETED" || (y != null && p.paidAt.getUTCFullYear() !== y)) continue;
    const a = Number(p.amount);
    if (ok) paid.verified += a;
    else {
      paid.waiting += a;
      if (!p.confirmed) paid.noProof += a;
    }
  }
  for (const p of prodPays) if (isCountedPayment(p.amount)) add("prodPayment", p.paidAt.getUTCFullYear(), p.confirmed && !!p.confirmedAt, p.confirmedBy);
  return { counts, purchaseByNumber, batchByNumber, orderById, paid };
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

export type VerifyCounts = { total: number; verified: number; waiting: number; ready: number; auto: number };
/** Оплата с суммой больше нуля — единственные оплаты, которые считаются «ждут документа или проверки» (и в реестре оплат, и в «Подтвердить»). */
export const isCountedPayment = (amount: number | string | { toString(): string }) => Number(amount.toString()) > 0;

export function countRows(allRows: VerifyRow[]): VerifyCounts {
  const rows = allRows.filter((r) => !r.zero);
  const verified = rows.filter((r) => r.verified).length;
  const waiting = rows.length - verified;
  return { total: rows.length, verified, waiting, ready: rows.filter((r) => !r.verified && r.ready).length, auto: rows.filter((r) => r.verified && r.auto).length };
}

// ====================================================================================================== ЗАПИСЬ

/** Подтвердить строку. Вопреки замечаниям — только с примечанием. Возвращает ошибку или null. */
export async function applyVerify(
  db: Db,
  orgId: string,
  kind: VerifyKind,
  id: string,
  userId: string,
  readiness: Readiness,
  note: string | null,
  by: string = userId,
): Promise<string | null> {
  const n = note?.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 500) || null;
  if (!readiness.ready && !n) return `Есть замечания (${readiness.blockers.length}): подтвердить можно только с примечанием — напишите, почему подтверждаете вопреки им.`;
  const override = !readiness.ready;
  const stamp = { verifiedAt: new Date(), verifiedBy: by, verifyNote: override ? `Вопреки замечаниям: ${n}` : n };
  if (kind === "purchase") {
    const r = await db.purchase.updateMany({ where: { id, organizationId: orgId }, data: stamp });
    return r.count ? null : "Закупка не найдена";
  }
  if (kind === "order") {
    const r = await db.productionOrder.updateMany({ where: { id, organizationId: orgId }, data: stamp });
    return r.count ? null : "ТЗ не найдено";
  }
  if (kind === "batch") {
    const r = await db.productionBatch.updateMany({ where: { id, organizationId: orgId }, data: stamp });
    return r.count ? null : "Партия не найдена";
  }
  // оплаты: confirmed = true (владелец подтвердил), confirmedAt/By; примечание — в заметку оплаты.
  const tail = override ? `\n[${formatDate(new Date())}] Подтверждено вручную вопреки замечаниям: ${n}` : "";
  if (kind === "payment") {
    const p = await db.payment.findFirst({ where: { id, organizationId: orgId }, select: { notes: true } });
    if (!p) return "Оплата не найдена";
    await db.payment.update({ where: { id }, data: { confirmed: true, confirmedAt: stamp.verifiedAt, confirmedBy: by, ...(tail ? { notes: `${p.notes ?? ""}${tail}`.slice(0, 2000) } : {}) } });
    return null;
  }
  const p = await db.productionPayment.findFirst({ where: { id, organizationId: orgId }, select: { notes: true } });
  if (!p) return "Оплата не найдена";
  await db.productionPayment.update({ where: { id }, data: { confirmed: true, confirmedAt: stamp.verifiedAt, confirmedBy: by, ...(tail ? { notes: `${p.notes ?? ""}${tail}`.slice(0, 2000) } : {}) } });
  return null;
}

/** Снять подтверждение (флаг «оплата подтверждена» у платежей не трогаем — снимается только отметка человека). */
export async function applyUnverify(db: Db, orgId: string, kind: VerifyKind, id: string): Promise<string | null> {
  const clear = { verifiedAt: null, verifiedBy: null, verifyNote: null };
  if (kind === "purchase") return (await db.purchase.updateMany({ where: { id, organizationId: orgId }, data: clear })).count ? null : "Закупка не найдена";
  if (kind === "order") return (await db.productionOrder.updateMany({ where: { id, organizationId: orgId }, data: clear })).count ? null : "ТЗ не найдено";
  if (kind === "batch") return (await db.productionBatch.updateMany({ where: { id, organizationId: orgId }, data: clear })).count ? null : "Партия не найдена";
  if (kind === "payment") return (await db.payment.updateMany({ where: { id, organizationId: orgId }, data: { confirmedAt: null, confirmedBy: null } })).count ? null : "Оплата не найдена";
  return (await db.productionPayment.updateMany({ where: { id, organizationId: orgId }, data: { confirmedAt: null, confirmedBy: null } })).count ? null : "Оплата не найдена";
}

export type ResetScope = {
  purchaseIds?: (string | null | undefined)[];
  /** Название аукциона (Purchase.auctionSession, первая строка): сбрасываются все закупки аукциона. */
  auctions?: (string | null | undefined)[];
  orderIds?: (string | null | undefined)[];
  batchIds?: (string | null | undefined)[];
  paymentIds?: (string | null | undefined)[];
  prodPaymentIds?: (string | null | undefined)[];
};
const ids = (a?: (string | null | undefined)[]) => [...new Set((a ?? []).filter((x): x is string => !!x))];

/**
 * Любая правка суммы, документа, даты или лотов сбрасывает подтверждение связанных строк (вызывается из server actions ПОСЛЕ правки).
 * Сброс цепочкой: платёж → его закупка и все закупки аукциона → ; ТЗ → его партия; оплата партии → её ТЗ и партия.
 * Меняет только уже подтверждённые строки; возвращает, сколько строк сброшено. Ошибки не пробрасываются — правка важнее отметки.
 */
export async function resetVerification(db: Db, orgId: string, s: ResetScope): Promise<number> {
  try {
    let n = 0;
    const clear = { verifiedAt: null, verifiedBy: null, verifyNote: null };
    const purchaseIds = new Set(ids(s.purchaseIds));
    const auctions = new Set(ids(s.auctions).map((a) => auctionName(a)).filter((x): x is string => !!x));
    const orderIds = new Set(ids(s.orderIds));
    const batchIds = new Set(ids(s.batchIds));

    const payIds = ids(s.paymentIds);
    if (payIds.length) {
      const pays = await db.payment.findMany({ where: { organizationId: orgId, id: { in: payIds } }, select: { id: true, purchaseId: true, auctionSession: true, confirmedAt: true } });
      for (const p of pays) {
        if (p.purchaseId) purchaseIds.add(p.purchaseId);
        const a = auctionName(p.auctionSession);
        if (a) auctions.add(a);
        if (p.confirmedAt) {
          n += (await db.payment.updateMany({ where: { id: p.id, confirmedAt: { not: null } }, data: { confirmedAt: null, confirmedBy: null } })).count;
        }
      }
    }
    const ppIds = ids(s.prodPaymentIds);
    if (ppIds.length) {
      const pays = await db.productionPayment.findMany({ where: { organizationId: orgId, id: { in: ppIds } }, select: { id: true, orders: { select: { productionOrderId: true, productionOrder: { select: { batchId: true } } } } } });
      for (const p of pays) {
        for (const l of p.orders) {
          orderIds.add(l.productionOrderId);
          if (l.productionOrder.batchId) batchIds.add(l.productionOrder.batchId);
        }
        n += (await db.productionPayment.updateMany({ where: { id: p.id, confirmedAt: { not: null } }, data: { confirmedAt: null, confirmedBy: null } })).count;
      }
    }
    // закупка → аукцион → все закупки аукциона
    if (purchaseIds.size) {
      const ps = await db.purchase.findMany({ where: { organizationId: orgId, id: { in: [...purchaseIds] } }, select: { auctionSession: true } });
      for (const p of ps) {
        const a = auctionName(p.auctionSession);
        if (a) auctions.add(a);
      }
    }
    if (auctions.size) {
      const all = await db.purchase.findMany({ where: { organizationId: orgId, auctionSession: { not: null } }, select: { id: true, auctionSession: true } });
      for (const p of all) if (auctions.has(auctionName(p.auctionSession) ?? "")) purchaseIds.add(p.id);
    }
    if (purchaseIds.size) n += (await db.purchase.updateMany({ where: { organizationId: orgId, id: { in: [...purchaseIds] }, verifiedAt: { not: null } }, data: clear })).count;
    // ТЗ → партия
    if (orderIds.size) {
      const os = await db.productionOrder.findMany({ where: { organizationId: orgId, id: { in: [...orderIds] } }, select: { batchId: true } });
      for (const o of os) if (o.batchId) batchIds.add(o.batchId);
      n += (await db.productionOrder.updateMany({ where: { organizationId: orgId, id: { in: [...orderIds] }, verifiedAt: { not: null } }, data: clear })).count;
    }
    if (batchIds.size) n += (await db.productionBatch.updateMany({ where: { organizationId: orgId, id: { in: [...batchIds] }, verifiedAt: { not: null } }, data: clear })).count;
    return n;
  } catch (e) {
    console.error("resetVerification:", e);
    return 0;
  }
}

// ---- короткие вызовы из server actions: организация определяется по самой строке (ID уникальны), сброс — по цепочке -----

/** Закупка изменена (сумма, лоты, расходы, оплата, документ, дата): сбросить её и все закупки её аукциона. */
export async function resetByPurchase(purchaseId: string | null | undefined): Promise<void> {
  if (!purchaseId) return;
  const p = await appPrisma.purchase.findUnique({ where: { id: purchaseId }, select: { organizationId: true } });
  if (p) await resetVerification(appPrisma, p.organizationId, { purchaseIds: [purchaseId] });
}
/** Оплата поставщику изменена/удалена/добавлена (по аукциону или закупке). */
export async function resetByAuction(orgId: string, auction: string | null | undefined, purchaseId?: string | null, paymentId?: string | null): Promise<void> {
  await resetVerification(appPrisma, orgId, { auctions: [auction], purchaseIds: [purchaseId], paymentIds: [paymentId] });
}
/** ТЗ изменено (количество, цена, материалы, дата, документ): сбросить его и его партию. */
export async function resetByOrder(orderId: string | null | undefined): Promise<void> {
  if (!orderId) return;
  const o = await appPrisma.productionOrder.findUnique({ where: { id: orderId }, select: { organizationId: true } });
  if (o) await resetVerification(appPrisma, o.organizationId, { orderIds: [orderId] });
}
/** Оплата производства изменена: сбросить её, связанные ТЗ и партии. */
export async function resetByProdPayment(orgId: string, paymentId: string | null | undefined, orderIds?: (string | null | undefined)[]): Promise<void> {
  await resetVerification(appPrisma, orgId, { prodPaymentIds: [paymentId], orderIds });
}
/** Партия изменена (расчёт, счёт): сбросить партию. */
export async function resetByBatch(orgId: string, batchId: string | null | undefined): Promise<void> {
  await resetVerification(appPrisma, orgId, { batchIds: [batchId] });
}
/** Документ (DriveDocument / PurchaseDocument) приложен, заменён или удалён: сбросить то, к чему он привязан. */
export async function resetByDriveDoc(doc: { purchaseId?: string | null; lotId?: string | null; productionOrderId?: string | null; productionBatchId?: string | null; paymentId?: string | null; productionPaymentId?: string | null }): Promise<void> {
  if (doc.purchaseId) await resetByPurchase(doc.purchaseId);
  if (doc.lotId) {
    const l = await appPrisma.rawMaterialLot.findUnique({ where: { id: doc.lotId }, select: { purchaseId: true } });
    if (l?.purchaseId) await resetByPurchase(l.purchaseId);
  }
  if (doc.productionOrderId) await resetByOrder(doc.productionOrderId);
  if (doc.productionBatchId) {
    const b = await appPrisma.productionBatch.findUnique({ where: { id: doc.productionBatchId }, select: { organizationId: true } });
    if (b) await resetVerification(appPrisma, b.organizationId, { batchIds: [doc.productionBatchId] });
  }
  if (doc.paymentId) {
    const p = await appPrisma.payment.findUnique({ where: { id: doc.paymentId }, select: { organizationId: true } });
    if (p) await resetVerification(appPrisma, p.organizationId, { paymentIds: [doc.paymentId] });
  }
  if (doc.productionPaymentId) {
    const p = await appPrisma.productionPayment.findUnique({ where: { id: doc.productionPaymentId }, select: { organizationId: true } });
    if (p) await resetVerification(appPrisma, p.organizationId, { prodPaymentIds: [doc.productionPaymentId] });
  }
}
/** Документ закупки (PurchaseDocument): к закупке или ко всему аукциону (batch). */
export async function resetByPurchaseDoc(orgId: string, doc: { purchaseId?: string | null; batch?: string | null }): Promise<void> {
  await resetVerification(appPrisma, orgId, { purchaseIds: [doc.purchaseId], auctions: [doc.batch] });
}

/** Ссылка на документы строки — для подписей. */
export const docTypeLabel = (t: keyof typeof DRIVE_DOC_TYPE_LABELS) => DRIVE_DOC_TYPE_LABELS[t];
