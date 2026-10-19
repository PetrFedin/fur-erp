// Раскладка принятого по площадкам ЦУМ (уровень 2 приёмки) — матрица «позиции × площадки». Только чистые функции:
// проверка ввода, «как в накладных», расхождения. Хранится в SystemState «shipment-zi:<id>» → alloc (правки пользователей),
// импортированное из накладных лежит в самих строках ЗИ и подставляется кнопкой «Как в накладных».
import type { ZiLine } from "@/lib/shipment-zi";

export const ALLOC_SITES = ["Третьяковская", "Барвиха", "Кутузовская", "Славянка", "ДЛТ", "ЦУМ"] as const;
export const ALLOC_LIMITS = { sites: 12, rej: 10, qty: 9999, site: 60, reason: 300, size: 10, sum: 1_000_000_000 } as const;

export type RejRow = { id: string; site: string; size: string; qty: number; reason: string; by: string; at: string };
export type LineCells = { cells: Record<string, number>; rej: RejRow[] };
export type AllocState = { sites: string[]; lines: Record<string, LineCells>; sums: Record<string, number | null>; by: string; at: string };
export type AllocInput = {
  sites?: unknown;
  cells?: Record<string, Record<string, unknown>>;
  rej?: Record<string, { id?: unknown; site?: unknown; size?: unknown; qty?: unknown; reason?: unknown }[]>;
  sums?: Record<string, unknown>;
};

const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max + 1);
const idOf = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : crypto.randomUUID());
const intOf = (v: unknown): number | null => {
  const t = String(v ?? "").replace(/\s/g, "");
  if (t === "") return 0; // пусто = 0
  if (!/^\d{1,6}$/.test(t)) return null;
  return Number(t);
};
const keyOf = (s: string) => s.toLowerCase().replace(/ё/g, "е");

export type LineCtx = { quantity: number; accepted: number | null; label: string };

/** Проверка и очистка матрицы. ctx — по id строки отгрузки (только они допустимы). Текст ошибки или очищенное состояние. */
export function validateAlloc(input: AllocInput, ctx: Record<string, LineCtx>, who: string, at: string): { error: string } | { state: AllocState } {
  const L = ALLOC_LIMITS;
  const rawSites = Array.isArray(input.sites) ? input.sites : [];
  if (rawSites.length > L.sites) return { error: `Не больше ${L.sites} площадок` };
  const sites: string[] = [];
  for (const s of rawSites) {
    const name = clean(s, L.site);
    if (!name) return { error: "Название площадки не может быть пустым" };
    if (name.length > L.site) return { error: `Название площадки не длиннее ${L.site} символов` };
    if (sites.some((x) => keyOf(x) === keyOf(name))) return { error: `Площадка «${name}» названа дважды` };
    sites.push(name);
  }
  const lines: Record<string, LineCells> = {};
  for (const id of Object.keys(input.cells ?? {})) if (!ctx[id]) return { error: "Строка не из этой отгрузки" };
  for (const id of Object.keys(input.rej ?? {})) if (!ctx[id]) return { error: "Строка не из этой отгрузки" };
  for (const [id, c] of Object.entries(ctx)) {
    const inCells = input.cells?.[id] ?? {};
    const cells: Record<string, number> = {};
    for (const [site, v] of Object.entries(inCells)) {
      const name = sites.find((s) => keyOf(s) === keyOf(site));
      if (!name) return { error: `${c.label}: площадки «${clean(site, 30)}» нет среди столбцов` };
      const q = intOf(v);
      if (q == null || q > L.qty) return { error: `${c.label}, «${name}»: количество — целое число от 0 до ${L.qty}` };
      if (q > 0) cells[name] = q;
    }
    const inRej = Array.isArray(input.rej?.[id]) ? input.rej![id] : [];
    if (inRej.length > L.rej) return { error: `${c.label}: не больше ${L.rej} отметок «не принято»` };
    const rej: RejRow[] = [];
    for (const [i, r] of inRej.entries()) {
      const size = clean(r.size, L.size), reason = clean(r.reason, L.reason), site = clean(r.site, L.site);
      if (!size) return { error: `${c.label}: не принято ${i + 1} — укажите размер` };
      if (size.length > L.size) return { error: `${c.label}: размер не длиннее ${L.size} символов` };
      if (!reason) return { error: `${c.label}: не принято ${i + 1} — укажите причину` };
      if (reason.length > L.reason || site.length > L.site) return { error: `${c.label}: слишком длинный текст` };
      const q = intOf(r.qty);
      if (q == null || q < 1 || q > L.qty) return { error: `${c.label}: не принято ${i + 1} — количество целое, от 1` };
      rej.push({ id: idOf(r.id), site, size, qty: q, reason, by: who, at });
    }
    const distributed = Object.values(cells).reduce((t, x) => t + x, 0) + rej.reduce((t, r) => t + r.qty, 0);
    if (distributed > (c.accepted ?? 0)) return { error: `${c.label}: разложено ${distributed} шт. (с «не принято»), принято в Коптево ${c.accepted ?? 0}` };
    if (Object.keys(cells).length || rej.length) lines[id] = { cells, rej };
  }
  const sums: Record<string, number | null> = {};
  for (const [site, v] of Object.entries(input.sums ?? {})) {
    const name = sites.find((s) => keyOf(s) === keyOf(site));
    if (!name) return { error: `Сумма: площадки «${clean(site, 30)}» нет среди столбцов` };
    if (v == null || String(v).trim() === "") continue;
    const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > L.sum) return { error: `Сумма по «${name}»: число от 0 (₽, с НДС)` };
    sums[name] = Math.round(n * 100) / 100;
  }
  return { state: { sites, lines, sums, by: who, at } };
}

export type ZiSite = { site: string; qty: number; sum: number; supply: string };
/** Накладные одной позиции → разбивка по площадкам (сумма с НДС). */
export function ziBySite(items: readonly ZiLine[]): ZiSite[] {
  const m = new Map<string, ZiSite>();
  for (const z of items) {
    const cur = m.get(z.boutique) ?? { site: z.boutique, qty: 0, sum: 0, supply: z.supply };
    cur.qty += 1; cur.sum = Math.round((cur.sum + z.sum + z.vat) * 100) / 100;
    if (!cur.supply.split(", ").includes(z.supply)) cur.supply += `, ${z.supply}`;
    m.set(z.boutique, cur);
  }
  return [...m.values()];
}

/** «Как в накладных»: вся матрица из накладных; порядок столбцов — как в накладных. Ошибка, если по какой-то позиции не помещается в принятое. */
export function allocFromZi(perLine: Record<string, { sites: ZiSite[]; accepted: number | null; label: string }>, ziOrder: readonly string[], who: string, at: string): { error: string } | { state: AllocState } {
  const sites = [...new Set([...ziOrder, ...Object.values(perLine).flatMap((p) => p.sites.map((s) => s.site))])];
  const lines: Record<string, LineCells> = {};
  const sums: Record<string, number | null> = {};
  for (const [id, p] of Object.entries(perLine)) {
    const total = p.sites.reduce((t, s) => t + s.qty, 0);
    if (total === 0) continue;
    if (total > (p.accepted ?? 0)) return { error: `${p.label}: в накладных ${total} шт., принято в Коптево ${p.accepted ?? 0}` };
    lines[id] = { cells: Object.fromEntries(p.sites.map((s) => [s.site, s.qty])), rej: [] };
    for (const s of p.sites) sums[s.site] = Math.round(((sums[s.site] ?? 0) + s.sum) * 100) / 100;
  }
  if (!Object.keys(lines).length) return { error: "В накладных нет строк по этой отгрузке" };
  return { state: { sites, lines, sums, by: who, at } };
}

export type LineDiff = { ok: boolean; delta: number };
/** Остаток/расхождение по строке: принято в Коптево − (разложено + не принято на площадках). 0 — сходится. */
export function lineDiff(accepted: number | null, distributed: number): LineDiff {
  const delta = (accepted ?? 0) - distributed;
  return { ok: delta === 0, delta };
}
export const fmtDelta = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

/** Σ введённых сумм против суммы накладной (допуск 1 ₽): разница в ₽. */
export function sumDiff(entered: number, invoice: number): { ok: boolean; diff: number } {
  const diff = Math.round((entered - invoice) * 100) / 100;
  return { ok: Math.abs(diff) <= 1, diff };
}

export function parseAlloc(v: unknown): AllocState | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<AllocState>;
  if (!Array.isArray(o.sites) || !o.lines || typeof o.lines !== "object") return null;
  return { sites: o.sites.map(String), lines: o.lines as Record<string, LineCells>, sums: (o.sums ?? {}) as Record<string, number | null>, by: String(o.by ?? ""), at: String(o.at ?? "") };
}
