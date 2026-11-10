/**
 * Excel «Отчёт: продажи» (09.11.2026): лист «Данные» из scripts/gen-fw26-sales-data-v06.ts, лист «Пивот» — пустой (настоящую сводную таблицу кладёт scripts/add-excel-pivot.py),
 * лист «Отчёт» — копия оформления образца владельца (scripts/templates/fw26-report-sales-template.xlsx: шапка, ширины и скрытые столбцы, шрифты, заливки, рамки, форматы чисел,
 * группировка строк), строки заново: Total → категория 1 → мех → категория 2 по убыванию заказа FW26 в €; формулы и значения — по актуальным «Данные».
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/build-report-sales-xlsx.ts <данные.xlsx> <результат.xlsx>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

const cv = (v: unknown) => (v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v);
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;

async function main() {
  const [src, out] = [process.argv[2], process.argv[3]];
  if (!src || !out) throw new Error("usage: <данные.xlsx> <результат.xlsx>");
  const tpl = new ExcelJS.Workbook(); await tpl.xlsx.readFile(join(__dirname, "templates", "fw26-report-sales-template.xlsx"));
  const T = tpl.getWorksheet("Отчёт")!;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(src);
  const D = wb.getWorksheet("Данные")!;
  for (const n of ["Пивот", "Отчёт"]) { const w = wb.getWorksheet(n); if (w) wb.removeWorksheet(w.id); }
  wb.addWorksheet("Пивот");
  const R = wb.addWorksheet("Отчёт", { properties: { outlineLevelRow: 3 } });
  R.properties.outlineProperties = { summaryBelow: false, summaryRight: false };

  // Данные: строки 4…LAST (до пустой строки перед «Итого»)
  const FIRST = 4; let LAST = FIRST;
  for (let r = FIRST; r <= D.rowCount; r++) { const a = D.getCell(r, 1).value; if (a == null || a === "" || String(a).startsWith("Итого")) break; LAST = r; }
  const L = (n: number) => D.getColumn(n).letter;
  type Row = { fur: string; c1: string; c2: string; v: number[] };
  const rows: Row[] = [];
  for (let r = FIRST; r <= LAST; r++) rows.push({ fur: String(cv(D.getCell(r, 1).value)), c1: String(cv(D.getCell(r, 2).value)), c2: String(cv(D.getCell(r, 3).value)), v: Array.from({ length: 26 }, (_, i) => Number(cv(D.getCell(r, i + 1).value)) || 0) });
  const dr = (c: number) => `Данные!$${L(c)}$${FIRST}:$${L(c)}$${LAST}`;
  const dF = `Данные!$A$${FIRST}:$A$${LAST}`, dA = `Данные!$B$${FIRST}:$B$${LAST}`, dB = `Данные!$C$${FIRST}:$C$${LAST}`;

  // столбцы отчёта I…Z (9…26): образец — формула итоговой строки Total (T!7)
  const COLS = Array.from({ length: 18 }, (_, i) => 9 + i);
  const colNum = (a: string) => a.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const tplF = new Map<number, string>();
  for (const c of COLS) { const v = T.getCell(7, c).value as { formula?: string } | string | null; const f = typeof v === "object" && v ? v.formula ?? "" : ""; tplF.set(c, f.replace(/(\$[A-Z]+\$)\d+:(\$[A-Z]+\$)\d+/g, `$1${FIRST}:$2${LAST}`)); }
  tplF.set(100, `SUM(Данные!$W$${FIRST}:$W$${LAST})`); // новый столбец «Order TTL, EUR» (Данные!W)
  tplF.set(101, `SUM(Данные!$X$${FIRST}:$X$${LAST})`); // Delivery TTL, PCS (Данные!X)
  tplF.set(102, `SUM(Данные!$Y$${FIRST}:$Y$${LAST})`); // Stock EUR FW26 (Данные!Y)
  tplF.set(103, `SUM(Данные!$Z$${FIRST}:$Z$${LAST})`); // Stock EUR TTL (Данные!Z)
  // столбцы образца от J вправо сдвигаются: новый J = Order TTL EUR; новый M = Delivery TTL PCS (перед Delivery FW26 PCS); после Stock TTL — Stock EUR FW26 (AC) и Stock EUR TTL (AD)
  const mapC = (c: number) => (c >= 12 ? c + 2 : c >= 10 ? c + 1 : c);
  const C_DTTL = 13, C_SEUR26 = 29, C_SEURTTL = 30;
  const termsOf = (s: string) => [...s.matchAll(/SUM\(Данные!\$([A-Z]+)\$\d+:\$[A-Z]+\$\d+\)/g)].map((m) => colNum(m[1]));
  const sumRows = (rs: Row[], cols: number[]) => rs.reduce((a, r) => a + cols.reduce((t, c) => t + r.v[c - 1], 0), 0);
  const calc = (c: number, rs: Row[]) => {
    const f = tplF.get(c)!; const m = /^IFERROR\(\((.*)\)\/\((.*)\),0\)$/.exec(f);
    if (m) { const den = sumRows(rs, termsOf(m[2])); return den ? sumRows(rs, termsOf(m[1])) / den : 0; }
    return sumRows(rs, termsOf(f));
  };
  const formulaFor = (c: number, crit: string) => (crit ? tplF.get(c)!.replace(/SUM\((Данные!\$[A-Z]+\$\d+:\$[A-Z]+\$\d+)\)/g, `SUMIFS($1${crit})`) : tplF.get(c)!);

  // ───── шапка и оформление: строки 1…6, ширины, скрытые столбцы — как в образце ─────
  const copyStyle = (s: ExcelJS.Cell, t: ExcelJS.Cell) => { t.style = JSON.parse(JSON.stringify(s.style)); };
  for (let c = 1; c <= 26; c++) {
    const sc = T.getColumn(c), tc = R.getColumn(mapC(c));
    if (sc.width) tc.width = sc.width; tc.hidden = !!sc.hidden;
    if ((c === 16 || c === 19 || c === 22) && (tc.width ?? 0) < 9.5) tc.width = 9.5; // NS в тыс. ₽ с итогом больше 99 999 не влезал (#######)
    for (let r = 1; r <= 6; r++) { const s = T.getCell(r, c), t = R.getCell(r, mapC(c)); copyStyle(s, t); const v = cv(s.value); if (v != null) t.value = v as ExcelJS.CellValue; }
  }
  R.getColumn(10).width = T.getColumn(11).width ?? 9.3;
  for (let r = 1; r <= 6; r++) { copyStyle(T.getCell(r, 11), R.getCell(r, 10)); if (T.getRow(r).height) R.getRow(r).height = T.getRow(r).height; }
  R.getCell(6, 10).value = "EUR";
  // новые столбцы: Delivery TTL PCS (M) и Stock EUR FW26 / TTL (AC, AD): оформление соседних столбцов образца
  for (const [nc, src, w] of [[C_DTTL, 12, 0], [C_SEUR26, 24, 11], [C_SEURTTL, 26, 11]] as [number, number, number][]) {
    for (let r = 1; r <= 6; r++) copyStyle(T.getCell(r, src), R.getCell(r, nc));
    R.getColumn(nc).width = Math.max(w, T.getColumn(src).width ?? 9.3);
  }
  R.getCell(4, C_DTTL).value = "Delivery"; R.getCell(5, C_DTTL).value = "TTL"; R.getCell(6, C_DTTL).value = "PCS";
  R.getCell(4, C_SEUR26).value = "Stock"; R.getCell(5, C_SEUR26).value = "FW26"; R.getCell(6, C_SEUR26).value = "EUR";
  R.getCell(4, C_SEURTTL).value = "Stock"; R.getCell(5, C_SEURTTL).value = "TTL"; R.getCell(6, C_SEURTTL).value = "EUR";
  const colLetter = (n: number) => R.getColumn(n).letter;
  for (const m of (T.model as unknown as { merges?: string[] }).merges ?? []) {
    const [a, b] = m.split(":");
    const pa = /([A-Z]+)(\d+)/.exec(a)!, pb = /([A-Z]+)(\d+)/.exec(b)!;
    R.mergeCells(`${colLetter(mapC(colNum(pa[1])))}${pa[2]}:${colLetter(mapC(colNum(pb[1])))}${pb[2]}`);
  }
  R.mergeCells("I5:J5"); // TTL над PCS и EUR
  // NS в отчёте — EUR без НДС (NS EUR excl VAT), полными числами: заголовки и формат столбцов NS.
  R.getCell(3, 5).value = "NS 000'EUR excl VAT"; // в тысячах €, как в PDF владельца 10.11
  for (const c of [17, 20, 23]) R.getCell(6, c).value = "NS EUR";
  R.getCell(2, 5).value = new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });

  // ───── строки ─────
  const lvlRow = [7, 8, 9, 10];
  let rn = 0, rrow = 7;
  const write = (label: string, lvl: 0 | 1 | 2 | 3, crit: string, rs: Row[], parent: number): number => {
    const tr = lvlRow[lvl], x = R.getRow(rrow++); const no = ++rn;
    for (let c = 1; c <= 26; c++) copyStyle(T.getCell(tr, c), x.getCell(mapC(c)));
    copyStyle(T.getCell(tr, 11), x.getCell(10));
    copyStyle(T.getCell(tr, 12), x.getCell(C_DTTL)); copyStyle(T.getCell(tr, 24), x.getCell(C_SEUR26)); copyStyle(T.getCell(tr, 26), x.getCell(C_SEURTTL));
    for (let c = 9; c <= 30; c++) x.getCell(c).alignment = { ...(x.getCell(c).alignment ?? {}), horizontal: "right" }; // числа — по правому краю ячейки
    if (T.getRow(tr).height) x.height = T.getRow(tr).height;
    x.getCell(1).value = parent || null; x.getCell(2).value = no; x.getCell(3).value = lvl === 3 ? 1 : 0; x.getCell(4).value = lvl + 1;
    x.getCell(5 + lvl).value = label;
    for (const c of COLS) if (tplF.get(c)) x.getCell(mapC(c)).value = { formula: formulaFor(c, crit), result: calc(c, rs) } as ExcelJS.CellFormulaValue;
    x.getCell(10).value = { formula: formulaFor(100, crit), result: calc(100, rs) } as ExcelJS.CellFormulaValue;
    for (const [nc, id] of [[C_DTTL, 101], [C_SEUR26, 102], [C_SEURTTL, 103]] as [number, number][]) x.getCell(nc).value = { formula: formulaFor(id, crit), result: calc(id, rs) } as ExcelJS.CellFormulaValue;
    x.outlineLevel = T.getRow(tr).outlineLevel || 0;
    return no;
  };
  const sumEur = (rs: Row[]) => rs.reduce((a, r) => a + r.v[6], 0), sumPcs = (rs: Row[]) => rs.reduce((a, r) => a + r.v[5], 0);
  const grp = (arr: Row[], pick: (r: Row) => string): [string, Row[]][] => { const m = new Map<string, Row[]>(); for (const r of arr) (m.get(pick(r)) ?? m.set(pick(r), []).get(pick(r))!).push(r); return [...m]; };
  const byOrder = (items: [string, Row[]][]) => items.sort((a, b) => sumEur(b[1]) - sumEur(a[1]) || sumPcs(b[1]) - sumPcs(a[1]) || a[0].localeCompare(b[0], "ru"));
  const total = write("Total", 0, "", rows, 0);
  for (const [c1, r1] of byOrder(grp(rows, (r) => r.c1))) {
    const n1 = write(c1, 1, `,${dA},${q(c1)}`, r1, total);
    for (const [fur, r2] of byOrder(grp(r1, (r) => r.fur))) {
      const n2 = write(fur, 2, `,${dA},${q(c1)},${dF},${q(fur)}`, r2, n1);
      for (const [c2, r3] of byOrder(grp(r2, (r) => r.c2))) write(c2, 3, `,${dA},${q(c1)},${dF},${q(fur)},${dB},${q(c2)}`, r3, n2);
    }
  }
  wb.calcProperties.fullCalcOnLoad = true;
  writeFileSync(out, Buffer.from(await wb.xlsx.writeBuffer()));
  console.log(out, JSON.stringify({ rows: rows.length, orderPcsFW26: sumPcs(rows), orderEurFW26: Math.round(sumEur(rows)), reportRows: rrow - 7 }));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
