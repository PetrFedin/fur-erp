/**
 * Excel «Продажи и остатки: данные + пивот» (05.11.2026).
 * Лист 1 «Данные» — одна строка = тип меха × категория 1 (Одежда / Аксессуары) × категория 2 × артикул × цвет:
 *   • «Всё время» (все сезоны): заказано, пришло, продано, остаток (шт.), выручка (₽ с НДС);
 *   • «FW26/27»: заказано и пришло (шт., €), продано сезонного (товар сезона в его календаре) и не сезонного (товар прошлых сезонов в календаре FW26): шт. и ₽ с НДС;
 *   • служебные столбцы для средневзвешенного маркапа: цена до скидки и себестоимость проданного (как в «Продажи → Сезоны»: цена до скидки ÷ себестоимость из ТЗ, с НДС).
 * Лист 2 «Пивот» — формулы СУММЕСЛИМН по «Данные»: категория 1 → тип меха → категория 2 (кнопки 1–3 слева сворачивают уровни).
 * Запуск: NODE_PATH=<папка с пустым server-only> node --env-file=.env node_modules/.bin/tsx scripts/gen-sales-pivot-xlsx.ts [папка]
 */
import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { loadSalesInput } from "@/lib/sales-server";
import { furRuLabel } from "@/lib/sales-receipts-core";

const S = "FW26/27";
const FUR_RU: Record<string, string> = { SABLE: "Соболь", MINK: "Норка", FOX: "Лиса", SWAKARA: "Свакара", LYNX: "Рысь", BEAVER: "Бобр", CHINCHILLA: "Шиншилла" };

type Leaf = {
  fur: string; c1: string; c2: string; article: string; color: string;
  conf: number; deliv: number; sold: number; stock: number; rub: number;
  fConf: number; fConfEur: number; fDeliv: number; fDelivEur: number;
  ssn: number; rubSsn: number; old: number; rubOld: number;
  grossSsn: number; costSsn: number; grossOld: number; costOld: number;
};

async function main() {
  const dir = process.argv[2] ?? "docs-inventory/reports";
  const org = await prisma.organization.findFirstOrThrow();
  const data = await loadSalesInput(org.id, "on");
  const costs = data.input.costs;

  const leaves = new Map<string, Leaf>();
  for (const r of data.sizes) {
    const fur = furRuLabel(r.fur ?? "Не указан", FUR_RU), c1 = (r.l2 || "(без категории)").trim(), c2 = (r.l4 || r.l5 || "(без категории)").trim(), color = (r.color ?? "").trim();
    const k = [fur, c1, c2, r.acode, color].join("|");
    const lf = leaves.get(k) ?? { fur, c1, c2, article: r.acode, color, conf: 0, deliv: 0, sold: 0, stock: 0, rub: 0, fConf: 0, fConfEur: 0, fDeliv: 0, fDelivEur: 0, ssn: 0, rubSsn: 0, old: 0, rubOld: 0, grossSsn: 0, costSsn: 0, grossOld: 0, costOld: 0 };
    lf.conf += r.conf ?? 0; lf.deliv += r.deliv ?? 0; lf.sold += r.sold ?? 0; lf.stock += r.stock ?? 0; lf.rub += r.nsRub ?? 0;
    const c = r.seas?.[S];
    if (c) {
      lf.fConf += c.conf ?? 0; lf.fConfEur += c.confEur ?? 0; lf.fDeliv += c.deliv ?? 0; lf.fDelivEur += c.delivEur ?? 0;
      const n = c.soldSsn ?? 0, nO = c.soldOld ?? 0;
      lf.ssn += n; lf.rubSsn += c.rubSsn ?? 0; lf.old += nO; lf.rubOld += c.rubOld ?? 0;
      const cost = r.modelCode ? costs.get(r.modelCode)?.unitIncl ?? 0 : 0;
      if (cost > 0 && n > 0) { lf.grossSsn += (c.rubSsn ?? 0) + (c.discSsn ?? 0); lf.costSsn += n * cost; }
      if (cost > 0 && nO > 0) { lf.grossOld += (c.rubOld ?? 0) + (c.discOld ?? 0); lf.costOld += nO * cost; }
    }
    leaves.set(k, lf);
  }
  const list = [...leaves.values()].filter((l) => l.conf || l.deliv || l.sold || l.stock || l.fConf || l.fDeliv || l.ssn || l.old);
  list.sort((a, b) => a.c1.localeCompare(b.c1, "ru") || a.fur.localeCompare(b.fur, "ru") || a.c2.localeCompare(b.c2, "ru") || a.article.localeCompare(b.article) || a.color.localeCompare(b.color));

  const wb = new ExcelJS.Workbook();
  wb.creator = "МехУчёт";
  const ws = wb.addWorksheet("Данные", { views: [{ state: "frozen", xSplit: 5, ySplit: 3 }] });
  const labels = ["Тип меха", "Категория 1", "Категория 2", "Артикул", "Цвет"];
  type Col = { head: string; group: string; get: (l: Leaf) => number; fmt: string; helper?: boolean };
  const N0 = "#,##0;-#,##0;–", NR = "#,##0;-#,##0;–";
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const cols: Col[] = [
    { group: "Всё время (все сезоны)", head: "Заказано, шт.", get: (l) => l.conf, fmt: N0 },
    { group: "Всё время (все сезоны)", head: "Пришло, шт.", get: (l) => l.deliv, fmt: N0 },
    { group: "Всё время (все сезоны)", head: "Продано, шт.", get: (l) => l.sold, fmt: N0 },
    { group: "Всё время (все сезоны)", head: "Остаток, шт.", get: (l) => l.stock, fmt: N0 },
    { group: "Всё время (все сезоны)", head: "Выручка, ₽ с НДС", get: (l) => Math.round(l.rub), fmt: NR },
    { group: "FW26/27", head: "Заказано, шт.", get: (l) => l.fConf, fmt: N0 },
    { group: "FW26/27", head: "Заказано, €", get: (l) => r2(l.fConfEur), fmt: NR },
    { group: "FW26/27", head: "Пришло, шт.", get: (l) => l.fDeliv, fmt: N0 },
    { group: "FW26/27", head: "Пришло, €", get: (l) => r2(l.fDelivEur), fmt: NR },
    { group: "FW26/27", head: "Продано сезонного, шт.", get: (l) => l.ssn, fmt: N0 },
    { group: "FW26/27", head: "Выручка сезонного, ₽ с НДС", get: (l) => Math.round(l.rubSsn), fmt: NR },
    { group: "FW26/27", head: "Продано не сезонного, шт.", get: (l) => l.old, fmt: N0 },
    { group: "FW26/27", head: "Выручка не сезонного, ₽ с НДС", get: (l) => Math.round(l.rubOld), fmt: NR },
    { group: "Для маркапа (служебные)", head: "Цена до скидки сезонного, ₽", get: (l) => Math.round(l.grossSsn), fmt: NR, helper: true },
    { group: "Для маркапа (служебные)", head: "Себестоимость сезонного, ₽", get: (l) => Math.round(l.costSsn), fmt: NR, helper: true },
    { group: "Для маркапа (служебные)", head: "Цена до скидки не сезонного, ₽", get: (l) => Math.round(l.grossOld), fmt: NR, helper: true },
    { group: "Для маркапа (служебные)", head: "Себестоимость не сезонного, ₽", get: (l) => Math.round(l.costOld), fmt: NR, helper: true },
  ];
  const FIRST = 4, LAST = FIRST + list.length - 1, c0 = labels.length + 1;
  const colLetter = (i: number) => ws.getColumn(c0 + i).letter;
  const idx = (head: string, group: string) => cols.findIndex((c) => c.head === head && c.group === group);
  const GROUP_FILL: Record<string, string> = { "Всё время (все сезоны)": "FFE8EEFC", "FW26/27": "FFE7F5EC", "Для маркапа (служебные)": "FFEFEFEF" };

  ws.getCell(1, 1).value = `Продажи и остатки: заказано, пришло, продано (шт., деньги) на ${new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}`;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  let gs = 0;
  cols.forEach((c, i) => {
    if (i === cols.length - 1 || cols[i + 1].group !== c.group) {
      ws.mergeCells(2, c0 + gs, 2, c0 + i);
      const g = ws.getCell(2, c0 + gs); g.value = c.group; g.font = { bold: true, size: 10 }; g.alignment = { horizontal: "center" };
      for (let j = gs; j <= i; j++) ws.getCell(2, c0 + j).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP_FILL[c.group] } };
      gs = i + 1;
    }
  });
  const hr = ws.getRow(3);
  labels.forEach((h, i) => { hr.getCell(i + 1).value = h; });
  cols.forEach((c, i) => { hr.getCell(c0 + i).value = c.head; });
  for (let c = 1; c < c0 + cols.length; c++) {
    const x = hr.getCell(c); x.font = { bold: true, size: 10 }; x.alignment = { wrapText: true, vertical: "middle", horizontal: c < c0 ? "left" : "center" };
    x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c < c0 ? "FFEFEFEF" : GROUP_FILL[cols[c - c0].group] } }; x.border = { bottom: { style: "thin" } };
  }
  hr.height = 48;
  list.forEach((l, r) => {
    const x = ws.getRow(FIRST + r);
    [l.fur, l.c1, l.c2, l.article, l.color || "(без цвета)"].forEach((v, i) => { x.getCell(i + 1).value = v; });
    cols.forEach((c, i) => { const cell = x.getCell(c0 + i); cell.value = c.get(l); cell.numFmt = c.fmt; if (c.helper) cell.font = { color: { argb: "FF888888" } }; });
  });
  const tr = ws.getRow(LAST + 2);
  tr.getCell(1).value = "Итого (по видимым строкам фильтра)";
  cols.forEach((c, i) => {
    const cell = tr.getCell(c0 + i);
    cell.value = { formula: `SUBTOTAL(109,${colLetter(i)}${FIRST}:${colLetter(i)}${LAST})`, result: list.reduce((a, l) => a + c.get(l), 0) };
    cell.numFmt = c.fmt;
  });
  for (let c = 1; c < c0 + cols.length; c++) { tr.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } }; tr.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2A5C" } }; }
  [16, 16, 22, 36, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  cols.forEach((c, i) => { ws.getColumn(c0 + i).width = c.head.length > 22 ? 17 : 12; });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: LAST, column: c0 + cols.length - 1 } };

  // ───────── Лист 2: Пивот ─────────
  const pv = wb.addWorksheet("Пивот", { views: [{ state: "frozen", xSplit: 1, ySplit: 3 }], properties: { outlineLevelRow: 3 } });
  pv.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  pv.getCell(1, 1).value = "Пивот по листу «Данные»: категория 1 → тип меха → категория 2 (формулы; меняете «Данные» — пивот пересчитывается). Кнопки 1–3 слева сворачивают уровни.";
  pv.getCell(1, 1).font = { bold: true, size: 12 };
  const rng = (i: number) => `Данные!$${colLetter(i)}$${FIRST}:$${colLetter(i)}$${LAST}`;
  const A = `Данные!$B$${FIRST}:$B$${LAST}`, F = `Данные!$A$${FIRST}:$A$${LAST}`, B = `Данные!$C$${FIRST}:$C$${LAST}`;
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const visible = cols.map((c, i) => ({ c, i })).filter((x) => !x.c.helper);
  // Столбцы пивота: все видимые числа + SO и два маркапа.
  const pc: { head: string; group: string; fmt: string; f: (crit: string, rows: Leaf[]) => { formula: string; result: number | string } }[] = [];
  const sumOf = (i: number, crit: string, rows: Leaf[]) => ({ formula: `SUMIFS(${rng(i)}${crit})`, result: rows.reduce((a, l) => a + cols[i].get(l), 0) });
  for (const { c, i } of visible) {
    pc.push({ head: c.head, group: c.group, fmt: c.fmt, f: (crit, rows) => { const s = sumOf(i, crit, rows); return { formula: s.formula, result: s.result }; } });
    if (c.group === "Всё время (все сезоны)" && c.head === "Остаток, шт.") {
      const iC = idx("Заказано, шт.", c.group), iS = idx("Продано, шт.", c.group);
      pc.push({ head: "SO, % (продано ÷ заказано)", group: c.group, fmt: "0%;-0%;–", f: (crit, rows) => {
        const sold = rows.reduce((a, l) => a + cols[iS].get(l), 0), conf = rows.reduce((a, l) => a + cols[iC].get(l), 0);
        return { formula: `IFERROR(SUMIFS(${rng(iS)}${crit})/SUMIFS(${rng(iC)}${crit}),0)`, result: conf > 0 ? sold / conf : 0 };
      } });
    }
  }
  const iG1 = idx("Цена до скидки сезонного, ₽", "Для маркапа (служебные)"), iC1 = idx("Себестоимость сезонного, ₽", "Для маркапа (служебные)");
  const iG2 = idx("Цена до скидки не сезонного, ₽", "Для маркапа (служебные)"), iC2 = idx("Себестоимость не сезонного, ₽", "Для маркапа (служебные)");
  const sm = (i: number, rows: Leaf[]) => rows.reduce((a, l) => a + cols[i].get(l), 0);
  pc.push({ head: "Маркап сезонного (средневзвеш.), ×", group: "FW26/27", fmt: "0.00", f: (crit, rows) => ({ formula: `IFERROR(SUMIFS(${rng(iG1)}${crit})/SUMIFS(${rng(iC1)}${crit}),0)`, result: sm(iC1, rows) > 0 ? sm(iG1, rows) / sm(iC1, rows) : 0 }) });
  pc.push({ head: "Маркап всего FW26 (средневзвеш.), ×", group: "FW26/27", fmt: "0.00", f: (crit, rows) => ({ formula: `IFERROR((SUMIFS(${rng(iG1)}${crit})+SUMIFS(${rng(iG2)}${crit}))/(SUMIFS(${rng(iC1)}${crit})+SUMIFS(${rng(iC2)}${crit})),0)`, result: sm(iC1, rows) + sm(iC2, rows) > 0 ? (sm(iG1, rows) + sm(iG2, rows)) / (sm(iC1, rows) + sm(iC2, rows)) : 0 }) });

  pv.getCell(3, 1).value = "Категория 1 → тип меха → категория 2";
  let g0 = 0;
  pc.forEach((c, i) => {
    pv.getCell(3, 2 + i).value = c.head;
    if (i === pc.length - 1 || pc[i + 1].group !== c.group) {
      pv.mergeCells(2, 2 + g0, 2, 2 + i);
      const g = pv.getCell(2, 2 + g0); g.value = c.group; g.font = { bold: true, size: 10 }; g.alignment = { horizontal: "center" };
      for (let j = g0; j <= i; j++) pv.getCell(2, 2 + j).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP_FILL[c.group] } };
      g0 = i + 1;
    }
  });
  for (let c = 1; c <= 1 + pc.length; c++) {
    const x = pv.getCell(3, c); x.font = { bold: true, size: 10 }; x.alignment = { wrapText: true, vertical: "middle", horizontal: c === 1 ? "left" : "center" };
    x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c === 1 ? "FFEFEFEF" : GROUP_FILL[pc[c - 2].group] } }; x.border = { bottom: { style: "thin" } };
  }
  pv.getRow(3).height = 48;
  pv.getColumn(1).width = 44;
  pc.forEach((c, i) => { pv.getColumn(2 + i).width = c.head.length > 22 ? 17 : 12; });

  let row = 4;
  const write = (label: string, lvl: 0 | 1 | 2, crit: string, rows: Leaf[]) => {
    const x = pv.getRow(row++);
    x.getCell(1).value = label;
    x.getCell(1).alignment = { indent: lvl * 2 };
    pc.forEach((c, i) => { const cell = x.getCell(2 + i); const v = c.f(crit, rows); cell.value = { formula: v.formula, result: v.result } as ExcelJS.CellFormulaValue; cell.numFmt = c.fmt; });
    x.outlineLevel = lvl; // 0 — категория 1 (видна всегда), 1 — тип меха, 2 — категория 2
    if (lvl === 0) { x.font = { bold: true }; x.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F4F9" } }; }); }
    else if (lvl === 1) x.font = { bold: true, color: { argb: "FF333333" } };
  };
  const cats1 = [...new Set(list.map((l) => l.c1))];
  const totalRowIdx: number[] = [];
  for (const c1 of cats1) {
    const rows1 = list.filter((l) => l.c1 === c1);
    totalRowIdx.push(row);
    write(c1, 0, `,${A},${q(c1)}`, rows1);
    for (const fur of [...new Set(rows1.map((l) => l.fur))]) {
      const rows2 = rows1.filter((l) => l.fur === fur);
      write(fur, 1, `,${A},${q(c1)},${F},${q(fur)}`, rows2);
      for (const c2 of [...new Set(rows2.map((l) => l.c2))]) write(c2, 2, `,${A},${q(c1)},${F},${q(fur)},${B},${q(c2)}`, rows2.filter((l) => l.c2 === c2));
    }
  }
  // «Итого» — по всей таблице данных (формулы без условий)
  const tx = pv.getRow(row++);
  tx.getCell(1).value = "ИТОГО";
  pc.forEach((c, i) => { const cell = tx.getCell(2 + i); const v = c.f("", list); cell.value = { formula: v.formula.replace(/SUMIFS\(([^,)]+)\)/g, "SUM($1)"), result: v.result } as ExcelJS.CellFormulaValue; cell.numFmt = c.fmt; });
  for (let c = 1; c <= 1 + pc.length; c++) { tx.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } }; tx.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2A5C" } }; }

  const info = wb.addWorksheet("Как читать");
  [
    "Как читать файл",
    "• «Данные» — одна строка на тип меха × категория 1 (Одежда / Аксессуары) × категория 2 (шубы, жилеты, шапки…) × артикул × цвет. Включён фильтр; итог внизу считает только видимые строки.",
    "• «Всё время (все сезоны)» — заказано, пришло, продано, остаток (шт.) и выручка (₽ с НДС) по отчёту, без разбивки по сезонам.",
    "• «FW26/27» — заказано и пришло (шт. и €); «сезонного» — товар FW26/27, проданный в календаре самого сезона; «не сезонного» — товар прошлых сезонов (олд), проданный в календаре FW26/27. Деньги — ₽ с НДС, после скидки.",
    "• Маркап — средневзвешенный: цена до скидки ÷ себестоимость изделия из ТЗ (с НДС), только по проданным штукам, у которых есть себестоимость. Считается в пивоте как сумма цены ÷ сумма себестоимости по служебным столбцам «Данные» (не как среднее процентов).",
    "• SO, % = продано ÷ заказано за всё время.",
    "• Сверка с экраном «Продажи → Отчёт» (FW 26/27): заказано, получено, выручка и маркап совпадают. Штуки «продано сезонного» взяты из отчёта и могут отличаться на единицы: на экране их уточняют по файлу продаж.",
    "• «Пивот» — формулы по листу «Данные»: категория 1 → тип меха → категория 2, слева кнопки 1–3 сворачивают уровни.",
  ].forEach((t, i) => { const c = info.getCell(i + 1, 1); c.value = t; c.alignment = { wrapText: true, vertical: "top" }; if (i === 0) c.font = { bold: true, size: 13 }; });
  info.getColumn(1).width = 130;
  wb.calcProperties.fullCalcOnLoad = true;

  const iso = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
  const path = `${dir}/Продажи_данные_и_пивот_${iso}.xlsx`;
  writeFileSync(path, Buffer.from(await wb.xlsx.writeBuffer()));
  const t = (f: (l: Leaf) => number) => Math.round(list.reduce((a, l) => a + f(l), 0));
  console.log(path, JSON.stringify({ rows: list.length, conf: t((l) => l.conf), sold: t((l) => l.sold), stock: t((l) => l.stock), fConf: t((l) => l.fConf), fDeliv: t((l) => l.fDeliv), ssn: t((l) => l.ssn), old: t((l) => l.old), mkSsn: sm(iC1, list) > 0 ? +(sm(iG1, list) / sm(iC1, list)).toFixed(2) : null, cats1 }));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
