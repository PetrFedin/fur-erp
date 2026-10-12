// Общие фильтры и параметры вида для «Изделий» и «Цен» — всё живёт в адресе страницы (рядом с общим годом из шапки и режимами 4% / НДС).
// Чистые функции без обращения к БД.
import type { OrderRow } from "@/lib/analytics-orders";
import { normalizeModelCode } from "@/lib/model-code";
import { UNDEFINED_CATEGORY, UNDEFINED_COLOR, UNDEFINED_SIZE } from "@/lib/product-category";
import { collectOrderSizes } from "@/lib/order-sizes";

const NO_SIZE = UNDEFINED_SIZE;
import { compareModelNames } from "@/lib/model-code";

export type SP = Record<string, string | string[] | undefined>;

const arr = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
export const one = (v: string | string[] | undefined) => arr(v)[0] ?? "";
const many = (v: string | string[] | undefined, max = 60) =>
  Array.from(new Set(arr(v).flatMap((s) => s.split("\u0001")).map((s) => s.trim().slice(0, 80)).filter(Boolean))).slice(0, max);
/** Значения под каноническим именем и его старыми псевдонимами (общие имена — src/lib/filters: category, auction, pyear, lotcolor). */
const manyAs = (sp: SP, ...names: string[]) => many(names.flatMap((n) => arr(sp[n])));

/** Имя параметра в адресе для поля SharedFilters (поля названы по-старому, адрес — по каноническим именам). */
export const PARAM_OF = { cat: "category", auc: "auction", py: "pyear", lc: "lotcolor" } as const;

export type VatFilter = "" | "20" | "22" | "mix";
export const VAT_LABEL: Record<Exclude<VatFilter, "">, string> = { "20": "НДС 20%", "22": "НДС 22%", mix: "смешанные ставки" };

export type SharedFilters = {
  cat: string[];
  fur: string[];
  size: string[];
  batch: string[];
  color: string[];
  /** Признаки меха (+ «none» — ТЗ без признака, если признаки вообще есть). */
  attr: string[];
  season: string[];
  q: string;
  vat: VatFilter;
  /** Диапазон себестоимости единицы системы (с НДС, в выбранном режиме 4%), ₽. */
  cmin: string;
  cmax: string;
  onlyH: boolean;
  onlyL: boolean;
  /** Сырьё: аукцион/сессия закупки, год закупки, цвет лота (по любому лоту меха в ТЗ). */
  auc: string[];
  py: string[];
  lc: string[];
  /** Вид: сортировка, расширенный набор колонок, выбранные колонки. */
  sort: string;
  dir: string;
  all: boolean;
  cols: string[];
};

const num = (s: string) => {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return s.trim() !== "" && Number.isFinite(n) && n >= 0 ? String(n) : "";
};

export function parseShared(sp: SP): SharedFilters {
  const vat = "" as "" | "20" | "22" | "mix"; // фильтр «Ставка НДС» убран из интерфейса: параметр адреса игнорируем
  return {
    cat: manyAs(sp, "category", "cat"),
    fur: many(sp.fur),
    size: many(sp.size),
    batch: many(sp.batch).filter((b) => /^\d{1,6}$/.test(b)),
    color: many(sp.color),
    season: many(sp.season),
    q: one(sp.q).trim().slice(0, 80),
    vat: vat === "20" || vat === "22" || vat === "mix" ? vat : "",
    cmin: num(one(sp.cmin)),
    cmax: num(one(sp.cmax)),
    onlyH: one(sp.onlyH) === "1",
    onlyL: one(sp.onlyL) === "1",
    auc: manyAs(sp, "auction", "auc"),
    py: manyAs(sp, "pyear", "py").filter((y) => /^\d{4}$/.test(y)),
    lc: manyAs(sp, "lotcolor", "lc"),
    attr: many(sp.attr),
    sort: one(sp.sort).slice(0, 20),
    dir: one(sp.dir) === "asc" ? "asc" : "desc",
    all: one(sp.all) === "1",
    cols: many(sp.cols, 30),
  };
}

/** Параметры фильтров в адрес (только непустые). Вид (sort/dir/all/cols) — отдельно, чтобы смена фильтра не сбивала порядок колонок. */
export function sharedParams(f: SharedFilters, over: Partial<SharedFilters> = {}, withView = true): URLSearchParams {
  const x = { ...f, ...over };
  const p = new URLSearchParams();
  for (const k of ["cat", "fur", "size", "batch", "color", "season", "auc", "py", "lc", "attr"] as const) for (const v of x[k]) p.append(k in PARAM_OF ? PARAM_OF[k as keyof typeof PARAM_OF] : k, v);
  if (x.q) p.set("q", x.q);
  if (x.vat) p.set("vat", x.vat);
  if (x.cmin) p.set("cmin", x.cmin);
  if (x.cmax) p.set("cmax", x.cmax);
  if (x.onlyH) p.set("onlyH", "1");
  if (x.onlyL) p.set("onlyL", "1");
  if (withView) {
    if (x.sort) {
      p.set("sort", x.sort);
      p.set("dir", x.dir);
    }
    if (x.all) p.set("all", "1");
    if (x.cols.length) p.set("cols", x.cols.join(","));
  }
  return p;
}

export const hasSharedFilter = (f: SharedFilters) =>
  !!(f.cat.length || f.fur.length || f.size.length || f.batch.length || f.color.length || f.season.length || f.q || f.vat || f.cmin || f.cmax || f.onlyH || f.onlyL || f.auc.length || f.py.length || f.lc.length || f.attr.length);

const unitCost = (r: OrderRow) => (r.qty > 0 && r.costIncl > 0 ? r.costIncl / r.qty : null);

/** Поиск по коду, названию, коду продаж, синонимам модели и по номеру ТЗ; кириллица и латиница в коде не различаются (M012 = М012). */
export function matchesQuery(r: OrderRow, q: string): boolean {
  const needle = normalizeModelCode(q.toLowerCase());
  const hay = normalizeModelCode(
    [r.number, r.workOrderNumber ?? "", r.modelName, r.modelSku ?? "", r.salesCode ?? "", ...r.modelAliases, r.category, r.fur, r.color, r.sizeRaw].join(" ").toLowerCase(),
  );
  return hay.includes(needle);
}

export function applyShared(rows: OrderRow[], f: SharedFilters): OrderRow[] {
  const cmin = f.cmin ? Number(f.cmin) : null;
  const cmax = f.cmax ? Number(f.cmax) : null;
  return rows.filter((r) => {
    if (f.cat.length && !f.cat.includes(r.category)) return false;
    if (f.fur.length && !f.fur.includes(r.fur)) return false;
    // Размер и цвет — по ВСЕМ размерам/цветам ТЗ (parseOrderSizes, orderColors); ТЗ без значения — под «не указан».
    if (f.size.length && !(r.sizes.length ? r.sizes.some((x) => f.size.includes(x)) : f.size.includes(NO_SIZE))) return false;
    if (f.batch.length && !f.batch.includes(String(r.batchNumber))) return false;
    if (f.color.length && !(r.colors.length ? r.colors.some((x) => f.color.includes(x)) : f.color.includes(UNDEFINED_COLOR))) return false;
    if (f.season.length && !f.season.includes(r.seasonCode ?? "")) return false;
    if (f.vat && r.vatKind !== f.vat) return false;
    if (f.onlyH && r.hammerSkins <= 0) return false;
    if (f.onlyL && !(r.liningQty > 0)) return false;
    if (f.auc.length && !r.auctions.some((a) => f.auc.includes(a))) return false;
    if (f.py.length && !r.purchaseYears.some((y) => f.py.includes(String(y)))) return false;
    if (f.lc.length && !r.lotColors.some((c) => f.lc.includes(c))) return false;
    if (f.attr.length && !(r.attrs.length ? r.attrs.some((a) => f.attr.includes(a)) : f.attr.includes("none"))) return false;
    if (cmin != null || cmax != null) {
      const u = unitCost(r);
      if (u == null || (cmin != null && u < cmin) || (cmax != null && u > cmax)) return false;
    }
    if (f.q && !matchesQuery(r, f.q)) return false;
    return true;
  });
}

export type Options = {
  cat: string[];
  fur: string[];
  size: string[];
  batch: string[];
  /** Подпись партии с годом: «Партия 5 · 2025». */
  batchLabels: Record<string, string>;
  color: string[];
  attr: string[];
  season: string[];
  auc: string[];
  py: string[];
  lc: string[];
  models: string[];
};

const uniq = (a: (string | null | undefined)[]) => Array.from(new Set(a.filter((x): x is string => !!x)));

/** Значения для выпадающих списков фильтров — по всем ТЗ выбранного года (без фильтров). */
export function filterOptions(all: OrderRow[]): Options {
  const ru = (a: string, b: string) => a.localeCompare(b, "ru");
  return {
    cat: uniq(all.map((r) => r.category)).sort((a, b) => (a === UNDEFINED_CATEGORY ? 1 : b === UNDEFINED_CATEGORY ? -1 : ru(a, b))),
    fur: uniq(all.map((r) => r.fur)).sort(ru),
    size: [...collectOrderSizes(all.map((r) => r.sizeRaw)), ...(all.some((r) => r.sizes.length === 0) ? [NO_SIZE] : [])],
    batch: uniq(all.map((r) => (r.batchNumber == null ? null : String(r.batchNumber)))).sort((a, b) => Number(a) - Number(b)),
    batchLabels: Object.fromEntries(all.filter((r) => r.batchNumber != null && r.batchText).map((r) => [String(r.batchNumber), r.batchText as string])),
    color: [...uniq(all.flatMap((r) => r.colors)).sort(ru), ...(all.some((r) => r.colors.length === 0) ? [UNDEFINED_COLOR] : [])],
    attr: (() => { const a = uniq(all.flatMap((r) => r.attrs)).sort((x, y) => x.localeCompare(y, "ru", { numeric: true })); return a.length ? [...a, ...(all.some((r) => r.attrs.length === 0) ? ["none"] : [])] : []; })(),
    season: uniq(all.map((r) => r.seasonCode)).sort(ru),
    auc: uniq(all.flatMap((r) => r.auctions)).sort(ru),
    py: uniq(all.flatMap((r) => r.purchaseYears.map(String))).sort(),
    lc: uniq(all.flatMap((r) => r.lotColors)).sort(ru),
    models: uniq(all.map((r) => r.modelName)).sort(compareModelNames),
  };
}
