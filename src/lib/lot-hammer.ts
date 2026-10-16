// «Молоток» лота — цена шкуры на аукционе ДО сборов, выделки, транспорта, брокера и комиссий.
// Хранится не отдельным полем, а строкой расчёта лота (RawMaterialLot.costBreakdown, он же копия PurchaseItem.costPlan):
//   • «Стоимость молоток за ед без НДС» (+ «… в т.ч. НДС») — уже в ₽ по курсу лота;
//   • «Цена за ед. (ам. долл.)» × «Курс» — то же, если готовой строки нет;
//   • «Цена за ед. по курсу, ₽» (и «Цена за ед., $») — формат расчётного листа costPlan.
// Нет ни одной из этих строк — молотка нет (лот не считается в среднее молотка).

import lotUsdSources from "@/data/lot-usd-sources.json";

export type Hammer = {
  /** ₽ за шкуру без НДС. */
  excl: number;
  /** ₽ за шкуру с НДС лота. */
  incl: number;
  /** $ за шкуру, если цена была в долларах. */
  usd: number | null;
  /** Откуда взято (для подсказки). */
  source: "молоток в расчёте лота" | "цена × курс" | "расчётный лист" | "НДС на шкуры ÷ ставка НДС" | "цена из расчёта × курсы";
};

type Item = { label?: unknown; value?: unknown };

function itemsOf(breakdown: unknown): Item[] {
  const b = breakdown as { items?: unknown } | null | undefined;
  return b && typeof b === "object" && Array.isArray(b.items) ? (b.items as Item[]) : [];
}

function pick(items: Item[], label: string, prefix = false): number | null {
  const low = label.toLowerCase();
  for (const it of items) {
    if (typeof it.label !== "string") continue;
    const l = it.label.trim().toLowerCase();
    if (prefix ? !l.startsWith(low) : l !== low) continue;
    const n = Number(it.value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function fromItems(items: Item[], vatRate: number): Hammer | null {
  if (items.length === 0) return null;
  const k = 1 + (Number.isFinite(vatRate) ? vatRate : 0) / 100;
  const usd = pick(items, "Цена за ед. (ам. долл.)") ?? pick(items, "Цена за ед., $");
  const direct = pick(items, "Стоимость молоток за ед без НДС");
  if (direct != null && direct > 0) {
    const incl = pick(items, "Стоимость молоток за ед в т.ч. НДС");
    return { excl: direct, incl: incl != null && incl > 0 ? incl : direct * k, usd, source: "молоток в расчёте лота" };
  }
  const rate = pick(items, "Курс") ?? pick(items, "Курс ЦБ на дату счёта");
  if (usd != null && usd > 0 && rate != null && rate > 0) {
    const excl = usd * rate;
    return { excl, incl: excl * k, usd, source: "цена × курс" };
  }
  const plan = pick(items, "Цена за ед. по курсу, ₽");
  if (plan != null && plan > 0) return { excl: plan, incl: plan * k, usd, source: "расчётный лист" };
  return null;
}

/** Листы без готовой строки молотка: «НДС на шкуры» ÷ ставка НДС лота (лист с «Курс ЦБ (фиксация)»); цена в евро из расчёта Drive × курс инвойса × курс ЦБ (лист с «Валютный курс инвойса»). */
function fromSheetFallbacks(items: Item[], vatRate: number, ref: { currency: "USD" | "EUR"; price: number } | null): Hammer | null {
  if (items.length === 0) return null;
  const k = 1 + (Number.isFinite(vatRate) ? vatRate : 0) / 100;
  const usd = pick(items, "Цена за ед. (ам. долл.)") ?? pick(items, "Цена за ед., $");
  const vatHides = pick(items, "НДС на шкуры");
  if (vatHides != null && vatHides > 0 && vatRate > 0) {
    const excl = vatHides / (vatRate / 100);
    return { excl, incl: excl * k, usd, source: "НДС на шкуры ÷ ставка НДС" };
  }
  const inv = pick(items, "Валютный курс инвойса");
  const fix = pick(items, "Курс ЦБ (фиксация)");
  if (ref && ref.price > 0 && fix != null && fix > 0 && (ref.currency === "USD" || (inv != null && inv > 0))) {
    const excl = (ref.currency === "EUR" ? ref.price * (inv ?? 0) : ref.price) * fix;
    return { excl, incl: excl * k, usd, source: "цена из расчёта × курсы" };
  }
  return null;
}

/** Молоток лота: из расчёта лота, а если его нет — из расчётного листа позиций закупки (costPlan). */
export function lotHammer(costBreakdown: unknown, vatRate: number, planBreakdowns: unknown[] = [], opts: { purchaseNumber?: string | null; lotNumber?: string | null } = {}): Hammer | null {
  const own = fromItems(itemsOf(costBreakdown), vatRate);
  if (own) return own;
  for (const p of planBreakdowns) {
    const cp = (p as { costBreakdown?: unknown } | null | undefined)?.costBreakdown;
    const h = fromItems(itemsOf(cp), vatRate);
    if (h) return h;
  }
  const ref = lotUsdRef(opts.purchaseNumber, opts.lotNumber);
  const fb = fromSheetFallbacks(itemsOf(costBreakdown), vatRate, ref);
  if (fb) return fb;
  for (const p of planBreakdowns) {
    const f2 = fromSheetFallbacks(itemsOf((p as { costBreakdown?: unknown } | null | undefined)?.costBreakdown), vatRate, ref);
    if (f2) return f2;
  }
  return null;
}

/**
 * Молоток, прямо стоящий в расчётном листе лота (или расчётном листе позиции закупки): строки «Стоимость молоток за ед…», «Цена за ед. (ам. долл.)» × «Курс»,
 * «Цена за ед. по курсу, ₽». Никаких оценок: ни «НДС на шкуры ÷ ставка», ни цен из справочника Drive (lot-usd-sources.json). Для карточки лота.
 */
export function lotHammerListed(costBreakdown: unknown, vatRate: number, planBreakdowns: unknown[] = []): Hammer | null {
  const own = fromItems(itemsOf(costBreakdown), vatRate);
  if (own) return own;
  for (const p of planBreakdowns) {
    const h = fromItems(itemsOf((p as { costBreakdown?: unknown } | null | undefined)?.costBreakdown), vatRate);
    if (h) return h;
  }
  return null;
}

/** Цена шкуры в $, прямо стоящая в расчётном листе лота («Цена за ед. (ам. долл.)» / «Цена за ед., $»); иначе null — без оценок. */
export function lotUsdListed(costBreakdown: unknown, planBreakdowns: unknown[] = []): number | null {
  const u = lotUsdPrice(costBreakdown, planBreakdowns);
  return u.source === "direct" ? u.usd : null;
}

/** Откуда взята цена шкуры в USD (молоток, до сборов). */
export type UsdSource = "direct" | "eur×rate" | "rub÷rate" | "calc" | "none";

export const USD_SOURCE_LABEL: Record<UsdSource, string> = {
  direct: "строка в долларах в расчёте лота",
  "eur×rate": "цена в евро × курс EUR→USD из расчёта лота",
  "rub÷rate": "молоток в ₽ ÷ записанный в расчёте курс USD/RUB",
  calc: "цена в $ из расчёта (в лоте нет разбивки)",
  none: "нет цены в USD",
};

export type LotUsd = { usd: number | null; source: UsdSource };

type RefEntry = { currency: "USD" | "EUR"; price: number; rubPerUsd?: number; source: string };
const REFS = (lotUsdSources as { lots: Record<string, RefEntry> }).lots;

/** Запись расчёта Drive по лоту (для отчёта и подсказок). */
export function lotUsdRef(purchaseNumber: string | null | undefined, lotNumber: string | null | undefined): RefEntry | null {
  if (!purchaseNumber || !lotNumber) return null;
  return REFS[`${purchaseNumber}|${lotNumber.trim()}`] ?? null;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Закупочная цена шкуры в долларах за единицу (молоток, до сборов) и откуда она получена. Только записанное в документах лота:
 *  1. direct — «Цена за ед. (ам. долл.)» / «Цена за ед., $» в расчёте лота или расчётном листе позиции закупки;
 *  2. eur×rate — цена в евро (расчёт Drive, lot-usd-sources.json) × «Валютный курс инвойса» (EUR→USD) из расчёта лота;
 *  3. rub÷rate — молоток в ₽ («НДС на шкуры» ÷ ставка НДС лота) ÷ «Курс ЦБ (фиксация)» из расчёта лота — когда расчёт сделан от долларовой цены;
 *  4. calc — цена в $ из расчёта Drive, если в самом лоте разбивки нет (lot-usd-sources.json).
 * Курс ЦБ на сегодня и любые «придуманные» курсы не используются: нет данных — source «none».
 */
export function lotUsdPrice(
  costBreakdown: unknown,
  planBreakdowns: unknown[] = [],
  opts: { vatRate?: number; purchaseNumber?: string | null; lotNumber?: string | null } = {},
): LotUsd {
  const own = itemsOf(costBreakdown);
  const fromOwn = pick(own, "Цена за ед. (ам. долл.)") ?? pick(own, "Цена за ед., $");
  if (fromOwn != null && fromOwn > 0) return { usd: fromOwn, source: "direct" };
  for (const p of planBreakdowns) {
    const items = itemsOf((p as { costBreakdown?: unknown } | null | undefined)?.costBreakdown);
    const v = pick(items, "Цена за ед. (ам. долл.)") ?? pick(items, "Цена за ед., $");
    if (v != null && v > 0) return { usd: v, source: "direct" };
  }
  const ref = lotUsdRef(opts.purchaseNumber, opts.lotNumber);
  if (ref?.currency === "EUR") {
    const inv = pick(own, "Валютный курс инвойса");
    if (inv != null && inv > 0) return { usd: r4(ref.price * inv), source: "eur×rate" };
  }
  const vat = pick(own, "НДС на шкуры");
  const fix = pick(own, "Курс ЦБ (фиксация)");
  const vr = opts.vatRate;
  if (vat != null && vat > 0 && fix != null && fix > 0 && vr != null && vr > 0 && !ref) {
    return { usd: r4(vat / (vr / 100) / fix), source: "rub÷rate" };
  }
  if (ref?.currency === "USD" && ref.price > 0) return { usd: ref.price, source: "calc" };
  return { usd: null, source: "none" };
}
