// Проверка выгрузки «детальный расчёт стоимости сырья» в Excel (src/lib/calc-xlsx.ts).
// Файл собирается, читается обратно и пересчитывается НЕЗАВИСИМЫМ вычислителем формул Excel (fast-formula-parser, не наш движок);
// каждая ячейка сверяется с нашим движком до копейки. Реальный расчёт СП 09-26: 29 лотов, T32 и «аванс 1» как в файле Веллмеха.
// Затем все форматы расчётов (14 пресетов по контрольным строкам) и простые форматы СП/РП, SAGA, FH с расходами и ручными правками.
import "./stubs/server-only-shim";
import fs from "fs";
import os from "os";
import ExcelJS from "exceljs";
import { PRESETS, getPreset, payloadFromPreset } from "../src/lib/calc-presets";
import { applySheetTable } from "../src/lib/sheet-paste";
import { calcAll, emptyPayload, newId, paramKey, syncLetters, type CalcPayload } from "../src/lib/supplier-calc";
import { buildCalcWorkbook, XLSX_SHEET } from "../src/lib/calc-xlsx";
import { parseTableFile } from "../src/lib/table-file";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FormulaParser = require("fast-formula-parser");

let bad = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (!cond) bad++; console.log(`${cond ? "OK  " : "FAIL"} ${name}${extra ? ": " + extra : ""}`); };
const eq = (name: string, got: number, want: number, tol = 0.005) => ok(name, Math.abs(got - want) <= tol, `${got} (ожидалось ${want})`);

/** Пересчёт книги вычислителем Excel-формул: значение любой ячейки по формулам из файла (кэшированные результаты не используются). */
async function loadAndEvaluate(wbOut: ExcelJS.Workbook) {
  const buf = Buffer.from(await wbOut.xlsx.writeBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const names = new Map<string, { sheet: string; row: number; col: number }>();
  for (const d of (wb.definedNames.model as { name: string; ranges: string[] }[])) {
    const m = /^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)$/.exec(d.ranges[0]);
    if (!m) continue;
    let col = 0; for (const ch of m[2]) col = col * 26 + ch.charCodeAt(0) - 64;
    names.set(d.name.toLowerCase(), { sheet: m[1], row: Number(m[3]), col });
  }
  // вычислитель не понимает кириллические имена — подставляем адрес именованной ячейки (настоящий Excel имена понимает)
  const colName = (n: number) => { let s = ""; for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s; return s; };
  const sorted = [...names.entries()].sort((a, b) => b[0].length - a[0].length);
  const inlineNames = (fx: string) => {
    let out = fx;
    for (const [nm, a] of sorted) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}_.$'!])${nm}(?![\\p{L}\\p{N}_(])`, "giu"), `'${a.sheet}'!$${colName(a.col)}$${a.row}`);
    return out;
  };
  const memo = new Map<string, unknown>();
  const cellVal = (sheet: string, row: number, col: number): unknown => {
    const key = `${sheet}!${row}:${col}`;
    if (memo.has(key)) return memo.get(key);
    const c = wb.getWorksheet(sheet)!.getCell(row, col);
    const v = c.value as unknown;
    let out: unknown;
    if (v && typeof v === "object" && "formula" in (v as object)) out = parseAt(inlineNames((v as { formula: string }).formula), { sheet, row, col });
    else if (v && typeof v === "object" && "result" in (v as object)) out = (v as { result: unknown }).result;
    else out = v ?? null;
    memo.set(key, out);
    return out;
  };
  // парсер Excel-формул не допускает вложенного вызова из своих обратных вызовов — по экземпляру на глубину вложенности
  let depth = 0;
  const pool: { parse: (f: string, pos: unknown) => unknown }[] = [];
  const parseAt = (fx: string, pos: unknown) => { const pa = (pool[depth] ??= new FormulaParser(callbacks)); depth++; try { return pa.parse(fx, pos); } finally { depth--; } };
  const nums = (args: unknown[]): number[] => args.flatMap((a) => {
    const v = a && typeof a === "object" && !Array.isArray(a) && "value" in (a as object) ? (a as { value: unknown }).value : a; // аргументы пользовательских функций приходят в обёртке
    return Array.isArray(v) ? nums(v) : typeof v === "number" ? [v] : [];
  });
  const callbacks = {
    // MAX/MIN/SUBTOTAL в этой библиотеке не реализованы — обычные определения Excel (для текста и пустых ячеек в диапазонах — пропуск)
    functions: {
      MAX: (...a: unknown[]) => Math.max(...nums(a)),
      MIN: (...a: unknown[]) => Math.min(...nums(a)),
      SUBTOTAL: (code0: { value: unknown }, ...a: unknown[]) => (code0.value === 1 ? nums(a).reduce((x, y) => x + y, 0) / nums(a).length : nums(a).reduce((x, y) => x + y, 0)),
    },
    onCell: (r: { sheet: string; row: number; col: number }) => cellVal(r.sheet, r.row, r.col),
    onRange: (r: { sheet: string; from: { row: number; col: number }; to: { row: number; col: number } }) => {
      const out: unknown[][] = [];
      for (let i = r.from.row; i <= r.to.row; i++) { const line: unknown[] = []; for (let j = r.from.col; j <= r.to.col; j++) line.push(cellVal(r.sheet, i, j)); out.push(line); }
      return out;
    },
    onVariable: (name: string) => { const n = names.get(name.toLowerCase()); return n ? cellVal(n.sheet, n.row, n.col) : FormulaParser.FormulaError.NAME; },
  };
  return { wb, value: cellVal, names };
}

/** Сверка книги с движком: каждая числовая ячейка листа «ММ-расчёт» (формулы пересчитаны независимо) равна значению нашего расчёта. */
async function verify(label: string, p: CalcPayload, opts: { minFormulas?: number } = {}) {
  const q = syncLetters(p);
  const c = calcAll(q);
  const sh = c.sheet;
  const { wb, meta } = buildCalcWorkbook(q);
  const ev = await loadAndEvaluate(wb);
  let checked = 0, diffs = 0, formulas = 0;
  const ws = wb.getWorksheet(XLSX_SHEET)!;
  for (const col of sh.cols) {
    if (col.text) continue;
    const L = meta.letters[col.id];
    const colNo = L.split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
    sh.cells[col.id]?.forEach((cell, i) => {
      if (!sh.used[i] || cell.v == null) return;
      const xc = ws.getCell(meta.first + i, colNo);
      const isF = xc.value && typeof xc.value === "object" && "formula" in (xc.value as object);
      if (isF) formulas++;
      const got = ev.value(XLSX_SHEET, meta.first + i, colNo) ?? 0; // пустая ячейка Excel = 0
      checked++;
      if (typeof got !== "number" || Math.abs(got - cell.v) > 0.005) { diffs++; if (diffs <= 5) console.log(`   расхождение ${label} ${L}${meta.first + i} (${col.title}): Excel ${String(got)} · движок ${cell.v}`); }
    });
    const s = sh.sums[col.id];
    if (s?.v != null) {
      const got = ev.value(XLSX_SHEET, meta.totalsRow, colNo);
      checked++;
      if (typeof got !== "number" || Math.abs(got - s.v) > 0.005) { diffs++; console.log(`   итог ${label} ${L}${meta.totalsRow} (${col.title}): Excel ${String(got)} · движок ${s.v}`); }
    }
  }
  ok(`${label}: ячеек сверено ${checked}, расхождений ${diffs}, формул в строках ${formulas}, запасных значений ${meta.fallbackCells}`, diffs === 0 && checked > 0 && meta.fallbackCells === 0 && formulas >= (opts.minFormulas ?? 0));
  return { wb, meta, ev, c, sh };
}

/** Строка формата из контрольных значений preset.check. */
function presetFromCheck(id: string): CalcPayload {
  const pr = getPreset(id)!;
  const p = payloadFromPreset(pr);
  const rows = pr.check.map((ch) => {
    const row: Record<string, string> = { _id: newId(), fur: "Соболь", size: "тест", lot: String(ch.row) };
    for (const [k, v] of Object.entries(ch.rowInputs)) {
      if (pr.columns.some((x) => x.key === k)) row[`k_${k}`] = String(v);
      else row["@" + paramKey(k)] = String(v);
    }
    return row;
  });
  const first = pr.check[0];
  p.params = (p.params ?? []).map((q) => (q.name in first.paramOverrides ? { ...q, value: String(first.paramOverrides[q.name]) } : q));
  // параметры с разными значениями по контрольным строкам: у строки — своё значение
  pr.check.forEach((ch, i) => { for (const [k, v] of Object.entries(ch.paramOverrides)) if (i > 0 && v !== first.paramOverrides[k]) rows[i]["@" + paramKey(k)] = String(v); });
  p.rows = rows;
  return p;
}

async function run() {
  // ——— 1. Реальный расчёт СП 09-26
  const FILE = `${os.homedir()}/Downloads/расчет закупки СП 09-26.xlsx`;
  if (fs.existsSync(FILE)) {
    const table = await parseTableFile(fs.readFileSync(FILE), "x.xlsx");
    const r = applySheetTable(payloadFromPreset(getPreset("sp_0926")!), table);
    if ("error" in r) { ok("СП 09-26: разбор файла", false, r.error); }
    else {
      const res = await verify("СП 09-26 (29 лотов)", r.payload, { minFormulas: 29 * 8 });
      const { wb, meta, ev } = res;
      const ws = wb.getWorksheet(XLSX_SHEET)!;
      eq("лотов", meta.last - meta.first + 1, 29, 0);
      const colOf = (title: string) => { const id = res.sh.cols.find((x) => x.title.startsWith(title))!.id; return meta.letters[id].split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0); };
      eq("T32: себестоимость общая (Excel-формула SUM)", ev.value(XLSX_SHEET, meta.totalsRow, colOf("Себестоимость общая")) as number, 64458150.402630106);
      eq("аванс 1: итог столбца", ev.value(XLSX_SHEET, meta.totalsRow, colOf("К оплате: аванс 1")) as number, 60831063.86684011);
      // блок «к оплате аванс 1»: строка с подписью и формулой
      let found = false;
      ws.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === "string" && /^К оплате: аванс 1/.test(cell.value)) { const v = ev.value(XLSX_SHEET, Number(cell.row), Number(cell.col) + 1); if (typeof v === "number" && Math.abs(v - 60831063.86684011) < 0.005) found = true; } }));
      ok("блок «К оплате: аванс 1» под таблицей = 60 831 063,87", found);
      // формулы настоящие: пример строки 1
      const sample = (L: string) => { const v = ws.getCell(`${L}${meta.first}`).value as { formula?: string } | null; return v?.formula ?? "(не формула)"; };
      const id = (t: string) => meta.letters[res.sh.cols.find((x) => x.title.startsWith(t))!.id];
      console.log("   пример формул, строка 3:", ["Аукционный сбор", "НДС на аукционный сбор", "Выделка", "Себестоимость за единицу", "Себестоимость общая"].map((t) => `${id(t)}3 = ${sample(id(t))}`).join(" | "));
      ok("столбец «Аукционный сбор» — формула со ссылкой на параметры", /курс/.test(sample(id("Аукционный сбор"))) && /сбор_проц/.test(sample(id("Аукционный сбор"))));
      ok("шапка и ставки на листе «Параметры» (именованные ячейки)", ["курс", "сбор_проц", "ндс_проц", "брок_проц", "выделка_без_ндс"].every((n) => ev.names.has(n)));
      // правка параметра в Excel: меняем ставку сбора — итог пересчитывается (формулы живые)
      const ev2 = await (async () => {
        const wp = wb.getWorksheet("Параметры")!;
        const nm = ev.names.get("сбор_проц")!;
        wp.getCell(nm.row, nm.col).value = 8;
        return loadAndEvaluate(wb);
      })();
      const t2 = ev2.value(XLSX_SHEET, meta.totalsRow, colOf("Себестоимость общая")) as number;
      ok("правка ставки сбора в «Параметры» пересчитывает итог (формулы живые)", typeof t2 === "number" && t2 > 64458150.4 + 1);
    }
  } else console.log("файл СП 09-26 не найден в ~/Downloads — проверка на реальном расчёте пропущена");

  // ——— 2. Все форматы по контрольным строкам из реальных файлов
  for (const pr of PRESETS) {
    if (pr.check.length === 0) { const p = payloadFromPreset(pr); p.rows = [{ ...p.rows[0], lot: "1" }]; continue; }
    await verify(`формат ${pr.id}`, presetFromCheck(pr.id));
  }

  // ——— 3. Простые форматы (не SHEET): СП/РП, SAGA, FH, «Другой» — с расходами, шапочными ставками, ручной ценой
  const simple = (f: "SP_RP" | "SAGA" | "FH" | "OTHER") => {
    const p = emptyPayload(f);
    p.header = { ...p.header, auction: "Тест 10-26", invoice: "9001", cbRate: "90,5", agentPct: "1,5", vat: "22", rates: { feePct: "7,35", brokerPct: "4,5", dressing: "1159", transport: "20", transit: "0", feeFixed: "0,1", packing: "0,25", coef: "1,153", air: "1", interestPct: "4,5", dressingUsd: "11", base22: "", vatPct: "22", dutyPct: "5", commPct: "2", trans1: "6", trans2: "6" }, extras: [{ name: "Страховка", amount: "100000", mode: "total" }, { name: "Прочее", amount: "12,5", mode: "perHide" }], advance: "1000000", interim: "250000" };
    const mk = (lot: string, qty: string, price: string, more: Record<string, string> = {}) => ({ ...p.rows[0], _id: newId(), invoice: "9001", fur: "Мех", size: "A", lot, qty, price, ...more });
    p.rows = [mk("1", "50", "120"), mk("2", "30", "(100+5)*1.1", { feePct: "9,2", rate: "91" }), mk("3", "10", "80", f === "FH" ? { base22: "5000", base5: "3000" } : { dressing: "1200", customs: "2", adj: "0,5" })];
    return p;
  };
  for (const f of ["SP_RP", "OTHER", "SAGA", "FH"] as const) {
    const p = simple(f);
    const r = await verify(`простой формат ${f}`, p, { minFormulas: 6 });
    // ручная цена за шкуру (число, выражение и формула «как введено»)
    const pl = r.sh.cols.find((x) => x.id === "price")!.letter;
    const p2 = syncLetters({ ...p, overrides: { [p.rows[0]._id]: { unit: "35000,5" }, [p.rows[1]._id]: { unit: "=950*1.22" }, [p.rows[2]._id]: { unit: `=${pl}+500` } } });
    await verify(`простой формат ${f} + ручные цены`, p2);
  }

  // ——— 4. Свои столбцы: правила по строкам, SUM/IF/ROUND/MIN/MAX/AVERAGE/диапазоны, ссылки на ячейки, итог avg, контрольная разность, ручная формула в ячейке
  {
    const p = payloadFromPreset(getPreset("sp_0926")!);
    const r = ["a", "b", "c", "d"].map((x, i) => ({ _id: newId(), fur: x, size: "", lot: String(i + 1), invoice: "7000", operation: "тонировка", k_E: String(10 + i * 5), k_H: String(100 + i * 10), k_O: "20", k_Q: "", "@сбор_проц": i === 3 ? "7,75" : "", k_U: "" }));
    p.rows = r;
    p.params = (p.params ?? []).map((q) => (q.name === "курс" ? { ...q, value: "84,4075" } : q));
    const letter = (key: string) => p.customColumns!.find((c) => c.id === `k_${key}`)!.letter;
    const E = letter("E"), H = letter("H"), S = letter("S"), T = letter("T");
    p.customColumns = [...p.customColumns!,
      { id: "x1", letter: "", title: "Округление", unit: "₽", kind: "formula", formula: `=ROUND(${S}*1,5;1)+IF(${H}>=120;10;0)+MAX(${H};${E})-MIN(${H};${E})+ABS(-3)` },
      { id: "x2", letter: "", title: "Доля от итога", unit: "%", kind: "formula", formula: `=${T}/SUM(${T})*100`, total: "avg" },
      { id: "x3", letter: "", title: "Сумма строки D:I", unit: "₽", kind: "formula", formula: `=SUM(${H}:${S})-${S}3+AVERAGE(${H}2:${H}3)`, rules: [{ rowFrom: 2, rowTo: 3, formula: `=${S}*2%` }] },
      { id: "x4", letter: "", title: "Итого для УПД", unit: "₽", kind: "formula", formula: `=SUBTOTAL(9;${T})+SUM(${H}:${E})` },
    ];
    const q = syncLetters(p);
    // ручная формула в ячейке вычисляемого столбца
    q.overrides = { [q.rows[1]._id]: { [q.customColumns!.find((c) => c.id === "k_S")!.id]: `=${H}*1,1` } };
    q.checks = [{ id: "c1", title: "T − Т", a: q.customColumns!.find((c) => c.id === "k_T")!.letter, b: q.customColumns!.find((c) => c.id === "k_T")!.letter, tol: "0.01" }];
    if (process.env.DUMP) { const { wb, meta } = buildCalcWorkbook(q); const ws = wb.getWorksheet(XLSX_SHEET)!; for (const id of ["x1", "x2", "x3", "x4"]) console.log(id, (ws.getCell(`${meta.letters[id]}3`).value as { formula: string }).formula); }
    const res = await verify("свои столбцы, правила, функции, ручные ячейки, invoice/операция", q, { minFormulas: 30 });
    ok("№ счёта и «Операция» выгружены столбцами", ["invoice", "operation"].every((k) => res.meta.letters[k]));
  }
  console.log(bad ? `ПРОВАЛОВ: ${bad}` : "выгрузка в Excel: формулы пересчитаны независимым вычислителем и совпали с движком до копейки");
  process.exit(bad ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
