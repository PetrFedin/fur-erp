import { sizeUnitEur, seasonUnitEur } from "../src/lib/stock-money";
import "./stubs/server-only-shim";
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
const FUR_RU: Record<string, string> = { SABLE: "Соболь", MINK: "Норка", FOX: "Лиса", SWAKARA: "Свакара", LYNX: "Рысь" };

type Leaf = { fur: string; c1: string; c2: string; article: string; color: string; conf: number; confEur: number; deliv: number; delivEur: number; sold: number; rub: number; oldSold: number; oldRub: number; stockAll: number; delivAll: number; delivAllEur: number; stockEurFw: number; stockEurAll: number; ttlConf: number; ttlEur: number; stkS: number; stkO: number; prior: number; priorEur: number; gS: number; cS: number; gO: number; cO: number };

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
    const lf = leaves.get(k) ?? { fur, c1, c2, article: r.acode, color, conf: 0, confEur: 0, deliv: 0, delivEur: 0, sold: 0, rub: 0, oldSold: 0, oldRub: 0, stockAll: 0, delivAll: 0, delivAllEur: 0, stockEurFw: 0, stockEurAll: 0, ttlConf: 0, ttlEur: 0, stkS: 0, stkO: 0, prior: 0, priorEur: 0, gS: 0, cS: 0, gO: 0, cO: 0 };
    lf.delivAllEur += (r.seas?.["FW25/26"]?.delivEur ?? 0) + (r.seas?.["SS26"]?.delivEur ?? 0) + (r.seas?.["FW26/27"]?.delivEur ?? 0);
    { const u = sizeUnitEur(r), f = r.seas?.["FW26/27"], uf = seasonUnitEur(r, "FW26/27"); if (u.unit) lf.stockEurAll += (u.deliv - (r.sold ?? 0)) * u.unit; if (uf) lf.stockEurFw += ((f?.deliv ?? 0) - (f?.soldSsn ?? 0)) * uf; } // закупка остатка по размерам (отчёт, € с НДС)
    lf.delivAll += (r.seas?.["FW25/26"]?.deliv ?? 0) + (r.seas?.["SS26"]?.deliv ?? 0) + (r.seas?.["FW26/27"]?.deliv ?? 0);
    lf.stockAll += (r.seas?.["FW25/26"]?.deliv ?? 0) + (r.seas?.["SS26"]?.deliv ?? 0) + (r.seas?.["FW26/27"]?.deliv ?? 0) - (r.sold ?? 0); for (const cs of ["FW25/26", "SS26", "FW26/27"] as const) { const cc = r.seas?.[cs]; if (cc) { lf.ttlConf += cs === "FW26/27" ? cc.conf ?? 0 : cc.conf ?? cc.deliv ?? 0; lf.ttlEur += cs === "FW26/27" ? cc.confEur ?? 0 : cc.confEur ?? cc.delivEur ?? 0; } } // заказ всего = FW25/26 + SS26 + FW26/27 (закрытые сезоны: заказано = получено)
    // Закрытые сезоны: заказано = пришло (правило владельца): приход прошлых сезонов по файлу поступлений (весь, включая старше FW25).
    const lk = leafKeyOf(r.acode, r.color);
    if (!claimed.has(lk)) { claimed.add(lk); lf.prior += priorByLeaf.get(lk) ?? 0; }
    for (const cs of ["FW25/26", "SS26"] as const) { const cc = r.seas?.[cs]; if (cc) lf.priorEur += cc.confEur ?? cc.delivEur ?? 0; } // закрытые сезоны: заказано = получено (€)
    const c = r.seas?.[S];
    if (c) {
      lf.conf += c.conf ?? 0; lf.confEur += c.confEur ?? 0; lf.deliv += c.deliv ?? 0; lf.delivEur += c.delivEur ?? 0;
      lf.sold += c.soldSsn ?? 0; lf.rub += c.eurExSsn ?? 0; lf.oldSold += c.soldOld ?? 0; lf.oldRub += c.eurExOld ?? 0; // NS EUR без НДС (excl VAT)
      // MU по отчёту (как в приложении): (NS EUR + Discount EUR) ÷ SC EUR по проданному; в листе — суммы, отношение считает «Отчёт» (средневзвешенное).
      // Правило владельца (09.11.2026): MU = (выручка ₽ + скидка ₽) ÷ (SC EUR × 110); в листе — числитель в ₽ и знаменатель SC EUR × 110 в ₽.
      // Правило владельца (09.11.2026): MU = (выручка ₽ + скидка ₽) ÷ (SC EUR × 110) — как в приложении; числитель в ₽ и знаменатель SC EUR × 110 в ₽.
      lf.gS += (c.rubSsn ?? 0) + (c.discSsn ?? 0); lf.cS += (c.scSsn ?? 0) * 110;
      lf.gO += (c.rubOld ?? 0) + (c.discOld ?? 0); lf.cO += (c.scOld ?? 0) * 110;
    }
    leaves.set(k, lf);
  }
  const list = [...leaves.values()].filter((l) => l.conf || l.deliv || l.sold || l.oldSold || l.stockAll || l.ttlConf);
  // Приход прошлых сезонов по артикулам без строки в отчёте: отдельные строки с типом меха и категориями из самого файла поступлений (чтобы 862 делились на одежду и аксессуары как на экране).
  const priorMatched = list.reduce((a, l) => a + l.prior, 0);
  list.sort((a, b) => a.c1.localeCompare(b.c1, "ru") || a.fur.localeCompare(b.fur, "ru") || a.c2.localeCompare(b.c2, "ru") || a.article.localeCompare(b.article) || a.color.localeCompare(b.color));
  // Остаток = получено − продано (без обрезки по нулю, чтобы суммы сходились: 226 + 120 = 346 = 637 − 291).
  const stock26 = (l: Leaf) => l.deliv - l.sold;
  const stockOth = (l: Leaf) => l.stockAll - stock26(l);
  // Закупочная цена изделия, €: приход € ÷ приход шт. (нет прихода — заказ € ÷ заказ шт.); для «всего» — заказ всего € ÷ заказ всего шт.
  const unitFw = (l: Leaf) => (l.deliv > 0 && l.delivEur > 0 ? l.delivEur / l.deliv : l.conf > 0 && l.confEur > 0 ? l.confEur / l.conf : 0);
  const unitAll = (l: Leaf) => (l.ttlConf > 0 && l.ttlEur > 0 ? l.ttlEur / l.ttlConf : unitFw(l));

  const N0 = "#,##0;-#,##0;–";
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const G1 = "Товар FW26/27", G2 = "Продажи других сезонов в календарном FW26", G3 = "Остатки", G4 = "Для MU (служебные)", G5 = "Заказ всего, €", G6 = "Приход всего и остаток в €";
  const FILL: Record<string, string> = { [G1]: "FFE7F5EC", [G2]: "FFFDF1DC", [G3]: "FFE8EEFC", [G4]: "FFEFEFEF", [G5]: "FFE7F5EC", [G6]: "FFE8EEFC" };
  const cols: { g: string; head: string; get: (l: Leaf) => number }[] = [
    { g: G1, head: "Заказано, шт.", get: (l) => l.conf },
    { g: G1, head: "Заказано, €", get: (l) => r2(l.confEur) },
    { g: G1, head: "Заказ всего, шт. (FW25/26 + SS26 + FW26/27)", get: (l) => l.ttlConf },
    { g: G1, head: "Пришло, шт.", get: (l) => l.deliv },
    { g: G1, head: "Пришло, €", get: (l) => r2(l.delivEur) },
    { g: G1, head: "В производстве, шт. (заказано − пришло)", get: (l) => Math.max(0, l.conf - l.deliv) },
    { g: G1, head: "Продано товара FW26 в календарном FW26, шт.", get: (l) => l.sold },
    { g: G1, head: "NS EUR excl VAT, товар FW26", get: (l) => r2(l.rub) },
    { g: G2, head: "Продано, шт.", get: (l) => l.oldSold },
    { g: G2, head: "NS EUR excl VAT, олды в FW26", get: (l) => r2(l.oldRub) },
    { g: G3, head: "Остаток товара FW26, шт.", get: stock26 },
    { g: G3, head: "Остаток всех остальных сезонов, шт.", get: stockOth },
    { g: G3, head: "Остаток всего, шт.", get: (l) => stock26(l) + stockOth(l) },
    { g: G4, head: "MU: NS RUR + Discount RUR, FW26 товар", get: (l) => Math.round(l.gS) },
    { g: G4, head: "MU: SC EUR × 110, FW26 товар, ₽", get: (l) => Math.round(l.cS) },
    { g: G4, head: "MU: NS RUR + Discount RUR, олды в FW26", get: (l) => Math.round(l.gO) },
    { g: G4, head: "MU: SC EUR × 110, олды в FW26, ₽", get: (l) => Math.round(l.cO) },
    { g: G5, head: "Заказ всего, € (FW25/26 + SS26 + FW26/27)", get: (l) => r2(l.ttlEur) },
    { g: G6, head: "Пришло всего, шт. (FW25/26 + SS26 + FW26/27)", get: (l) => l.delivAll },
    { g: G6, head: "Пришло всего, € (FW25/26 + SS26 + FW26/27)", get: (l) => r2(l.delivAllEur) },
    { g: G6, head: "Stock EUR FW26 (остаток × закупочная цена изделия)", get: (l) => r2(l.stockEurFw) },
    { g: G6, head: "Stock EUR всего (остаток × закупочная цена изделия)", get: (l) => r2(l.stockEurAll) },
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

  // ───────── Лист 3: Отчёт (формулы по «Данные»): категория 1 → тип меха → категория 2, упорядочено по деньгам заказа FW26 (€), средневзвешенный MU ─────────
  const rp = wb.addWorksheet("Отчёт", { views: [{ state: "frozen", xSplit: 1, ySplit: 3 }], properties: { outlineLevelRow: 3 } });
  rp.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  const dl = (i: number) => ws.getColumn(c0 + i).letter;
  const dr = (i: number) => `Данные!$${dl(i)}$${FIRST}:$${dl(i)}$${LAST}`;
  const dA = `Данные!$B$${FIRST}:$B$${LAST}`, dF = `Данные!$A$${FIRST}:$A$${LAST}`, dB = `Данные!$C$${FIRST}:$C$${LAST}`;
  const qs = (v: string) => `"${v.replace(/"/g, '""')}"`;
  type RC = { head: string; grp: string; idx: number[]; den?: number[]; kind: "sum" | "mu" | "so"; fmt: string };
  const RG1 = "Заказ FW26", RG2 = "Приход FW26", RG3 = "Продажи FW26 (товар сезона)", RG5 = "Олды: продажи прошлых сезонов в календарном FW26", RG6 = "Всего продаж в FW26 с олдами", RG4 = "Остатки";
  const RFILL: Record<string, string> = { [RG1]: "FFE7F5EC", [RG2]: "FFDDEBFA", [RG3]: "FFFDF1DC", [RG5]: "FFF6E3D0", [RG6]: "FFFBE9C6", [RG4]: "FFE8EEFC" };
  const rcs: RC[] = [
    { grp: RG1, head: "Заказ, €", idx: [1], kind: "sum", fmt: N0 },
    { grp: RG1, head: "Заказ, шт.", idx: [0], kind: "sum", fmt: N0 },
    { grp: RG1, head: "Заказ всего, шт. (приход SS26 + FW25 + заказ FW26)", idx: [2], kind: "sum", fmt: N0 },
    { grp: RG2, head: "Приход, шт.", idx: [3], kind: "sum", fmt: N0 },
    { grp: RG2, head: "Приход, €", idx: [4], kind: "sum", fmt: N0 },
    { grp: RG2, head: "В производстве, шт.", idx: [5], kind: "sum", fmt: N0 },
    { grp: RG3, head: "Продано, шт.", idx: [6], kind: "sum", fmt: N0 },
    { grp: RG3, head: "SO, %", idx: [6], den: [0], kind: "so", fmt: "0%;-0%;–" },
    { grp: RG3, head: "Выручка, ₽ с НДС", idx: [7], kind: "sum", fmt: N0 },
    { grp: RG3, head: "Ср. MU FW26, ×", idx: [13], den: [14], kind: "mu", fmt: "0.00;-0.00;–" },
    { grp: RG5, head: "Продано олдов, шт.", idx: [8], kind: "sum", fmt: N0 },
    { grp: RG5, head: "Выручка олдов, ₽ с НДС", idx: [9], kind: "sum", fmt: N0 },
    { grp: RG5, head: "Ср. MU олдов, ×", idx: [15], den: [16], kind: "mu", fmt: "0.00;-0.00;–" },
    { grp: RG6, head: "Продано всего, шт.", idx: [6, 8], kind: "sum", fmt: N0 },
    { grp: RG6, head: "Выручка всего, ₽ с НДС", idx: [7, 9], kind: "sum", fmt: N0 },
    { grp: RG6, head: "Ср. MU всех продаж, ×", idx: [13, 15], den: [14, 16], kind: "mu", fmt: "0.00;-0.00;–" },
    { grp: RG4, head: "Остаток FW26, шт.", idx: [10], kind: "sum", fmt: N0 },
    { grp: RG4, head: "Остаток остальных сезонов, шт.", idx: [11], kind: "sum", fmt: N0 },
    { grp: RG4, head: "Остаток всего, шт.", idx: [12], kind: "sum", fmt: N0 },
  ];
  const sumI = (ix: number[], rows: Leaf[]) => rows.reduce((a, l) => a + ix.reduce((t, k) => t + cols[k].get(l), 0), 0);
  const resR = (c: RC, rows: Leaf[]) => (c.den ? (sumI(c.den, rows) > 0 ? sumI(c.idx, rows) / sumI(c.den, rows) : 0) : sumI(c.idx, rows));
  rp.getCell(1, 1).value = "Отчёт FW26: заказ, приход, продажи, средневзвешенный MU и остатки. Категория 1 → тип меха → категория 2, внутри каждого уровня — по убыванию заказа FW26 в €. Формулы по листу «Данные»; кнопки 1–3 слева сворачивают уровни.";
  rp.getCell(1, 1).font = { bold: true, size: 12 };
  let rg0 = 0;
  rcs.forEach((c, i) => {
    rp.getCell(3, 2 + i).value = c.head;
    if (i === rcs.length - 1 || rcs[i + 1].grp !== c.grp) {
      rp.mergeCells(2, 2 + rg0, 2, 2 + i);
      const g = rp.getCell(2, 2 + rg0); g.value = c.grp; g.font = { bold: true, size: 10 }; g.alignment = { horizontal: "center" };
      for (let j = rg0; j <= i; j++) rp.getCell(2, 2 + j).fill = { type: "pattern", pattern: "solid", fgColor: { argb: RFILL[c.grp] } };
      rg0 = i + 1;
    }
  });
  rp.getCell(3, 1).value = "Категория 1 → тип меха → категория 2";
  for (let c = 1; c <= 1 + rcs.length; c++) {
    const x = rp.getCell(3, c); x.font = { bold: true, size: 10 }; x.alignment = { wrapText: true, vertical: "middle", horizontal: c === 1 ? "left" : "center" };
    x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c === 1 ? "FFEFEFEF" : RFILL[rcs[c - 2].grp] } }; x.border = { bottom: { style: "thin" } };
  }
  rp.getRow(3).height = 48; rp.getColumn(1).width = 44; rcs.forEach((_, i) => { rp.getColumn(2 + i).width = 15; });
  let rrow = 4;
  const rwrite = (label: string, lvl: 0 | 1 | 2, crit: string, rows: Leaf[]) => {
    const x = rp.getRow(rrow++);
    x.getCell(1).value = label; x.getCell(1).alignment = { indent: lvl * 2 };
    rcs.forEach((c, i) => {
      const cell = x.getCell(2 + i);
      const sm = (ix: number[]) => ix.map((k) => `SUMIFS(${dr(k)}${crit})`).join("+");
      cell.value = { formula: c.den ? `IFERROR((${sm(c.idx)})/(${sm(c.den)}),0)` : sm(c.idx), result: resR(c, rows) } as ExcelJS.CellFormulaValue; cell.numFmt = c.fmt;
    });
    x.outlineLevel = lvl;
    if (lvl === 0) { x.font = { bold: true }; x.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F4F9" } }; }); }
    else if (lvl === 1) x.font = { bold: true, color: { argb: "FF333333" } };
  };
  const byMoney = <T,>(items: [string, Leaf[]][]) => items.sort((a, b) => sumI([1], b[1]) - sumI([1], a[1]) || a[0].localeCompare(b[0], "ru"));
  const grp = (arr: Leaf[], pick: (l: Leaf) => string): [string, Leaf[]][] => { const m = new Map<string, Leaf[]>(); for (const l of arr) (m.get(pick(l)) ?? m.set(pick(l), []).get(pick(l))!).push(l); return [...m]; };
  for (const [c1, rows1] of byMoney(grp(list, (l) => l.c1))) {
    rwrite(c1, 0, `,${dA},${qs(c1)}`, rows1);
    for (const [fur, rows2] of byMoney(grp(rows1, (l) => l.fur))) {
      rwrite(fur, 1, `,${dA},${qs(c1)},${dF},${qs(fur)}`, rows2);
      for (const [c2, rows3] of byMoney(grp(rows2, (l) => l.c2))) rwrite(c2, 2, `,${dA},${qs(c1)},${dF},${qs(fur)},${dB},${qs(c2)}`, rows3);
    }
  }
  const rtx = rp.getRow(rrow++);
  rtx.getCell(1).value = "ИТОГО";
  rcs.forEach((c, i) => {
    const cell = rtx.getCell(2 + i);
    const sm = (ix: number[]) => ix.map((k) => `SUM(${dr(k)})`).join("+");
    cell.value = { formula: c.den ? `IFERROR((${sm(c.idx)})/(${sm(c.den)}),0)` : sm(c.idx), result: resR(c, list) } as ExcelJS.CellFormulaValue; cell.numFmt = c.fmt;
  });
  for (let c = 1; c <= 1 + rcs.length; c++) { rtx.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } }; rtx.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2A5C" } }; }
  wb.calcProperties.fullCalcOnLoad = true;

  const iso = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
  const path = `${dir}/FW26_массив_${iso}.xlsx`;
  writeFileSync(path, Buffer.from(await wb.xlsx.writeBuffer()));
  const t = (f: (l: Leaf) => number) => Math.round(list.reduce((a, l) => a + f(l), 0));
  console.log(path, JSON.stringify({ byCat: Object.fromEntries([...new Set(list.map((l) => l.c1))].map((c) => [c, list.filter((l) => l.c1 === c).reduce((a, l) => a + l.prior + l.conf, 0)])), priorTotal, priorMatched, orderAll: t((l) => l.prior + l.conf), rows: list.length, conf: t((l) => l.conf), deliv: t((l) => l.deliv), sold: t((l) => l.sold), old: t((l) => l.oldSold), st26: t(stock26), stOth: t(stockOth), stAll: t((l) => l.stockAll) }));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
