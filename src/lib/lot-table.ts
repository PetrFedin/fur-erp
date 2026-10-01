// Модель строки таблицы лотов режима «Аукцион», фильтры и итоги. Чистые функции:
// те же числа считает и сервер при первой отрисовке, и браузер при фильтрах/выборе.
import type { CustomFieldDef, ExtraValue } from "@/lib/custom-fields";
import type { Part } from "@/lib/auction-cost-parts";
import { normalizeNumberInput } from "@/lib/input";
import type { VatMode } from "@/lib/vat-mode";

export type LotRow = {
  id: string;
  purchaseId: string;
  materialId: string;
  material: string;
  lotNumber: string;
  /** «Сорт / размер»: grade / color */
  size: string;
  /** «Операция»: PurchaseItem.notes */
  op: string;
  qty: number;
  unit: string;
  /** цена лота за шкуру в валюте закупки */
  price: number;
  currency: string;
  rate: number;
  unitIncl: number;
  unitExcl: number;
  totalIncl: number;
  totalExcl: number;
  /** цена лота в ₽: с НДС / без НДС */
  priceIncl: number;
  priceExcl: number;
  source: "lot" | "plan" | "price";
  onStock: boolean;
  remaining: number;
  usages: { id: string; orderId: string; number: string; qty: number }[];
  parts: Part[];
  expIncl: number;
  extra: Record<string, ExtraValue>;
  breakdown: unknown;
  /** Параметры редактора расчёта (только у черновиков с costPlan) */
  editor: unknown;
};

export type PurchaseMeta = {
  id: string;
  counted: boolean;
  unallocated: boolean;
  received: boolean;
  cancelled: boolean;
  currency: string;
  expIncl: number;
  expExcl: number;
  expenses: { name: string; incl: number; excl: number }[];
  lineCount: number;
};

export type Range = { from: string; to: string };
export type Filters = {
  text: Record<string, string>;
  multi: Record<string, string[]>;
  range: Record<string, Range>;
  bool: Record<string, "yes" | "no">;
  onlySelected: boolean;
};

export const emptyFilters = (): Filters => ({ text: {}, multi: {}, range: {}, bool: {}, onlySelected: false });

export const EMPTY_VALUE = "(пусто)";
export const MULTI_KEYS = ["material", "size", "op"] as const;
export type MultiKey = (typeof MULTI_KEYS)[number];

export function multiValue(row: LotRow, key: string): string {
  const v = key === "material" ? row.material : key === "size" ? row.size : row.op;
  return v && v !== "—" ? v : EMPTY_VALUE;
}

const parseBoundRaw = (s: string): number | null => {
  const n = normalizeNumberInput(s);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** Граница диапазона: пусто или корректное число (иначе поле подсвечивается и фильтр не действует). */
export function isBoundValid(s: string): boolean {
  return !s.trim() || parseBoundRaw(s) != null;
}

const rangeActive = (r: Range) =>
  (r.from.trim() !== "" && parseBoundRaw(r.from) != null) || (r.to.trim() !== "" && parseBoundRaw(r.to) != null);

export function activeFilterCount(f: Filters): number {
  return (
    Object.values(f.text).filter((v) => v.trim()).length +
    Object.values(f.multi).filter((v) => v.length > 0).length +
    Object.values(f.range).filter(rangeActive).length +
    Object.keys(f.bool).length +
    (f.onlySelected ? 1 : 0)
  );
}

type NumKey = "qty" | "price" | "rate" | "unit" | "total" | "remaining" | "used";

export function rowNumber(row: LotRow, key: NumKey, mode: VatMode): number | null {
  switch (key) {
    case "qty":
      return row.qty;
    case "price":
      return row.price;
    case "rate":
      return row.rate;
    case "unit":
      return mode === "excl" ? row.unitExcl : row.unitIncl;
    case "total":
      return mode === "excl" ? row.totalExcl : row.totalIncl;
    case "remaining":
      return row.onStock ? row.remaining : null;
    case "used":
      return row.usages.reduce((s, u) => s + u.qty, 0);
  }
}

const parseBound = (s: string): number | null => {
  const n = normalizeNumberInput(s);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export function inRange(v: number | null, r: Range): boolean {
  const from = parseBound(r.from);
  const to = parseBound(r.to);
  if (from == null && to == null) return true;
  if (v == null) return false;
  // допуск на двоичную дробь у границ
  if (from != null && v < from - 1e-9) return false;
  if (to != null && v > to + 1e-9) return false;
  return true;
}

export function rowMatches(
  row: LotRow,
  f: Filters,
  fields: CustomFieldDef[],
  mode: VatMode,
  extraOf: (row: LotRow, fieldId: string) => ExtraValue | undefined,
  selected: ReadonlySet<string>,
): boolean {
  if (f.onlySelected && !selected.has(row.id)) return false;
  const lot = f.text.lotNumber?.trim().toLowerCase();
  if (lot && !row.lotNumber.toLowerCase().includes(lot)) return false;
  for (const k of MULTI_KEYS) {
    const sel = f.multi[k];
    if (sel && sel.length > 0 && !sel.includes(multiValue(row, k))) return false;
  }
  for (const [k, r] of Object.entries(f.range)) {
    if (!rangeActive(r)) continue;
    const field = fields.find((x) => x.id === k);
    if (field) {
      const v = extraOf(row, k);
      if (!inRange(typeof v === "number" ? v : null, r)) return false;
    } else if (!inRange(rowNumber(row, k as NumKey, mode), r)) return false;
  }
  for (const fld of fields) {
    if (fld.type === "TEXT") {
      const t = f.text[fld.id]?.trim().toLowerCase();
      if (t) {
        const v = extraOf(row, fld.id);
        if (typeof v !== "string" || !v.toLowerCase().includes(t)) return false;
      }
    } else if (fld.type === "BOOLEAN") {
      const b = f.bool[fld.id];
      if (b) {
        const v = extraOf(row, fld.id);
        if (b === "yes" ? v !== true : v !== false) return false;
      }
    }
  }
  return true;
}

export type CustomTotals = { n: number; sum: number; wavg: number | null; uniq: number; yes: number; no: number };
export type Totals = {
  count: number;
  qty: number;
  /** Σ цена × кол-во в валюте закупки */
  priceSum: number;
  currencies: string[];
  avgPrice: number | null;
  priceIncl: number;
  priceExcl: number;
  rateAvg: number | null;
  rateMin: number | null;
  rateMax: number | null;
  totalIncl: number;
  totalExcl: number;
  remaining: number;
  onStock: number;
  used: number;
  uniq: { material: number; lotNumber: number; size: number; op: number };
  custom: Record<string, CustomTotals>;
};

const uniqCount = (xs: string[]) => new Set(xs.filter((x) => x && x !== "—")).size;

export function computeTotals(
  rows: LotRow[],
  fields: CustomFieldDef[],
  extraOf: (row: LotRow, fieldId: string) => ExtraValue | undefined,
): Totals {
  let qty = 0;
  let priceSum = 0;
  let priceIncl = 0;
  let priceExcl = 0;
  let totalIncl = 0;
  let totalExcl = 0;
  let remaining = 0;
  let onStock = 0;
  let used = 0;
  let rateW = 0;
  let rateWSum = 0;
  let rateQ = 0;
  let rateMin: number | null = null;
  let rateMax: number | null = null;
  const currencies = new Set<string>();
  for (const r of rows) {
    qty += r.qty;
    const amount = r.price * r.qty;
    priceSum += amount;
    priceIncl += r.priceIncl;
    priceExcl += r.priceExcl;
    totalIncl += r.totalIncl;
    totalExcl += r.totalExcl;
    currencies.add(r.currency);
    if (r.onStock) {
      remaining += r.remaining;
      onStock++;
    }
    used += r.usages.reduce((s, u) => s + u.qty, 0);
    // курс взвешиваем по сумме закупки в валюте (цена × кол-во); если суммы нулевые — по количеству
    rateW += r.rate * amount;
    rateWSum += amount;
    rateQ += r.rate * r.qty;
    rateMin = rateMin == null ? r.rate : Math.min(rateMin, r.rate);
    rateMax = rateMax == null ? r.rate : Math.max(rateMax, r.rate);
  }
  const custom: Record<string, CustomTotals> = {};
  for (const f of fields) {
    let n = 0;
    let sum = 0;
    let wq = 0;
    let wsum = 0;
    let yes = 0;
    let no = 0;
    const uniq = new Set<string>();
    for (const r of rows) {
      const v = extraOf(r, f.id);
      if (v === undefined || v === "") continue;
      n++;
      if (f.type === "NUMBER" && typeof v === "number") {
        sum += v;
        wsum += v * r.qty;
        wq += r.qty;
      } else if (f.type === "BOOLEAN") {
        if (v === true) yes++;
        else if (v === false) no++;
      } else uniq.add(String(v).toLowerCase());
    }
    custom[f.id] = { n, sum, wavg: wq > 0 ? wsum / wq : n > 0 && f.type === "NUMBER" ? sum / n : null, uniq: uniq.size, yes, no };
  }
  return {
    count: rows.length,
    qty,
    priceSum,
    currencies: Array.from(currencies),
    avgPrice: qty > 0 ? priceSum / qty : null,
    priceIncl,
    priceExcl,
    rateAvg: rateWSum > 0 ? rateW / rateWSum : qty > 0 ? rateQ / qty : null,
    rateMin,
    rateMax,
    totalIncl,
    totalExcl,
    remaining,
    onStock,
    used,
    uniq: {
      material: uniqCount(rows.map((r) => r.material)),
      lotNumber: uniqCount(rows.map((r) => r.lotNumber)),
      size: uniqCount(rows.map((r) => r.size)),
      op: uniqCount(rows.map((r) => r.op)),
    },
    custom,
  };
}
