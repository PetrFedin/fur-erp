import { FormulaError, cellRef, colIndex, evalNode, lettersBetween, parseFormula, refsOf, renameColumnRefs, type Node } from "@/lib/calc-formula";
import { type CalcFormat, type CalcRow, type CalcHeader, type CalcPayload, evalNum, n0, type RowCalc, type SheetCol } from "./shared";
import { FORMAT_LABEL, rowFilled, newId, resolveRow, emptyRow, emptyPayload, effectiveRate, extraPerHide, calcRow, UNIT_COL, QTY_COL, sheetColumns, paramKey, paramValues, matchRule } from "./format-label";

export type CalcTotals = { qtys: number[]; qty: number; totalRub: number; advance: number; interim: number; rest: number; extraRub: number; calcs: RowCalc[]; rate: number; sheet: Sheet };

export type Cell = { v: number | null; err?: string; manual?: boolean };

export type Sheet = {
  cols: SheetCol[];
  /** Значения по столбцам и строкам (пустые строки — v null). */
  cells: Record<string, Cell[]>;
  /** Итоги по числовым столбцам. */
  sums: Record<string, Cell>;
  /** Ошибки самих формул (синтаксис, циклы): id столбца → текст. */
  colErrors: Record<string, string>;
  used: boolean[];
  unitCol: string;
  qtyCol: string;
};

const LETTERS = /^[A-Za-z]{1,3}$/;

export function computeSheet(p: CalcPayload): Sheet {
  const cols = sheetColumns(p);
  const byLetter = new Map(cols.map((c) => [c.letter, c]));
  const byId = new Map(cols.map((c) => [c.id, c]));
  const f = p.format, h = p.header;
  const isSheet = f === "SHEET";
  const used = p.rows.map(rowFilled);
  const rawQty = p.rows.reduce((s, r, i) => s + (used[i] ? n0(r.qty) : 0), 0);
  const extra = extraPerHide(h, rawQty);
  const base = p.rows.map((r, i) => (used[i] && !isSheet ? calcRow(f, h, r, extra) : null));
  const cells: Record<string, Cell[]> = {};
  const colErrors: Record<string, string> = {};
  const eff = effectiveRate(h);
  const params = paramValues(p);
  const empty = (): Cell[] => p.rows.map(() => ({ v: null }));

  // ввод
  for (const c of cols) {
    if (c.kind !== "input") continue;
    cells[c.id] = p.rows.map((raw, i) => {
      if (!used[i]) return { v: null };
      if (c.text) return { v: null };
      const r = resolveRow(f, h, raw);
      const t = (r[c.id] ?? "").trim();
      if (c.id === "rate" && (f === "SP_RP" || f === "OTHER") && t === "") return { v: eff };
      if (t === "") return { v: 0 };
      const v = evalNum(t);
      return Number.isFinite(v) ? { v } : { v: null, err: `в столбце ${c.letter} («${c.title}») не число: «${t}»` };
    });
  }
  // встроенные вычисляемые
  const ov = (i: number, id: string) => { const o = p.overrides?.[p.rows[i]?._id ?? ""]?.[id]; return o !== undefined && o.trim() !== "" ? o : null; };
  if (!isSheet) {
    cells[UNIT_COL] = p.rows.map((_, i) => {
      if (!used[i]) return { v: null };
      const o = ov(i, UNIT_COL);
      if (o !== null) { const v = evalNum(o); return Number.isFinite(v) ? { v, manual: true } : { v: null, err: `ручное значение не число: «${o}»`, manual: true }; }
      return { v: base[i]!.unitRub };
    });
    cells.unitUsd = p.rows.map((_, i) => (used[i] && base[i]!.unitUsd != null ? { v: base[i]!.unitUsd } : { v: null }));
    cells.total = p.rows.map((_, i) => {
      const u = cells[UNIT_COL][i];
      return used[i] && u.v != null ? { v: u.v * (cells[QTY_COL][i].v ?? 0) } : { v: null, err: u.err };
    });
  }

  // свои столбцы-формулы: разбор (основная формула и правила), зависимости, порядок вычисления
  const customs = (p.customColumns ?? []).filter((cc) => cc.kind !== "input").map((cc) => ({ cc, col: byId.get(cc.id)! }));
  const ast = new Map<string, { main: Node | null; rules: (Node | null)[] }>();
  for (const { cc } of customs) {
    const rules = cc.rules ?? [];
    if (!cc.formula.trim() && rules.length === 0) { colErrors[cc.id] = "Формула не задана"; continue; }
    try {
      const main = cc.formula.trim() ? parseFormula(cc.formula) : null;
      const rn = rules.map((r, k) => { try { return parseFormula(r.formula); } catch (e) { throw new FormulaError(`правило ${k + 1}: ${e instanceof FormulaError ? e.message : "ошибка в формуле"}`); } });
      ast.set(cc.id, { main, rules: rn });
    } catch (e) { colErrors[cc.id] = e instanceof FormulaError ? e.message : "Ошибка в формуле"; }
  }
  const deps = new Map<string, string[]>();
  for (const { cc } of customs) {
    const a = ast.get(cc.id);
    if (!a) continue;
    const names: string[] = [];
    for (const n of [a.main, ...a.rules]) if (n) { const r = refsOf(n); names.push(...r.row, ...r.sum); }
    const ids = names.map((x) => { const cr = cellRef(x); const l = cr ? cr.col : x; return LETTERS.test(l) ? byLetter.get(l.toUpperCase()) : undefined; }).filter((c): c is SheetCol => !!c && c.kind === "custom").map((c) => c.id);
    deps.set(cc.id, [...new Set(ids)]);
  }
  const order: string[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, path: string[]) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const loop = [...path.slice(path.indexOf(id)), id].map((x) => byId.get(x)?.letter ?? "?").join(" → ");
      for (const x of path.slice(path.indexOf(id))) colErrors[x] = `Циклическая ссылка: ${loop}`;
      return;
    }
    state.set(id, 1);
    for (const d of deps.get(id) ?? []) visit(d, [...path, id]);
    state.set(id, 2);
    order.push(id);
  };
  for (const { cc } of customs) if (ast.has(cc.id)) visit(cc.id, []);

  const colArr = (letter: string): Cell[] => {
    const c = byLetter.get(letter.toUpperCase());
    if (!c || !LETTERS.test(letter)) throw new FormulaError(`Неизвестный столбец ${letter.toUpperCase()}`);
    const arr = cells[c.id];
    if (!arr) throw new FormulaError(`${c.letter}: столбец ещё не вычислен`);
    return arr;
  };
  const colValues = (letter: string): number[] => {
    const arr = colArr(letter);
    const out: number[] = [];
    arr.forEach((x, i) => {
      if (!used[i]) return;
      if (x.v == null) { if (byLetter.get(letter.toUpperCase())?.text) return; throw new FormulaError(`${letter.toUpperCase()}: в строке ${i + 1} ошибка${x.err ? ` — ${x.err}` : ""}`); }
      out.push(x.v);
    });
    return out;
  };
  const sumOf = (letter: string): number => colValues(letter).reduce((s, x) => s + x, 0);

  for (const id of order) {
    if (colErrors[id]) { cells[id] = p.rows.map((_, i) => (used[i] ? { v: null, err: colErrors[id] } : { v: null })); continue; }
    const a = ast.get(id)!;
    const cc = p.customColumns!.find((x) => x.id === id)!;
    cells[id] = empty();
    p.rows.forEach((raw, i) => {
      if (!used[i]) return;
      // формула строки: первое подошедшее правило, иначе основная
      let node = a.main;
      const rules = cc.rules ?? [];
      for (let k = 0; k < rules.length; k++) if (matchRule(rules[k], i + 1, raw)) { node = a.rules[k]; break; }
      const o = ov(i, id);
      if (!node && o === null) { cells[id][i] = { v: null, err: "для этой строки нет формулы" }; return; }
      const cellAt = (letter: string, rowNo: number): number => {
        const arr = colArr(letter);
        const cell = arr[rowNo - 1];
        if (!cell) throw new FormulaError(`${letter.toUpperCase()}${rowNo}: такой строки нет`);
        if (!used[rowNo - 1]) return 0;
        if (cell.v == null) { if (byLetter.get(letter.toUpperCase())?.text) return 0; throw new FormulaError(`в ячейке ${letter.toUpperCase()}${rowNo} ошибка${cell.err ? `: ${cell.err}` : ""}`); }
        return cell.v;
      };
      const ctx: Parameters<typeof evalNode>[1] = {
          sum: sumOf,
          colValues,
          isColumn: (name) => LETTERS.test(name) && byLetter.has(name.toUpperCase()),
          rangeValues: (x, y) => {
            const cx = cellRef(x), cy = cellRef(y);
            if (cx && cy) {
              const out: number[] = [];
              const r1 = Math.min(cx.row, cy.row), r2 = Math.max(cx.row, cy.row);
              for (const l of lettersBetween(cx.col, cy.col)) for (let rn = r1; rn <= r2; rn++) if (used[rn - 1]) out.push(cellAt(l, rn));
              return out;
            }
            if (LETTERS.test(x) && LETTERS.test(y)) {
              if (colIndex(x) > 25 && x.length > 3) throw new FormulaError("диапазон столбцов");
              return lettersBetween(x, y).map((l) => cellAt(l, i + 1));
            }
            throw new FormulaError(`Диапазон ${x}:${y} записан неверно (пример: D:I или D3:I10)`);
          },
          ident: (name) => {
            const cr = cellRef(name);
            if (cr && byLetter.has(cr.col)) return cellAt(cr.col, cr.row);
            if (LETTERS.test(name)) {
              const c = byLetter.get(name.toUpperCase());
              if (c) {
                const cell = cells[c.id]?.[i];
                if (!cell) throw new FormulaError(`Столбец ${c.letter} ещё не вычислен`);
                if (cell.v == null) { if (c.text) return 0; throw new FormulaError(`в столбце ${c.letter} ошибка${cell.err ? `: ${cell.err}` : ""}`); }
                return cell.v;
              }
            }
            // параметр: для строки можно задать своё значение (ключ «@имя» в строке)
            const rowOv = raw["@" + paramKey(name)];
            if (rowOv !== undefined && rowOv.trim() !== "") { const x = evalNum(rowOv); if (Number.isFinite(x)) return x; }
            const pv = params[paramKey(name)];
            if (typeof pv === "number") return pv;
            if (typeof pv === "string") throw new FormulaError(pv);
            if (LETTERS.test(name)) throw new FormulaError(`Неизвестный столбец ${name.toUpperCase()}`);
            throw new FormulaError(`Неизвестный параметр «${name}»`);
          },
      };
      try {
        if (o !== null) {
          // ручное значение: число, выражение «=950*1.22» или формула со ссылками «=H3*2», «=S+500», «=курс*10»
          let v = evalNum(o);
          if (!Number.isFinite(v) && o.trim().startsWith("=")) v = evalNode(parseFormula(o), ctx);
          cells[id][i] = Number.isFinite(v) ? { v, manual: true } : { v: null, err: `ручное значение не число: «${o}»`, manual: true };
          return;
        }
        const v = evalNode(node!, ctx);
        cells[id][i] = Number.isFinite(v) ? { v } : { v: null, err: "результат не число" };
      } catch (e) {
        cells[id][i] = { v: null, err: e instanceof FormulaError ? e.message : "ошибка вычисления" };
      }
    });
  }
  // столбцы с ошибкой синтаксиса/цикла, не попавшие в order
  for (const { cc } of customs) if (!cells[cc.id]) cells[cc.id] = p.rows.map((_, i) => (used[i] ? { v: null, err: colErrors[cc.id] ?? "ошибка формулы" } : { v: null }));

  const okUnit = (id: string | undefined) => { const c = id ? byId.get(id) : undefined; return c && (isSheet ? !c.text : c.kind !== "input") ? c.id : null; };
  const unitCol = okUnit(p.unitCostColumn) ?? (isSheet ? "" : UNIT_COL);
  const qtyCol = p.qtyColumn && byId.get(p.qtyColumn) && !byId.get(p.qtyColumn)!.text && byId.get(p.qtyColumn)!.kind !== "calc" ? p.qtyColumn : isSheet ? "" : QTY_COL;

  // итоги по числовым столбцам
  const sums: Record<string, Cell> = {};
  const totalMode = (c: SheetCol) => (p.customColumns ?? []).find((x) => x.id === c.id)?.total ?? "sum";
  for (const c of cols) {
    if (c.text) continue;
    if (c.kind === "input" && !c.userInput && c.id !== QTY_COL && c.id !== "price") continue;
    const arr = cells[c.id];
    if (!arr || c.id === "unitUsd") continue;
    const mode = totalMode(c);
    if (mode === "none") continue;
    let s = 0, n = 0, bad: string | undefined;
    arr.forEach((x, i) => { if (!used[i]) return; if (x.v == null) bad = bad ?? x.err ?? "ошибка"; else { s += x.v; n++; } });
    sums[c.id] = bad ? { v: null, err: bad } : mode === "avg" ? (n ? { v: s / n } : { v: null, err: "нет значений" }) : { v: s };
  }
  return { cols, cells, sums, colErrors, used, unitCol, qtyCol };
}

export function calcAll(p: CalcPayload): CalcTotals {
  const sh = computeSheet(p);
  const isSheet = p.format === "SHEET";
  const rawQty = p.rows.reduce((s, r, i) => s + (sh.used[i] ? n0(r.qty) : 0), 0);
  const extraRub = extraPerHide(p.header, rawQty);
  const colTitle = (id: string) => sh.cols.find((c) => c.id === id)?.title ?? id;
  const qtys = p.rows.map((_, i) => (sh.used[i] && sh.qtyCol ? sh.cells[sh.qtyCol]?.[i]?.v ?? 0 : 0));
  const calcs = p.rows.map((r, i) => {
    const b = isSheet
      ? { ok: true, problems: [] as string[], unitRub: 0, totalRub: 0, unitUsd: null, parts: [], extraRub: 0 } as RowCalc
      : calcRow(p.format, p.header, r, extraRub);
    if (!sh.used[i]) return b;
    const problems = b.problems.filter((x) => !(x === "нет количества" && sh.qtyCol !== QTY_COL));
    if (isSheet && !sh.unitCol) problems.push("не выбран столбец себестоимости");
    if (isSheet && !sh.qtyCol) problems.push("не выбран столбец количества");
    const u = sh.unitCol ? sh.cells[sh.unitCol]?.[i] : undefined;
    const q = sh.qtyCol ? sh.cells[sh.qtyCol]?.[i] : undefined;
    if (sh.qtyCol && (isSheet || sh.qtyCol !== QTY_COL) && !(qtys[i] > 0)) problems.push("нет количества");
    if (u && u.v == null) problems.push(`ошибка в столбце «${colTitle(sh.unitCol)}»: ${u.err ?? "нет значения"}`);
    if (q && q.v == null) problems.push(`ошибка в столбце «${colTitle(sh.qtyCol)}»: ${q.err ?? "нет значения"}`);
    const unit = u?.v ?? 0;
    return { ...b, ok: problems.length === 0, problems, unitRub: unit, totalRub: unit * qtys[i] };
  });
  const qty = qtys.reduce((s, x) => s + x, 0);
  const totalRub = calcs.reduce((s, c, i) => s + (sh.used[i] ? c.totalRub : 0), 0);
  const advance = n0(p.header.advance);
  const interim = n0(p.header.interim);
  const rate = isSheet ? (typeof paramValues(p)["курс"] === "number" ? (paramValues(p)["курс"] as number) : 0) : effectiveRate(p.header);
  return { qtys, qty, totalRub, advance, interim, rest: totalRub - advance - interim, extraRub, calcs, rate, sheet: sh };
}

/** Контрольные разности под таблицей: |итог A − итог B| ≤ допуск. */
export function checkDiffs(p: CalcPayload, sh: Sheet): { id: string; title: string; diff: number | null; ok: boolean; note?: string }[] {
  const byLetter = new Map(sh.cols.map((c) => [c.letter, c]));
  return (p.checks ?? []).map((c) => {
    const a = byLetter.get(c.a.trim().toUpperCase()), b = byLetter.get(c.b.trim().toUpperCase());
    const sa = a ? sh.sums[a.id] : undefined, sb = b ? sh.sums[b.id] : undefined;
    if (!a || !b || !sa || !sb) return { id: c.id, title: c.title, diff: null, ok: false, note: "нет такого столбца" };
    if (sa.v == null || sb.v == null) return { id: c.id, title: c.title, diff: null, ok: false, note: "в итоге ошибка" };
    const diff = sa.v - sb.v;
    const tol = n0(c.tol);
    return { id: c.id, title: c.title, diff, ok: Math.abs(diff) <= tol + 1e-9 };
  });
}

/** Проверка перед отправкой: что обязательно заполнено. */
export function sendProblems(p: CalcPayload): string[] {
  const out: string[] = [];
  if (!p.header.auction.trim()) out.push("Укажите аукцион");
  if (!p.header.invoice.trim()) out.push("Укажите номер аукционного счёта");
  if (p.format !== "SHEET" && !(effectiveRate(p.header) > 0)) out.push("Укажите курс ЦБ");
  const rows = p.rows.filter(rowFilled);
  if (rows.length === 0) out.push("Добавьте хотя бы один лот");
  const t = calcAll(p);
  for (const [id, msg] of Object.entries(t.sheet.colErrors)) out.push(`Столбец «${t.sheet.cols.find((c) => c.id === id)?.title ?? id}»: ${msg}`);
  t.calcs.forEach((c, i) => { if (!c.ok && p.rows[i] && rowFilled(p.rows[i])) out.push(`Строка ${i + 1}: ${c.problems.join(", ")}`); });
  return out;
}

/** Название аукциона из заголовка файла → как в нашем справочнике: «СОЮЗПУШНИНА 09-26 (предварительный…)» → «СП 09-26», «Русьпушнина 04-26» → «РП 04-26». */
export function auctionNameFromTitle(title: string): string {
  const t = title.replace(/\(.*$/, "").replace(/\s+/g, " ").trim();
  return t.replace(/^союзпушнина(?=\s|$)/i, "СП").replace(/^русьпушнина(?=\s|$)/i, "РП");
}

const TOTAL_RE = /^(итого|всего|total)/i;

const head = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Реальный файл Веллмеха (таблица ячеек) → черновик расчёта. Формат определяется по шапке; проценты считаются
 * из рублёвых сумм файла (сбор / (цена×курс)), поэтому расчёт даёт те же цифры. Ничего не сохраняет.
 */
export function payloadFromTable(table: string[][]): { payload: CalcPayload; warnings: string[] } | { error: string } {
  let hi = -1;
  for (let i = 0; i < Math.min(table.length, 15); i++) {
    const hs = table[i].map(head);
    if (hs.some((h) => h.startsWith("invoice")) && hs.some((h) => h === "lot" || h.startsWith("lot")) && hs.some((h) => h.startsWith("quantity"))) { hi = i; break; }
  }
  if (hi < 0) return { error: "Не нашёл шапку расчёта (столбцы invoice, lot, quantity). Проверьте, что это расчёт по лотам." };
  const H = table[hi].map(head);
  const col = (re: RegExp, from = 0) => { for (let c = from; c < H.length; c++) if (re.test(H[c])) return c; return -1; };
  const isSaga = col(/упаковка/) >= 0 && col(/брок\.? ?%/) >= 0 && col(/^курс/) >= 0 && col(/интерес/) >= 0;
  const isFh = col(/^grade/) >= 0 || col(/для 5/) >= 0 || col(/пошлин/) >= 0;
  const format: CalcFormat = isSaga ? "SAGA" : isFh ? "FH" : "SP_RP";
  const warnings: string[] = [];
  const payload = emptyPayload(format);
  const g = (row: string[], c: number) => (c >= 0 ? (row[c] ?? "").replace(/[\r\n]+/g, " ").trim() : "");
  const x = (row: string[], c: number) => evalNum(g(row, c));
  const pct = (sum: number, base: number) => (Number.isFinite(sum) && base > 0 ? String(Math.round((sum / base) * 100 * 1e6) / 1e6) : "");
  const num = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : "");
  // Название аукциона из строк над шапкой: «СОЮЗПУШНИНА 09-26 (…)», «SAGA 03-26», «FH 06-26».
  for (let i = 0; i < hi; i++) for (const cell of table[i]) {
    const m = /(\S*\s?\d{2}-\d{2,4})/.exec(cell ?? "");
    if (m && !payload.header.auction) payload.header.auction = auctionNameFromTitle(cell);
  }
  const cInv = col(/^invoice/), cFur = col(/^fur/), cSize = col(/^size|^description/), cLot = col(/^lot/), cQty = col(/^quantity/);
  const cOp = col(/^operation/), cDest = col(/^куда/), cPrice = isSaga ? col(/^закупка/) : col(/^закупка/);
  const cFee = col(/аукционный сбор/);
  const rows: CalcRow[] = [];
  const header: CalcHeader = payload.header;
  for (const raw of table.slice(hi + 1)) {
    const first = (raw.find((c) => c.trim() !== "") ?? "").trim();
    if (!first) continue;
    if (TOTAL_RE.test(first)) continue;
    const qty = x(raw, cQty), price = x(raw, cPrice);
    if (!Number.isFinite(qty) || !Number.isFinite(price)) continue;
    const r = emptyRow(format);
    r._id = newId();
    r.invoice = g(raw, cInv); r.fur = g(raw, cFur); r.size = [g(raw, col(/^grade/)), g(raw, col(/^color|^цвет/)), g(raw, cSize)].filter(Boolean).join(" "); r.lot = g(raw, cLot);
    // В файлах SAGA столбец перед «fur» без заголовка — это сам мех, а «fur» — описание.
    if (format === "SAGA" && cFur > 0 && H[cFur - 1] === "" && g(raw, cFur - 1)) { r.size = [g(raw, cFur), g(raw, cSize)].filter(Boolean).join(" "); r.fur = g(raw, cFur - 1); }
    r.qty = num(qty); r.operation = g(raw, cOp); r.dest = g(raw, cDest); r.price = num(price);
    if (format === "SAGA") {
      const coef = x(raw, col(/^курс/)) || 1;
      r.feePct = pct(x(raw, cFee), price); r.feeFixed = "0"; r.packing = num(x(raw, col(/упаковка/)));
      r.brokerPct = pct(x(raw, col(/брок/)), price); r.coef = num(coef);
      r.dressing = num(x(raw, col(/^выделка/))); r.customs = num(x(raw, col(/аванс на таможню|ндс 22%\+tax/)));
      r.air = num(x(raw, col(/доставка/))); r.adj = num(x(raw, col(/корректировка/)));
      r.interestPct = pct(x(raw, col(/интерес/)), price * coef);
      for (const k of ["packing", "dressing", "customs", "air", "adj"]) if (r[k] === "") r[k] = "0";
      if (!header.cbRate) { const u = x(raw, col(/курс цб|расчетный курс/)); if (Number.isFinite(u)) { header.cbRate = num(u); header.agentPct = "0"; header.rateComment = g(table[hi], col(/курс цб|расчетный курс/)); } }
    } else if (format === "FH") {
      const rate = x(raw, col(/^курс/));
      r.feePct = pct(x(raw, cFee), price * rate); r.packing = num(x(raw, col(/упаковка/))); r.brokerPct = pct(x(raw, col(/брок/)), price * rate);
      r.dressingUsd = rate > 0 ? num(x(raw, col(/выделка/)) / rate) : "";
      r.base22 = num(x(raw, col(/для 22/))); r.base5 = num(x(raw, col(/для 5/)));
      r.trans1 = rate > 0 ? num(x(raw, col(/до выделки/)) / rate) : ""; r.trans2 = rate > 0 ? num(x(raw, col(/выделка-склад/)) / rate) : "";
      const comm = x(raw, col(/комиссия рм/));
      r.commPct = Number.isFinite(comm) ? pct(comm, price * rate) : "0";
      if (!header.cbRate && rate > 0) { header.cbRate = num(rate); header.agentPct = "0"; header.rateComment = g(table[hi], col(/^курс/)); }
      for (const k of ["packing", "dressingUsd", "base22", "base5", "trans1", "trans2"]) if (r[k] === "") r[k] = "0";
      // ставки НДС и пошлины в файле заданы столбцами «для 22%» и «для 5%»
      r.vatPct = "22"; r.dutyPct = "5";
    } else {
      const rate = x(raw, col(/^курс/));
      const base = price * rate;
      r.rate = num(rate);
      // СП: сбор и «НДС на услуги СП» — отдельные столбцы; РП: сбор уже с НДС 22 % внутри формулы (J = цена×7,85 %×курс×1,22).
      const feeIncl = col(/ндс на услуги/) < 0;
      r.feePct = feeIncl && Number.isFinite(x(raw, cFee)) ? String(Math.round((x(raw, cFee) / base / 1.22) * 100 * 1e6) / 1e6) : pct(x(raw, cFee), base);
      r.dressing = num(x(raw, col(/^выделка/))); r.transport = num(x(raw, col(/^транспорт/)));
      r.brokerPct = pct(x(raw, col(/^брокерский/)), base) || pct(x(raw, col(/комиссия рм/)), base);
      r.transit = num(x(raw, col(/транзит/)));
      const vsum = x(raw, col(/^ндс 2/));
      if (base > 0 && Number.isFinite(vsum) && !header.vat.startsWith("#")) header.vat = String(Math.round((vsum / base) * 100 * 1e4) / 1e4);
      if (!header.cbRate && rate > 0) { header.cbRate = num(rate); header.agentPct = "0"; }
      for (const k of ["feePct", "dressing", "transport", "brokerPct", "transit"]) if (r[k] === "") r[k] = "0";
    }
    if (r.invoice && !header.invoice) header.invoice = r.invoice;
    rows.push(r);
  }
  if (rows.length === 0) return { error: "В файле не нашлось строк лотов (нужны количество и цена)." };
  payload.rows = rows;
  payload.header = header;
  if (header.vat === "" || !Number.isFinite(evalNum(header.vat))) header.vat = "22";
  warnings.push(`Распознан формат «${FORMAT_LABEL[format]}», строк: ${rows.length}. Проверьте шапку и ставки — они взяты из сумм файла.`);
  return { payload, warnings };
}

// ============================================================================================ правки столбцов (для формы «Детально»)

/** Записать актуальные буквы в customColumns (буква считается по порядку; в хранилище — для чтения человеком). */
export function syncLetters(p: CalcPayload): CalcPayload {
  if (!p.customColumns?.length) return p;
  const cols = sheetColumns(p);
  return { ...p, customColumns: p.customColumns.map((c) => ({ ...c, letter: cols.find((x) => x.id === c.id)?.letter ?? c.letter })) };
}

/** После смены набора столбцов (формат) ссылки на свои столбцы в формулах переезжают на новые буквы; ссылки на встроенные придётся проверить. */
export function remapCustomRefs(before: CalcPayload, after: CalcPayload): CalcPayload {
  if (!after.customColumns?.length) return after;
  const a = sheetColumns(before), b = sheetColumns(after);
  const map: Record<string, string> = {};
  for (const c of after.customColumns) {
    const o = a.find((x) => x.id === c.id), n = b.find((x) => x.id === c.id);
    if (o && n && o.letter !== n.letter) map[o.letter] = n.letter;
  }
  if (Object.keys(map).length === 0) return syncLetters(after);
  return syncLetters({ ...after, checks: after.checks?.map((c) => ({ ...c, a: map[c.a.toUpperCase()] ?? c.a, b: map[c.b.toUpperCase()] ?? c.b })), customColumns: after.customColumns.map((c) => ({ ...c, formula: renameColumnRefs(c.formula, map), rules: c.rules?.map((r) => ({ ...r, formula: renameColumnRefs(r.formula, map) })) })) });
}

/** Какие столбцы ссылаются на данный (по букве): нельзя удалить, пока на него ссылаются. */
export function columnUsers(p: CalcPayload, id: string): string[] {
  const cols = sheetColumns(p);
  const me = cols.find((c) => c.id === id);
  if (!me) return [];
  const out: string[] = [];
  for (const c of p.customColumns ?? []) {
    if (c.id === id) continue;
    for (const src of [c.formula, ...(c.rules ?? []).map((r) => r.formula)]) {
      try {
        const r = refsOf(parseFormula(src));
        if ([...r.row, ...r.sum].some((x) => { const cr = cellRef(x); const l = cr ? cr.col : x; return l.toUpperCase() === me.letter && LETTERS.test(l); })) { out.push(c.title || "без названия"); break; }
      } catch { /* формула с ошибкой — не считается */ }
    }
  }
  return out;
}
