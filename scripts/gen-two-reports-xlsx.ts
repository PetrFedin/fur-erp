/**
 * Excel «Отчёт: продажи» и «Отчёт: поставки» (09.11.2026): две книги в одном файле, у каждой три листа — «данные», «пивот», «отчёт».
 *   • данные — одна строка = тип меха × категория 1 × категория 2 × артикул × цвет (по листу Report выгрузки «заказ и продажи», версия отчёта = «current»);
 *   • пивот — формулы СУММЕСЛИМН по «данные»: категория 1 → тип меха → категория 2 (кнопки 1–3 слева сворачивают уровни);
 *   • отчёт — как в отчёте владельца: Total → кат. 1 → мех → кат. 2 → артикул·цвет, блоки Order / Delivery / Sales / Stock (SSN, Old, Calendar по сезонам), SO и средний MU по формулам.
 * Имена листов без двоеточия (Excel его не принимает): «Отчёт продажи», «Отчёт поставки»; заголовок «Отчёт: продажи» — в ячейке A1 каждого листа.
 * Запуск: node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/gen-two-reports-xlsx.ts [папка]
 */
import "./stubs/server-only-shim";
import { mkdirSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";

const SEAS = ["FW26/27", "SS26", "FW25/26"] as const;
const FUR_RU: Record<string, string> = { SABLE: "Соболь", MINK: "Норка", FOX: "Лиса", SWAKARA: "Каракульча", LYNX: "Рысь", BEAVER: "Бобр", CHINCHILLA: "Шиншилла" };
const N0 = "#,##0;-#,##0;–", PCT = "0%;-0%;–", MUF = "0.00;-0.00;–";

type Leaf = { fur: string; c1: string; c2: string; article: string; color: string; v: Record<string, number> };
type Col = { g: string; head: string; key: string; fmt: string; helper?: boolean };
type RCol = { head: string; idx: string[]; den?: string[]; fmt: string; top: string; mid: string };
type Cfg = { name: string; title: string; dataName: string; pivotName: string; reportName: string; cols: Col[]; ratios: { head: string; g: string; num: string[]; den: string[]; fmt: string }[]; rcols: RCol[]; sortKey: string; fills: Record<string, string>; topFills: Record<string, string> };

const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
const sheetRef = (n: string) => `'${n}'`;
const sum = (rows: Leaf[], k: string) => rows.reduce((a, l) => a + (l.v[k] ?? 0), 0);

function fill(argb: string): ExcelJS.Fill { return { type: "pattern", pattern: "solid", fgColor: { argb } }; }

function build(wb: ExcelJS.Workbook, list: Leaf[], cfg: Cfg) {
  const FIRST = 4, LAST = FIRST + list.length - 1, labels = ["Тип меха", "Категория 1", "Категория 2", "Артикул", "Цвет"], c0 = labels.length + 1;
  const today = new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
  // ───── Данные ─────
  const ws = wb.addWorksheet(cfg.dataName, { views: [{ state: "frozen", xSplit: 5, ySplit: 3 }] });
  ws.getCell(1, 1).value = `${cfg.title}: данные на ${today}`; ws.getCell(1, 1).font = { bold: true, size: 13 };
  let gs = 0;
  cfg.cols.forEach((c, i) => {
    if (i === cfg.cols.length - 1 || cfg.cols[i + 1].g !== c.g) {
      ws.mergeCells(2, c0 + gs, 2, c0 + i);
      const g = ws.getCell(2, c0 + gs); g.value = c.g; g.font = { bold: true, size: 10 }; g.alignment = { horizontal: "center" };
      for (let j = gs; j <= i; j++) ws.getCell(2, c0 + j).fill = fill(cfg.fills[c.g] ?? "FFEFEFEF");
      gs = i + 1;
    }
  });
  const hr = ws.getRow(3);
  labels.forEach((h, i) => { hr.getCell(i + 1).value = h; });
  cfg.cols.forEach((c, i) => { hr.getCell(c0 + i).value = c.head; });
  for (let c = 1; c < c0 + cfg.cols.length; c++) {
    const x = hr.getCell(c); x.font = { bold: true, size: 10 }; x.alignment = { wrapText: true, vertical: "middle", horizontal: c < c0 ? "left" : "center" };
    x.fill = fill(c < c0 ? "FFEFEFEF" : cfg.fills[cfg.cols[c - c0].g] ?? "FFEFEFEF"); x.border = { bottom: { style: "thin" } };
  }
  hr.height = 62;
  list.forEach((l, r) => {
    const x = ws.getRow(FIRST + r);
    [l.fur, l.c1, l.c2, l.article, l.color || "(без цвета)"].forEach((v, i) => { x.getCell(i + 1).value = v; });
    cfg.cols.forEach((c, i) => { const cell = x.getCell(c0 + i); cell.value = l.v[c.key] ?? 0; cell.numFmt = c.fmt; if (c.helper) cell.font = { color: { argb: "FF888888" } }; });
  });
  const tr = ws.getRow(LAST + 2);
  tr.getCell(1).value = "Итого (по видимым строкам фильтра)";
  cfg.cols.forEach((c, i) => { const L = ws.getColumn(c0 + i).letter; const cell = tr.getCell(c0 + i); cell.value = { formula: `SUBTOTAL(109,${L}${FIRST}:${L}${LAST})`, result: sum(list, c.key) }; cell.numFmt = c.fmt; });
  for (let c = 1; c < c0 + cfg.cols.length; c++) { tr.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } }; tr.getCell(c).fill = fill("FF1B2A5C"); }
  [16, 16, 22, 36, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  cfg.cols.forEach((_, i) => { ws.getColumn(c0 + i).width = 15; });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: LAST, column: c0 + cfg.cols.length - 1 } };

  const D = sheetRef(cfg.dataName);
  const colIdx = new Map(cfg.cols.map((c, i) => [c.key, i]));
  const rng = (k: string) => { const L = ws.getColumn(c0 + colIdx.get(k)!).letter; return `${D}!$${L}$${FIRST}:$${L}$${LAST}`; };
  const dF = `${D}!$A$${FIRST}:$A$${LAST}`, dA = `${D}!$B$${FIRST}:$B$${LAST}`, dB = `${D}!$C$${FIRST}:$C$${LAST}`, dArt = `${D}!$D$${FIRST}:$D$${LAST}`, dCol = `${D}!$E$${FIRST}:$E$${LAST}`;
  const S = (ks: string[], crit: string) => ks.map((k) => (crit ? `SUMIFS(${rng(k)}${crit})` : `SUM(${rng(k)})`)).join("+");
  const R = (ks: string[], rows: Leaf[]) => ks.reduce((a, k) => a + sum(rows, k), 0);

  // ───── Пивот ─────
  const pv = wb.addWorksheet(cfg.pivotName, { views: [{ state: "frozen", xSplit: 1, ySplit: 3 }], properties: { outlineLevelRow: 3 } });
  pv.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  pv.getCell(1, 1).value = `${cfg.title}: пивот по листу «${cfg.dataName}» — категория 1 → тип меха → категория 2 (формулы; меняете данные — пивот пересчитывается). Кнопки 1–3 слева сворачивают уровни.`;
  pv.getCell(1, 1).font = { bold: true, size: 12 };
  type PC = { head: string; g: string; fmt: string; f: (crit: string, rows: Leaf[]) => { formula: string; result: number } };
  const pc: PC[] = [];
  for (const c of cfg.cols.filter((x) => !x.helper)) pc.push({ head: c.head, g: c.g, fmt: c.fmt, f: (crit, rows) => ({ formula: S([c.key], crit), result: R([c.key], rows) }) });
  for (const r of cfg.ratios) pc.push({ head: r.head, g: r.g, fmt: r.fmt, f: (crit, rows) => { const d = R(r.den, rows); return { formula: `IFERROR((${S(r.num, crit)})/(${S(r.den, crit)}),0)`, result: d > 0 ? R(r.num, rows) / d : 0 }; } });
  pv.getCell(3, 1).value = "Категория 1 → тип меха → категория 2";
  let g0 = 0;
  pc.forEach((c, i) => {
    pv.getCell(3, 2 + i).value = c.head;
    if (i === pc.length - 1 || pc[i + 1].g !== c.g) {
      pv.mergeCells(2, 2 + g0, 2, 2 + i);
      const g = pv.getCell(2, 2 + g0); g.value = c.g; g.font = { bold: true, size: 10 }; g.alignment = { horizontal: "center" };
      for (let j = g0; j <= i; j++) pv.getCell(2, 2 + j).fill = fill(cfg.fills[c.g] ?? "FFEFEFEF");
      g0 = i + 1;
    }
  });
  for (let c = 1; c <= 1 + pc.length; c++) { const x = pv.getCell(3, c); x.font = { bold: true, size: 10 }; x.alignment = { wrapText: true, vertical: "middle", horizontal: c === 1 ? "left" : "center" }; x.fill = fill(c === 1 ? "FFEFEFEF" : cfg.fills[pc[c - 2].g] ?? "FFEFEFEF"); x.border = { bottom: { style: "thin" } }; }
  pv.getRow(3).height = 62; pv.getColumn(1).width = 44; pc.forEach((_, i) => { pv.getColumn(2 + i).width = 15; });
  let row = 4;
  const pw = (label: string, lvl: 0 | 1 | 2, crit: string, rows: Leaf[]) => {
    const x = pv.getRow(row++); x.getCell(1).value = label; x.getCell(1).alignment = { indent: lvl * 2 };
    pc.forEach((c, i) => { const cell = x.getCell(2 + i); const v = c.f(crit, rows); cell.value = { formula: v.formula, result: v.result } as ExcelJS.CellFormulaValue; cell.numFmt = c.fmt; });
    x.outlineLevel = lvl;
    if (lvl === 0) { x.font = { bold: true }; x.eachCell((cell) => { cell.fill = fill("FFF1F4F9"); }); } else if (lvl === 1) x.font = { bold: true, color: { argb: "FF333333" } };
  };
  const uniq = <T,>(a: T[]) => [...new Set(a)];
  for (const c1 of uniq(list.map((l) => l.c1))) {
    const r1 = list.filter((l) => l.c1 === c1); pw(c1, 0, `,${dA},${q(c1)}`, r1);
    for (const fur of uniq(r1.map((l) => l.fur))) {
      const r2 = r1.filter((l) => l.fur === fur); pw(fur, 1, `,${dA},${q(c1)},${dF},${q(fur)}`, r2);
      for (const c2 of uniq(r2.map((l) => l.c2))) pw(c2, 2, `,${dA},${q(c1)},${dF},${q(fur)},${dB},${q(c2)}`, r2.filter((l) => l.c2 === c2));
    }
  }
  const tx = pv.getRow(row++); tx.getCell(1).value = "ИТОГО";
  pc.forEach((c, i) => { const cell = tx.getCell(2 + i); const v = c.f("", list); cell.value = { formula: v.formula, result: v.result } as ExcelJS.CellFormulaValue; cell.numFmt = c.fmt; });
  for (let c = 1; c <= 1 + pc.length; c++) { tx.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } }; tx.getCell(c).fill = fill("FF1B2A5C"); }

  // ───── Отчёт (формат отчёта владельца) ─────
  const rp = wb.addWorksheet(cfg.reportName, { views: [{ state: "frozen", xSplit: 9, ySplit: 6 }], properties: { outlineLevelRow: 4 } });
  rp.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  const RC0 = 10;
  rp.getCell(1, 5).value = cfg.title; rp.getCell(1, 5).font = { bold: true, size: 13 };
  rp.getCell(2, 5).value = today; rp.getCell(2, 5).font = { size: 10 };
  rp.getCell(3, 5).value = "Источник: отчёт «заказ и продажи» и «поступления и продажи» от 09.11.2026; NS — EUR без НДС, выручка ₽ — с НДС"; rp.getCell(3, 5).font = { italic: true, size: 9, color: { argb: "FF666666" } };
  const band = (r: number, key: "top" | "mid", fills: Record<string, string>) => {
    let s = 0;
    cfg.rcols.forEach((c, i) => {
      if (i === cfg.rcols.length - 1 || cfg.rcols[i + 1][key] !== c[key] || (key === "mid" && cfg.rcols[i + 1].top !== c.top)) {
        if (i > s) rp.mergeCells(r, RC0 + s, r, RC0 + i);
        const x = rp.getCell(r, RC0 + s); x.value = c[key]; x.font = { bold: true, size: 10 }; x.alignment = { horizontal: "center" };
        for (let j = s; j <= i; j++) { const y = rp.getCell(r, RC0 + j); y.border = { bottom: { style: "thin" } }; y.fill = fill(fills[cfg.rcols[j].top] ?? "FFEFEFEF"); }
        s = i + 1;
      }
    });
  };
  band(4, "top", cfg.topFills); band(5, "mid", cfg.topFills);
  cfg.rcols.forEach((c, i) => { const x = rp.getCell(6, RC0 + i); x.value = c.head; x.font = { bold: true, size: 10 }; x.alignment = { horizontal: "center", wrapText: true }; x.border = { bottom: { style: "medium" } }; rp.getColumn(RC0 + i).width = 13; });
  rp.getRow(6).height = 30;
  for (let i = 1; i <= 4; i++) rp.getColumn(i).width = 4;
  [14, 14, 16, 26, 34].forEach((w, i) => { rp.getColumn(5 + i).width = w; });
  const sumR = (ix: string[], rows: Leaf[]) => R(ix, rows);
  let rrow = 7, rno = 0;
  const rwrite = (label: string, lvl: 0 | 1 | 2 | 3 | 4, crit: string, rows: Leaf[], parent: number, isLeaf: boolean): number => {
    const x = rp.getRow(rrow++); const no = ++rno;
    x.getCell(1).value = parent; x.getCell(2).value = no; x.getCell(3).value = isLeaf ? 1 : 0; x.getCell(4).value = lvl + 1;
    for (let c = 1; c <= 4; c++) x.getCell(c).font = { size: 8, color: { argb: "FFAAAAAA" } };
    x.getCell(5 + lvl).value = label;
    cfg.rcols.forEach((c, i) => {
      const cell = x.getCell(RC0 + i);
      const res = c.den ? (sumR(c.den, rows) > 0 ? sumR(c.idx, rows) / sumR(c.den, rows) : 0) : sumR(c.idx, rows);
      cell.value = { formula: c.den ? `IFERROR((${S(c.idx, crit)})/(${S(c.den, crit)}),0)` : S(c.idx, crit), result: res } as ExcelJS.CellFormulaValue; cell.numFmt = c.fmt; cell.alignment = { horizontal: "right" };
    });
    x.outlineLevel = lvl === 0 ? 0 : lvl - 1;
    if (lvl <= 1) { x.font = { bold: true }; x.eachCell((cell, col) => { if (col >= 5) cell.fill = fill(lvl === 0 ? "FFDCE3F2" : "FFF1F4F9"); }); }
    else if (lvl === 2) x.font = { bold: true, color: { argb: "FF333333" } };
    else if (lvl === 4) x.font = { color: { argb: "FF555555" }, size: 10 };
    return no;
  };
  const grp = (arr: Leaf[], pick: (l: Leaf) => string): [string, Leaf[]][] => { const m = new Map<string, Leaf[]>(); for (const l of arr) (m.get(pick(l)) ?? m.set(pick(l), []).get(pick(l))!).push(l); return [...m]; };
  const byMoney = (items: [string, Leaf[]][]) => items.sort((a, b) => sum(b[1], cfg.sortKey) - sum(a[1], cfg.sortKey) || a[0].localeCompare(b[0], "ru"));
  const total = rwrite("Total", 0, "", list, 0, false);
  for (const [c1, r1] of byMoney(grp(list, (l) => l.c1))) {
    const n1 = rwrite(c1, 1, `,${dA},${q(c1)}`, r1, total, false);
    for (const [fur, r2] of byMoney(grp(r1, (l) => l.fur))) {
      const n2 = rwrite(fur, 2, `,${dA},${q(c1)},${dF},${q(fur)}`, r2, n1, false);
      for (const [c2, r3] of byMoney(grp(r2, (l) => l.c2))) {
        const n3 = rwrite(c2, 3, `,${dA},${q(c1)},${dF},${q(fur)},${dB},${q(c2)}`, r3, n2, false);
        for (const l of [...r3].sort((a, b) => sum([b], cfg.sortKey) - sum([a], cfg.sortKey) || a.article.localeCompare(b.article) || a.color.localeCompare(b.color)))
          rwrite(`${l.article} · ${l.color || "(без цвета)"}`, 4, `,${dA},${q(c1)},${dF},${q(fur)},${dB},${q(c2)},${dArt},${q(l.article)},${dCol},${q(l.color || "(без цвета)")}`, [l], n3, true);
      }
    }
  }
}

async function main() {
  const dir = process.argv[2] ?? "docs-inventory/reports";
  mkdirSync(dir, { recursive: true });
  const { prisma } = await import("@/lib/prisma");
  const { loadSalesInput } = await import("@/lib/sales-server");
  const { furRuLabel } = await import("@/lib/sales-receipts-core");
  const org = await prisma.organization.findFirstOrThrow();
  const data = await loadSalesInput(org.id, "on");
  const m = new Map<string, Leaf>();
  for (const r of data.sizes) {
    const fur = furRuLabel(r.fur ?? "Не указан", FUR_RU), c1 = (r.l2 || "(без категории)").trim(), c2 = (r.l4 || r.l5 || "(без категории)").trim(), color = (r.color ?? "").trim();
    const k = [fur, c1, c2, r.acode, color].join("|");
    const l = m.get(k) ?? { fur, c1, c2, article: r.acode, color, v: {} as Record<string, number> };
    const add = (key: string, x: number | undefined) => { l.v[key] = (l.v[key] ?? 0) + (x ?? 0); };
    add("conf", r.conf); add("deliv", r.deliv); add("sold", r.sold); add("stock", r.stock); add("rub", r.nsRub); add("rubEx", r.nsRubEx);
    for (const s of SEAS) {
      const c = r.seas?.[s]; const p = s.replace("/", "_");
      add(`${p}_conf`, c?.conf); add(`${p}_confEur`, c?.confEur); add(`${p}_deliv`, c?.deliv); add(`${p}_delivEur`, c?.delivEur);
      add(`${p}_soldSsn`, c?.soldSsn); add(`${p}_rubSsn`, c?.rubSsn); add(`${p}_eurExSsn`, c?.eurExSsn);
      add(`${p}_soldOld`, c?.soldOld); add(`${p}_rubOld`, c?.rubOld); add(`${p}_eurExOld`, c?.eurExOld);
      add(`${p}_soldAll`, c?.soldAll); add(`${p}_eurExAll`, c?.eurExAll); add(`${p}_discAll`, c?.discAll);
      add(`${p}_gS`, (c?.eurSsn ?? 0) + (c?.discEurSsn ?? 0)); add(`${p}_cS`, c?.scSsn);
      add(`${p}_gO`, (c?.eurOld ?? 0) + (c?.discEurOld ?? 0)); add(`${p}_cO`, c?.scOld);
    }
    m.set(k, l);
  }
  const list = [...m.values()].filter((l) => Object.values(l.v).some((x) => x));
  // Правило владельца: закрытые сезоны — заказано = получено; FW26/27 — заказано по отчёту, но не меньше полученного (шт. и €).
  for (const l of list) for (const s of SEAS) { const p = s.replace("/", "_"); l.v[`${p}_conf`] = Math.max(l.v[`${p}_conf`] ?? 0, l.v[`${p}_deliv`] ?? 0); l.v[`${p}_confEur`] = Math.max(l.v[`${p}_confEur`] ?? 0, l.v[`${p}_delivEur`] ?? 0); }
  for (const l of list) for (const s of SEAS) { const p = s.replace("/", "_"); l.v[`${p}_wip`] = Math.max(0, (l.v[`${p}_conf`] ?? 0) - (l.v[`${p}_deliv`] ?? 0)); }
  for (const l of list) l.v.wip = Math.max(0, (l.v.conf ?? 0) - (l.v.deliv ?? 0));
  for (const l of list) for (const k of Object.keys(l.v)) l.v[k] = Math.round(l.v[k] * 100) / 100;
  list.sort((a, b) => a.c1.localeCompare(b.c1, "ru") || a.fur.localeCompare(b.fur, "ru") || a.c2.localeCompare(b.c2, "ru") || a.article.localeCompare(b.article) || a.color.localeCompare(b.color));

  const P = (s: string) => s.replace("/", "_");
  // ── Продажи ──
  const salesCols: Col[] = [
    { g: "Всё время", head: "Заказано, шт.", key: "conf", fmt: N0 }, { g: "Всё время", head: "Продано, шт.", key: "sold", fmt: N0 },
    { g: "Всё время", head: "Выручка, ₽ с НДС", key: "rub", fmt: N0 }, { g: "Всё время", head: "Выручка, ₽ без НДС", key: "rubEx", fmt: N0 }, { g: "Всё время", head: "Остаток, шт.", key: "stock", fmt: N0 },
  ];
  const salesFills: Record<string, string> = { "Всё время": "FFE8EEFC" }, salesTop: Record<string, string> = { Order: "FFE7F5EC", Sales: "FFFDF1DC", Stock: "FFE8EEFC" };
  const SEAS_FILL = ["FFE7F5EC", "FFFDF1DC", "FFDDEBFA"];
  const rS: RCol[] = [
    { top: "Order", mid: "TTL", head: "Заказано, шт.", idx: ["conf"], fmt: N0 },
    { top: "Sales", mid: "TTL", head: "Продано, шт.", idx: ["sold"], fmt: N0 },
    { top: "Sales", mid: "TTL", head: "SO, %", idx: ["sold"], den: ["conf"], fmt: PCT },
    { top: "Sales", mid: "TTL", head: "Выручка, ₽ с НДС", idx: ["rub"], fmt: N0 },
    { top: "Stock", mid: "TTL", head: "Остаток, шт.", idx: ["stock"], fmt: N0 },
  ];
  const salesRatios: { head: string; g: string; num: string[]; den: string[]; fmt: string }[] = [{ head: "SO, % (продано ÷ заказано)", g: "Всё время", num: ["sold"], den: ["conf"], fmt: PCT }];
  SEAS.forEach((s, si) => {
    const p = P(s), g = `${s}: календарь сезона`;
    salesFills[g] = SEAS_FILL[si]; salesTop[s] = SEAS_FILL[si];
    salesCols.push(
      { g, head: `Заказано ${s}, шт.`, key: `${p}_conf`, fmt: N0 },
      { g, head: "Продано товара сезона (SSN), шт.", key: `${p}_soldSsn`, fmt: N0 }, { g, head: "Выручка SSN, ₽ с НДС", key: `${p}_rubSsn`, fmt: N0 }, { g, head: "NS EUR excl VAT, SSN", key: `${p}_eurExSsn`, fmt: N0 },
      { g, head: "Продано олдов, шт.", key: `${p}_soldOld`, fmt: N0 }, { g, head: "Выручка олдов, ₽ с НДС", key: `${p}_rubOld`, fmt: N0 }, { g, head: "NS EUR excl VAT, олды", key: `${p}_eurExOld`, fmt: N0 },
      { g, head: "Продано всего в календаре, шт.", key: `${p}_soldAll`, fmt: N0 }, { g, head: "NS EUR excl VAT, всего", key: `${p}_eurExAll`, fmt: N0 }, { g, head: "Скидка, ₽ с НДС", key: `${p}_discAll`, fmt: N0 },
      { g: "MU (служебные)", head: `${s}: NS EUR + Discount EUR, SSN`, key: `${p}_gS`, fmt: N0, helper: true }, { g: "MU (служебные)", head: `${s}: SC EUR, SSN`, key: `${p}_cS`, fmt: N0, helper: true },
      { g: "MU (служебные)", head: `${s}: NS EUR + Discount EUR, олды`, key: `${p}_gO`, fmt: N0, helper: true }, { g: "MU (служебные)", head: `${s}: SC EUR, олды`, key: `${p}_cO`, fmt: N0, helper: true },
    );
    salesRatios.push({ head: `${s}: SO SSN, % (SSN ÷ заказано сезона)`, g, num: [`${p}_soldSsn`], den: [`${p}_conf`], fmt: PCT });
    salesRatios.push({ head: `${s}: Avg MU SSN`, g, num: [`${p}_gS`], den: [`${p}_cS`], fmt: MUF });
    salesRatios.push({ head: `${s}: Avg MU олды`, g, num: [`${p}_gO`], den: [`${p}_cO`], fmt: MUF });
    rS.push(
      { top: s, mid: "SSN", head: "PCS", idx: [`${p}_soldSsn`], fmt: N0 }, { top: s, mid: "SSN", head: "SO, %", idx: [`${p}_soldSsn`], den: [`${p}_conf`], fmt: PCT },
      { top: s, mid: "SSN", head: "NS EUR excl VAT", idx: [`${p}_eurExSsn`], fmt: N0 }, { top: s, mid: "SSN", head: "Avg MU", idx: [`${p}_gS`], den: [`${p}_cS`], fmt: MUF },
      { top: s, mid: "Old", head: "PCS", idx: [`${p}_soldOld`], fmt: N0 }, { top: s, mid: "Old", head: "NS EUR excl VAT", idx: [`${p}_eurExOld`], fmt: N0 }, { top: s, mid: "Old", head: "Avg MU", idx: [`${p}_gO`], den: [`${p}_cO`], fmt: MUF },
      { top: s, mid: "Calendar", head: "PCS", idx: [`${p}_soldAll`], fmt: N0 }, { top: s, mid: "Calendar", head: "NS EUR excl VAT", idx: [`${p}_eurExAll`], fmt: N0 }, { top: s, mid: "Calendar", head: "Скидка, ₽", idx: [`${p}_discAll`], fmt: N0 },
    );
  });
  // ── Поставки ──
  const delCols: Col[] = [
    { g: "Всё время", head: "Заказано, шт.", key: "conf", fmt: N0 }, { g: "Всё время", head: "Пришло, шт.", key: "deliv", fmt: N0 },
    { g: "Всё время", head: "В производстве, шт. (заказано − пришло)", key: "wip", fmt: N0 }, { g: "Всё время", head: "Остаток, шт.", key: "stock", fmt: N0 },
  ];
  const delFills: Record<string, string> = { "Всё время": "FFE8EEFC" }, delTop: Record<string, string> = { Order: "FFE7F5EC", Delivery: "FFDDEBFA", "In production": "FFFDF1DC", Stock: "FFE8EEFC" };
  const delRatios: { head: string; g: string; num: string[]; den: string[]; fmt: string }[] = [{ head: "Исполнение, % (пришло ÷ заказано)", g: "Всё время", num: ["deliv"], den: ["conf"], fmt: PCT }];
  const rD: RCol[] = [
    { top: "Order", mid: "TTL", head: "Заказано, шт.", idx: ["conf"], fmt: N0 }, { top: "Delivery", mid: "TTL", head: "Пришло, шт.", idx: ["deliv"], fmt: N0 },
    { top: "Delivery", mid: "TTL", head: "Исполнение, %", idx: ["deliv"], den: ["conf"], fmt: PCT }, { top: "In production", mid: "TTL", head: "В производстве, шт.", idx: ["wip"], fmt: N0 },
    { top: "Stock", mid: "TTL", head: "Остаток, шт.", idx: ["stock"], fmt: N0 },
  ];
  SEAS.forEach((s, si) => {
    const p = P(s), g = s;
    delFills[g] = SEAS_FILL[si];
    delCols.push(
      { g, head: "Заказано, шт.", key: `${p}_conf`, fmt: N0 }, { g, head: "Заказано, €", key: `${p}_confEur`, fmt: N0 }, { g, head: "Пришло, шт.", key: `${p}_deliv`, fmt: N0 },
      { g, head: "Пришло, €", key: `${p}_delivEur`, fmt: N0 }, { g, head: "В производстве, шт.", key: `${p}_wip`, fmt: N0 },
    );
    delRatios.push({ head: `${s}: Исполнение, %`, g, num: [`${p}_deliv`], den: [`${p}_conf`], fmt: PCT });
    rD.push(
      { top: s, mid: "Order", head: "PCS", idx: [`${p}_conf`], fmt: N0 }, { top: s, mid: "Order", head: "EUR", idx: [`${p}_confEur`], fmt: N0 },
      { top: s, mid: "Delivery", head: "PCS", idx: [`${p}_deliv`], fmt: N0 }, { top: s, mid: "Delivery", head: "EUR", idx: [`${p}_delivEur`], fmt: N0 }, { top: s, mid: "Delivery", head: "Исполнение, %", idx: [`${p}_deliv`], den: [`${p}_conf`], fmt: PCT },
      { top: s, mid: "In production", head: "PCS", idx: [`${p}_wip`], fmt: N0 },
    );
    delTop[s] = SEAS_FILL[si];
  });

  const wb = new ExcelJS.Workbook(); wb.creator = "МехУчёт";
  build(wb, list, { name: "Продажи", title: "Отчёт: продажи", dataName: "Продажи данные", pivotName: "Продажи пивот", reportName: "Отчёт продажи", cols: salesCols, ratios: salesRatios, rcols: rS, sortKey: "rub", fills: salesFills, topFills: salesTop });
  build(wb, list, { name: "Поставки", title: "Отчёт: поставки", dataName: "Поставки данные", pivotName: "Поставки пивот", reportName: "Отчёт поставки", cols: delCols, ratios: delRatios, rcols: rD, sortKey: "conf", fills: delFills, topFills: delTop });
  wb.calcProperties.fullCalcOnLoad = true;
  const iso = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
  const path = `${dir}/Отчёты_продажи_и_поставки_${iso}.xlsx`;
  writeFileSync(path, Buffer.from(await wb.xlsx.writeBuffer()));
  const t = (k: string) => Math.round(sum(list, k));
  console.log(path, JSON.stringify({ rows: list.length, conf: t("conf"), deliv: t("deliv"), sold: t("sold"), stock: t("stock"), rub: t("rub"), fw26Conf: t("FW26_27_conf"), fw26Deliv: t("FW26_27_deliv"), fw26Ssn: t("FW26_27_soldSsn"), fw26RubSsn: t("FW26_27_rubSsn"), ss26Ssn: t("SS26_soldSsn"), fw25Ssn: t("FW25_26_soldSsn") }));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
