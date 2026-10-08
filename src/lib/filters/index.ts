// Единый разбор фильтров страниц (docs/analysis/filters.md): одно имя параметра на одно понятие, повтор ключа
// для мультивыбора (`auction=А&auction=Б`; запятая не годится — в названиях аукционов есть запятые), старые имена —
// псевдонимы (`auc`, `py`, `lc`, `kind`, `dq`, `cat`, `nds`, `need`…). Чистые функции без базы и React:
// их вызывают и серверные страницы, и клиентская панель <FilterBar>.
//
//   const F = defineFilters({ auction: FILTER_CATALOG.auction, q: FILTER_CATALOG.q, tab: stateParam("tab") });
//   const f = parseFilters(F, await searchParams);        // f.auction: string[], f.q: string
//   filterHref(F, "/lots", f, { auction: ["СП 09.26"] }); // ссылка с заменой значения, page/limit сброшены
//   activeChips(F, f, { path: "/lots", labels })          // чипы «Партия: СП 09.26 ×»
//   toWhere(f, { status: (v) => ({ status: { in: v } }) }) // фрагменты where для Prisma
import { cleanSearch, parseDateInput } from "@/lib/input";

export type FilterKind = "multi" | "single" | "text" | "date";

export type FilterDef = {
  kind: FilterKind;
  /** Подпись в панели и чипах. */
  label: string;
  /** Старые имена параметра: читаются, при записи в адрес стираются. */
  aliases?: readonly string[];
  /** Допустимые значения (для multi/single); остальные отбрасываются. */
  allowed?: readonly string[];
  /** Допустимый вид значения (для multi/single), например /^\d{4}$/. */
  pattern?: RegExp;
  /** Максимальная длина одного значения. */
  maxLen?: number;
  /** state — параметр вида (tab, view, sort, page…): не чип, не сбрасывается кнопкой «Сбросить всё». */
  role?: "filter" | "state";
};

export type FilterDefs = Record<string, FilterDef>;
export type FilterSchema<D extends FilterDefs = FilterDefs> = { readonly defs: D; readonly keys: ReadonlyArray<keyof D & string> };
export type FilterValues<D extends FilterDefs> = { [K in keyof D]: D[K]["kind"] extends "multi" ? string[] : string };
export type SearchParamsLike = Record<string, string | string[] | undefined>;

/** Вариант выпадающего списка: value — в адресе, label — на экране, count — сколько записей, title — полное название. */
export type FilterOption = { value: string; label: string; count?: number; title?: string };

export const MAX_VALUES = 60;
/** Служебное значение мультивыбора «Без …» (поле не заполнено). */
export const NONE = "none";

/** Параметры вида: по умолчанию есть у любой схемы; при смене фильтра page и limit сбрасываются. */
const PAGING = ["page", "limit"] as const;

export const stateParam = (label: string, opts: Partial<FilterDef> = {}): FilterDef => ({ kind: "single", label, role: "state", maxLen: 40, ...opts });

export function defineFilters<const D extends FilterDefs>(defs: D): FilterSchema<D & { page: FilterDef; limit: FilterDef }> {
  const all = {
    page: stateParam("Страница", { pattern: /^\d{1,6}$/ }),
    limit: stateParam("Показывать", { pattern: /^\d{1,6}$/ }),
    ...defs,
  } as D & { page: FilterDef; limit: FilterDef };
  return { defs: all, keys: Object.keys(all) as Array<keyof typeof all & string> };
}

/** Все имена параметра: каноническое и псевдонимы. */
export const namesOf = (key: string, def: FilterDef): string[] => [key, ...(def.aliases ?? [])];

const asList = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

function okValue(def: FilterDef, v: string): boolean {
  if (def.allowed && !def.allowed.includes(v)) return false;
  if (def.pattern && !def.pattern.test(v)) return false;
  return true;
}

function readOne(def: FilterDef, key: string, sp: SearchParamsLike): string | string[] {
  const raw = namesOf(key, def).flatMap((n) => asList(sp[n]));
  const max = def.maxLen ?? (def.kind === "text" ? 100 : 200);
  if (def.kind === "multi") {
    const out: string[] = [];
    for (const r of raw) {
      const v = cleanSearch(r, max);
      if (v && okValue(def, v) && !out.includes(v)) out.push(v);
      if (out.length >= MAX_VALUES) break;
    }
    return out;
  }
  for (const r of raw) {
    const v = cleanSearch(r, max);
    if (!v) continue;
    if (def.kind === "date") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(v) && parseDateInput(v)) return v;
      continue;
    }
    if (def.kind === "single" && !okValue(def, v)) continue;
    return v;
  }
  return "";
}

export function parseFilters<D extends FilterDefs>(schema: FilterSchema<D>, sp: SearchParamsLike): FilterValues<D> {
  const out: Record<string, string | string[]> = {};
  for (const k of schema.keys) out[k] = readOne(schema.defs[k], k, sp);
  return out as FilterValues<D>;
}

const isEmpty = (v: string | string[] | undefined) => (Array.isArray(v) ? v.length === 0 : !v);

/** Параметры адреса из значений (канонические имена; пустое — без параметра). */
export function filterEntries<D extends FilterDefs>(schema: FilterSchema<D>, values: Partial<FilterValues<D>>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const k of schema.keys) {
    const v = values[k] as string | string[] | undefined;
    if (isEmpty(v)) continue;
    if (Array.isArray(v)) for (const x of v) out.push([k, x]);
    else out.push([k, v as string]);
  }
  return out;
}

const q = (entries: Array<[string, string]>) => {
  const p = new URLSearchParams();
  for (const [k, v] of entries) p.append(k, v);
  return p.toString();
};

/**
 * Ссылка на страницу с изменёнными значениями. `values` — текущие (после parseFilters), `patch` — что заменить.
 * Если меняется фильтр (не page/limit) — page и limit сбрасываются. Остальные значения (в т. ч. tab, view, sort) сохраняются.
 */
export function filterHref<D extends FilterDefs>(
  schema: FilterSchema<D>,
  path: string,
  values: Partial<FilterValues<D>>,
  patch: Partial<FilterValues<D>> = {},
  opts: { hash?: string } = {},
): string {
  const merged: Partial<FilterValues<D>> = { ...values, ...patch };
  const touched = Object.keys(patch).some((k) => !(PAGING as readonly string[]).includes(k));
  if (touched) for (const p of PAGING) if (!(p in patch)) (merged as Record<string, unknown>)[p] = "";
  const qs = q(filterEntries(schema, merged));
  return `${path}${qs ? `?${qs}` : ""}${opts.hash ?? ""}`;
}

/** Ссылка «Сбросить всё»: убирает все фильтры, оставляет параметры вида (tab, view, sort…), кроме page/limit. */
export function resetHref<D extends FilterDefs>(schema: FilterSchema<D>, path: string, values: Partial<FilterValues<D>>, opts: { hash?: string } = {}): string {
  const kept: Partial<FilterValues<D>> = {};
  for (const k of schema.keys) {
    if (schema.defs[k].role !== "state" || (PAGING as readonly string[]).includes(k)) continue;
    (kept as Record<string, unknown>)[k] = values[k];
  }
  const qs = q(filterEntries(schema, kept));
  return `${path}${qs ? `?${qs}` : ""}${opts.hash ?? ""}`;
}

export type FilterChip = { key: string; value: string; label: string; text: string; href: string };

/** Чипы активных фильтров (кроме параметров вида). Клик по чипу снимает одно значение. */
export function activeChips<D extends FilterDefs>(
  schema: FilterSchema<D>,
  values: Partial<FilterValues<D>>,
  ctx: { path: string; labels?: Record<string, Record<string, string>>; hash?: string },
): FilterChip[] {
  const out: FilterChip[] = [];
  for (const k of schema.keys) {
    const def = schema.defs[k];
    if (def.role === "state") continue;
    const v = values[k] as string | string[] | undefined;
    if (isEmpty(v)) continue;
    for (const x of Array.isArray(v) ? v : [v as string]) {
      const text = ctx.labels?.[k]?.[x] ?? (x === NONE ? "Без значения" : x);
      const rest = Array.isArray(v) ? v.filter((y) => y !== x) : "";
      out.push({
        key: k,
        value: x,
        label: def.label,
        text,
        href: filterHref(schema, ctx.path, values, { [k]: rest } as Partial<FilterValues<D>>, { hash: ctx.hash }),
      });
    }
  }
  return out;
}

/** Сколько фильтров включено (значения мультивыбора считаются по одному; параметры вида не считаются). */
export function activeCount<D extends FilterDefs>(schema: FilterSchema<D>, values: Partial<FilterValues<D>>): number {
  let n = 0;
  for (const k of schema.keys) {
    if (schema.defs[k].role === "state") continue;
    const v = values[k] as string | string[] | undefined;
    if (!isEmpty(v)) n += Array.isArray(v) ? v.length : 1;
  }
  return n;
}

/**
 * Фрагменты `where` для Prisma: по правилу на каждый непустой фильтр. Использование: `AND: toWhere(f, { status: (v) => ({ status: { in: v } }) })`.
 * Правило получает значение (массив для multi, строку для остальных) и возвращает фрагмент либо undefined.
 */
export function toWhere<V extends object, W>(values: V, rules: { [K in keyof V]?: (v: V[K]) => W | undefined }): W[] {
  const out: W[] = [];
  for (const k of Object.keys(rules) as Array<keyof V>) {
    const rule = rules[k];
    const v = values[k];
    if (!rule || isEmpty(v as unknown as string | string[])) continue;
    const w = rule(v);
    if (w !== undefined) out.push(w);
  }
  return out;
}

/** Делит значения мультивыбора на «Без …» (none) и обычные. */
export function splitNone(values: string[]): { none: boolean; rest: string[] } {
  return { none: values.includes(NONE), rest: values.filter((v) => v !== NONE) };
}

/** Проверка в памяти: пустой выбор = всё подходит; none — значения нет; иначе значение среди выбранных. */
export function matchesMulti(selected: string[], value: string | null | undefined): boolean {
  if (selected.length === 0) return true;
  const empty = value == null || value === "";
  if (empty) return selected.includes(NONE);
  return selected.includes(value);
}

/** Границы дат «с / по» для Prisma: `to` включительно (до конца суток UTC). */
export function dateRange(from: string, to: string): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) };
}

/** Диапазоны дат для Prisma по выбранным годам (UTC): `{ OR: yearRanges(years).map((r) => ({ plannedDate: r })) }`. */
export function yearRanges(years: string[]): Array<{ gte: Date; lt: Date }> {
  return years.filter((y) => /^\d{4}$/.test(y)).map((y) => ({ gte: new Date(Date.UTC(Number(y), 0, 1)), lt: new Date(Date.UTC(Number(y) + 1, 0, 1)) }));
}

/** Варианты «Год» по датам записей: годы по убыванию, со счётчиком записей. */
export function yearOptionsFrom(dates: Array<Date | null | undefined>): FilterOption[] {
  const counts = new Map<string, number>();
  for (const d of dates) if (d) counts.set(String(d.getUTCFullYear()), (counts.get(String(d.getUTCFullYear())) ?? 0) + 1);
  return Array.from(counts, ([value, count]) => ({ value, label: value, count })).sort((a, b) => Number(b.value) - Number(a.value));
}

// ───────────────────────────── каталог общих понятий ─────────────────────────────
// Одно понятие — одно имя на всех страницах. Страница берёт нужное: `pick("auction", "q")`.

export const FILTER_CATALOG = {
  auction: { kind: "multi", label: "Партия закупки (аукцион)", aliases: ["auc"] },
  pyear: { kind: "multi", label: "Год закупки", aliases: ["py"], pattern: /^\d{4}$/ },
  year: { kind: "multi", label: "Год", pattern: /^\d{4}$/ },
  fur: { kind: "multi", label: "Вид меха", aliases: ["kind"] },
  color: { kind: "multi", label: "Цвет" },
  /** Признак меха из справочника /settings/fur-attrs («Седина 3», «Дикий», «Тонированный»); none — без признака. */
  attr: { kind: "multi", label: "Признак меха" },
  lotcolor: { kind: "multi", label: "Цвет лота", aliases: ["lc"] },
  batch: { kind: "multi", label: "Партия производства", pattern: /^\d{1,6}$/ },
  status: { kind: "multi", label: "Статус" },
  verified: { kind: "multi", label: "Проверка", aliases: ["filter"] },
  supplier: { kind: "multi", label: "Поставщик" },
  client: { kind: "multi", label: "Заказчик" },
  category: { kind: "multi", label: "Категория", aliases: ["cat"] },
  size: { kind: "multi", label: "Размер" },
  season: { kind: "multi", label: "Сезон" },
  vat: { kind: "multi", label: "Ставка НДС", aliases: ["nds"], allowed: ["20", "22", "mixed", "mix"] },
  model: { kind: "multi", label: "Модель" },
  material: { kind: "multi", label: "Материал" },
  q: { kind: "text", label: "Поиск", aliases: ["dq", "article"] },
  from: { kind: "date", label: "Дата с" },
  to: { kind: "date", label: "Дата по" },
  docs: { kind: "multi", label: "Документы и оплата", aliases: ["need"] },
  sort: { kind: "single", label: "Сортировка", role: "state", maxLen: 20 },
  dir: { kind: "single", label: "Порядок", role: "state", allowed: ["asc", "desc"] },
  tab: { kind: "single", label: "Вкладка", role: "state", maxLen: 20 },
  view: { kind: "single", label: "Вид", role: "state", maxLen: 20 },
  vatmode: { kind: "single", label: "Режим НДС", role: "state", allowed: ["incl", "excl"] },
} as const satisfies FilterDefs;

export type CatalogKey = keyof typeof FILTER_CATALOG;

/** Взять понятия из каталога; `over` меняет подпись/псевдонимы/допустимые значения под страницу. */
export function pick<const K extends CatalogKey>(keys: readonly K[], over: { [P in K]?: Partial<FilterDef> } = {}): { [P in K]: (typeof FILTER_CATALOG)[P] & FilterDef } {
  const out: Record<string, FilterDef> = {};
  for (const k of keys) out[k] = { ...(FILTER_CATALOG[k] as FilterDef), ...((over as Record<string, Partial<FilterDef>>)[k] ?? {}) };
  return out as { [P in K]: (typeof FILTER_CATALOG)[P] & FilterDef };
}
