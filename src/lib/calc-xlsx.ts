/**
 * Excel «детальный расчёт стоимости сырья» из расчёта аукциона — как Веллмех присылает файлы (лист «ММ-расчёт»).
 * Лист: заголовки столбцов, все лоты и статьи, итоговая строка SUM, блок «к оплате», шапка и ставки на листе «Параметры»
 * (именованные ячейки: курс, сбор_проц, ндс…). В столбцах-формулах — настоящие формулы Excel (не значения):
 * наши формулы (буквы столбцов, параметры, «;», проценты, ROUND/MIN/MAX/IF/SUM) переводятся в синтаксис Excel; рядом лежит
 * вычисленное нашим движком значение, чтобы файл читался и без пересчёта. Ручные правки ячеек — значением или формулой как введено.
 * Простые форматы (СП/РП, SAGA, FH, «Другой») выгружаются тем же листом: «Цена за шкуру» и «Сумма» — формулы по тем же правилам, что calcRow.
 * Чистая логика без БД; цен продажи и себестоимости наших изделий в файле нет — только данные расчёта поставщика.
 */
import ExcelJS from "exceljs";
import { FormulaError, cellRef, lettersBetween, colIndex, parseFormula, type Node } from "@/lib/calc-formula";
import {
  QTY_COL, UNIT_COL, STAGE_LABEL, calcAll, effectiveRate, evalNum, headerRate, matchRule, paramKey, paramValues, rateCols, resolveRow, rowFilled,
  type CalcPayload, type CalcRow, type CustomCol, type SheetCol,
} from "@/lib/supplier-calc";

export const XLSX_SHEET = "ММ-расчёт";
export const XLSX_PARAMS = "Параметры";
const LETTERS = /^[A-Za-z]{1,3}$/;
const n0 = (s: string | undefined) => { const v = evalNum(s); return Number.isFinite(v) ? v : 0; };
const isBlank = (s: string | undefined | null) => (s ?? "").trim() === "";

/** Номер столбца Excel → буква (0→A). */
function xlLetter(i: number): string {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

type XCtx = {
  /** Строка Excel, в которой стоит формула (для ссылок «этой строки»). */
  row: number;
  first: number; last: number;
  /** Буква столбца нашей таблицы → буква в Excel (или undefined). */
  xl: (letter: string) => string | undefined;
  raw: CalcRow;
  params: Record<string, number | string>;
};

const PREC: Record<string, number> = { "=": 0, "<>": 0, "<": 0, ">": 0, "<=": 0, ">=": 0, "+": 1, "-": 1, "*": 2, "/": 2 };
const numText = (v: number) => String(v);

/** Диапазон из столбцов: подряд идущие столбцы Excel склеиваются в D5:I5, иначе список ссылок (вставленные нами столбцы не попадают в сумму). */
function rangeParts(letters: string[], c: XCtx, rowA: number | null, rowB?: number): string {
  const xs = letters.map((l) => { const x = c.xl(l); if (!x) throw new FormulaError(`Неизвестный столбец ${l.toUpperCase()}`); return x; });
  const abs = rowA !== null;
  const ref = (x: string) => (abs ? `$${x}$${rowA}:$${x}$${rowB}` : `${x}${c.row}`);
  const contiguous = xs.every((x, i) => i === 0 || colIndex(x) === colIndex(xs[i - 1]) + 1);
  if (contiguous && xs.length > 1) return abs ? `$${xs[0]}$${rowA}:$${xs[xs.length - 1]}$${rowB}` : `${xs[0]}${c.row}:${xs[xs.length - 1]}${c.row}`;
  return xs.map(ref).join(",");
}

function xlArg(n: Node, c: XCtx, whole: boolean): string {
  if (n.t === "range") {
    const ca = cellRef(n.a), cb = cellRef(n.b);
    if (ca && cb) {
      const r1 = Math.min(ca.row, cb.row), r2 = Math.max(ca.row, cb.row);
      return rangeParts(lettersBetween(ca.col, cb.col), c, c.first + r1 - 1, c.first + r2 - 1);
    }
    if (LETTERS.test(n.a) && LETTERS.test(n.b)) return rangeParts(lettersBetween(n.a, n.b), c, null);
    throw new FormulaError(`Диапазон ${n.a}:${n.b} записан неверно`);
  }
  if (whole && n.t === "id" && LETTERS.test(n.name) && c.xl(n.name)) return rangeParts([n.name], c, c.first, c.last);
  return xl(n, c, -1, false);
}

/** Формула нашего движка → текст формулы Excel (без «=»). Бросает FormulaError, если перевести нельзя. */
export function toExcelFormula(n: Node, c: XCtx, parent = -1, right = false): string {
  return xl(n, c, parent, right);
}
function xl(n: Node, c: XCtx, parent: number, right: boolean): string {
  switch (n.t) {
    case "num": return numText(n.v);
    case "id": {
      const cr = cellRef(n.name);
      if (cr && c.xl(cr.col)) return `$${c.xl(cr.col)}$${c.first + cr.row - 1}`;
      if (LETTERS.test(n.name) && c.xl(n.name)) return `${c.xl(n.name)}${c.row}`;
      const key = paramKey(n.name);
      const own = c.raw["@" + key];
      if (own !== undefined && own.trim() !== "") { const x = evalNum(own); if (Number.isFinite(x)) return numText(x); }
      const pv = c.params[key];
      if (typeof pv === "number") return key;
      if (typeof pv === "string") throw new FormulaError(pv);
      if (LETTERS.test(n.name)) throw new FormulaError(`Неизвестный столбец ${n.name.toUpperCase()}`);
      throw new FormulaError(`Неизвестный параметр «${n.name}»`);
    }
    case "range": throw new FormulaError("Диапазон можно писать только внутри SUM, AVERAGE, MIN, MAX");
    case "neg": {
      const s = xl(n.e, c, 3, false);
      return n.e.t === "bin" ? `-(${xl(n.e, c, -1, false)})` : `-${s}`;
    }
    case "bin": {
      const p = PREC[n.op];
      const s = `${xl(n.l, c, p, false)}${n.op}${xl(n.r, c, p, true)}`;
      return parent > p || (parent === p && right) || (parent >= 0 && p === 0) ? `(${s})` : s;
    }
    case "call": {
      const whole = n.name === "SUM" || n.name === "AVERAGE" || n.name === "SUBTOTAL";
      if (n.name === "SUBTOTAL") {
        const code = n.args[0];
        const codeText = code.t === "num" ? (code.v === 109 || code.v === 9 ? "9" : code.v === 101 || code.v === 1 ? "1" : numText(code.v)) : xl(code, c, -1, false);
        return `SUBTOTAL(${[codeText, ...n.args.slice(1).map((a) => xlArg(a, c, true))].join(",")})`;
      }
      return `${n.name}(${n.args.map((a) => xlArg(a, c, whole)).join(",")})`;
    }
  }
}

type PlanCol = { id: string; title: string; text: boolean; kind: "input" | "calc" | "custom"; src?: SheetCol; custom?: CustomCol };

/** Список столбцов Excel: столбцы нашей таблицы; в «своей таблице» добавляются № счёта / операция / куда, если они есть в строках. */
function planColumns(p: CalcPayload, cols: SheetCol[], used: boolean[]): PlanCol[] {
  const plan: PlanCol[] = cols.map((c) => ({ id: c.id, title: c.title, text: !!c.text, kind: c.kind, src: c, custom: p.customColumns?.find((x) => x.id === c.id) }));
  if (p.format === "SHEET") {
    const has = (k: string) => p.rows.some((r, i) => used[i] && !isBlank(r[k]));
    const add = (id: string, title: string, at: number) => plan.splice(at, 0, { id, title, text: true, kind: "input" });
    if (!plan.some((c) => c.id === "invoice") && has("invoice")) add("invoice", "№ счёта", 0);
    const lot = plan.findIndex((c) => c.id === "lot");
    let at = lot >= 0 ? lot + 1 : plan.length;
    if (!plan.some((c) => c.id === "operation") && has("operation")) add("operation", "Операция", at++);
    if (!plan.some((c) => c.id === "dest") && has("dest")) add("dest", "Куда", at++);
  }
  return plan;
}

export type XlsxMeta = {
  sheet: string; headerRow: number; first: number; last: number; totalsRow: number;
  /** id нашего столбца → буква в Excel. */
  letters: Record<string, string>;
  /** Сколько ячеек записано формулами / значениями / запасным значением (формулу перевести не удалось). */
  formulaCells: number; fallbackCells: number;
  notes: string[];
};

/** Книга Excel и сведения о раскладке (для проверок). */
export function buildCalcWorkbook(p: CalcPayload, titleFallback = "Расчёт"): { wb: ExcelJS.Workbook; meta: XlsxMeta } {
  const t = calcAll(p);
  const sh = t.sheet;
  const f = p.format, h = p.header;
  const legacy = f !== "SHEET";
  const params = paramValues(p);
  const plan = planColumns(p, sh.cols, sh.used);
  const letterOfId: Record<string, string> = {};
  plan.forEach((c, i) => { letterOfId[c.id] = xlLetter(i); });
  const engineToXl = new Map<string, string>();
  sh.cols.forEach((c) => engineToXl.set(c.letter, letterOfId[c.id]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "fur-erp";
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet(XLSX_SHEET);
  const wp = wb.addWorksheet(XLSX_PARAMS);
  const notes: string[] = [];
  let formulaCells = 0, fallbackCells = 0;

  const HEADER_ROW = 2, FIRST = 3;
  const lastUsed = sh.used.lastIndexOf(true);
  const nRows = Math.max(1, lastUsed + 1);
  const LAST = FIRST + nRows - 1;
  const TOTALS = LAST + 1;
  const PQ = `'${XLSX_PARAMS}'`;

  // ============================================================ лист «Параметры»
  wp.getColumn(1).width = 34; wp.getColumn(2).width = 18; wp.getColumn(3).width = 24; wp.getColumn(4).width = 70;
  wp.getCell("A1").value = "Параметры расчёта"; wp.getCell("A1").font = { bold: true, size: 13 };
  wp.getCell("A2").value = "Значения в столбце B можно менять — формулы на листе «ММ-расчёт» пересчитаются. Имя из столбца C используется в формулах.";
  wp.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };
  let pr = 4;
  const secTitle = (s: string) => { const c = wp.getCell(`A${pr}`); c.value = s; c.font = { bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } }; for (const L of ["B", "C", "D"]) wp.getCell(`${L}${pr}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } }; pr++; };
  const infoRow = (label: string, val: string | number) => { if (val === "" || val == null) return; wp.getCell(`A${pr}`).value = label; wp.getCell(`B${pr}`).value = val; pr++; };
  secTitle("Шапка");
  infoRow("Аукцион", h.auction); infoRow("Стадия", STAGE_LABEL[p.stage ?? "FINAL"]); infoRow("Формат", p.formatName ?? ""); infoRow("№ аукционного счёта", h.invoice);
  infoRow("Дата счёта", h.invoiceDate); infoRow("Продавец", h.seller); infoRow("Валюта счёта", h.currency); infoRow("Покупатель", h.buyer);
  infoRow("Куда", h.dest); infoRow("Брокер", h.broker); infoRow("Срок оплаты", h.dueDate); infoRow("Дата аванса", h.advanceDate); infoRow("Курс — комментарий", h.rateComment);
  pr++;
  secTitle("Курс и ставки (имена для формул)");
  const nameCell = new Map<string, string>(); // имя → адрес на листе параметров
  const defName = (name: string, addr: string) => { wb.definedNames.add(`${PQ}!$B$${addr}`, name); nameCell.set(name, `B${addr}`); };
  const putParam = (name: string, label: string, valueStr: string, note: string, preset?: { formula: string; result: number }) => {
    wp.getCell(`A${pr}`).value = label;
    const cell = wp.getCell(`B${pr}`);
    const val = evalNum(valueStr);
    if (preset) cell.value = { formula: preset.formula, result: preset.result };
    else if (!isBlank(valueStr) && Number.isFinite(val)) {
      if (/^[-+]?\d+([.,]\d+)?$/.test(valueStr.trim().replace(/\s/g, ""))) cell.value = val;
      else { try { cell.value = { formula: toExcelFormula(parseFormula(valueStr), { row: 0, first: FIRST, last: LAST, xl: () => undefined, raw: {}, params }, -1), result: val }; } catch { cell.value = val; } }
    } else cell.value = isBlank(valueStr) ? 0 : valueStr;
    cell.numFmt = "0.######";
    wp.getCell(`C${pr}`).value = name; wp.getCell(`C${pr}`).font = { color: { argb: "FF1F4E9C" } };
    wp.getCell(`D${pr}`).value = note;
    defName(name, String(pr));
    pr++;
  };
  const own = new Set((p.params ?? []).filter((q) => q.name.trim()).map((q) => paramKey(q.name)));
  // курс: ЦБ + надбавка агента, либо свой параметр «курс» (в свободной таблице)
  if (!own.has("курс")) {
    putParam("курс_цб", "Курс ЦБ на дату счёта", h.cbRate, "в формулах не используется напрямую — входит в «курс»");
    putParam("надбавка_агента_проц", "Надбавка агента к курсу, %", h.agentPct, "");
    putParam("курс", "Курс для расчёта", "", "= курс ЦБ × (1 + надбавка агента / 100)", { formula: `${nameCell.get("курс_цб")}*(1+${nameCell.get("надбавка_агента_проц")}/100)`, result: effectiveRate(h) });
  }
  if (!own.has("ндс")) putParam("ндс", "НДС, %", isBlank(h.vat) ? "22" : h.vat, "НДС на товар и услуги");
  const seen = new Set<string>(["курс", "ндс", "курс_цб", "надбавка_агента_проц"]);
  for (const rc of rateCols(f)) {
    rc.rate!.names.forEach((nm, k) => {
      const key = paramKey(nm);
      if (seen.has(key) || own.has(key)) return;
      seen.add(key);
      if (k === 0) putParam(key, rc.rate!.label, headerRate(h, rc.key), "ставка из шапки; пустая ячейка в строке берёт её");
      else { const master = paramKey(rc.rate!.names[0]); putParam(key, rc.rate!.label, "", `то же, что ${master}`, { formula: nameCell.get(master) ?? "B1", result: n0(headerRate(h, rc.key)) }); }
    });
  }
  for (const q of p.params ?? []) {
    if (!q.name.trim()) continue;
    const key = paramKey(q.name);
    if (nameCell.has(key) && !own.has(key)) continue;
    if (seen.has(key) && own.has(key) && nameCell.has(key)) continue;
    seen.add(key);
    putParam(key, q.label || q.name, q.value, q.hint ?? "");
  }
  // расходы на шкуру (простые форматы)
  let extrasName = false;
  const extras = legacy ? h.extras.filter((e) => !isBlank(e.name) || !isBlank(e.amount)) : [];
  if (extras.length) {
    pr++;
    secTitle("Прочие расходы, ₽");
    const startE = pr;
    const qtyId = QTY_COL;
    const qtyTot = `'${XLSX_SHEET}'!$${letterOfId[qtyId]}$${TOTALS}`;
    for (const e of extras) {
      wp.getCell(`A${pr}`).value = e.name || "Расход";
      wp.getCell(`B${pr}`).value = n0(e.amount);
      wp.getCell(`C${pr}`).value = e.mode === "total" ? "на весь счёт" : "на шкуру";
      const per = e.mode === "total" ? (sh.used.some(Boolean) && t.qty > 0 ? n0(e.amount) / t.qty : 0) : n0(e.amount);
      wp.getCell(`D${pr}`).value = { formula: `IF(C${pr}="на весь счёт",IF(${qtyTot}=0,0,B${pr}/${qtyTot}),B${pr})`, result: per };
      wp.getCell(`D${pr}`).numFmt = "#,##0.00";
      pr++;
    }
    wp.getCell(`A${pr}`).value = "Расходы на шкуру, ₽ (в цену за шкуру)"; wp.getCell(`A${pr}`).font = { bold: true };
    wp.getCell(`B${pr}`).value = { formula: `SUM(D${startE}:D${pr - 1})`, result: t.extraRub };
    wp.getCell(`B${pr}`).numFmt = "#,##0.00";
    wp.getCell(`C${pr}`).value = "расходы_на_шкуру";
    wb.definedNames.add(`${PQ}!$B$${pr}`, "расходы_на_шкуру");
    extrasName = true;
    pr++;
  }
  // свои значения по строкам
  const rowParamNotes: string[] = [];
  p.rows.forEach((r, i) => { if (!sh.used[i]) return; for (const [k, v] of Object.entries(r)) if (k.startsWith("@") && !isBlank(v)) rowParamNotes.push(`строка ${i + 1}: ${k.slice(1)} = ${v}`); });
  if (rowParamNotes.length) {
    pr++;
    secTitle("Свои значения по строкам (в формулах этих строк стоят числом)");
    for (const s of rowParamNotes) { wp.getCell(`A${pr}`).value = s; pr++; }
  }

  // ============================================================ лист «ММ-расчёт»
  const title = h.auction.trim() ? `${h.auction.trim()} (${(p.stage ?? "FINAL") === "PRELIM" ? "предварительный расчёт" : "расчёт"})` : titleFallback;
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 13 };
  // «(в файле O)» — пометка образца формата для экрана; в файле для поставщика она лишняя
  plan.forEach((c) => { c.title = c.title.replace(/\s*\(в файле [A-Za-z]+\)\s*$/, ""); });
  plan.forEach((c, i) => {
    const cell = ws.getCell(HEADER_ROW, i + 1);
    cell.value = c.title;
    cell.font = { bold: true };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: c.text ? "left" : "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
    cell.border = { bottom: { style: "thin" } };
    ws.getColumn(i + 1).width = c.text ? (c.id === "fur" || c.id === "size" ? 28 : 14) : Math.min(22, Math.max(13, Math.ceil(c.title.length * 0.8)));
  });
  ws.getRow(HEADER_ROW).height = 48;
  ws.views = [{ state: "frozen", ySplit: HEADER_ROW }];

  const xlOf = (letter: string) => engineToXl.get(letter.toUpperCase());
  const ctxFor = (rowNo: number, raw: CalcRow): XCtx => ({ row: rowNo, first: FIRST, last: LAST, xl: xlOf, raw, params });
  const ov = (i: number, id: string) => { const o = p.overrides?.[p.rows[i]?._id ?? ""]?.[id]; return o !== undefined && o.trim() !== "" ? o : null; };
  const numFmtOf = (c: PlanCol) => (c.id === QTY_COL || c.id === p.qtyColumn ? "#,##0" : /курс/i.test(c.title) ? "0.0000" : "#,##0.00");
  const L = (id: string, r: number) => `${letterOfId[id]}${r}`;
  const extraTerm = extrasName ? "+расходы_на_шкуру" : "";
  const vatName = "ндс";

  // встроенные формулы простых форматов: ссылки по ключам столбцов формата
  const legacyFormula = (id: string, r: number): string | null => {
    const v = (k: string) => L(k, r);
    if (id === "total") return `${L(UNIT_COL, r)}*${L(QTY_COL, r)}`;
    if (id === "unitUsd" && f === "SAGA") {
      const coef = `IF(${v("coef")}="",1,${v("coef")})`;
      return `(${v("price")}+(${v("price")}*${v("feePct")}/100+${v("feeFixed")})+${v("packing")}+${v("price")}*${v("brokerPct")}/100)*${coef}+${v("price")}*${v("interestPct")}/100*${coef}+${v("dressing")}+${v("adj")}+${v("customs")}+${v("air")}`;
    }
    if (id !== UNIT_COL) return null;
    if (f === "SAGA") return `${v("unitUsd")}*курс${extraTerm}`;
    if (f === "FH") {
      const P = v("price");
      return `${P}*курс+${P}*${v("feePct")}/100*курс+${v("packing")}*курс+${P}*${v("brokerPct")}/100*курс+${v("dressingUsd")}*курс+${v("base22")}*${v("vatPct")}/100+${v("base5")}*${v("dutyPct")}/100+(${v("trans1")}+${v("trans2")})*курс+${P}*курс*${v("commPct")}/100${extraTerm}`;
    }
    const g = `${v("price")}*${v("rate")}`;
    return `${g}*(1+${v("feePct")}/100*(1+${vatName}/100)+${vatName}/100+${v("brokerPct")}/100)+${v("dressing")}+${v("transport")}+${v("transit")}${extraTerm}`;
  };

  for (let i = 0; i < nRows; i++) {
    const r = FIRST + i;
    if (!sh.used[i]) continue;
    const raw = p.rows[i];
    const rr = resolveRow(f, h, raw);
    const ctx = ctxFor(r, raw);
    plan.forEach((c, ci) => {
      const cell = ws.getCell(r, ci + 1);
      const val = sh.cells[c.id]?.[i];
      const setNum = () => { cell.numFmt = numFmtOf(c); };
      // текст
      if (c.text) {
        const s = (raw[c.id] ?? "").trim();
        if (s === "") return;
        cell.value = (c.id === "invoice" || c.id === "lot") && /^[1-9]\d{0,14}$/.test(s) ? Number(s) : s;
        return;
      }
      const setFormula = (fx: string) => { cell.value = { formula: fx, result: val?.v ?? undefined } as ExcelJS.CellFormulaValue; formulaCells++; setNum(); };
      const fallback = (why: string) => { fallbackCells++; notes.push(`${XLSX_SHEET}!${letterOfId[c.id]}${r}: ${why} — записано значением`); if (val?.v != null) { cell.value = val.v; setNum(); } else if (val?.err) cell.value = `ошибка: ${val.err}`; };
      const manual = (s: string) => {
        const t0 = s.trim();
        if (/^[-+]?\d+([.,]\d+)?$/.test(t0.replace(/[\s  ]/g, ""))) { cell.value = n0(t0); setNum(); return; }
        try { setFormula(toExcelFormula(parseFormula(t0), ctx)); } catch (e) { fallback(e instanceof FormulaError ? e.message : "ручная формула"); }
      };
      // ручное значение вычисляемого столбца
      if (c.kind !== "input") {
        const o = ov(i, c.id);
        if (o !== null) return manual(o);
      }
      if (c.kind === "input") {
        // ввод: ставка шапки в пустой ячейке → ссылка на параметр; число; выражение «6,8*1,156»
        const s = (rr[c.id] ?? "").trim();
        if (isBlank(raw[c.id]) && !isBlank(s) && c.src && c.id !== "rate") {
          const rc = rateCols(f).find((x) => x.key === c.id);
          if (rc) { cell.value = { formula: paramKey(rc.rate!.names[0]), result: val?.v ?? undefined } as ExcelJS.CellFormulaValue; formulaCells++; setNum(); return; }
        }
        if (c.id === "rate" && legacy && (f === "SP_RP" || f === "OTHER") && s === "") { cell.value = { formula: "курс", result: val?.v ?? undefined } as ExcelJS.CellFormulaValue; formulaCells++; setNum(); return; }
        if (s === "") return;
        return manual(s);
      }
      if (c.kind === "calc") {
        const fx = legacyFormula(c.id, r);
        if (fx) return setFormula(fx);
        return fallback("нет формулы");
      }
      // свой столбец-формула: правила строки важнее основной формулы
      const cc = c.custom!;
      let src = cc.formula;
      for (const rule of cc.rules ?? []) if (matchRule(rule, i + 1, raw)) { src = rule.formula; break; }
      if (!src.trim() || val?.err) return fallback(val?.err ?? "для строки нет формулы");
      try { setFormula(toExcelFormula(parseFormula(src), ctx)); } catch (e) { fallback(e instanceof FormulaError ? e.message : "формулу не перевести"); }
    });
  }

  // итоговая строка
  ws.getCell(TOTALS, 1).value = "Итого";
  ws.getCell(TOTALS, 1).font = { bold: true };
  plan.forEach((c, ci) => {
    const s = sh.sums[c.id];
    if (!s || c.text) return;
    const col = xlLetter(ci);
    const mode = c.custom?.total ?? "sum";
    const cell = ws.getCell(TOTALS, ci + 1);
    cell.value = { formula: `${mode === "avg" ? "AVERAGE" : "SUM"}(${col}${FIRST}:${col}${LAST})`, result: s.v ?? undefined } as ExcelJS.CellFormulaValue;
    cell.font = { bold: true };
    cell.numFmt = numFmtOf(c);
    cell.border = { top: { style: "thin" } };
    formulaCells++;
  });

  // блок «к оплате»
  const unitId = sh.unitCol, qtyId = sh.qtyCol;
  const labelCol = Math.max(1, unitId ? plan.findIndex((c) => c.id === unitId) + 1 : 2);
  let br = TOTALS + 2;
  const line = (label: string, value: number | { formula: string; result: number }, note?: string) => {
    const lc = ws.getCell(br, labelCol), vc = ws.getCell(br, labelCol + 1);
    lc.value = label; lc.font = { bold: true }; lc.alignment = { horizontal: "right" };
    vc.value = value as ExcelJS.CellValue; vc.numFmt = "#,##0.00"; vc.font = { bold: true };
    if (note) { const nc = ws.getCell(br, labelCol + 2); nc.value = note; nc.font = { italic: true, color: { argb: "FF666666" } }; }
    br++;
  };
  const cellOf = (id: string) => `${letterOfId[id]}${TOTALS}`;
  for (const c of plan) if (/^к оплате/i.test(c.title) && sh.sums[c.id]?.v != null) line(c.title, { formula: cellOf(c.id), result: sh.sums[c.id].v! });
  if (unitId && qtyId) {
    const u = letterOfId[unitId], q = letterOfId[qtyId];
    line("Итого себестоимость (цена за шкуру × количество)", { formula: `SUMPRODUCT(${u}${FIRST}:${u}${LAST},${q}${FIRST}:${q}${LAST})`, result: t.totalRub });
    const adv = n0(h.advance), mid = n0(h.interim);
    if (!isBlank(h.advance) || !isBlank(h.interim)) {
      const vL = xlLetter(labelCol);
      const aRow = br;
      line("Аванс оплачен", adv);
      line("Промежуточная оплата", mid);
      line("Остаток к оплате", { formula: `${vL}${aRow - 1}-${vL}${aRow}-${vL}${aRow + 1}`, result: t.rest });
    }
  }
  for (const d of p.checks ?? []) {
    const a = sh.cols.find((c) => c.letter === d.a.trim().toUpperCase()), b = sh.cols.find((c) => c.letter === d.b.trim().toUpperCase());
    if (!a || !b || sh.sums[a.id]?.v == null || sh.sums[b.id]?.v == null) continue;
    line(`Контроль: ${d.title}`, { formula: `${cellOf(a.id)}-${cellOf(b.id)}`, result: sh.sums[a.id].v! - sh.sums[b.id].v! }, `допуск ±${d.tol || 0}`);
  }
  if (notes.length) {
    br++;
    ws.getCell(br, 1).value = "Замечания (формулу перевести не удалось — записано значение):";
    ws.getCell(br, 1).font = { bold: true };
    notes.slice(0, 30).forEach((s, k) => { ws.getCell(br + 1 + k, 1).value = s; });
  }

  return { wb, meta: { sheet: XLSX_SHEET, headerRow: HEADER_ROW, first: FIRST, last: LAST, totalsRow: TOTALS, letters: letterOfId, formulaCells, fallbackCells, notes } };
}

export async function buildCalcXlsx(p: CalcPayload, titleFallback?: string): Promise<Buffer> {
  const { wb } = buildCalcWorkbook(p, titleFallback);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Имя файла: «расчет закупки СП 09-26.xlsx». */
export function calcXlsxName(p: CalcPayload, title: string): string {
  const base = (p.header.auction || title || "расчёт").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `расчет закупки ${base}.xlsx`;
}
