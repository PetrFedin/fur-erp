// Cashflow: оплаты по статьям и месяцам. Чистая агрегация поверх loadPaymentsOverview (единый источник «Оплачено всего»,
// только COMPLETED); своей выборки и формул оплат здесь нет.
import type { OverviewRow } from "@/lib/payments-overview";
import type { CatClass, SalesAggLine } from "@/lib/sales-receipts-core";

export type CashflowPeriod = "all" | (string & {});
export const CASHFLOW_FIRST_YEAR = 2025;
/** Годы ряда: с 2025 до текущего (минимум 2026), чтобы каждый новый год/месяц появлялся сам и платежи не уходили в «вне периода». */
export function cashflowYears(nowYear: number = new Date().getUTCFullYear()): number[] {
  const last = Math.max(2026, nowYear);
  return Array.from({ length: last - CASHFLOW_FIRST_YEAR + 1 }, (_, i) => CASHFLOW_FIRST_YEAR + i);
}
/** Текущий месяц «YYYY-MM» по Москве (граница месяца не уезжает от UTC). */
export function currentMonthMsk(now: Date = new Date()): string {
  const m = new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 7);
  return m;
}

export const CASHFLOW_ARTICLES = [
  { key: "furAuction", label: "Мех: аукционы", hint: "Оплата партий меха по аукционам (SAGA, FH и др.) поставщику." },
  { key: "furPurchase", label: "Мех: закупка у поставщика", hint: "Оплата закупок меха напрямую, авансы поставщику без привязки к аукциону и шкуры подрядчика в его счёте (НДС 22 % по сырью): подрядчик здесь поставщик меха, не аукцион." },
  { key: "lining", label: "Подкладка", hint: "Оплата подкладочных тканей (доля подкладки в оплаченных закупках)." },
  { key: "services", label: "Услуги по УПД", hint: "Закупки без позиций сырья: услуги и аксессуары по УПД (состав — в подсказке раздела)." },
  { key: "work", label: "Работа подрядчику", hint: "Оплата пошива подрядчику (Веллмех) по ТЗ, включая аванс, не разнесённый на ТЗ." },
  { key: "hides", label: "Доплата подрядчику: НДС 22 % по сырью", hint: "Часть счёта подрядчика, отнесённая к шкурам, которые поставил подрядчик." },
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
  return typeof v === "string" && /^\d{4}$/.test(v) && cashflowYears().includes(Number(v)) ? v : "all";
}

export function monthsOf(period: CashflowPeriod): string[] {
  const ys = period === "all" ? cashflowYears() : [Number(period)];
  return ys.flatMap((y) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`));
}

/** Статья строки: у сырья мех (аукцион / закупка) / подкладка / услуги, у производства — работа и шкуры (в OverviewRow шкуры лежат в поле fur). */
export function split(r: OverviewRow): Record<ArticleKey, number> {
  const z = { furAuction: 0, furPurchase: 0, lining: 0, services: 0, work: 0, hides: 0 };
  if (r.kind === "raw") return { ...z, [(r.auction ?? r.edit === "auction") ? "furAuction" : "furPurchase"]: r.fur, lining: r.lining, services: r.services };
  return { ...z, work: r.work, hides: r.hides };
}

/** Доля НДС в сумме платежа для строки: «Без НДС» = сумма × (1 − доля). Строки без данных об НДС в карту не попадают. */
export type RowVatShare = Map<string, number>;

/**
 * НДС в оплате работы подрядчику (Веллмех, Договор подряда №1605). ДОКУМЕНТЫ (проверено 20.10.2026): каждый счёт Веллмеха на пошив содержит строку «В том числе НДС r%: X», где X = сумма счёта × r / (100 + r),
 * то есть НДС ВХОДИТ в оплачиваемую сумму (счета №170, 209, 235, 239 — 20%; №7, 41, 193, 247 и все остальные 2026 г. — 22%; в реестре сверки НДС указан у 26 из 29 счетов, у остальных — по дате счёта).
 * Ставка — по ДАТЕ СЧЁТА из основания платежа («Счёт №N от дд.мм.гггг»): до 31.12.2025 — 20 %, с 01.01.2026 — 22 % (так во всех счетах, где ставка напечатана). Шкуры подрядчика внутри счёта (счёт №235, №237, №265)
 * облагаются по той же ставке: строка НДС счёта считается от всей суммы счёта. Нет даты счёта в основании — ставка неизвестна (null), сумма остаётся в «НДС нет в данных».
 * Оплата частями (аванс 70 %, доплата 30 %, разнесение по ТЗ) делит НДС пропорционально: НДС части = часть × r / (100 + r).
 */
export function workPaymentVatRate(doc: string | null | undefined): 20 | 22 | null {
  const m = /сч[её]т[^№;·]*№\s*[^\s;·,()]+\s+от\s+(\d{2})\.(\d{2})\.(\d{4})/i.exec(doc ?? "");
  if (!m) return null;
  const year = Number(m[3]);
  return year <= 2025 ? 20 : 22;
}

/**
 * Правило «Без НДС» (документированное): НДС платежа по сырью = Σ по закупкам, на которые разнесён платёж, часть × доля НДС закупки
 * (ставка позиций: 20% или 22%, взвешено по сумме позиций; у закупок-услуг без позиций — ставка расходов). Оплата производства (работа подрядчику и шкуры в его счёте) —
 * НДС по счёту подрядчика (workPaymentVatRate: ставка по дате счёта, НДС включён в сумму). Платёж без привязки к закупке и без счёта в основании — НДС в данных нет, сумма остаётся как есть и идёт в `unknown`.
 */
export function vatShares(rows: OverviewRow[], purchaseVat: Map<string, number>): { share: RowVatShare; vat: number; unknown: number; workVat: number } {
  const share: RowVatShare = new Map();
  let vat = 0, unknown = 0, workVat = 0;
  for (const r of rows) {
    let v = 0, known = 0;
    if (r.kind === "raw") {
      for (const part of r.parts) {
        const id = part.href?.startsWith("/purchases/") ? part.href.slice("/purchases/".length) : null;
        const f = id ? purchaseVat.get(id) : undefined;
        if (f !== undefined) { v += part.amount * f; known += part.amount; }
      }
    } else {
      const rate = workPaymentVatRate(r.doc);
      if (rate !== null) { v = (r.amount * rate) / (100 + rate); known = r.amount; workVat += v; }
    }
    unknown += r.amount - known;
    if (r.amount !== 0) share.set(r.id, v / r.amount);
    vat += v;
  }
  return { share, vat, unknown, workVat };
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
    const s = { furAuction: s0.furAuction * k, furPurchase: (s0.furPurchase + s0.hides) * k, lining: s0.lining * k, services: s0.services * k, work: s0.work * k, hides: 0 };
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
  /** Продано валовое (только положительные строки продаж, шт.), возвраты (шт., положительным числом) и возвраты в рублях с НДС / без НДС (положительным числом). salePcs = grossPcs − returnsPcs. */
  grossPcs: number[];
  returnsPcs: number[];
  returnsRub: number[];
  returnsRubEx: number[];
  /** Выручка (чистые розничные продажи после скидки) с НДС и без НДС; скидка с НДС. */
  revIncl: number[];
  revEx: number[];
  discIncl: number[];
};

export function aggregateSales(lines0: SalesAggLine[], months: string[], cls: CatClass | "all" = "all"): SalesMonthly {
  const lines = cls === "all" ? lines0 : lines0.filter((l) => l.cls === cls);
  const idx = new Map(months.map((m, i) => [m, i]));
  const z = () => months.map(() => 0);
  const o: SalesMonthly = { available: lines0.length > 0, recPcs: z(), salePcs: z(), grossPcs: z(), returnsPcs: z(), returnsRub: z(), returnsRubEx: z(), revIncl: z(), revEx: z(), discIncl: z() };
  for (const l of lines) {
    const i = idx.get(l.iso.slice(0, 7));
    if (i === undefined) continue;
    if (l.kind === "RECEIPT") o.recPcs[i] += l.pcs;
    else {
      if (l.pcs > 0) o.grossPcs[i] += l.pcs;
      else if (l.pcs < 0) { o.returnsPcs[i] += -l.pcs; o.returnsRub[i] += -l.retailRub; o.returnsRubEx[i] += -l.retailRubExVat; }
      o.salePcs[i] += l.pcs; o.revIncl[i] += l.retailRub; o.revEx[i] += l.retailRubExVat; o.discIncl[i] += l.discountRub; }
  }
  return o;
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const cum = (a: number[]) => { let r = 0; return a.map((v) => (r += v)); };

export type Headline = {
  spent: number; received: number; net: number; cumNet: number;
  /** unitsSold — НЕТТО (продано минус возвраты); unitsGross — валовое «продано», unitsReturns — возвраты (шт.). unitsSold = unitsGross − unitsReturns. */
  unitsReceived: number; unitsSold: number; unitsGross: number; unitsReturns: number;
  /** Среднее за месяц: работа подрядчику / число месяцев от первой до последней оплаты в периоде. */
  workPerMonth: number | null; workMonths: number;
  /** Единицы прихода: месяцы с приходом и среднее за такой месяц. */
  recMonths: number; unitsPerMonth: number | null;
  workTotal: number;
  /** Работа (оплачено) / единиц получено за период. */
  workPerUnit: number | null;
  /** Выручка / проданные единицы. */
  avgPrice: number | null;
  /** Скидка в % от выручки до скидки. */
  discountPct: number | null;
};

/** Ключевые показатели периода. `revenue` — выручка выбранного режима (с НДС / без НДС). Единый источник для плиток, таблицы и тестов. */
/** base: «pay» — месяцы с оплатой работы (прежнее правило), «all» — все месяцы периода, «active» — месяцы с оплатой работы ИЛИ с приходом (поставкой). */
export type AvgBase = "pay" | "all" | "active";
export function headline(d: CashflowData, s: SalesMonthly, revenue: number[], workSeries?: number[], base: AvgBase = "pay", mask?: boolean[]): Headline {
  const spent = d.total;
  const received = sum(revenue);
  const work = d.articles.find((a) => a.key === "work");
  const ws = workSeries ?? work?.byMonth ?? [];
  const workTotal = workSeries ? sum(workSeries) : work?.total ?? 0;
  // Месяцы, в которых были оплаты работы подрядчику (не календарные месяцы периода).
  const wsFull = ws.length ? ws : s.recPcs.map(() => 0);
  const activeIdx = s.recPcs.map((v, i) => (mask ? (mask[i] ? i : -1) : v !== 0 || Math.abs(wsFull[i] ?? 0) > 0.005 ? i : -1)).filter((i) => i >= 0);
  const workMonths = base === "all" ? s.recPcs.length : base === "active" ? activeIdx.length : ws.filter((v) => Math.abs(v) > 0.005).length;
  const unitsReceived = sum(s.recPcs), unitsSold = sum(s.salePcs);
  const disc = sum(s.discIncl), revIncl = sum(s.revIncl);
  return {
    spent, received, net: received - spent, cumNet: received - spent,
    unitsReceived, unitsSold, unitsGross: sum(s.grossPcs), unitsReturns: sum(s.returnsPcs), workTotal, workMonths,
    recMonths: base === "all" ? s.recPcs.length : base === "active" ? activeIdx.length : s.recPcs.filter((v) => v !== 0).length,
    unitsPerMonth: s.recPcs.some((v) => v !== 0) ? unitsReceived / (base === "all" ? s.recPcs.length : base === "active" ? activeIdx.length : s.recPcs.filter((v) => v !== 0).length) : null,
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
  return { available: s.available, recPcs: f(s.recPcs), salePcs: f(s.salePcs), grossPcs: f(s.grossPcs), returnsPcs: f(s.returnsPcs), returnsRub: f(s.returnsRub), returnsRubEx: f(s.returnsRubEx), revIncl: f(s.revIncl), revEx: f(s.revEx), discIncl: f(s.discIncl) };
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
  const grossSold = keep.reduce((t, i) => t + allSales.grossPcs[i], 0), returnsPcs = keep.reduce((t, i) => t + allSales.returnsPcs[i], 0);
  const returnsRub = keep.reduce((t, i) => t + allSales.returnsRub[i], 0), returnsRubEx = keep.reduce((t, i) => t + allSales.returnsRubEx[i], 0);
  return {
    received: recv, sold, stock,
    /** «Продано» на плитке — нетто (sold). Для окна деталей: валовое продано, возвраты (шт., ₽ с НДС и без НДС); sold = grossSold − returnsPcs. */
    grossSold, returnsPcs, returnsRub, returnsRubEx,
    /** Накопленные с начала данных до конца периода (для SO). */
    cumReceived: last >= 0 ? st.cumRec[last] : 0, cumSold: last >= 0 ? st.cumSale[last] : 0,
    /** Продано / получено накопленно с начала данных до конца периода. */
    sellThrough: last >= 0 && st.cumRec[last] > 0 ? (st.cumSale[last] / st.cumRec[last]) * 100 : null,
    /** Остаток / средние продажи в месяц (от первого до последнего месяца продаж периода). */
    coverMonths: perMonth > 0 ? stock / perMonth : null,
  };
}


/**
 * Работа подрядчика по категориям (ТЗ → модель → группа категории): доля платежа, разнесённая на ТЗ, делится по группе модели ТЗ.
 * Неразнесённый аванс и ТЗ без группы — «прочее» (в категории не попадают). Σ классов = статья «Работа» по месяцам. НДС в оплате работы в данных нет.
 */
export type WorkByClass = { clothes: number[]; acc: number[]; other: number[]; /** Из «прочее»: без привязки к ТЗ. */ unlinked: number[] };
export function workByClass(rows: OverviewRow[], orderClass: Map<string, CatClass>, months: string[], vatShare?: RowVatShare): WorkByClass {
  const idx = new Map(months.map((m, i) => [m, i]));
  const z = () => months.map(() => 0);
  const o: WorkByClass = { clothes: z(), acc: z(), other: z(), unlinked: z() };
  for (const r of rows) {
    if (r.kind !== "prod" || Math.abs(r.work) < 0.005) continue;
    const i = idx.get(r.iso.slice(0, 7));
    if (i === undefined) continue;
    // «Без НДС»: работа без доли НДС платежа (та же доля, что в статье «Работа подрядчику»).
    const net = vatShare ? 1 - (vatShare.get(r.id) ?? 0) : 1;
    const k = r.amount !== 0 ? (r.work * net) / r.amount : 0;
    let linked = 0;
    for (const part of r.parts) {
      const id = part.href?.startsWith("/production/") ? part.href.slice("/production/".length) : null;
      if (!id) continue;
      const w = part.amount * k;
      linked += part.amount;
      o[orderClass.get(id) ?? "other"][i] += w;
    }
    const rest = r.work * net - linked * k;
    o.other[i] += rest; o.unlinked[i] += rest;
  }
  return o;
}

/** Работа на единицу нарастающим итогом: накопленная работа / накопленные единицы прихода (null, пока единиц не было). */
export function cumWorkPerUnit(work: number[], cumRec: number[], available: boolean): (number | null)[] {
  const c = cum(work);
  return c.map((v, i) => (available && cumRec[i] > 0 ? v / cumRec[i] : null));
}

/** Начало проекта для метрик работы (первая оплата работы подрядчику — август 2025, первый приход — сентябрь 2025). */
export const PROJECT_START_MONTH = "2025-08";
/** Индексы месяцев ряда `allMonths` для метрик работы: от начала проекта до текущего календарного месяца включительно (текущий — неполный), внутри выбранного периода. */
export function workMonthIdx(allMonths: string[], nowMonth: string, period: CashflowPeriod): number[] {
  return allMonths.map((m, i) => (m >= PROJECT_START_MONTH && m <= nowMonth && (period === "all" || m.startsWith(period)) ? i : -1)).filter((i) => i >= 0);
}

/** Предоплата за непринятые заказы: платежи по заказам, по которым товар ещё не принят (за что, когда, сколько, вид, основание). */
export type PrepaidItem = { id: string; label: string; iso: string; amount: number; what: string; doc: string | null; href: string };
export function prepaidItems(rows: OverviewRow[], names: Set<string>): PrepaidItem[] {
  return rows.filter((r) => r.kind === "raw" && names.has(r.label)).map((r) => ({ id: r.id, label: r.label, iso: r.iso.slice(0, 10), amount: r.amount, what: r.what, doc: r.doc, href: r.href })).sort((a, b) => a.label.localeCompare(b.label, "ru") || a.iso.localeCompare(b.iso));
}
