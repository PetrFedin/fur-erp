import "server-only";
import { prisma } from "@/lib/prisma";
import type { OrderRow } from "@/lib/analytics-orders";
import { compareModelNames } from "@/lib/model-code";
import { weightedPercent } from "@/lib/weighted";
import { UNDEFINED_CATEGORY } from "@/lib/product-category";
import { one, parseShared, sharedParams, type SP, type SharedFilters } from "@/lib/analytics-filters";
import { computeMetrics, derived, COLUMNS, type ColKey, type Metrics, type SortDir } from "@/lib/analytics-metrics";

// Себестоимость и цены по моделям (артикулам), категориям и видам меха — по ЗАВЕРШЁННЫМ ТЗ выбранного года.
// «Артикул» в системе = модель (ProductModel): у неё розничная цена sellingPrice (её же правят на странице «Изделия»).
// Отдельной оптовой цены в базе нет.

export type PricingView = "model" | "category" | "fur" | "furcat";
export const VIEW_LABEL: Record<PricingView, string> = {
  model: "По моделям (артикулам)",
  category: "По категориям",
  fur: "По видам меха",
  furcat: "Мех → категория",
};

export type PricingParams = SharedFilters & {
  /** Целевая наценка в процентах (как введена), пусто — по умолчанию из данных. */
  m: string;
  /** База себестоимости для наценки: mat — как в «Изделиях» (материалы + 4% + расходы), full — плюс работа. */
  base: "mat" | "full";
  view: PricingView;
  only: "all" | "noprice" | "issues";
};

export function parsePricingParams(sp: SP): PricingParams {
  const only = one(sp.only);
  const view = one(sp.view);
  return {
    ...parseShared(sp),
    m: one(sp.m).trim().slice(0, 8),
    base: one(sp.base) === "full" ? "full" : "mat",
    view: view === "category" || view === "fur" || view === "furcat" ? view : "model",
    only: only === "noprice" || only === "issues" ? only : "all",
  };
}

export function pricingParams(p: PricingParams, over: Partial<PricingParams> = {}): URLSearchParams {
  const x = { ...p, ...over };
  const s = sharedParams(x);
  if (x.m) s.set("m", x.m);
  if (x.base !== "mat") s.set("base", x.base);
  if (x.view !== "model") s.set("view", x.view);
  if (x.only !== "all") s.set("only", x.only);
  return s;
}

export function pricingQuery(p: PricingParams, over: Partial<PricingParams> = {}): string {
  const t = pricingParams(p, over).toString();
  return t ? `?${t}` : "";
}

/** Колонки показателей на странице «Цены» (рядом с обязательными: единицы, себестоимость, структура, цена, наценка). */
export const PRICING_BASIC: ColKey[] = ["skinsUnit", "liningUnit", "hammer", "work"];
export const PRICING_ALL: ColKey[] = ["skinsUnit", "skins", "liningUnit", "liningSum", "furUnit", "furSkin", "hammer", "hammerCov", "work", "fullUnit"];

export function parsePricingCols(raw: string[], all: boolean): ColKey[] {
  const set = new Set(raw.flatMap((s) => s.split(",")).map((s) => s.trim()));
  const picked = PRICING_ALL.filter((k) => set.has(k));
  if (picked.length > 0) return picked;
  return all ? PRICING_ALL : PRICING_BASIC;
}

/** Ввод «350», «350,5», «350%» → число или null. */
export function parseTargetMarkup(raw: string): number | null {
  const t = raw.replace(/[\s%]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return v >= 0 && v <= 100000 ? v : null;
}

export const roundTo100 = (x: number) => Math.round(x / 100) * 100;

export type LotAgg = {
  lotId: string;
  rawName: string;
  isLining: boolean;
  lotNumber: string | null;
  grade: string | null;
  color: string | null;
  purchaseId: string | null;
  purchaseNumber: string | null;
  auction: string | null;
  qty: number;
  incl: number;
  excl: number;
  /** Молоток за шкуру (₽) и валютная цена, если есть. */
  hammerIncl: number | null;
  hammerExcl: number | null;
  hammerUsd: number | null;
  orders: number;
};

export type PriceAgg = {
  key: string;
  label: string;
  category: string;
  fur: string;
  salesCode: string | null;
  /** Для модели — id; для остальных видов пусто. */
  modelId: string | null;
  modelCount: number;
  rows: OrderRow[];
  /** Единые показатели строки (те же формулы, что на «Изделиях»). */
  m: Metrics;
  orders: number;
  units: number;
  costedOrders: number;
  unitsCosted: number;
  furIncl: number;
  furExcl: number;
  liningIncl: number;
  liningExcl: number;
  c4Incl: number;
  c4Excl: number;
  c4PotIncl: number;
  expenses: number;
  work: number;
  /** Себестоимость системы (материалы + 4% по режиму + расходы). */
  costIncl: number;
  costExcl: number;
  /** НДС внутри материалов и 4%. */
  vat: number;
  minUnitIncl: number | null;
  maxUnitIncl: number | null;
  minUnitExcl: number | null;
  maxUnitExcl: number | null;
  lots: LotAgg[];
  price: number | null;
  /** Единицы и цена ценообразованных моделей внутри категории (для средней наценки категории). */
  pricedModels: number;
  inWorkOrders: number;
  noUsages: OrderRow[];
  noWork: OrderRow[];
  zeroCost: OrderRow[];
};

const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);

export async function loadModelPrices(orgId: string): Promise<Map<string, number | null>> {
  const ms = await prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, sellingPrice: true } });
  return new Map(ms.map((m) => [m.id, m.sellingPrice ? Number(m.sellingPrice) : null]));
}

const keyOfView = (view: PricingView, r: OrderRow) => (view === "model" ? r.modelId : view === "category" ? r.category : view === "fur" ? r.fur : `${r.fur}\u0000${r.category}`);

/** Агрегация завершённых ТЗ по ключу (модель, категория, вид меха, мех + категория). allRows — все ТЗ года (для счётчика «в работе»). */
export function aggregatePricing(allRows: OrderRow[], view: PricingView, prices: Map<string, number | null>): PriceAgg[] {
  const keyOf = (r: OrderRow) => keyOfView(view, r);
  const done = allRows.filter((r) => r.group === "done");
  const work = allRows.filter((r) => r.group === "work");
  const byKey = new Map<string, OrderRow[]>();
  for (const r of done) (byKey.get(keyOf(r)) ?? byKey.set(keyOf(r), []).get(keyOf(r))!).push(r);

  const out: PriceAgg[] = [];
  for (const [key, rows] of byKey) {
    const costed = rows.filter((r) => r.costIncl > 0);
    const unitInc = costed.filter((r) => r.qty > 0).map((r) => r.costIncl / r.qty);
    const unitExc = costed.filter((r) => r.qty > 0).map((r) => r.costExcl / r.qty);
    const lotMap = new Map<string, LotAgg>();
    // Лоты — по всем ТЗ с составом (не только с известной себестоимостью): молоток нужен и там, где себестоимость 0.
    for (const r of rows) {
      const seen = new Set<string>();
      for (const l of r.lines) {
        const k = `${l.lotId}`;
        const a = lotMap.get(k) ?? {
          lotId: l.lotId,
          rawName: l.rawName,
          isLining: l.isLining,
          lotNumber: l.lotNumber,
          grade: l.grade,
          color: l.color,
          purchaseId: l.purchaseId,
          purchaseNumber: l.purchaseNumber,
          auction: l.auction,
          qty: 0,
          incl: 0,
          excl: 0,
          hammerIncl: l.hammerIncl,
          hammerExcl: l.hammerExcl,
          hammerUsd: l.hammerUsd,
          orders: 0,
        };
        a.qty += l.qty;
        a.incl += l.incl;
        a.excl += l.excl;
        if (!seen.has(k)) a.orders += 1;
        seen.add(k);
        lotMap.set(k, a);
      }
    }
    const first = rows[0];
    const label = view === "model" ? first.modelName : view === "category" ? key : view === "fur" ? key : `${first.fur} · ${first.category}`;
    const modelIds = new Set(rows.map((r) => r.modelId));
    const pricedIds = Array.from(modelIds).filter((id) => (prices.get(id) ?? 0) > 0);
    out.push({
      key,
      label,
      category: view === "category" ? key : first.category,
      fur: first.fur,
      salesCode: view === "model" ? first.salesCode : null,
      modelId: view === "model" ? key : null,
      modelCount: modelIds.size,
      rows,
      m: computeMetrics(rows),
      orders: rows.length,
      units: sum(rows, (r) => r.qty),
      costedOrders: costed.length,
      unitsCosted: sum(costed, (r) => r.qty),
      furIncl: sum(costed, (r) => r.furIncl),
      furExcl: sum(costed, (r) => r.furExcl),
      liningIncl: sum(costed, (r) => r.liningIncl),
      liningExcl: sum(costed, (r) => r.liningExcl),
      c4Incl: sum(costed, (r) => r.c4Incl),
      c4Excl: sum(costed, (r) => r.c4Excl),
      c4PotIncl: sum(costed, (r) => r.c4PotIncl),
      expenses: sum(costed, (r) => r.expenses),
      work: sum(costed, (r) => r.work),
      costIncl: sum(costed, (r) => r.costIncl),
      costExcl: sum(costed, (r) => r.costExcl),
      vat: sum(costed, (r) => r.furIncl + r.liningIncl + r.c4Incl - (r.furExcl + r.liningExcl + r.c4Excl)),
      minUnitIncl: unitInc.length ? Math.min(...unitInc) : null,
      maxUnitIncl: unitInc.length ? Math.max(...unitInc) : null,
      minUnitExcl: unitExc.length ? Math.min(...unitExc) : null,
      maxUnitExcl: unitExc.length ? Math.max(...unitExc) : null,
      lots: Array.from(lotMap.values()).sort((a, b) => Number(a.isLining) - Number(b.isLining) || b.incl - a.incl),
      price: view === "model" ? (prices.get(key) ?? null) : null,
      pricedModels: pricedIds.length,
      inWorkOrders: work.filter((r) => keyOf(r) === key).length,
      noUsages: rows.filter((r) => r.usageCount === 0),
      noWork: rows.filter((r) => !(r.work > 0)),
      zeroCost: rows.filter((r) => !(r.costIncl > 0)),
    });
  }
  return out.sort((a, b) => {
    if (view === "model") return compareModelNames(a.label, b.label);
    if (view === "furcat") return a.label.localeCompare(b.label, "ru");
    const ua = a.label === UNDEFINED_CATEGORY ? 1 : 0;
    const ub = b.label === UNDEFINED_CATEGORY ? 1 : 0;
    return ua - ub || b.units - a.units;
  });
}

export type PriceCalc = {
  /** Себестоимость единицы для наценки (с НДС / без НДС), средневзвешенная. */
  baseIncl: number | null;
  baseExcl: number | null;
  /** Чистые составляющие на единицу (с НДС / без НДС), для таблицы состава. */
  perUnit: (x: number) => number | null;
  markupX: number | null; // цена ÷ себестоимость
  markupPct: number | null;
  marginPct: number | null;
  belowCost: boolean;
};

export function calcPrice(a: PriceAgg, base: "mat" | "full", price: number | null): PriceCalc {
  const u = a.unitsCosted;
  const perUnit = (x: number) => (u > 0 ? x / u : null);
  const workPart = base === "full" ? a.work : 0;
  const baseIncl = perUnit(a.costIncl + workPart);
  const baseExcl = perUnit(a.costExcl + workPart);
  const p = price != null && price > 0 ? price : null;
  const markupX = p && baseIncl && baseIncl > 0 ? p / baseIncl : null;
  return {
    baseIncl,
    baseExcl,
    perUnit,
    markupX,
    markupPct: markupX ? (markupX - 1) * 100 : null,
    marginPct: p && baseIncl && p > 0 ? ((p - baseIncl) / p) * 100 : null,
    belowCost: !!(p && baseIncl && p < baseIncl),
  };
}

/** Средневзвешенный маркап (%) по ценообразованным моделям: вес — себестоимость партии (себестоимость единицы × единицы). */
export function defaultMarkupPct(models: PriceAgg[], base: "mat" | "full"): { pct: number | null; count: number } {
  const items: { percent: number; base: number }[] = [];
  for (const a of models) {
    if (!a.modelId || !a.price) continue;
    const c = calcPrice(a, base, a.price);
    if (c.markupPct == null || !c.baseIncl) continue;
    items.push({ percent: c.markupPct, base: c.baseIncl * a.unitsCosted });
  }
  const pct = weightedPercent(items);
  return { pct, count: items.length };
}

export type Recommendation = { incl: number; excl: number } | null;

export function recommend(a: PriceAgg, base: "mat" | "full", targetPct: number | null): Recommendation {
  if (targetPct == null) return null;
  const c = calcPrice(a, base, null);
  if (!c.baseIncl || !c.baseExcl) return null;
  const k = 1 + targetPct / 100;
  return { incl: roundTo100(c.baseIncl * k), excl: roundTo100(c.baseExcl * k) };
}

// ───────────────────────────── Сортировка ─────────────────────────────

export type PricingSortKey = "label" | "units" | "cost" | "price" | "markup" | "rec" | ColKey;

export function parsePricingSort(sort: string, dir: string): { sort: PricingSortKey | ""; dir: SortDir } {
  const ok = ["label", "units", "cost", "price", "markup", "rec"].includes(sort) || PRICING_ALL.includes(sort as ColKey);
  return { sort: ok ? (sort as PricingSortKey) : "", dir: dir === "asc" ? "asc" : "desc" };
}

/** Сортировка строк «Цен»: пустые значения всегда в конце. */
export function sortPricing(list: PriceAgg[], sort: PricingSortKey | "", dir: SortDir, base: "mat" | "full", target: number | null): PriceAgg[] {
  if (!sort) return list;
  const k = dir === "asc" ? 1 : -1;
  const val = (a: PriceAgg): number | null => {
    switch (sort) {
      case "units":
        return a.units;
      case "cost":
        return calcPrice(a, base, a.price).baseIncl;
      case "price":
        return a.price;
      case "markup":
        return calcPrice(a, base, a.price).markupX;
      case "rec":
        return recommend(a, base, target)?.incl ?? null;
      case "label":
        return null;
      default:
        return COLUMNS[sort].sort(a.m, a.m);
    }
  };
  return [...list].sort((a, b) => {
    if (sort === "label") return k * (a.modelId ? compareModelNames(a.label, b.label) : a.label.localeCompare(b.label, "ru", { numeric: true }));
    const va = val(a);
    const vb = val(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return k * (va - vb) || a.label.localeCompare(b.label, "ru", { numeric: true });
  });
}

export { derived };
