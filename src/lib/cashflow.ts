// Cashflow: оплаты по статьям и месяцам. Чистая агрегация поверх loadPaymentsOverview (единый источник «Оплачено всего»,
// только COMPLETED); своей выборки и формул оплат здесь нет.
import type { OverviewRow } from "@/lib/payments-overview";
import type { SalesAggLine } from "@/lib/sales-receipts-core";

export type CashflowPeriod = "2025" | "2026" | "all";
export const CASHFLOW_YEARS = [2025, 2026] as const;

export const CASHFLOW_ARTICLES = [
  { key: "furAuction", label: "Мех: аукционы", hint: "Оплата партий меха по аукционам (SAGA, FH и др.) поставщику." },
  { key: "furPurchase", label: "Мех: закупка у поставщика", hint: "Оплата закупок меха напрямую и авансы поставщику без привязки к аукциону." },
  { key: "lining", label: "Подкладка", hint: "Оплата подкладочных тканей (доля подкладки в оплаченных закупках)." },
  { key: "services", label: "Услуги по УПД", hint: "Закупки без позиций сырья: услуги и аксессуары по УПД (состав — в подсказке раздела)." },
  { key: "work", label: "Работа подрядчику", hint: "Оплата пошива подрядчику (Веллмех) по ТЗ, включая аванс, не разнесённый на ТЗ." },
  { key: "hides", label: "Шкуры подрядчика в счёте за пошив", hint: "Часть счёта подрядчика, отнесённая к шкурам, которые поставил подрядчик." },
] as const;
export type ArticleKey = (typeof CASHFLOW_ARTICLES)[number]["key"];
export type PayType = "ADVANCE" | "PARTIAL" | "FINAL" | "OTHER";
export const TYPE_LABEL: Record<PayType, string> = { ADVANCE: "Аванс", PARTIAL: "Доплата", FINAL: "Окончательный расчёт", OTHER: "Прочее / без вида" };
const TYPE_ORDER: PayType[] = ["ADVANCE", "PARTIAL", "FINAL", "OTHER"];

export type CashflowData = {
  period: CashflowPeriod;
  /** Месяцы периода: «2025-01» … */
  months: string[];
  articles: { key: ArticleKey; label: string; hint: string; byMonth: number[]; total: number; types: { type: PayType; label: string; byMonth: number[]; total: number }[] }[];
  monthTotals: number[];
  cumulative: number[];
  total: number;
  /** Оплаты вне 2025–2026 (в таблицу не попадают; нужны, чтобы Σ сходилась с «Оплачено всего»). */
  outside: number;
};

export function parsePeriod(v: string | string[] | undefined): CashflowPeriod {
  return v === "2025" || v === "2026" ? v : "all";
}

export function monthsOf(period: CashflowPeriod): string[] {
  const ys = period === "all" ? CASHFLOW_YEARS : [Number(period)];
  return ys.flatMap((y) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`));
}

/** Статья строки: у сырья мех (аукцион / закупка) / подкладка / услуги, у производства — работа и шкуры (в OverviewRow шкуры лежат в поле fur). */
function split(r: OverviewRow): Record<ArticleKey, number> {
  const z = { furAuction: 0, furPurchase: 0, lining: 0, services: 0, work: 0, hides: 0 };
  if (r.kind === "raw") return { ...z, [r.edit === "auction" ? "furAuction" : "furPurchase"]: r.fur, lining: r.lining, services: r.services };
  return { ...z, work: r.work, hides: r.hides };
}

/** Доля НДС в сумме платежа для строки: «Без НДС» = сумма × (1 − доля). Строки без данных об НДС в карту не попадают. */
export type RowVatShare = Map<string, number>;

/**
 * Правило «Без НДС» (документированное): НДС платежа по сырью = Σ по закупкам, на которые разнесён платёж, часть × доля НДС закупки
 * (ставка позиций: 20% или 22%, взвешено по сумме позиций; у закупок-услуг без позиций — ставка расходов). Платёж без привязки к закупке и
 * оплата производства (работа, шкуры в счёте подрядчика) — НДС в данных нет, суммы остаются как есть и считаются в `unknown`.
 */
export function vatShares(rows: OverviewRow[], purchaseVat: Map<string, number>): { share: RowVatShare; vat: number; unknown: number } {
  const share: RowVatShare = new Map();
  let vat = 0, unknown = 0;
  for (const r of rows) {
    let v = 0, known = 0;
    if (r.kind === "raw") {
      for (const part of r.parts) {
        const id = part.href?.startsWith("/purchases/") ? part.href.slice("/purchases/".length) : null;
        const f = id ? purchaseVat.get(id) : undefined;
        if (f !== undefined) { v += part.amount * f; known += part.amount; }
      }
    }
    unknown += r.amount - known;
    if (r.amount !== 0) share.set(r.id, v / r.amount);
    vat += v;
  }
  return { share, vat, unknown };
}

export function buildCashflow(rows: OverviewRow[], period: CashflowPeriod, vatShare?: RowVatShare): CashflowData {
  const months = monthsOf(period);
  const idx = new Map(months.map((m, i) => [m, i]));
  const zeros = () => months.map(() => 0);
  const articles = CASHFLOW_ARTICLES.map((a) => ({
    key: a.key, label: a.label as string, hint: a.hint as string, byMonth: zeros(), total: 0,
    types: TYPE_ORDER.map((t) => ({ type: t, label: TYPE_LABEL[t], byMonth: zeros(), total: 0 })),
  }));
  let outside = 0;
  for (const r of rows) {
    const i = idx.get(r.iso.slice(0, 7));
    if (i === undefined) {
      if (period === "all") outside += r.amount * (vatShare ? 1 - (vatShare.get(r.id) ?? 0) : 1);
      continue;
    }
    const k = vatShare ? 1 - (vatShare.get(r.id) ?? 0) : 1;
    const s0 = split(r);
    const s = { furAuction: s0.furAuction * k, furPurchase: s0.furPurchase * k, lining: s0.lining * k, services: s0.services * k, work: s0.work * k, hides: s0.hides * k };
    for (const a of articles) {
      a.byMonth[i] += s[a.key];
      a.types.find((t) => t.type === r.type)!.byMonth[i] += s[a.key];
    }
  }
  for (const a of articles) {
    a.total = a.byMonth.reduce((x, y) => x + y, 0);
    for (const t of a.types) t.total = t.byMonth.reduce((x, y) => x + y, 0);
    a.types = a.types.filter((t) => Math.abs(t.total) > 0.005);
  }
  const keep = articles.filter((a) => Math.abs(a.total) > 0.005);
  const monthTotals = months.map((_, i) => keep.reduce((x, a) => x + a.byMonth[i], 0));
  let run = 0;
  const cumulative = monthTotals.map((v) => (run += v));
  return { period, months, articles: keep, monthTotals, cumulative, total: run, outside };
}

// ───────────────────────── Поступления и продажи (из выгрузки «поступления и продажи»), метрики для топ-менеджмента

export type SalesMonthly = {
  /** Есть ли вообще загруженные строки (иначе раздел показывает «нет данных о продажах»). */
  available: boolean;
  /** Поступило единиц (Delivery PCS) и продано единиц (чистых, возврат минус) по месяцам. */
  recPcs: number[];
  salePcs: number[];
  /** Выручка (чистые розничные продажи после скидки) с НДС и без НДС; скидка с НДС. */
  revIncl: number[];
  revEx: number[];
  discIncl: number[];
};

export function aggregateSales(lines: SalesAggLine[], months: string[]): SalesMonthly {
  const idx = new Map(months.map((m, i) => [m, i]));
  const z = () => months.map(() => 0);
  const o: SalesMonthly = { available: lines.length > 0, recPcs: z(), salePcs: z(), revIncl: z(), revEx: z(), discIncl: z() };
  for (const l of lines) {
    const i = idx.get(l.iso.slice(0, 7));
    if (i === undefined) continue;
    if (l.kind === "RECEIPT") o.recPcs[i] += l.pcs;
    else { o.salePcs[i] += l.pcs; o.revIncl[i] += l.retailRub; o.revEx[i] += l.retailRubExVat; o.discIncl[i] += l.discountRub; }
  }
  return o;
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const cum = (a: number[]) => { let r = 0; return a.map((v) => (r += v)); };

export type Headline = {
  spent: number; received: number; net: number; cumNet: number;
  unitsReceived: number; unitsSold: number;
  /** Среднее за месяц: работа подрядчику / число месяцев от первой до последней оплаты в периоде. */
  workPerMonth: number | null; workMonths: number;
  workTotal: number;
  /** Работа (оплачено) / единиц получено за период. */
  workPerUnit: number | null;
  /** Выручка / проданные единицы. */
  avgPrice: number | null;
  /** Скидка в % от выручки до скидки. */
  discountPct: number | null;
};

/** Ключевые показатели периода. `revenue` — выручка выбранного режима (с НДС / без НДС). Единый источник для плиток, таблицы и тестов. */
export function headline(d: CashflowData, s: SalesMonthly, revenue: number[]): Headline {
  const spent = d.total;
  const received = sum(revenue);
  const work = d.articles.find((a) => a.key === "work");
  const workTotal = work?.total ?? 0;
  const active = d.monthTotals.map((v, i) => (Math.abs(v) > 0.005 ? i : -1)).filter((i) => i >= 0);
  const workMonths = active.length ? active[active.length - 1] - active[0] + 1 : 0;
  const unitsReceived = sum(s.recPcs), unitsSold = sum(s.salePcs);
  const disc = sum(s.discIncl), revIncl = sum(s.revIncl);
  return {
    spent, received, net: received - spent, cumNet: received - spent,
    unitsReceived, unitsSold, workTotal, workMonths,
    workPerMonth: workMonths && Math.abs(workTotal) > 0.005 ? workTotal / workMonths : null,
    workPerUnit: s.available && unitsReceived > 0 && Math.abs(workTotal) > 0.005 ? workTotal / unitsReceived : null,
    avgPrice: s.available && unitsSold > 0 ? received / unitsSold : null,
    discountPct: s.available && revIncl + disc > 0 ? (disc / (revIncl + disc)) * 100 : null,
  };
}

/** Ряды для графиков и таблицы: помесячно и накопительно. */
export function seriesOf(d: CashflowData, s: SalesMonthly, revenue: number[]) {
  const spend = d.monthTotals;
  const net = revenue.map((v, i) => v - spend[i]);
  const work = d.articles.find((a) => a.key === "work")?.byMonth ?? spend.map(() => 0);
  const cumWork = cum(work), cumRec = cum(s.recPcs);
  return {
    spend, revenue, net, cumSpend: cum(spend), cumRevenue: cum(revenue), cumNet: cum(net), work,
    /** Работа на единицу нарастающим итогом: накопленная оплата работы / накопленные единицы (null, пока единиц не было). */
    cumWorkPerUnit: cumWork.map((v, i) => (cumRec[i] > 0 && s.available ? v / cumRec[i] : null)) as (number | null)[],
  };
}

/** Срез ряда «all» по индексам месяцев `keep`: суммы пересчитаны, накопительно — внутри среза. */
export function sliceData(all: CashflowData, keep: number[], period: CashflowPeriod = all.period): CashflowData {
  const months = keep.map((i) => all.months[i]);
  const articles = all.articles.map((a) => ({ ...a, byMonth: keep.map((i) => a.byMonth[i]), total: keep.reduce((t, i) => t + a.byMonth[i], 0), types: a.types.map((t) => ({ ...t, byMonth: keep.map((i) => t.byMonth[i]), total: keep.reduce((x, i) => x + t.byMonth[i], 0) })) }))
    .filter((a) => Math.abs(a.total) > 0.005).map((a) => ({ ...a, types: a.types.filter((t) => Math.abs(t.total) > 0.005) }));
  const monthTotals = keep.map((i) => all.monthTotals[i]);
  return { period, months, articles, monthTotals, cumulative: cum(monthTotals), total: sum(monthTotals), outside: 0 };
}

export function sliceSales(s: SalesMonthly, keep: number[]): SalesMonthly {
  const f = (a: number[]) => keep.map((i) => a[i]);
  return { available: s.available, recPcs: f(s.recPcs), salePcs: f(s.salePcs), revIncl: f(s.revIncl), revEx: f(s.revEx), discIncl: f(s.discIncl) };
}

/** Месяцы, которые показываем: год периода, от первого до последнего месяца, где есть хоть какие-то траты, деньги или единицы. */
export function visibleMonths(all: CashflowData, s: SalesMonthly, period: CashflowPeriod): number[] {
  const inP = all.months.map((m, i) => (period === "all" || m.startsWith(period) ? i : -1)).filter((i) => i >= 0);
  const has = (i: number) => Math.abs(all.monthTotals[i]) > 0.005 || s.recPcs[i] !== 0 || s.salePcs[i] !== 0 || Math.abs(s.revIncl[i]) > 0.005;
  const act = inP.filter(has);
  if (!act.length) return inP;
  return inP.filter((i) => i >= act[0] && i <= act[act.length - 1]);
}

/** Товар: приход, продажи, остаток (накопленный приход − накопленные продажи), sell-through и покрытие в месяцах. Остаток считается с начала данных. */
export function stockSeries(s: SalesMonthly) {
  const cumRec = cum(s.recPcs), cumSale = cum(s.salePcs);
  return { cumRec, cumSale, stock: cumRec.map((v, i) => v - cumSale[i]) };
}

export function goodsHeadline(allSales: SalesMonthly, allMonths: string[], period: CashflowPeriod) {
  const st = stockSeries(allSales);
  const keep = allMonths.map((m, i) => (period === "all" || m.startsWith(period) ? i : -1)).filter((i) => i >= 0);
  const last = keep[keep.length - 1] ?? -1;
  const recv = keep.reduce((t, i) => t + allSales.recPcs[i], 0), sold = keep.reduce((t, i) => t + allSales.salePcs[i], 0);
  const sellIdx = keep.filter((i) => allSales.salePcs[i] !== 0);
  const span = sellIdx.length ? sellIdx[sellIdx.length - 1] - sellIdx[0] + 1 : 0;
  const stock = last >= 0 ? st.stock[last] : 0;
  const perMonth = span ? sold / span : 0;
  return {
    received: recv, sold, stock,
    /** Продано / получено накопленно с начала данных до конца периода. */
    sellThrough: last >= 0 && st.cumRec[last] > 0 ? (st.cumSale[last] / st.cumRec[last]) * 100 : null,
    /** Остаток / средние продажи в месяц (от первого до последнего месяца продаж периода). */
    coverMonths: perMonth > 0 ? stock / perMonth : null,
  };
}
