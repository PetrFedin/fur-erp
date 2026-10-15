// Сортировка таблиц по клику на заголовок на серверных страницах: ?sort=ключ&dir=asc|desc.
// Числа сравниваются как числа, даты как даты, строки — по-русски с «натуральными» номерами (лот 2 < лот 10), пустые — в конце.
// Заголовок — <SortTh/> (src/components/sort-th.tsx). Если на странице несколько независимых таблиц, у каждой свой prefix.

export type SortDir = "asc" | "desc";
export type SortState = { key: string; dir: SortDir };
export type SortParams = Record<string, string | string[] | undefined>;
export type SortVal = string | number | Date | null | undefined;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Текущая сортировка из адреса; ключ вне списка allowed игнорируется (берётся def или null). */
export function readSort(sp: SortParams, allowed: string[], def: SortState | null = null, prefix = ""): SortState | null {
  const key = one(sp[`${prefix}sort`]);
  if (!key || !allowed.includes(key)) return def;
  const d = one(sp[`${prefix}dir`]);
  return { key, dir: d === "desc" ? "desc" : d === "asc" ? "asc" : def?.key === key ? def.dir : "asc" };
}

/** Повторный клик меняет направление; новый столбец — по возрастанию. */
export function nextDir(cur: SortState | null, key: string): SortDir {
  return cur?.key === key ? (cur.dir === "asc" ? "desc" : "asc") : "asc";
}

/** Ссылка для заголовка: остальные параметры адреса сохраняются. */
export function sortHref(path: string, sp: SortParams, key: string, cur: SortState | null, prefix = ""): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === `${prefix}sort` || k === `${prefix}dir`) continue;
    const val = Array.isArray(v) ? v[0] : v;
    if (val) q.set(k, val);
  }
  q.set(`${prefix}sort`, key);
  q.set(`${prefix}dir`, nextDir(cur, key));
  return `${path}?${q.toString()}`;
}

/** Свойства для <Th>/<TH> серверной страницы: состояние ▲/▼ и ссылка (см. также <SortTh/>, у которого есть и подпись). */
export function thSort(path: string, sp: SortParams, key: string, cur: SortState | null, prefix = ""): { sort: "asc" | "desc" | "none"; href: string } {
  return { sort: cur?.key === key ? cur.dir : "none", href: sortHref(path, sp, key, cur, prefix) };
}

const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

function cmp(a: SortVal, b: SortVal): number {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  if (typeof x === "number" && typeof y === "number") return x - y;
  return collator.compare(String(x), String(y));
}

/** Стабильная сортировка копии; пустые значения всегда в конце (при любом направлении). */
export function sortRows<T>(rows: T[], st: SortState | null, getters: Record<string, (r: T) => SortVal>): T[] {
  const get = st ? getters[st.key] : undefined;
  if (!st || !get) return rows;
  const sign = st.dir === "desc" ? -1 : 1;
  const empty = (v: SortVal) => v == null || v === "" || (typeof v === "number" && !Number.isFinite(v));
  return rows
    .map((r, i) => ({ r, i, v: get(r) }))
    .sort((p, q) => {
      const pe = empty(p.v), qe = empty(q.v);
      if (pe || qe) return pe && qe ? p.i - q.i : pe ? 1 : -1;
      return sign * cmp(p.v, q.v) || p.i - q.i;
    })
    .map((x) => x.r);
}
