/**
 * Вставка таблицы из Excel (буфер обмена или файл .xlsx) в «Таблицу как в Excel» расчёта аукциона.
 * Чистая логика без БД и без браузера: работает в форме, на сервере и в scripts/test-sheet-paste.ts.
 *
 * Что делает:
 *  1. находит строку заголовков (invoice, fur, lot, quantity, Закупка…) и сопоставляет столбцы по названиям;
 *  2. вносит лоты в столбцы ввода (мех, описание, лот, количество, закупка, свои столбцы ввода);
 *  3. «курс» и другие параметры формата: общее значение уходит в параметр, отличающиеся строки получают своё значение строки;
 *  4. столбцы файла, которые у нас считаются формулой (сбор, себестоимость…), сверяются с нашим расчётом; если в какой-то строке
 *     в файле иначе (например, другая ставка сбора на лотах Лисы), подбирается значение параметра строки, а если не вышло —
 *     ячейка помечается «вручную» с числом из файла. Итог по каждому сверенному столбцу показывается в отчёте.
 */
import { calcAll, evalNum, newId, paramKey, rowFilled, sheetColumns, auctionNameFromTitle, syncLetters, type CalcPayload, type CalcRow, type CustomCol } from "@/lib/supplier-calc";

export type PasteCheck = { title: string; file: number; ours: number; ok: boolean };
export type PasteResult = {
  payload: CalcPayload;
  /** Сколько лотов добавлено. */
  added: number;
  /** Что распознано: «столбец файла → куда». */
  mapped: string[];
  /** Столбцы файла, которые не использованы. */
  skipped: string[];
  checks: PasteCheck[];
  /** Ячейки, где значение взято из файла вручную (не по формуле). */
  manualCells: number;
  /** Строки, у которых своё значение параметра (курс, ставка). */
  rowParams: string[];
  notes: string[];
};

const nt = (s: string) => norm(s.replace(/\(в файле [a-z]+\)/gi, ""));
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}%]+/gu, " ").trim();
const TOTAL_RE = /^(итого|всего|total|к оплате)/i;

/** Разбор текста из буфера Excel (табуляции, кавычки) в таблицу. */
export function parseClipboardTable(text: string): string[][] {
  const t = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === "\t") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); cell = ""; rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

type Target =
  | { t: "row"; key: "invoice" | "fur" | "size" | "lot" | "operation" | "dest" }
  | { t: "input"; id: string }
  | { t: "param"; name: string }
  | { t: "check"; id: string; title: string }
  | { t: "skip" };

const ROW_ALIASES: [RegExp, "invoice" | "fur" | "size" | "lot" | "operation" | "dest"][] = [
  [/^(invoice|счет|номер счета|№ счета)(\s|$)/, "invoice"],
  [/^(fur|мех)(\s|$)/, "fur"],
  [/^(size|description|описание|размер|grade|color|цвет)/, "size"],
  [/^(lot|лот)(\s|$)/, "lot"],
  [/^(operation|операция)/, "operation"],
  [/^(куда|dest)/, "dest"],
];
const QTY_RE = /^(quantity|кол|количество|шт)(\s|$|\.)/;
const PRICE_RE = /^(закупка|price|цена)/;

/** Сколько заголовков строки узнаются: нужно ≥ 2 и среди них лот или количество. */
export function headerScore(cells: string[]): number {
  let n = 0;
  for (const c of cells) {
    const h = norm(c);
    if (!h) continue;
    if (ROW_ALIASES.some(([re]) => re.test(h)) || QTY_RE.test(h) || PRICE_RE.test(h)) n++;
  }
  return n;
}
export function findHeaderRow(table: string[][]): number {
  for (let i = 0; i < Math.min(table.length, 12); i++) {
    const h = table[i].map(norm);
    if (headerScore(table[i]) >= 3 && h.some((x) => /^(lot|лот)/.test(x)) && h.some((x) => QTY_RE.test(x))) return i;
  }
  return -1;
}

const decimalsOf = (s: string) => { const m = /[.,](\d+)\s*$/.exec(s.trim()); return m ? m[1].length : 0; };
/** Число из ячейки Excel как строка (без пробелов и значков валют, запятая → точка); пусто, если не число. */
function numStr(s: string): string {
  const v = evalNum(s);
  if (!Number.isFinite(v)) return "";
  return /^[\s\d.,\-− ₽$€]+$/.test(s.trim()) ? String(Number(v.toPrecision(15))) : String(v);
}

export function applySheetTable(p: CalcPayload, tableIn: string[][], opts: { replace?: boolean } = {}): PasteResult | { error: string } {
  if (p.format !== "SHEET") return { error: "Вставка по заголовкам работает в «Своей таблице» — выберите формат расчёта." };
  const hi = findHeaderRow(tableIn);
  if (hi < 0) return { error: "Не нашёл строку заголовков (нужны хотя бы «lot» или «Лот» и «quantity» или «Кол-во»). Скопируйте вместе с заголовками из Excel." };
  const header = tableIn[hi];
  const cols = sheetColumns(p);
  const customs = new Map<string, CustomCol>((p.customColumns ?? []).map((c) => [c.id, c]));
  const claimed = new Set<string>();
  const inputCols = cols.filter((c) => c.kind === "input" && c.userInput);
  const formulaCols = cols.filter((c) => c.kind === "custom");
  const pick = (h: string, list: { id: string; title: string }[]) => {
    const free = list.filter((c) => !claimed.has(c.id));
    const exact = free.find((c) => nt(c.title) === h);
    if (exact) return exact;
    const pre = free.filter((c) => { const t = nt(c.title); return h.length >= 5 && t.length >= 5 && (h.startsWith(t) || t.startsWith(h)); });
    pre.sort((a, b) => Math.abs(nt(a.title).length - h.length) - Math.abs(nt(b.title).length - h.length));
    return pre[0];
  };
  const paramNames = (p.params ?? []).map((q) => q.name);

  const targets: Target[] = header.map((raw) => {
    const h = norm(raw);
    if (!h) return { t: "skip" };
    if (/^(bayer|buyer)/.test(h)) return { t: "skip" };
    if (QTY_RE.test(h)) { const id = p.qtyColumn ?? inputCols.find((c) => /^кол/.test(nt(c.title)))?.id; if (id && !claimed.has(id)) { claimed.add(id); return { t: "input", id }; } return { t: "skip" }; }
    if (PRICE_RE.test(h) && p.priceColumn && !claimed.has(p.priceColumn)) { claimed.add(p.priceColumn); return { t: "input", id: p.priceColumn }; }
    const alias = ROW_ALIASES.find(([re]) => re.test(h));
    if (alias && !(alias[1] === "size" && false)) return { t: "row", key: alias[1] };
    const inp = pick(h, inputCols);
    if (inp) { claimed.add(inp.id); return { t: "input", id: inp.id }; }
    const pn = paramNames.find((n) => paramKey(n) === paramKey(raw));
    if (pn) return { t: "param", name: pn };
    const fc = pick(h, formulaCols);
    if (fc) { claimed.add(fc.id); return { t: "check", id: fc.id, title: fc.title }; }
    return { t: "skip" };
  });

  // строки данных
  type Parsed = { row: CalcRow; params: Record<string, string>; checks: Record<string, string> };
  const parsed: Parsed[] = [];
  for (const raw of tableIn.slice(hi + 1)) {
    const first = (raw.find((c) => c.trim() !== "") ?? "").trim();
    if (!first || TOTAL_RE.test(first)) continue;
    const row: CalcRow = { _id: newId() };
    const params: Record<string, string> = {};
    const checks: Record<string, string> = {};
    const sizeParts: string[] = [];
    let hasLot = false, hasPrice = false;
    targets.forEach((tg, i) => {
      const cell = (raw[i] ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
      if (tg.t === "row") {
        if (tg.key === "size") { if (cell) sizeParts.push(cell); } else row[tg.key] = cell;
        if (tg.key === "lot" && cell) hasLot = true;
      } else if (tg.t === "input") {
        const c = customs.get(tg.id);
        if (c?.text) row[tg.id] = cell;
        else row[tg.id] = numStr(cell);
        if (tg.id === p.priceColumn && numStr(cell) !== "") hasPrice = true;
      } else if (tg.t === "param") { const v = numStr(cell); if (v !== "") params[tg.name] = v; }
      else if (tg.t === "check") { const v = numStr(cell); if (v !== "") checks[tg.id] = v; }
    });
    if (!hasLot && !hasPrice) continue;
    row.size = sizeParts.join(" ");
    row.fur = row.fur ?? "";
    row.lot = row.lot ?? "";
    row.invoice = row.invoice ?? "";
    row.dest = row.dest ?? "";
    parsed.push({ row, params, checks });
  }
  if (parsed.length === 0) return { error: "В таблице нет строк лотов (нужны номер лота или цена закупки)." };

  // вставка в расчёт
  const keep = opts.replace ? [] : p.rows.filter(rowFilled);
  const next: CalcPayload = { ...p, params: (p.params ?? []).map((q) => ({ ...q })), rows: [...keep, ...parsed.map((x) => x.row)], overrides: { ...(p.overrides ?? {}) } };
  if (opts.replace) next.overrides = {};

  const notes: string[] = [];
  const rowParams: string[] = [];
  // параметры (курс…): самое частое значение — в параметр, отличающиеся строки — своё значение строки
  const paramsUsed = new Set(targets.filter((t) => t.t === "param").map((t) => (t as { name: string }).name));
  for (const name of paramsUsed) {
    const vals = parsed.map((x) => x.params[name]).filter((v): v is string => v !== undefined);
    if (vals.length === 0) continue;
    const freq = new Map<string, number>();
    vals.forEach((v) => freq.set(v, (freq.get(v) ?? 0) + 1));
    const common = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const q = next.params!.find((x) => x.name === name)!;
    const cur = evalNum(q.value);
    const base = Number.isFinite(cur) && q.value.trim() !== "" ? q.value : common;
    if (q.value.trim() === "") q.value = common;
    parsed.forEach((x) => {
      const v = x.params[name];
      if (v !== undefined && Math.abs(Number(v) - evalNum(base)) > 1e-9) {
        x.row["@" + paramKey(name)] = v;
        rowParams.push(`${name} = ${v.replace(".", ",")} (лот ${x.row.lot || "—"})`);
      }
    });
  }
  const firstNew = keep.length;
  next.rows = [...keep, ...parsed.map((x) => x.row)];

  // шапка: аукцион из строк над заголовками, № счёта и «куда», если пусто
  const hdr = { ...next.header };
  if (!hdr.auction.trim()) for (let i = 0; i < hi && !hdr.auction; i++) for (const c of tableIn[i]) { const m = /(\S*\s?\d{2}-\d{2,4})/.exec(c ?? ""); if (m) { hdr.auction = auctionNameFromTitle(c); break; } }
  const uniq = (k: "invoice" | "dest") => [...new Set(parsed.map((x) => x.row[k]).filter(Boolean))];
  if (!hdr.invoice.trim() && uniq("invoice").length) hdr.invoice = uniq("invoice").join(", ");
  if (!hdr.dest.trim() && uniq("dest").length === 1) hdr.dest = uniq("dest")[0];
  next.header = hdr;

  // сверка столбцов-формул с файлом
  const tolOf = (s: string) => Math.max(0.5 * Math.pow(10, -Math.min(decimalsOf(s), 8)), 1e-6);
  const rawText = new Map<string, string[]>(); // для допуска: сколько знаков в числе файла
  parsed.forEach((x, k) => { for (const [id, v] of Object.entries(x.checks)) { const a = rawText.get(id) ?? []; a[k] = v; rawText.set(id, a); } });
  const checkIds = formulaCols.filter((c) => rawText.has(c.id)).map((c) => c.id);
  const valueAt = (q: CalcPayload, id: string, i: number) => calcAll(q).sheet.cells[id]?.[i]?.v ?? null;
  let manualCells = 0;
  const setOv = (q: CalcPayload, rowIdx: number, id: string, v: string) => {
    const rid = q.rows[rowIdx]._id!;
    q.overrides = { ...(q.overrides ?? {}), [rid]: { ...(q.overrides?.[rid] ?? {}), [id]: v } };
  };
  let work = next;
  for (let iter = 0; iter < 12; iter++) {
    const sh = calcAll(work).sheet;
    let fixed = false;
    for (const id of checkIds) {
      const mism: number[] = [];
      parsed.forEach((x, k) => {
        const want = x.checks[id];
        if (want === undefined) return;
        const i = firstNew + k;
        const got = sh.cells[id]?.[i]?.v;
        if (got == null || Math.abs(got - Number(want)) > tolOf(want)) mism.push(k);
      });
      if (mism.length === 0) continue;
      const cc = customs.get(id)!;
      const formulas = [cc.formula, ...(cc.rules ?? []).map((r) => r.formula)].join(" ").toLowerCase().replace(/ё/g, "е");
      const cands = paramNames.filter((n) => new RegExp(`(?<![\\p{L}\\p{N}_])${paramKey(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "u").test(formulas));
      const q2: CalcPayload = { ...work, rows: work.rows.map((r) => ({ ...r })), overrides: { ...(work.overrides ?? {}) } };
      for (const k of mism) {
        const i = firstNew + k;
        const want = Number(parsed[k].checks[id]);
        const tol = tolOf(parsed[k].checks[id]);
        let solved = false;
        // подбор параметра строки: берём только параметры, которых нет среди столбцов файла, значение должно быть неотрицательным
        // и «круглым»: из нескольких подходящих выигрывает тот, у кого меньше знаков после запятой
        let best: { name: string; cand: number; d: number } | null = null;
        for (const name of cands.filter((n) => !paramsUsed.has(n))) {
          const key = "@" + paramKey(name);
          const at = (v: number) => { const q3: CalcPayload = { ...q2, rows: q2.rows.map((r, j) => (j === i ? { ...r, [key]: String(v) } : r)) }; return valueAt(q3, id, i); };
          const f0 = at(0), f1 = at(1);
          if (f0 == null || f1 == null || Math.abs(f1 - f0) < 1e-12) continue;
          const star = (want - f0) / (f1 - f0);
          if (!(star >= 0)) continue;
          for (const d of [2, 4, 8]) {
            const cand = Number(star.toFixed(d));
            const fv = at(cand);
            if (fv != null && Math.abs(fv - want) <= (d === 8 ? Math.min(tol, 1e-6) : Math.min(tol, 1e-7))) {
              if (!best || d < best.d) best = { name, cand, d };
              break;
            }
          }
        }
        if (best) {
          const key = "@" + paramKey(best.name);
          q2.rows = q2.rows.map((r, j) => (j === i ? { ...r, [key]: String(best!.cand) } : r));
          rowParams.push(`${best.name} = ${String(best.cand).replace(".", ",")} (лот ${q2.rows[i].lot || "—"})`);
          solved = true;
        }
        if (!solved) { setOv(q2, i, id, parsed[k].checks[id]); manualCells++; }
      }
      work = q2;
      fixed = true;
      break; // пересчитать: правки левого столбца меняют правые
    }
    if (!fixed) break;
  }
  next.rows = work.rows;
  next.overrides = work.overrides;

  const finalSh = calcAll(next).sheet;
  const checks: PasteCheck[] = checkIds.map((id) => {
    const file = parsed.reduce((s, x) => s + Number(x.checks[id] ?? 0), 0);
    const arr = finalSh.cells[id] ?? [];
    const ours = parsed.reduce((s, _, k) => s + (arr[firstNew + k]?.v ?? 0), 0);
    return { title: customs.get(id)!.title, file, ours, ok: Math.abs(file - ours) <= 0.01 + 0.005 * parsed.length * 0 };
  });

  const mapped: string[] = [];
  const skipped: string[] = [];
  header.forEach((h, i) => {
    const tg = targets[i];
    if (!h.trim()) return;
    if (tg.t === "skip") skipped.push(h.trim());
    else mapped.push(h.trim());
  });
  if (!keep.length && parsed.length) notes.push(`Внесено лотов: ${parsed.length}.`);
  else notes.push(`Добавлено лотов: ${parsed.length}.`);
  return { payload: syncLetters(next), added: parsed.length, mapped, skipped, checks, manualCells, rowParams: groupRowParams(rowParams), notes };
}

/** «курс = 84,4283 (лот 1)», «курс = 84,4283 (лот 2)» → «курс = 84,4283: лоты 1, 2». */
function groupRowParams(list: string[]): string[] {
  const g = new Map<string, string[]>();
  for (const x of list) {
    const m = /^(.*) \(лот (.*)\)$/.exec(x);
    const k = m ? m[1] : x;
    const a = g.get(k) ?? [];
    if (m && !a.includes(m[2])) a.push(m[2]);
    g.set(k, a);
  }
  return [...g.entries()].map(([k, lots]) => (lots.length ? `${k}: ${lots.length > 1 ? "лоты" : "лот"} ${lots.join(", ")}` : k));
}
