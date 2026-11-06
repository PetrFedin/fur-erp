/**
 * Excel «FW26: массив» (06.11.2026). Лист 1 «Массив» — одна строка = тип меха × кат. 1 × кат. 2 × артикул × цвет:
 *   • товар FW26/27: заказано и пришло (шт., €), «в производстве» (заказано − пришло), продано в календарном FW26 (шт., ₽ с НДС);
 *   • продажи ДРУГИХ сезонов (товар SS26, FW25 и старше) в календарном FW26 (шт., ₽ с НДС);
 *   • остатки: товара FW26 (пришло − продано) и всех остальных сезонов (общий остаток − остаток FW26), шт.
 * Запуск: NODE_PATH=<папка с пустым server-only> node --env-file=.env node_modules/.bin/tsx scripts/gen-fw26-massiv-xlsx.ts [папка]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { loadSalesInput } from "@/lib/sales-server";
import { furRuLabel } from "@/lib/sales-receipts-core";

const S = "FW26/27";
const FUR_RU: Record<string, string> = { SABLE: "Соболь", MINK: "Норка", FOX: "Лиса", SWAKARA: "Свакара", LYNX: "Рысь" };

type Leaf = { fur: string; c1: string; c2: string; article: string; color: string; conf: number; confEur: number; deliv: number; delivEur: number; sold: number; rub: number; oldSold: number; oldRub: number; stockAll: number };

async function main() {
  const dir = process.argv[2] ?? "docs-inventory/reports";
  mkdirSync(dir, { recursive: true });
  const org = await prisma.organization.findFirstOrThrow();
  const data = await loadSalesInput(org.id, "on");
  const leaves = new Map<string, Leaf>();
  for (const r of data.sizes) {
    const fur = furRuLabel(r.fur ?? "Не указан", FUR_RU), c1 = (r.l2 || "(без категории)").trim(), c2 = (r.l4 || r.l5 || "(без категории)").trim(), color = (r.color ?? "").trim();
    const k = [fur, c1, c2, r.acode, color].join("|");
    const lf = leaves.get(k) ?? { fur, c1, c2, article: r.acode, color, conf: 0, confEur: 0, deliv: 0, delivEur: 0, sold: 0, rub: 0, oldSold: 0, oldRub: 0, stockAll: 0 };
    lf.stockAll += r.stock ?? 0;
    const c = r.seas?.[S];
    if (c) {
      lf.conf += c.conf ?? 0; lf.confEur += c.confEur ?? 0; lf.deliv += c.deliv ?? 0; lf.delivEur += c.delivEur ?? 0;
      lf.sold += c.soldSsn ?? 0; lf.rub += c.rubSsn ?? 0; lf.oldSold += c.soldOld ?? 0; lf.oldRub += c.rubOld ?? 0;
    }
    leaves.set(k, lf);
  }
  const list = [...leaves.values()].filter((l) => l.conf || l.deliv || l.sold || l.oldSold || l.stockAll);
  list.sort((a, b) => a.c1.localeCompare(b.c1, "ru") || a.fur.localeCompare(b.fur, "ru") || a.c2.localeCompare(b.c2, "ru") || a.article.localeCompare(b.article) || a.color.localeCompare(b.color));
  const stock26 = (l: Leaf) => Math.max(0, l.deliv - l.sold);
  const stockOth = (l: Leaf) => Math.max(0, l.stockAll - stock26(l));

  const N0 = "#,##0;-#,##0;–";
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const G1 = "Товар FW26/27", G2 = "Продажи других сезонов в календарном FW26", G3 = "Остатки";
  const FILL: Record<string, string> = { [G1]: "FFE7F5EC", [G2]: "FFFDF1DC", [G3]: "FFE8EEFC" };
  const cols: { g: string; head: string; get: (l: Leaf) => number }[] = [
    { g: G1, head: "Заказано, шт.", get: (l) => l.conf },
    { g: G1, head: "Заказано, €", get: (l) => r2(l.confEur) },
    { g: G1, head: "Пришло, шт.", get: (l) => l.deliv },
    { g: G1, head: "Пришло, €", get: (l) => r2(l.delivEur) },
    { g: G1, head: "В производстве, шт. (заказано − пришло)", get: (l) => Math.max(0, l.conf - l.deliv) },
    { g: G1, head: "Продано товара FW26 в календарном FW26, шт.", get: (l) => l.sold },
    { g: G1, head: "Выручка товара FW26, ₽ с НДС", get: (l) => Math.round(l.rub) },
    { g: G2, head: "Продано, шт.", get: (l) => l.oldSold },
    { g: G2, head: "Выручка, ₽ с НДС", get: (l) => Math.round(l.oldRub) },
    { g: G3, head: "Остаток товара FW26, шт.", get: stock26 },
    { g: G3, head: "Остаток всех остальных сезонов, шт.", get: stockOth },
    { g: G3, head: "Остаток всего, шт.", get: (l) => stock26(l) + stockOth(l) },
  ];
  const labels = ["Тип меха", "Категория 1", "Категория 2", "Артикул", "Цвет"], c0 = labels.length + 1, FIRST = 4, LAST = FIRST + list.length - 1;

  const wb = new ExcelJS.Workbook(); wb.creator = "МехУчёт";
  const ws = wb.addWorksheet("Массив", { views: [{ state: "frozen", xSplit: 5, ySplit: 3 }] });
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

  const info = wb.addWorksheet("Как читать");
  [
    "Как читать лист «Массив»",
    "• Одна строка = тип меха × категория 1 × категория 2 × артикул × цвет. Фильтры включены, итог внизу считает только видимые строки.",
    "• «Товар FW26/27» — заказано и пришло по отчёту (шт., €); «в производстве» = заказано − пришло; «продано» — товар FW26, проданный в календаре самого сезона (август 2026 – январь 2027).",
    "• «Продажи других сезонов в календарном FW26» — товар прошлых сезонов (SS26, FW25 и старше), проданный в календаре FW26.",
    "• «Остаток товара FW26» = пришло − продано товара FW26; «остаток всех остальных сезонов» = общий остаток по отчёту − остаток товара FW26; «остаток всего» — их сумма.",
  ].forEach((t, i) => { const c = info.getCell(i + 1, 1); c.value = t; c.alignment = { wrapText: true, vertical: "top" }; if (i === 0) c.font = { bold: true, size: 13 }; });
  info.getColumn(1).width = 130;

  const iso = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
  const path = `${dir}/FW26_массив_${iso}.xlsx`;
  writeFileSync(path, Buffer.from(await wb.xlsx.writeBuffer()));
  const t = (f: (l: Leaf) => number) => Math.round(list.reduce((a, l) => a + f(l), 0));
  console.log(path, JSON.stringify({ rows: list.length, conf: t((l) => l.conf), deliv: t((l) => l.deliv), sold: t((l) => l.sold), old: t((l) => l.oldSold), st26: t(stock26), stOth: t(stockOth), stAll: t((l) => l.stockAll) }));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
