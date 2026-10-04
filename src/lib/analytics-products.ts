// Группировка и фильтры для «Что произведено» (/analytics/products). Чистые функции без обращения к БД:
// страница и выгрузка CSV строятся из одних и тех же строк и одних и тех же функций.
import { compareModelNames } from "@/lib/model-code";
import { compareSizes, UNDEFINED_CATEGORY } from "@/lib/product-category";
import type { OrderRow } from "@/lib/analytics-orders";

export const GROUPS = {
  category: "Категория изделия",
  fur: "Вид меха",
  size: "Размер",
  model: "Модель",
  batch: "Партия",
  year: "Год",
  color: "Цвет",
} as const;
export type GroupKey = keyof typeof GROUPS;
export const GROUP_KEYS = Object.keys(GROUPS) as GroupKey[];

export type StatusFilter = "done" | "work" | "all";
export const STATUS_LABEL: Record<StatusFilter, string> = {
  done: "Сделано",
  work: "В работе и план",
  all: "Все (кроме отменённых)",
};

export type ProductFilters = {
  g: GroupKey;
  st: StatusFilter;
  cat: string;
  fur: string;
  size: string;
  batch: string;
  q: string;
  mx: "units" | "cost";
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseProductFilters(sp: Record<string, string | string[] | undefined>): ProductFilters {
  const g = one(sp.g) as GroupKey;
  const st = one(sp.st) as StatusFilter;
  return {
    g: g in GROUPS ? g : "category",
    st: st === "work" || st === "all" ? st : "done",
    cat: one(sp.cat).slice(0, 80),
    fur: one(sp.fur).slice(0, 80),
    size: one(sp.size).slice(0, 80),
    batch: /^\d{1,6}$/.test(one(sp.batch)) ? one(sp.batch) : "",
    q: one(sp.q).trim().slice(0, 80),
    mx: one(sp.mx) === "cost" ? "cost" : "units",
  };
}

/** Параметры в адрес (только непустые и отличающиеся от умолчаний). */
export function productQuery(f: ProductFilters, over: Partial<ProductFilters> = {}): string {
  const x = { ...f, ...over };
  const p = new URLSearchParams();
  if (x.g !== "category") p.set("g", x.g);
  if (x.st !== "done") p.set("st", x.st);
  if (x.cat) p.set("cat", x.cat);
  if (x.fur) p.set("fur", x.fur);
  if (x.size) p.set("size", x.size);
  if (x.batch) p.set("batch", x.batch);
  if (x.q) p.set("q", x.q);
  if (x.mx !== "units") p.set("mx", x.mx);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function applyStatus(rows: OrderRow[], st: StatusFilter): OrderRow[] {
  return st === "all" ? rows : rows.filter((r) => r.group === st);
}

export function applyFilters(rows: OrderRow[], f: ProductFilters): OrderRow[] {
  const q = f.q.toLowerCase();
  return applyStatus(rows, f.st).filter(
    (r) =>
      (!f.cat || r.category === f.cat) &&
      (!f.fur || r.fur === f.fur) &&
      (!f.size || r.size === f.size) &&
      (!f.batch || String(r.batchNumber) === f.batch) &&
      (!q ||
        [r.number, r.workOrderNumber ?? "", r.modelName, r.category, r.fur, r.color, r.sizeRaw]
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );
}

export function groupLabel(r: OrderRow, g: GroupKey): string {
  switch (g) {
    case "category":
      return r.category;
    case "fur":
      return r.fur;
    case "size":
      return r.size;
    case "model":
      return r.modelName;
    case "batch":
      return r.batchNumber == null ? "Без партии" : `Партия ${r.batchNumber}`;
    case "year":
      return r.year == null ? "Год не определён" : String(r.year);
    case "color":
      return r.color;
  }
}

function compareLabels(g: GroupKey, a: string, b: string): number {
  if (g === "model") return compareModelNames(a, b);
  if (g === "size") return compareSizes(a, b);
  if (g === "batch") return Number(a.replace(/\D/g, "") || 1e9) - Number(b.replace(/\D/g, "") || 1e9);
  if (g === "year") return a.localeCompare(b);
  return a.localeCompare(b, "ru");
}

export type Agg = {
  label: string;
  rows: OrderRow[];
  orders: number;
  units: number;
  /** Σ себестоимости (с НДС / без НДС) по ТЗ с известной себестоимостью. */
  costIncl: number;
  costExcl: number;
  /** Единицы в ТЗ с известной себестоимостью — знаменатель средней себестоимости. */
  unitsCosted: number;
  work: number;
  unitsWork: number;
  furQty: number;
  liningQty: number;
  /** Единицы в ТЗ, где есть списания материалов — знаменатель расхода меха/подкладки. */
  unitsMat: number;
  furIncl: number;
  liningIncl: number;
};

const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);

export function aggregate(label: string, rows: OrderRow[]): Agg {
  const costed = rows.filter((r) => r.costIncl > 0);
  const withWork = rows.filter((r) => r.work > 0);
  const withMat = rows.filter((r) => r.usageCount > 0);
  return {
    label,
    rows,
    orders: rows.length,
    units: sum(rows, (r) => r.qty),
    costIncl: sum(costed, (r) => r.costIncl),
    costExcl: sum(costed, (r) => r.costExcl),
    unitsCosted: sum(costed, (r) => r.qty),
    work: sum(withWork, (r) => r.work),
    unitsWork: sum(withWork, (r) => r.qty),
    furQty: sum(withMat, (r) => r.furQty),
    liningQty: sum(withMat, (r) => r.liningQty),
    unitsMat: sum(withMat, (r) => r.qty),
    furIncl: sum(withMat, (r) => r.furIncl),
    liningIncl: sum(withMat, (r) => r.liningIncl),
  };
}

/** Среднее взвешенное = отношение сумм; нет знаменателя — null. */
export const per = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export function groupRows(rows: OrderRow[], g: GroupKey): Agg[] {
  const m = new Map<string, OrderRow[]>();
  for (const r of rows) {
    const k = groupLabel(r, g);
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  const undefinedLabels = new Set([UNDEFINED_CATEGORY, "Мех не определён", "Размер не указан", "Цвет не указан", "Без партии", "Год не определён"]);
  return Array.from(m, ([label, rs]) => aggregate(label, rs)).sort((a, b) => {
    const ua = undefinedLabels.has(a.label) ? 1 : 0;
    const ub = undefinedLabels.has(b.label) ? 1 : 0;
    if (ua !== ub) return ua - ub;
    if (g === "category" || g === "fur" || g === "color") return b.units - a.units || compareLabels(g, a.label, b.label);
    return compareLabels(g, a.label, b.label);
  });
}

export type Matrix = {
  rowLabels: string[];
  colLabels: string[];
  cell: (r: string, c: string) => { units: number; costIncl: number; costExcl: number; orders: number };
  maxUnits: number;
  maxCost: number;
  rowTotals: Map<string, { units: number; costIncl: number; costExcl: number }>;
  colTotals: Map<string, { units: number; costIncl: number; costExcl: number }>;
};

/** Матрица «A × B»: единицы и себестоимость по паре значений. */
export function buildMatrix(rows: OrderRow[], rowKey: GroupKey, colKey: GroupKey): Matrix {
  const cells = new Map<string, { units: number; costIncl: number; costExcl: number; orders: number }>();
  const rowTotals = new Map<string, { units: number; costIncl: number; costExcl: number }>();
  const colTotals = new Map<string, { units: number; costIncl: number; costExcl: number }>();
  for (const r of rows) {
    const a = groupLabel(r, rowKey);
    const b = groupLabel(r, colKey);
    const k = `${a}\u0000${b}`;
    const c = cells.get(k) ?? { units: 0, costIncl: 0, costExcl: 0, orders: 0 };
    c.units += r.qty;
    c.costIncl += r.costIncl;
    c.costExcl += r.costExcl;
    c.orders += 1;
    cells.set(k, c);
    for (const [map, key] of [
      [rowTotals, a],
      [colTotals, b],
    ] as const) {
      const t = map.get(key) ?? { units: 0, costIncl: 0, costExcl: 0 };
      t.units += r.qty;
      t.costIncl += r.costIncl;
      t.costExcl += r.costExcl;
      map.set(key, t);
    }
  }
  const sortLabels = (set: Map<string, unknown>, g: GroupKey) =>
    Array.from(set.keys()).sort((x, y) => {
      const ux = [UNDEFINED_CATEGORY, "Мех не определён", "Размер не указан"].includes(x) ? 1 : 0;
      const uy = [UNDEFINED_CATEGORY, "Мех не определён", "Размер не указан"].includes(y) ? 1 : 0;
      return ux - uy || compareLabels(g, x, y);
    });
  const empty = { units: 0, costIncl: 0, costExcl: 0, orders: 0 };
  let maxUnits = 0;
  let maxCost = 0;
  for (const c of cells.values()) {
    maxUnits = Math.max(maxUnits, c.units);
    maxCost = Math.max(maxCost, c.costIncl);
  }
  return {
    rowLabels: sortLabels(rowTotals, rowKey),
    colLabels: sortLabels(colTotals, colKey),
    cell: (r, c) => cells.get(`${r}\u0000${c}`) ?? empty,
    maxUnits,
    maxCost,
    rowTotals,
    colTotals,
  };
}

/** Различные значения поля для выпадающих фильтров. */
export function distinct(rows: OrderRow[], g: GroupKey): string[] {
  return Array.from(new Set(rows.map((r) => groupLabel(r, g)))).sort((a, b) => compareLabels(g, a, b));
}
