// Статус оплат для подрядчика (Веллмеха) — чистая часть (без базы, проверяется в scripts/test-security.ts).
//
// Сумма «к оплате» по сырью — это сумма СЧЁТА Веллмеха (supplier-invoice-due.ts: «К оплате…» из принятого расчёта, а если такого
// столбца нет — весь расчёт, как в УПД), а не вся себестоимость закупки: выделка, перевозка, брокерские и комиссии третьим лицам
// Веллмеху не платятся и в статус не входят. Нет суммы счёта — «Нет счёта» (не «Не оплачено»). Переплата и недоплата до 1 ₽ — «Оплачено».
//
// Правило: подрядчик видит «Оплачено / Частично / Не оплачено» ТОЛЬКО по своим счетам, аукционам и ТЗ и ТОЛЬКО по оплатам,
// которые заказчик подтвердил у себя: проведена (COMPLETED) + флаг «подтверждена» + отметка подтверждения (confirmedAt).
// Черновые, плановые (PENDING), отменённые и ещё не подтверждённые оплаты не считаются оплаченными. Остатки и долги заказчика,
// неразнесённые авансы и оплаты других подрядчиков сюда не попадают вообще.

export type PayState = "PAID" | "PARTIAL" | "UNPAID" | "NOINVOICE";
export const PAY_STATE_LABEL: Record<PayState, string> = { PAID: "Оплачено", PARTIAL: "Частично", UNPAID: "Не оплачено", NOINVOICE: "Нет счёта" };
/** Вид оплаты для подписи: аванс / доплата / расчёт. */
export const PAY_KIND_LABEL: Record<string, string> = { ADVANCE: "Аванс", PARTIAL: "Доплата", FINAL: "Расчёт", OTHER: "Оплата" };

/** Допуск «оплачено полностью» — как STATUS_EPS в auction-payments (1 ₽). */
export const PAY_DONE_EPS = 1;

export type PayLine = { kind: string; amount: number; paidAt: Date };
export type PayInfo = { state: PayState; paid: number; date: Date | null; lines: PayLine[] };

type Flags = { status: string; confirmed: boolean; confirmedAt: Date | null };
/** Оплата видна подрядчику только когда она проведена и подтверждена у заказчика. */
export const isConfirmedForSupplier = (p: Flags): boolean => p.status === "COMPLETED" && p.confirmed === true && p.confirmedAt != null;

/** Условие выборки Prisma для тех же оплат (Payment и ProductionPayment) — одно место. */
export const CONFIRMED_WHERE = { status: "COMPLETED", confirmed: true, confirmedAt: { not: null } } as const;

/**
 * Статус по сумме к оплате и подтверждённым оплатам. totalKnown = false (цена работы у ТЗ не задана): «Оплачено»
 * сказать нельзя — при любой оплате «Частично».
 */
export function payInfo(total: number, lines: PayLine[], totalKnown = true): PayInfo {
  const paid = Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;
  const date = lines.reduce<Date | null>((a, l) => (!a || l.paidAt > a ? l.paidAt : a), null);
  const sorted = [...lines].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
  if (paid <= 0.005) return { state: "UNPAID", paid: 0, date: null, lines: [] };
  const done = totalKnown && total - paid < PAY_DONE_EPS;
  return { state: done ? "PAID" : "PARTIAL", paid, date, lines: sorted };
}

/**
 * Статус сырья по сумме СЧЁТА Веллмеха. due = null (или не больше нуля) — суммы счёта нет: «Нет счёта», оплаты (если есть) всё равно
 * показываются. Дальше как payInfo: допуск 1 ₽, переплата — «Оплачено».
 */
export function rawPayInfo(due: number | null, lines: PayLine[]): PayInfo {
  if (due == null || !(due > 0.005)) {
    const base = payInfo(0, lines, false);
    return { ...base, state: "NOINVOICE" };
  }
  return payInfo(due, lines);
}

/** Общий пул оплат аукциона делится между его счетами по порядку: каждый счёт добирает свой остаток. Возвращает долю пула на каждый счёт. */
export function poolShares(purchases: { id: string; need: number }[], pool: number): Map<string, number> {
  const out = new Map<string, number>();
  let left = pool;
  for (const p of purchases) {
    const take = Math.max(0, Math.min(left, p.need));
    out.set(p.id, take);
    left -= take;
  }
  return out;
}

/** Нормализация номера счёта для сопоставления («№ 083» = «83»), как в supplier-payment-docs-core. */
export const normInvoice = (s: string | null | undefined): string => (s ?? "").toLowerCase().replace(/[\s№#]/g, "").replace(/^0+(?=\d)/, "");
