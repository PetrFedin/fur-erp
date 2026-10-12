// Чистые расчёты таблиц «По месяцам» и «Стадии» календаря (без базы и React): строки — вид меха, столбцы — месяцы выбранного года
// (при «Все годы» — годы) и «Без даты», в ячейке — изделия по стадиям. Σ стадий без «Ремонт» = «Произведено» Главной.
import { STAGE_ORDER, type Stage } from "@/lib/calendar-actions";
import type { PipeItem } from "@/lib/calendar-pipeline";

export const NO_DATE = "none";
export type StageSums = Record<Stage, number>;
export const blankSums = (): StageSums => ({ plan: 0, raw: 0, work: 0, ready: 0, shipped: 0, repair: 0 });
export const sumOf = (s: StageSums, withRepair = true) => STAGE_ORDER.reduce((a, k) => a + (k === "repair" && !withRepair ? 0 : s[k]), 0);

export type TableFilters = { grp: string[]; fur: string[]; stage: string[] };

/** Изделия ТЗ по стадиям с учётом фильтров (группа, вид меха, стадии). Пусто — ТЗ в таблицу не попадает. */
export function unitsFor(p: PipeItem, f: TableFilters): Partial<Record<Stage, number>> {
  if (f.grp.length && (p.stage === "repair" || !f.grp.includes(p.grp))) return {};
  if (f.fur.length && !f.fur.includes(p.fur)) return {};
  const out: Partial<Record<Stage, number>> = {};
  for (const k of STAGE_ORDER) {
    const v = p.units[k];
    if (v && (!f.stage.length || f.stage.includes(k))) out[k] = v;
  }
  return out;
}

/** Ключ столбца: месяц «MM» выбранного года, год «ГГГГ» при «Все годы», «none» — даты нет. */
export function columnKey(p: PipeItem, allYears: boolean): string {
  if (allYears) return p.year == null ? NO_DATE : String(p.year);
  return p.bucket ? p.bucket.slice(5, 7) : NO_DATE;
}

export type MonthTable = {
  cols: string[];
  rows: { fur: string; cells: Record<string, StageSums>; total: StageSums; items: PipeItem[] }[];
  colTotals: Record<string, StageSums>;
  grand: StageSums;
};

export function buildMonthTable(items: PipeItem[], f: TableFilters, allYears: boolean): MonthTable {
  const byFur = new Map<string, { cells: Map<string, StageSums>; total: StageSums; items: PipeItem[] }>();
  const colTotals = new Map<string, StageSums>();
  const grand = blankSums();
  const colSet = new Set<string>();
  for (const p of items) {
    const u = unitsFor(p, f);
    if (Object.keys(u).length === 0) continue;
    const col = columnKey(p, allYears);
    colSet.add(col);
    const row = byFur.get(p.fur) ?? { cells: new Map<string, StageSums>(), total: blankSums(), items: [] as PipeItem[] };
    byFur.set(p.fur, row);
    row.items.push(p);
    const cell = row.cells.get(col) ?? blankSums();
    row.cells.set(col, cell);
    const ct = colTotals.get(col) ?? blankSums();
    colTotals.set(col, ct);
    for (const k of STAGE_ORDER) {
      const v = u[k] ?? 0;
      cell[k] += v; row.total[k] += v; ct[k] += v; grand[k] += v;
    }
  }
  const cols = allYears
    ? [...colSet].filter((c) => c !== NO_DATE).sort().concat(colSet.has(NO_DATE) ? [NO_DATE] : [])
    : [...Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")), ...(colSet.has(NO_DATE) ? [NO_DATE] : [])];
  const rows = [...byFur.entries()]
    .map(([fur, r]) => ({ fur, cells: Object.fromEntries(r.cells) as Record<string, StageSums>, total: r.total, items: r.items }))
    .sort((a, b) => sumOf(b.total) - sumOf(a.total) || a.fur.localeCompare(b.fur, "ru"));
  return { cols, rows, colTotals: Object.fromEntries(colTotals) as Record<string, StageSums>, grand };
}

/** ТЗ ячейки: row «*» — все виды меха, col «*» — все столбцы. */
export function cellItems(items: PipeItem[], f: TableFilters, allYears: boolean, col: string, fur: string): PipeItem[] {
  return items.filter((p) => Object.keys(unitsFor(p, f)).length > 0 && (col === "*" || columnKey(p, allYears) === col) && (fur === "*" || p.fur === fur));
}

/** Ближайшая и самая поздняя ожидаемая даты среди ТЗ (без дат — null). */
export function dateSpan(items: PipeItem[]): { min: string; max: string } | null {
  const ds = items.map((p) => p.expected?.date).filter((x): x is string => !!x).sort();
  return ds.length ? { min: ds[0], max: ds[ds.length - 1] } : null;
}

// ───── «По месяцам» v2: столбцы — месяцы «ГГГГ-ММ» (выбранный год или все подряд), «Без даты» ─────
export const MONTH_SHORT = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
export const MONTH_GEN = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

/** Выбор года внутри режима: «all» — все месяцы подряд, иначе «2026». */
export type MonthScope = string;

/** Месяц ТЗ «ГГГГ-ММ» (из bucket) или «none». */
export const monthOf = (p: PipeItem): string => (p.bucket ? p.bucket.slice(0, 7) : NO_DATE);
export const inScope = (p: PipeItem, my: MonthScope): boolean => my === "all" || p.year === Number(my);

/** «2026-10» → «Окт 2026» (short) или «Октябрь 2026». */
export function monthText(key: string, full = false): string {
  if (key === NO_DATE) return "Без даты";
  const [y, m] = key.split("-").map(Number);
  return `${full ? MONTH_GEN[m - 1][0].toUpperCase() + MONTH_GEN[m - 1].slice(1) : MONTH_SHORT[m - 1]} ${y}`;
}

const nextMonth = (k: string) => { const [y, m] = k.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };

/** Месяцы подряд от первого до последнего с данными; для года — все 12. «Без даты» — в конце, если есть. */
export function monthRange(items: PipeItem[], f: TableFilters, my: MonthScope): string[] {
  const used = items.filter((p) => inScope(p, my) && Object.keys(unitsFor(p, f)).length > 0);
  const hasNone = used.some((p) => monthOf(p) === NO_DATE);
  let cols: string[];
  if (my !== "all") cols = Array.from({ length: 12 }, (_, i) => `${my}-${String(i + 1).padStart(2, "0")}`);
  else {
    const ms = used.map(monthOf).filter((m) => m !== NO_DATE).sort();
    cols = [];
    if (ms.length) for (let k = ms[0]; k <= ms[ms.length - 1]; k = nextMonth(k)) cols.push(k);
  }
  return hasNone ? [...cols, NO_DATE] : cols;
}

export function buildMonthGrid(items: PipeItem[], f: TableFilters, my: MonthScope): MonthTable {
  const scoped = items.filter((p) => inScope(p, my));
  const byFur = new Map<string, { cells: Map<string, StageSums>; total: StageSums; items: PipeItem[] }>();
  const colTotals = new Map<string, StageSums>();
  const grand = blankSums();
  for (const p of scoped) {
    const u = unitsFor(p, f);
    if (Object.keys(u).length === 0) continue;
    const col = monthOf(p);
    const row = byFur.get(p.fur) ?? { cells: new Map<string, StageSums>(), total: blankSums(), items: [] as PipeItem[] };
    byFur.set(p.fur, row);
    row.items.push(p);
    const cell = row.cells.get(col) ?? blankSums(); row.cells.set(col, cell);
    const ct = colTotals.get(col) ?? blankSums(); colTotals.set(col, ct);
    for (const k of STAGE_ORDER) { const v = u[k] ?? 0; cell[k] += v; row.total[k] += v; ct[k] += v; grand[k] += v; }
  }
  const rows = [...byFur.entries()]
    .map(([fur, r]) => ({ fur, cells: Object.fromEntries(r.cells) as Record<string, StageSums>, total: r.total, items: r.items }))
    .sort((a, b) => sumOf(b.total, false) - sumOf(a.total, false) || a.fur.localeCompare(b.fur, "ru"));
  return { cols: monthRange(items, f, my), rows, colTotals: Object.fromEntries(colTotals) as Record<string, StageSums>, grand };
}

/** ТЗ ячейки «месяц × мех» (col/fur «*» — любые). */
export function gridCellItems(items: PipeItem[], f: TableFilters, my: MonthScope, col: string, fur: string): PipeItem[] {
  return items
    .filter((p) => inScope(p, my) && Object.keys(unitsFor(p, f)).length > 0 && (col === "*" || monthOf(p) === col) && (fur === "*" || p.fur === fur))
    .sort((a, b) => (a.expected?.date ?? "9999").localeCompare(b.expected?.date ?? "9999") || a.articleLabel.localeCompare(b.articleLabel, "ru"));
}
