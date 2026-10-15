// Группировка и фильтры для «Что произведено» (/analytics/products). Чистые функции без обращения к БД:
// страница и выгрузка CSV строятся из одних и тех же строк и одних и тех же функций.
import { compareModelNames } from "@/lib/model-code";
import { compareSizes, UNDEFINED_CATEGORY } from "@/lib/product-category";
import type { OrderRow } from "@/lib/analytics-orders";
import { orderKey } from "@/lib/tz-key";
import { applyShared, one, parseShared, sharedParams, type SP, type SharedFilters } from "@/lib/analytics-filters";
import { computeMetrics, sortItems, type Metrics } from "@/lib/analytics-metrics";

export const GROUPS = {
  category: "Категория изделия",
  fur: "Вид меха",
  size: "Размер изделия",
  model: "Модель (артикул)",
  batch: "Партия",
  year: "Год",
  color: "Цвет",
  order: "ТЗ",
} as const;
export type GroupKey = keyof typeof GROUPS;
export const GROUP_KEYS = Object.keys(GROUPS) as GroupKey[];

export type ProductFilters = SharedFilters & {
  g: GroupKey;
  /** Второй уровень группировки (внутри первого); пусто — один уровень. */
  g2: GroupKey | "";
  mx: "units" | "cost";
};

export function parseProductFilters(sp: SP): ProductFilters {
  const g = one(sp.g) as GroupKey;
  const g2 = one(sp.g2) as GroupKey;
  const gg: GroupKey = g in GROUPS ? g : "category";
  return {
    ...parseShared(sp),
    g: gg,
    g2: g2 in GROUPS && g2 !== gg ? g2 : "",
    mx: one(sp.mx) === "cost" ? "cost" : "units",
  };
}

/** Параметры в адрес (только непустые и отличающиеся от умолчаний). */
export function productParams(f: ProductFilters, over: Partial<ProductFilters> = {}, withView = true): URLSearchParams {
  const x = { ...f, ...over };
  const p = sharedParams(x, {}, withView);
  if (x.g !== "category") p.set("g", x.g);
  if (x.g2) p.set("g2", x.g2);
  if (x.mx !== "units") p.set("mx", x.mx);
  return p;
}
export function productQuery(f: ProductFilters, over: Partial<ProductFilters> = {}): string {
  const s = productParams(f, over).toString();
  return s ? `?${s}` : "";
}

export function applyFilters(rows: OrderRow[], f: ProductFilters): OrderRow[] {
  return applyShared(rows, f);
}

export const orderLabel = (r: OrderRow) => (r.workOrderNumber && r.workOrderNumber !== r.number ? `${r.number} (заказчика ${r.workOrderNumber})` : r.number);

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
      return r.batchNumber == null ? "Вне партий" : `Партия ${r.batchNumber}`;
    case "year":
      return r.year == null ? "Год не определён" : String(r.year);
    case "color":
      return r.color;
    case "order":
      return `ТЗ ${r.number}`;
  }
}

function compareLabels(g: GroupKey, a: string, b: string): number {
  if (g === "model") return compareModelNames(a, b);
  if (g === "size") return compareSizes(a, b);
  if (g === "batch") return Number(a.replace(/\D/g, "") || 1e9) - Number(b.replace(/\D/g, "") || 1e9);
  if (g === "year") return a.localeCompare(b);
  if (g === "order") return a.localeCompare(b, "ru", { numeric: true });
  return a.localeCompare(b, "ru");
}

const UNDEFINED_LABELS = new Set([UNDEFINED_CATEGORY, "Мех не определён", "Размер не указан", "Цвет не указан", "Вне партий", "Год не определён"]);

export type GroupNode = {
  /** Ключ для ссылок и React: значение группы первого уровня (и второго через «\u0000»). */
  key: string;
  label: string;
  rows: OrderRow[];
  m: Metrics;
  children: GroupNode[];
};

function bucket(rows: OrderRow[], g: GroupKey, prefix: string): GroupNode[] {
  const m = new Map<string, OrderRow[]>();
  for (const r of rows) {
    const k = groupLabel(r, g);
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return Array.from(m, ([label, rs]) => ({ key: prefix + label, label, rows: rs, m: computeMetrics(rs), children: [] as GroupNode[] }));
}

/** Порядок по умолчанию: «не определено» в конец; категории/мех/цвет — по единицам, остальное — по названию. */
function defaultOrder(nodes: GroupNode[], g: GroupKey): GroupNode[] {
  return nodes.sort((a, b) => {
    const ua = UNDEFINED_LABELS.has(a.label) ? 1 : 0;
    const ub = UNDEFINED_LABELS.has(b.label) ? 1 : 0;
    if (ua !== ub) return ua - ub;
    if (g === "category" || g === "fur" || g === "color") return b.m.units - a.m.units || compareLabels(g, a.label, b.label);
    return compareLabels(g, a.label, b.label);
  });
}

/** Группы первого (и второго) уровня с показателями; sort/dir — порядок на каждом уровне. */
export function buildGroups(rows: OrderRow[], g: GroupKey, g2: GroupKey | "", sort: Parameters<typeof sortItems>[1], dir: Parameters<typeof sortItems>[2]): { nodes: GroupNode[]; total: Metrics } {
  const total = computeMetrics(rows);
  const order = (ns: GroupNode[], gg: GroupKey) => (sort ? sortItems(ns, sort, dir, total) : defaultOrder(ns, gg));
  const top = order(bucket(rows, g, ""), g);
  if (g2) for (const n of top) n.children = order(bucket(n.rows, g2, `${n.label}\u0000`), g2);
  return { nodes: top, total };
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
  const cellTz = new Map<string, Set<string>>();
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
    const tz = cellTz.get(k) ?? new Set<string>();
    tz.add(orderKey(r));
    cellTz.set(k, tz);
    c.orders = tz.size;
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
      const ux = UNDEFINED_LABELS.has(x) ? 1 : 0;
      const uy = UNDEFINED_LABELS.has(y) ? 1 : 0;
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
