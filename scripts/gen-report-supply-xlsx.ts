/**
 * Excel «Отчёт: поставки» (09.11.2026) — три листа:
 *   «Данные» — одна строка = тип меха × категория 1 × категория 2 × артикул × цвет (позиция, FW26/27): заказ и поставка (OPT, шт., €), приход по месяцам и прогноз поставок;
 *   «Пивот» — пустой лист: настоящую сводную таблицу Excel кладёт scripts/add-excel-pivot.py (запуск — scripts/gen-two-reports.sh);
 *   «Отчёт» — оформление отчёта «Отчет по заказу и поставкам меховых изделий MVST FW26» (Total → категория 1 → мех → категория 2; Order / Deliv: OPT, PCS, EUR; помесячно; Nov/Dec — прогноз),
 *             упорядочено по убыванию заказа в €; формулы СУММЕСЛИМН по «Данные».
 * Запуск: node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/gen-report-supply-xlsx.ts <файл.xlsx>
 */
import "./stubs/server-only-shim";
import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";

const S = "FW26/27";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const N0 = '#,##0;\\-#,##0;"-"';
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const BR = "FFBFBFBF", NAVY = "FF2B2A5A", PURPLE = "FF6B68A6", LAV = "FFD9D7EC";

type Row = { fur: string; c1: string; c2: string; article: string; color: string; v: Record<string, number> };

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("укажите путь файла");
  const { prisma } = await import("@/lib/prisma");
  const { loadSupplyLeaves } = await import("@/lib/supply-report");
  const org = await prisma.organization.findFirstOrThrow();
  const leaves = await loadSupplyLeaves(org.id, "on");
  const fw = leaves.filter((l) => l.by[S] && (l.by[S].conf || l.by[S].deliv));
  const monthsSet = new Set<string>(), fcSet = new Set<string>();
  for (const l of fw) { for (const m of Object.keys(l.months[S] ?? {})) monthsSet.add(m); for (const [m, v] of Object.entries(l.fc)) if (v) { monthsSet.add(m); fcSet.add(m); } }
  const months = [...monthsSet].sort();
  const monthName = (m: string) => MON[Number(m.slice(5, 7)) - 1];
  const rows: Row[] = fw.map((l) => {
    const b = l.by[S];
    const v: Record<string, number> = { oOpt: b.conf > 0 ? 1 : 0, oPcs: b.conf, oEur: Math.round(b.confEur * 100) / 100, dOpt: b.deliv > 0 ? 1 : 0, dPcs: b.deliv, dEur: Math.round(b.delivEur * 100) / 100 };
    for (const m of months) { v[`a${m}`] = l.months[S]?.[m] ?? 0; v[`f${m}`] = l.fc[m] ?? 0; }
    return { fur: l.fur === "Каракульча" ? "Свакара" : l.fur, c1: l.cat1, c2: l.cat2, article: l.article ?? "", color: l.color || "(без цвета)", v };
  }).sort((a, b) => a.c1.localeCompare(b.c1, "ru") || a.fur.localeCompare(b.fur, "ru") || a.c2.localeCompare(b.c2, "ru") || a.article.localeCompare(b.article) || a.color.localeCompare(b.color));

  const wb = new ExcelJS.Workbook(); wb.creator = "МехУчёт";
  // ───── Данные ─────
  const ws = wb.addWorksheet("Данные", { views: [{ state: "frozen", xSplit: 5, ySplit: 3 }] });
  const labels = ["Тип меха", "Категория 1", "Категория 2", "Артикул", "Цвет"], c0 = 6, FIRST = 4, LAST = FIRST + rows.length - 1;
  type Col = { g: string; head: string; key: string };
  const cols: Col[] = [
    { g: "Order FW26/27", head: "OPT, позиций (артикул × цвет)", key: "oOpt" }, { g: "Order FW26/27", head: "Заказано, шт.", key: "oPcs" }, { g: "Order FW26/27", head: "Заказано, €", key: "oEur" },
    { g: "Deliv FW26/27", head: "OPT, позиций с приходом", key: "dOpt" }, { g: "Deliv FW26/27", head: "Пришло, шт.", key: "dPcs" }, { g: "Deliv FW26/27", head: "Пришло, €", key: "dEur" },
    ...months.map((m) => ({ g: "Приход по месяцам, шт.", head: `Приход ${monthName(m)} ${m.slice(0, 4)}`, key: `a${m}` })),
    ...months.filter((m) => fcSet.has(m)).map((m) => ({ g: "Прогноз поставок, шт.", head: `Прогноз ${monthName(m)} ${m.slice(0, 4)}`, key: `f${m}` })),
  ];
  const FILL: Record<string, string> = { "Order FW26/27": "FFE7F5EC", "Deliv FW26/27": "FFDDEBFA", "Приход по месяцам, шт.": "FFE8EEFC", "Прогноз поставок, шт.": "FFFDF1DC" };
  ws.getCell(1, 1).value = `Заказ и поставки FW26/27: позиции, штуки, € и приход по месяцам на ${new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}`; ws.getCell(1, 1).font = { bold: true, size: 13 };
  let gs = 0;
  cols.forEach((c, i) => {
    if (i === cols.length - 1 || cols[i + 1].g !== c.g) {
      if (i > gs) ws.mergeCells(2, c0 + gs, 2, c0 + i);
      const g = ws.getCell(2, c0 + gs); g.value = c.g; g.font = { bold: true, size: 10 }; g.alignment = { horizontal: "center" };
      for (let j = gs; j <= i; j++) ws.getCell(2, c0 + j).fill = fill(FILL[c.g]);
      gs = i + 1;
    }
  });
  const hr = ws.getRow(3);
  labels.forEach((h, i) => { hr.getCell(i + 1).value = h; });
  cols.forEach((c, i) => { hr.getCell(c0 + i).value = c.head; });
  for (let c = 1; c < c0 + cols.length; c++) { const x = hr.getCell(c); x.font = { bold: true, size: 10 }; x.alignment = { wrapText: true, vertical: "middle", horizontal: c < c0 ? "left" : "center" }; x.fill = fill(c < c0 ? "FFEFEFEF" : FILL[cols[c - c0].g]); x.border = { bottom: { style: "thin" } }; }
  hr.height = 48;
  rows.forEach((r, i) => {
    const x = ws.getRow(FIRST + i);
    [r.fur, r.c1, r.c2, r.article, r.color].forEach((v, k) => { x.getCell(k + 1).value = v; });
    cols.forEach((c, k) => { const cell = x.getCell(c0 + k); cell.value = r.v[c.key] ?? 0; cell.numFmt = N0; });
  });
  const tr = ws.getRow(LAST + 2); tr.getCell(1).value = "Итого (по видимым строкам фильтра)";
  cols.forEach((c, k) => { const L = ws.getColumn(c0 + k).letter; const cell = tr.getCell(c0 + k); cell.value = { formula: `SUBTOTAL(109,${L}${FIRST}:${L}${LAST})`, result: rows.reduce((a, r) => a + (r.v[c.key] ?? 0), 0) }; cell.numFmt = N0; });
  for (let c = 1; c < c0 + cols.length; c++) { tr.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } }; tr.getCell(c).fill = fill("FF1B2A5C"); }
  [16, 16, 22, 36, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  cols.forEach((_, k) => { ws.getColumn(c0 + k).width = 15; });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: LAST, column: c0 + cols.length - 1 } };
  wb.addWorksheet("Пивот"); // заполняет add-excel-pivot.py (настоящая сводная таблица)

  // ───── Отчёт ─────
  const rp = wb.addWorksheet("Отчёт", { views: [{ state: "frozen", xSplit: 1, ySplit: 5, showGridLines: false }], properties: { outlineLevelRow: 3 } });
  rp.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  const colIdx = new Map(cols.map((c, k) => [c.key, k]));
  const rng = (k: string) => { const L = ws.getColumn(c0 + colIdx.get(k)!).letter; return `Данные!$${L}$${FIRST}:$${L}$${LAST}`; };
  const dF = `Данные!$A$${FIRST}:$A$${LAST}`, dA = `Данные!$B$${FIRST}:$B$${LAST}`, dB = `Данные!$C$${FIRST}:$C$${LAST}`;
  const rc: { head: string; keys: string[]; group: "o" | "d" | "m"; fc?: boolean }[] = [
    { head: "OPT", keys: ["oOpt"], group: "o" }, { head: "PCS", keys: ["oPcs"], group: "o" }, { head: "EUR", keys: ["oEur"], group: "o" },
    { head: "OPT", keys: ["dOpt"], group: "d" }, { head: "PCS", keys: ["dPcs"], group: "d" }, { head: "EUR", keys: ["dEur"], group: "d" },
    ...months.map((m) => ({ head: monthName(m), keys: fcSet.has(m) ? [`a${m}`, `f${m}`] : [`a${m}`], group: "m" as const, fc: fcSet.has(m) })),
  ];
  const nC = rc.length, X0 = 2; // данные с колонки B
  const thin = { style: "thin" as const, color: { argb: BR } }, thick = { style: "medium" as const, color: { argb: "FF000000" } };
  rp.getCell(1, 1).value = "Отчет по заказу и поставкам меховых изделий MVST FW26"; rp.getCell(1, 1).font = { bold: true, size: 14 };
  const d = new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }).replace(/\./g, "-");
  rp.getCell(2, 1).value = d; rp.getCell(2, 1).font = { size: 10 };
  const hdr = (r: number, c: number, text: string, extra?: Partial<ExcelJS.Style>) => { const x = rp.getCell(r, c); x.value = text; x.font = { bold: true, size: 10, ...(extra?.font ?? {}) }; x.alignment = { horizontal: "center", vertical: "middle" }; x.border = { top: thin, bottom: thin, left: thin, right: thin }; };
  rp.mergeCells(4, X0, 4, X0 + 2); hdr(4, X0, "Order");
  rp.mergeCells(4, X0 + 3, 4, X0 + 5); hdr(4, X0 + 3, "Deliv");
  if (months.length) { rp.mergeCells(4, X0 + 6, 4, X0 + 5 + months.length); hdr(4, X0 + 6, months[0].slice(0, 4)); }
  for (let c = X0; c < X0 + nC; c++) { const x = rp.getCell(4, c); x.border = { top: thin, bottom: thin, left: c === X0 || c === X0 + 3 || c === X0 + 6 ? thick : thin, right: thin }; }
  rc.forEach((c, i) => hdr(5, X0 + i, c.head, c.fc ? { font: { bold: true, italic: true, color: { argb: "FFC00000" } } } : undefined));
  for (let c = X0; c < X0 + nC; c++) { const x = rp.getCell(5, c); x.border = { top: thin, bottom: { style: "medium", color: { argb: "FF000000" } }, left: c === X0 || c === X0 + 3 || c === X0 + 6 ? thick : thin, right: thin }; }
  rp.getColumn(1).width = 34; for (let i = 0; i < nC; i++) rp.getColumn(X0 + i).width = i % 3 === 2 && i < 6 ? 12 : 7;
  rp.getRow(1).height = 24;

  const sumK = (rs: Row[], ks: string[]) => rs.reduce((a, r) => a + ks.reduce((t, k) => t + (r.v[k] ?? 0), 0), 0);
  let row = 6;
  const write = (label: string, lvl: 0 | 1 | 2 | 3, crit: string, rs: Row[]) => {
    const x = rp.getRow(row++); const lab = x.getCell(1);
    lab.value = label; lab.alignment = { horizontal: "left", indent: lvl === 0 ? 0 : lvl - 1 };
    const style = lvl === 0 ? { f: NAVY, c: "FFFFFFFF", b: true } : lvl === 1 ? { f: PURPLE, c: "FFFFFFFF", b: true } : lvl === 2 ? { f: LAV, c: "FF000000", b: true } : { f: "", c: "FF000000", b: false };
    rc.forEach((c, i) => {
      const cell = x.getCell(X0 + i);
      const f = c.keys.map((k) => (crit ? `SUMIFS(${rng(k)}${crit})` : `SUM(${rng(k)})`)).join("+");
      cell.value = { formula: f, result: sumK(rs, c.keys) } as ExcelJS.CellFormulaValue; cell.numFmt = N0; cell.alignment = { horizontal: "right" };
    });
    for (let c = 1; c < X0 + nC; c++) {
      const cell = x.getCell(c);
      cell.font = { bold: style.b, size: 10, color: { argb: style.c }, italic: c >= X0 + 6 && rc[c - X0]?.fc && lvl === 3 };
      if (style.f) cell.fill = fill(style.f);
      cell.border = { top: thin, bottom: thin, left: c === X0 || c === X0 + 3 || c === X0 + 6 ? thick : thin, right: thin };
    }
    x.outlineLevel = lvl === 0 ? 0 : lvl - 1;
  };
  const grp = (arr: Row[], pick: (r: Row) => string): [string, Row[]][] => { const m = new Map<string, Row[]>(); for (const r of arr) (m.get(pick(r)) ?? m.set(pick(r), []).get(pick(r))!).push(r); return [...m]; };
  const byOrder = (items: [string, Row[]][]) => items.sort((a, b) => sumK(b[1], ["oEur"]) - sumK(a[1], ["oEur"]) || sumK(b[1], ["oPcs"]) - sumK(a[1], ["oPcs"]) || a[0].localeCompare(b[0], "ru"));
  write("Total", 0, "", rows);
  for (const [c1, r1] of byOrder(grp(rows, (r) => r.c1))) {
    write(c1, 1, `,${dA},${q(c1)}`, r1);
    for (const [fur, r2] of byOrder(grp(r1, (r) => r.fur))) {
      write(fur, 2, `,${dA},${q(c1)},${dF},${q(fur)}`, r2);
      for (const [c2, r3] of byOrder(grp(r2, (r) => r.c2))) write(c2, 3, `,${dA},${q(c1)},${dF},${q(fur)},${dB},${q(c2)}`, r3);
    }
  }
  if (fcSet.size) { const x = rp.getCell(row + 1, 1); x.value = `${[...fcSet].map(monthName).join(", ")} - прогноз поставок`; x.font = { italic: true, size: 9, color: { argb: "FFC00000" } }; }
  // fitToPage здесь нельзя: ExcelJS пишет sheetPr в порядке pageSetUpPr→outlinePr, Excel такой лист отбрасывает (пустой «Отчёт»).
  rp.pageSetup = { paperSize: 9, orientation: "portrait", scale: 85 };
  wb.calcProperties.fullCalcOnLoad = true;
  writeFileSync(out, Buffer.from(await wb.xlsx.writeBuffer()));
  const t = (ks: string[]) => Math.round(sumK(rows, ks) * 100) / 100;
  console.log(out, JSON.stringify({ positions: rows.length, orderOpt: t(["oOpt"]), orderPcs: t(["oPcs"]), orderEur: t(["oEur"]), delivOpt: t(["dOpt"]), delivPcs: t(["dPcs"]), delivEur: t(["dEur"]), months: months.map((m) => [monthName(m), sumK(rows, [`a${m}`, `f${m}`])]) }));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
