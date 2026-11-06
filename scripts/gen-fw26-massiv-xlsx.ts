/**
 * Excel «FW26: массив» (06.11.2026). Лист 1 «Данные» — одна строка = тип меха × кат. 1 × кат. 2 × артикул × цвет:
 *   • товар FW26/27: заказано и пришло (шт., €), «в производстве» (заказано − пришло), продано в календарном FW26 (шт., ₽ с НДС);
 *   • продажи ДРУГИХ сезонов (товар SS26, FW25 и старше) в календарном FW26 (шт., ₽ с НДС);
 *   • остатки: товара FW26 (пришло − продано) и всех остальных сезонов (общий остаток − остаток FW26), шт.
 * Запуск: NODE_PATH=<папка с пустым server-only> node --env-file=.env node_modules/.bin/tsx scripts/gen-fw26-massiv-xlsx.ts [папка]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { loadSalesInput } from "@/lib/sales-server";
import { furRuLabel, furTypeOfFabric } from "@/lib/sales-receipts-core";
import { leafKeyOf } from "@/lib/fw26-plan";

const S = "FW26/27";
const FUR_RU: Record<string, string> = { SABLE: "Соболь", MINK: "Норка", FOX: "Лиса", SWAKARA: "Каракульча", LYNX: "Рысь" };

type Leaf = { fur: string; c1: string; c2: string; article: string; color: string; conf: number; confEur: number; deliv: number; delivEur: number; sold: number; nsEx: number; oldSold: number; oldNsEx: number; stockAll: number; prior: number; gS: number; cS: number; gO: number; cO: number };

async function main() {
  const dir = process.argv[2] ?? "docs-inventory/reports";
  mkdirSync(dir, { recursive: true });
  const org = await prisma.organization.findFirstOrThrow();
  const data = await loadSalesInput(org.id, "on");
  const leaves = new Map<string, Leaf>();
  // Приход прошлых сезонов (все, кроме FW26/27) по файлу «поступления и продажи» — как «В выпуске / Заказано 862» в Продажах: артикул+цвет → шт.
  const priorByLeaf = new Map<string, number>();
  const priorAttr = new Map<string, { fur: string; c1: string; c2: string; article: string; color: string }>();
  for (const l of data.input.lines) {
    if (l.kind !== "RECEIPT" || !l.pcs || l.season === "FW 26/27") continue;
    const kk = leafKeyOf(l.article, l.colorId);
    priorByLeaf.set(kk, (priorByLeaf.get(kk) ?? 0) + l.pcs);
    if (!priorAttr.has(kk)) priorAttr.set(kk, { fur: furRuLabel(furTypeOfFabric(l.fabric), FUR_RU), c1: ((l as { level2?: string | null }).level2 || "(без категории)").trim(), c2: (l.level4 || (l as { level5?: string | null }).level5 || "(без категории)").trim(), article: l.article, color: (l.colorId ?? "").trim() });
  }
  const priorTotal = [...priorByLeaf.values()].reduce((a, x) => a + x, 0);
  const claimed = new Set<string>();
  for (const r of data.sizes) {
    const fur = furRuLabel(r.fur ?? "Не указан", FUR_RU), c1 = (r.l2 || "(без категории)").trim(), c2 = (r.l4 || r.l5 || "(без категории)").trim(), color = (r.color ?? "").trim();
    const k = [fur, c1, c2, r.acode, color].join("|");
    const lf = leaves.get(k) ?? { fur, c1, c2, article: r.acode, color, conf: 0, confEur: 0, deliv: 0, delivEur: 0, sold: 0, nsEx: 0, oldSold: 0, oldNsEx: 0, stockAll: 0, prior: 0, gS: 0, cS: 0, gO: 0, cO: 0 };
    lf.stockAll += r.stock ?? 0;
    // Закрытые сезоны: заказано = пришло (правило владельца): приход прошлых сезонов по файлу поступлений (весь, включая старше FW25).
    const lk = leafKeyOf(r.acode, r.color);
    if (!claimed.has(lk)) { claimed.add(lk); lf.prior += priorByLeaf.get(lk) ?? 0; }
    const c = r.seas?.[S];
    if (c) {
      lf.conf += c.conf ?? 0; lf.confEur += c.confEur ?? 0; lf.deliv += c.deliv ?? 0; lf.delivEur += c.delivEur ?? 0;
      lf.sold += c.soldSsn ?? 0; lf.nsEx += c.eurExSsn ?? 0; lf.oldSold += c.soldOld ?? 0; lf.oldNsEx += c.eurExOld ?? 0;
      // MU по отчёту: (NS EUR + Discount EUR) ÷ SC EUR — полная розничная цена продажи с учётом скидки к себестоимости продаж в €.
      lf.gS += (c.eurSsn ?? 0) + (c.discEurSsn ?? 0); lf.cS += c.scSsn ?? 0;
      lf.gO += (c.eurOld ?? 0) + (c.discEurOld ?? 0); lf.cO += c.scOld ?? 0;
    }
    leaves.set(k, lf);
  }
  const list = [...leaves.values()].filter((l) => l.conf || l.deliv || l.sold || l.oldSold || l.stockAll || l.prior);
  // Приход прошлых сезонов по артикулам без строки в отчёте: отдельные строки с типом меха и категориями из самого файла поступлений (чтобы 862 делились на одежду и аксессуары как на экране).
  const priorMatched = list.reduce((a, l) => a + l.prior, 0);
  for (const [kk, n] of priorByLeaf) {
    if (claimed.has(kk) || n <= 0) continue;
    const at = priorAttr.get(kk)!;
    list.push({ ...at, conf: 0, confEur: 0, deliv: 0, delivEur: 0, sold: 0, nsEx: 0, oldSold: 0, oldNsEx: 0, stockAll: 0, prior: n, gS: 0, cS: 0, gO: 0, cO: 0 });
  }
  list.sort((a, b) => a.c1.localeCompare(b.c1, "ru") || a.fur.localeCompare(b.fur, "ru") || a.c2.localeCompare(b.c2, "ru") || a.article.localeCompare(b.article) || a.color.localeCompare(b.color));
  const stock26 = (l: Leaf) => Math.max(0, l.deliv - l.sold);
  const stockOth = (l: Leaf) => Math.max(0, l.stockAll - stock26(l));

  const N0 = "#,##0;-#,##0;–";
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const G1 = "Товар FW26/27", G2 = "Продажи других сезонов в календарном FW26", G3 = "Остатки", G4 = "Для MU (служебные)";
  const FILL: Record<string, string> = { [G1]: "FFE7F5EC", [G2]: "FFFDF1DC", [G3]: "FFE8EEFC", [G4]: "FFEFEFEF" };
  const cols: { g: string; head: string; get: (l: Leaf) => number }[] = [
    { g: G1, head: "Заказано, шт.", get: (l) => l.conf },
    { g: G1, head: "Заказано, €", get: (l) => r2(l.confEur) },
    { g: G1, head: "Заказ всего, шт. (приход SS26 + FW25 + заказ FW26)", get: (l) => l.prior + l.conf },
    { g: G1, head: "Пришло, шт.", get: (l) => l.deliv },
    { g: G1, head: "Пришло, €", get: (l) => r2(l.delivEur) },
    { g: G1, head: "В производстве, шт. (заказано − пришло)", get: (l) => Math.max(0, l.conf - l.deliv) },
    { g: G1, head: "Продано товара FW26 в календарном FW26, шт.", get: (l) => l.sold },
    { g: G1, head: "NS EUR excl VAT, товар FW26", get: (l) => r2(l.nsEx) },
    { g: G2, head: "Продано, шт.", get: (l) => l.oldSold },
    { g: G2, head: "NS EUR excl VAT, олды в FW26", get: (l) => r2(l.oldNsEx) },
    { g: G3, head: "Остаток товара FW26, шт.", get: stock26 },
    { g: G3, head: "Остаток всех остальных сезонов, шт.", get: stockOth },
    { g: G3, head: "Остаток всего, шт.", get: (l) => stock26(l) + stockOth(l) },
    { g: G4, head: "MU: NS EUR + Discount EUR, товар FW26", get: (l) => r2(l.gS) },
    { g: G4, head: "MU: SC EUR, товар FW26", get: (l) => r2(l.cS) },
    { g: G4, head: "MU: NS EUR + Discount EUR, олды", get: (l) => r2(l.gO) },
    { g: G4, head: "MU: SC EUR, олды", get: (l) => r2(l.cO) },
  ];
  const labels = ["Тип меха", "Категория 1", "Категория 2", "Артикул", "Цвет"], c0 = labels.length + 1, FIRST = 4, LAST = FIRST + list.length - 1;

  const wb = new ExcelJS.Workbook(); wb.creator = "МехУчёт";
  const ws = wb.addWorksheet("Данные", { views: [{ state: "frozen", xSplit: 5, ySplit: 3 }] });
  ws.getCell(1, 1).value = `FW26: заказ, приход, продажи и остатки на ${new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}`;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  let gs = 0;
  cols.forEach((c, i) => {
    if (i === cols.length - 1 || cols[i + 1].g !== c.g) {
      ws.mergeCells(2, c0 + gs, 2, c0 + i);
      const g = ws.getCell(2, c0 + gs); g.value = c.g; g.font = { bold: true, size: 10 }; g.alignment = { horizontal: "center" };
      for (let j = gs; j <= i; j++) ws.getCell(2, c0 + j).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[c.g] } };
      gs = i + 1;
    }
  });
  const hr = ws.getRow(3);
  labels.forEach((h, i) => { hr.getCell(i + 1).value = h; });
  cols.forEach((c, i) => { hr.getCell(c0 + i).value = c.head; });
  for (let c = 1; c < c0 + cols.length; c++) {
    const x = hr.getCell(c); x.font = { bold: true, size: 10 }; x.alignment = { wrapText: true, vertical: "middle", horizontal: c < c0 ? "left" : "center" };
    x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c < c0 ? "FFEFEFEF" : FILL[cols[c - c0].g] } }; x.border = { bottom: { style: "thin" } };
  }
  hr.height = 62;
  list.forEach((l, r) => {
    const x = ws.getRow(FIRST + r);
    [l.fur, l.c1, l.c2, l.article, l.color || "(без цвета)"].forEach((v, i) => { x.getCell(i + 1).value = v; });
    cols.forEach((c, i) => { const cell = x.getCell(c0 + i); cell.value = c.get(l); cell.numFmt = N0; });
  });
  const tr = ws.getRow(LAST + 2);
  tr.getCell(1).value = "Итого (по видимым строкам фильтра)";
  cols.forEach((c, i) => { const L = ws.getColumn(c0 + i).letter; const cell = tr.getCell(c0 + i); cell.value = { formula: `SUBTOTAL(109,${L}${FIRST}:${L}${LAST})`, result: list.reduce((a, l) => a + c.get(l), 0) }; cell.numFmt = N0; });
  for (let c = 1; c < c0 + cols.length; c++) { tr.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } }; tr.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2A5C" } }; }
  [16, 16, 22, 36, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  cols.forEach((_, i) => { ws.getColumn(c0 + i).width = 15; });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: LAST, column: c0 + cols.length - 1 } };

  // С EXCEL_PIVOT=1 лист «Пивот» не строим формулами: его создаёт настоящая сводная таблица Excel (scripts/add-excel-pivot.applescript).
  if (!process.env.EXCEL_PIVOT) {
  // ───────── Лист 2: Сводная (формулы по «Данные»): категория 1 → тип меха → категория 2 ─────────
  const pv = wb.addWorksheet("Пивот", { views: [{ state: "frozen", xSplit: 1, ySplit: 2 }], properties: { outlineLevelRow: 3 } });
  pv.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  const colL = (i: number) => ws.getColumn(c0 + i).letter;
  const rng = (i: number) => `Данные!$${colL(i)}$${FIRST}:$${colL(i)}$${LAST}`;
  const A = `Данные!$B$${FIRST}:$B$${LAST}`, F = `Данные!$A$${FIRST}:$A$${LAST}`, B = `Данные!$C$${FIRST}:$C$${LAST}`;
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const pcs: { head: string; fill: string; idx: number[]; den?: number[] }[] = [
    { head: "Заказ FW26, шт.", fill: FILL[G1], idx: [0] },
    { head: "Заказ всего, шт. (приход SS26 + FW25 + заказ FW26)", fill: FILL[G1], idx: [2] },
    { head: "Приход FW26, шт.", fill: FILL[G1], idx: [3] },
    { head: "Продажи FW26, шт.", fill: FILL[G1], idx: [6] },
    { head: "Остаток FW26, шт.", fill: FILL[G3], idx: [10] },
    { head: "Продажи всего в FW26 с олдами, шт.", fill: FILL[G2], idx: [6, 8] },
    { head: "Остаток всего с олдами, шт.", fill: FILL[G3], idx: [12] },
    { head: "Выручка FW26, ₽ с НДС", fill: FILL[G1], idx: [7] },
    { head: "Выручка всего в FW26 с олдами, ₽ с НДС", fill: FILL[G2], idx: [7, 9] },
    { head: "MU FW26 (средневзв.), ×", fill: FILL[G1], idx: [13], den: [14] },
    { head: "MU всего в FW26 с олдами (средневзв.), ×", fill: FILL[G2], idx: [13, 15], den: [14, 16] },
  ];
  const sumIdx = (ix: number[], rows: Leaf[]) => rows.reduce((a, l) => a + ix.reduce((t, k) => t + cols[k].get(l), 0), 0);
  const resOf = (c: { idx: number[]; den?: number[] }, rows: Leaf[]) => (c.den ? (sumIdx(c.den, rows) > 0 ? sumIdx(c.idx, rows) / sumIdx(c.den, rows) : 0) : sumIdx(c.idx, rows));
  const fmtOf = (c: { den?: number[] }) => (c.den ? "0.00" : N0);
  pv.getCell(1, 1).value = "Сводная по листу «Данные»: категория 1 → тип меха → категория 2 (формулы). Кнопки 1–3 слева сворачивают уровни. «С олдами» — товар FW26 плюс товар прошлых сезонов.";
  pv.getCell(1, 1).font = { bold: true, size: 12 };
  pv.getCell(2, 1).value = "Категория 1 → тип меха → категория 2";
  pcs.forEach((c, i) => { pv.getCell(2, 2 + i).value = c.head; });
  for (let c = 1; c <= 1 + pcs.length; c++) {
    const x = pv.getCell(2, c); x.font = { bold: true, size: 10 }; x.alignment = { wrapText: true, vertical: "middle", horizontal: c === 1 ? "left" : "center" };
    x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c === 1 ? "FFEFEFEF" : pcs[c - 2].fill } }; x.border = { bottom: { style: "thin" } };
  }
  pv.getRow(2).height = 48; pv.getColumn(1).width = 44; pcs.forEach((_, i) => { pv.getColumn(2 + i).width = 17; });
  let prow = 3;
  const write = (label: string, lvl: 0 | 1 | 2, crit: string, rows: Leaf[]) => {
    const x = pv.getRow(prow++);
    x.getCell(1).value = label; x.getCell(1).alignment = { indent: lvl * 2 };
    pcs.forEach((c, i) => {
      const cell = x.getCell(2 + i);
      const sm = (ix: number[]) => ix.map((k) => `SUMIFS(${rng(k)}${crit})`).join("+");
      cell.value = { formula: c.den ? `IFERROR((${sm(c.idx)})/(${sm(c.den)}),0)` : sm(c.idx), result: resOf(c, rows) } as ExcelJS.CellFormulaValue; cell.numFmt = fmtOf(c);
    });
    x.outlineLevel = lvl;
    if (lvl === 0) { x.font = { bold: true }; x.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F4F9" } }; }); }
    else if (lvl === 1) x.font = { bold: true, color: { argb: "FF333333" } };
  };
  for (const c1 of [...new Set(list.map((l) => l.c1))]) {
    const rows1 = list.filter((l) => l.c1 === c1);
    write(c1, 0, `,${A},${q(c1)}`, rows1);
    for (const fur of [...new Set(rows1.map((l) => l.fur))]) {
      const rows2 = rows1.filter((l) => l.fur === fur);
      write(fur, 1, `,${A},${q(c1)},${F},${q(fur)}`, rows2);
      for (const c2 of [...new Set(rows2.map((l) => l.c2))]) write(c2, 2, `,${A},${q(c1)},${F},${q(fur)},${B},${q(c2)}`, rows2.filter((l) => l.c2 === c2));
    }
  }
  const tx = pv.getRow(prow++);
  tx.getCell(1).value = "ИТОГО";
  pcs.forEach((c, i) => { const cell = tx.getCell(2 + i); const sm = (ix: number[]) => ix.map((k) => `SUM(${rng(k)})`).join("+");
    cell.value = { formula: c.den ? `IFERROR((${sm(c.idx)})/(${sm(c.den)}),0)` : sm(c.idx), result: resOf(c, list) } as ExcelJS.CellFormulaValue; cell.numFmt = fmtOf(c); });
  for (let c = 1; c <= 1 + pcs.length; c++) { tx.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } }; tx.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2A5C" } }; }
  wb.calcProperties.fullCalcOnLoad = true;
  } else {
    wb.addWorksheet("Пивот").getCell(1, 1).value = "Сводная таблица Excel по листу «Данные»";
  }

  // ───────── Лист 3: Отчёт — оформление как в отчёте владельца (Order / Delivery / Sales / Stock), формулы по «Данные»; NS — EUR excl VAT ─────────
  const rp = wb.addWorksheet("Отчёт", { views: [{ state: "frozen", xSplit: 8, ySplit: 6 }], properties: { outlineLevelRow: 3 } });
  rp.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  const dl = (i: number) => ws.getColumn(c0 + i).letter;
  const dr = (i: number) => `Данные!$${dl(i)}$${FIRST}:$${dl(i)}$${LAST}`;
  const dA = `Данные!$B$${FIRST}:$B$${LAST}`, dF = `Данные!$A$${FIRST}:$A$${LAST}`, dB = `Данные!$C$${FIRST}:$C$${LAST}`;
  const qs = (v: string) => `"${v.replace(/"/g, '""')}"`;
  type RC = { idx: number[]; den?: number[]; kind: "sum" | "so" | "mu"; fmt: string; head: string };
  const MUF = "0.00;-0.00;–", SOF = "0%;-0%;–";
  // Колонки I..Z: Order (TTL PCS, FW26 PCS, EUR) · Delivery (PCS, EUR) · Sales: SSN FW26 (PCS, SO, NS, Avg MU), Old (PCS, NS, Avg MU), Calendar FW26 (PCS, NS, Avg MU) · Stock (FW26, Old, TTL)
  const rcs: RC[] = [
    { head: "PCS", idx: [2], kind: "sum", fmt: N0 }, { head: "PCS", idx: [0], kind: "sum", fmt: N0 }, { head: "EUR", idx: [1], kind: "sum", fmt: N0 },
    { head: "PCS", idx: [3], kind: "sum", fmt: N0 }, { head: "EUR", idx: [4], kind: "sum", fmt: N0 },
    { head: "PCS", idx: [6], kind: "sum", fmt: N0 }, { head: "SO, %", idx: [6], den: [0], kind: "so", fmt: SOF }, { head: "NS EUR excl VAT", idx: [7], kind: "sum", fmt: N0 }, { head: "Avg MU", idx: [13], den: [14], kind: "mu", fmt: MUF },
    { head: "PCS", idx: [8], kind: "sum", fmt: N0 }, { head: "NS EUR excl VAT", idx: [9], kind: "sum", fmt: N0 }, { head: "Avg MU", idx: [15], den: [16], kind: "mu", fmt: MUF },
    { head: "PCS", idx: [6, 8], kind: "sum", fmt: N0 }, { head: "NS EUR excl VAT", idx: [7, 9], kind: "sum", fmt: N0 }, { head: "Avg MU", idx: [13, 15], den: [14, 16], kind: "mu", fmt: MUF },
    { head: "PCS", idx: [10], kind: "sum", fmt: N0 }, { head: "PCS", idx: [11], kind: "sum", fmt: N0 }, { head: "PCS", idx: [12], kind: "sum", fmt: N0 },
  ];
  const RC0 = 9; // первая колонка данных — I
  const sumI = (ix: number[], rows: Leaf[]) => rows.reduce((a, l) => a + ix.reduce((t, k) => t + cols[k].get(l), 0), 0);
  const resR = (c: RC, rows: Leaf[]) => (c.den ? (sumI(c.den, rows) > 0 ? sumI(c.idx, rows) / sumI(c.den, rows) : 0) : sumI(c.idx, rows));
  const BOLD = { bold: true, size: 10 };
  rp.getCell(1, 5).value = "Отчет по продажам меховых изделий MVST FW26"; rp.getCell(1, 5).font = { bold: true, size: 13 };
  rp.getCell(2, 5).value = new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }); rp.getCell(2, 5).font = { size: 10 };
  rp.getCell(3, 5).value = "NS EUR excl VAT"; rp.getCell(3, 5).font = { bold: true, size: 11 };
  const grp = (r: number, c1: number, c2: number, text: string, fill?: string) => {
    if (c2 > c1) rp.mergeCells(r, c1, r, c2);
    const x = rp.getCell(r, c1); x.value = text; x.font = BOLD; x.alignment = { horizontal: "center" };
    for (let c = c1; c <= c2; c++) { const y = rp.getCell(r, c); y.border = { bottom: { style: "thin" } }; if (fill) y.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } }; }
  };
  grp(4, 9, 11, "Order", "FFE7F5EC"); grp(4, 12, 13, "Delivery", "FFDDEBFA"); grp(4, 14, 23, "Sales", "FFFDF1DC"); grp(4, 24, 26, "Stock", "FFE8EEFC");
  grp(5, 9, 9, "TTL"); grp(5, 10, 11, "FW26"); grp(5, 12, 13, "FW26"); grp(5, 14, 17, "SSN FW26"); grp(5, 18, 20, "Old"); grp(5, 21, 23, "Calendar FW26"); grp(5, 24, 24, "FW26"); grp(5, 25, 25, "Old"); grp(5, 26, 26, "TTL");
  rcs.forEach((c, i) => { const x = rp.getCell(6, RC0 + i); x.value = c.head; x.font = BOLD; x.alignment = { horizontal: "center", wrapText: true }; x.border = { bottom: { style: "medium" } }; });
  rp.getRow(6).height = 30;
  for (let i = 1; i <= 4; i++) rp.getColumn(i).width = 4;
  rp.getColumn(5).width = 14; rp.getColumn(6).width = 14; rp.getColumn(7).width = 16; rp.getColumn(8).width = 26;
  rcs.forEach((_, i) => { rp.getColumn(RC0 + i).width = 13; });
  let rrow = 7, rno = 0;
  const rwrite = (label: string, lvl: 0 | 1 | 2 | 3, crit: string, rows: Leaf[], parent: number, isLeaf: boolean): number => {
    const x = rp.getRow(rrow++); const no = ++rno;
    x.getCell(1).value = parent; x.getCell(2).value = no; x.getCell(3).value = isLeaf ? 1 : 0; x.getCell(4).value = lvl + 1;
    for (let c = 1; c <= 4; c++) x.getCell(c).font = { size: 8, color: { argb: "FFAAAAAA" } };
    x.getCell(5 + lvl).value = label;
    rcs.forEach((c, i) => {
      const cell = x.getCell(RC0 + i);
      const sm = (ix: number[]) => ix.map((k) => (crit ? `SUMIFS(${dr(k)}${crit})` : `SUM(${dr(k)})`)).join("+");
      cell.value = { formula: c.den ? `IFERROR((${sm(c.idx)})/(${sm(c.den)}),0)` : sm(c.idx), result: resR(c, rows) } as ExcelJS.CellFormulaValue; cell.numFmt = c.fmt;
      cell.alignment = { horizontal: "right" };
    });
    x.outlineLevel = lvl === 0 ? 0 : lvl - 1;
    if (lvl <= 1) { x.font = { bold: true }; x.eachCell((cell, col) => { if (col >= 5) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: lvl === 0 ? "FFDCE3F2" : "FFF1F4F9" } }; }); }
    else if (lvl === 2) x.font = { bold: true, color: { argb: "FF333333" } };
    return no;
  };
  const byMoney = (items: [string, Leaf[]][]) => items.sort((a, b) => sumI([1], b[1]) - sumI([1], a[1]) || a[0].localeCompare(b[0], "ru"));
  const grpBy = (arr: Leaf[], pick: (l: Leaf) => string): [string, Leaf[]][] => { const m = new Map<string, Leaf[]>(); for (const l of arr) (m.get(pick(l)) ?? m.set(pick(l), []).get(pick(l))!).push(l); return [...m]; };
  const total = rwrite("Total", 0, "", list, 0, false);
  for (const [c1, rows1] of byMoney(grpBy(list, (l) => l.c1))) {
    const n1 = rwrite(c1, 1, `,${dA},${qs(c1)}`, rows1, total, false);
    for (const [fur, rows2] of byMoney(grpBy(rows1, (l) => l.fur))) {
      const n2 = rwrite(fur, 2, `,${dA},${qs(c1)},${dF},${qs(fur)}`, rows2, n1, false);
      for (const [c2, rows3] of byMoney(grpBy(rows2, (l) => l.c2))) rwrite(c2, 3, `,${dA},${qs(c1)},${dF},${qs(fur)},${dB},${qs(c2)}`, rows3, n2, true);
    }
  }
  wb.calcProperties.fullCalcOnLoad = true;

  const iso = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
  const path = `${dir}/FW26_массив_${iso}.xlsx`;
  writeFileSync(path, Buffer.from(await wb.xlsx.writeBuffer()));
  const t = (f: (l: Leaf) => number) => Math.round(list.reduce((a, l) => a + f(l), 0));
  console.log(path, JSON.stringify({ byCat: Object.fromEntries([...new Set(list.map((l) => l.c1))].map((c) => [c, list.filter((l) => l.c1 === c).reduce((a, l) => a + l.prior + l.conf, 0)])), priorTotal, priorMatched, orderAll: t((l) => l.prior + l.conf), rows: list.length, conf: t((l) => l.conf), deliv: t((l) => l.deliv), sold: t((l) => l.sold), old: t((l) => l.oldSold), st26: t(stock26), stOth: t(stockOth), stAll: t((l) => l.stockAll) }));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
