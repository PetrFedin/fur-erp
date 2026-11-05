/**
 * Excel FW 26/27, вариант «Данные + Сводная» (05.11.2026).
 * Лист 1 «Данные» — одна строка = тип меха × кат. 1 × кат. 2 × артикул × цвет: заказ и приход (моделей, шт., €), приход шт. по месяцам,
 * «в ТЗ есть, но не пришло» (считаем: придёт в ноябре), план от остатка на ноябрь и декабрь.
 * Лист 2 «Сводная» — формулы СУММЕСЛИМН по листу «Данные»: тип меха → кат. 1 → кат. 2 (группировка строк).
 * Запуск: NODE_PATH=<папка с пустым server-only> node --env-file=.env node_modules/.bin/tsx scripts/gen-fw26-array-xlsx.ts [папка]
 */
import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { loadSalesInput } from "@/lib/sales-server";
import { tzAwaitSizes } from "@/lib/tz-await";
import { furRuLabel } from "@/lib/sales-receipts-core";
import { baseForecast, FC_MONTHS, leafKeyOf, monthLabelRu, netMonths, tzPartsByModel, type Overrides } from "@/lib/fw26-plan";

const S = "FW26/27";
const FUR_RU: Record<string, string> = { SABLE: "Соболь", MINK: "Норка", FOX: "Лиса", SWAKARA: "Свакара", LYNX: "Рысь", BEAVER: "Бобр", CHINCHILLA: "Шиншилла" };

type Leaf = { key: string; model: string; article: string; color: string; fur: string; l1: string; l2: string; conf: number; confEur: number; deliv: number; delivEur: number; mm: Map<string, number>; aw: number; tz: number; nov: number; dec: number; jan: number };

async function main() {
  const dir = process.argv[2] ?? "docs-inventory/reports";
  const org = await prisma.organization.findFirstOrThrow();
  const [data, tz, state] = await Promise.all([
    loadSalesInput(org.id, "on"),
    tzAwaitSizes(org.id, "on"),
    prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: org.id, key: "sales-fw26-forecast" } } }),
  ]);
  const st = (state?.value ?? {}) as { cells?: Overrides; janOn?: boolean };
  const overrides = st.cells ?? {};

  // Приход по месяцам (файл поступлений), артикул+цвет → месяц → шт.
  const recv = new Map<string, Map<string, number>>();
  for (const l of data.input.lines) {
    if (l.kind !== "RECEIPT" || l.season !== "FW 26/27" || !l.pcs) continue;
    const k = leafKeyOf(l.article, l.colorId), m = l.iso.slice(0, 7);
    const a = recv.get(k) ?? new Map<string, number>(); recv.set(k, a);
    a.set(m, (a.get(m) ?? 0) + l.pcs);
  }
  const leaves = new Map<string, Leaf>();
  for (const r of data.sizes) {
    const c = r.seas?.[S]; if (!c) continue;
    const k = leafKeyOf(r.acode, r.color);
    const lf = leaves.get(k) ?? { key: k, model: r.modelCode ?? "", article: r.acode, color: r.color ?? "", fur: furRuLabel(r.fur ?? "Не указан", FUR_RU), l1: (r.l3 || "(без категории)").trim(), l2: (r.l4 || r.l5 || "(без категории)").trim(), conf: 0, confEur: 0, deliv: 0, delivEur: 0, mm: netMonths(recv.get(k) ?? new Map()), aw: 0, tz: 0, nov: 0, dec: 0, jan: 0 };
    lf.conf += c.conf ?? 0; lf.confEur += c.confEur ?? 0; lf.delivEur += c.delivEur ?? 0;
    leaves.set(k, lf);
  }
  const list = [...leaves.values()].filter((l) => {
    l.deliv = [...l.mm.values()].reduce((a, x) => a + x, 0);
    l.aw = Math.max(0, l.conf - l.deliv);
    return l.conf || l.deliv;
  });
  const tzByModel = new Map<string, number>();
  for (const t of tz) tzByModel.set(t.modelCode ?? "", (tzByModel.get(t.modelCode ?? "") ?? 0) + (t.fw26Conf ?? 0));
  const parts = tzPartsByModel(list.map((l) => ({ model: l.model, aw: l.aw })), tzByModel);
  list.forEach((l, i) => {
    l.tz = parts[i];
    const b = baseForecast(l.aw, l.tz);
    l.nov = overrides[l.key]?.["2026-11"] ?? b.nov;
    l.dec = overrides[l.key]?.["2026-12"] ?? b.dec;
    l.jan = st.janOn ? (overrides[l.key]?.["2027-01"] ?? 0) : 0;
  });
  list.sort((a, b) => a.fur.localeCompare(b.fur, "ru") || a.l1.localeCompare(b.l1, "ru") || a.l2.localeCompare(b.l2, "ru") || a.article.localeCompare(b.article) || a.color.localeCompare(b.color));
  const months = [...new Set(list.flatMap((l) => [...l.mm.keys()]))].sort();
  void FC_MONTHS;

  // ───────── Лист 1: Массив ─────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "МехУчёт";
  const ws = wb.addWorksheet("Данные", { views: [{ state: "frozen", xSplit: 5, ySplit: 3 }] });
  const labels = ["Тип меха", "Категория 1", "Категория 2", "Артикул", "Цвет"];
  type NumCol = { head: string; group: string; get: (l: Leaf) => number; fmt: string };
  const N0 = "#,##0;-#,##0;–", N2 = "#,##0;-#,##0;–";
  const cols: NumCol[] = [
    { group: "Заказ", head: "Моделей", get: (l) => (l.conf > 0 ? 1 : 0), fmt: N0 },
    { group: "Заказ", head: "Штук", get: (l) => l.conf, fmt: N0 },
    { group: "Заказ", head: "Евро", get: (l) => Math.round(l.confEur * 100) / 100, fmt: N2 },
    { group: "Приход", head: "Моделей", get: (l) => (l.deliv > 0 ? 1 : 0), fmt: N0 },
    { group: "Приход", head: "Штук", get: (l) => l.deliv, fmt: N0 },
    { group: "Приход", head: "Евро", get: (l) => Math.round(l.delivEur * 100) / 100, fmt: N2 },
    ...months.map((m): NumCol => ({ group: "Приход по месяцам, шт.", head: monthLabelRu(m), get: (l) => l.mm.get(m) ?? 0, fmt: N0 })),
    { group: "Не пришло", head: "Всего не пришло, шт. (заказ − приход)", get: (l) => l.aw, fmt: N0 },
    { group: "Не пришло", head: "Из них в ТЗ есть, не пришло — получим в ноябре, шт.", get: (l) => l.tz, fmt: N0 },
    { group: "Не пришло", head: "Остаток без ТЗ, шт.", get: (l) => l.aw - l.tz, fmt: N0 },
    { group: "План прихода от остатка, шт.", head: "Ноябрь (ТЗ + ½ остатка без ТЗ)", get: (l) => l.nov, fmt: N0 },
    { group: "План прихода от остатка, шт.", head: "Декабрь (½ остатка без ТЗ)", get: (l) => l.dec, fmt: N0 },
    ...(st.janOn ? [{ group: "План прихода от остатка, шт.", head: "Январь 27", get: (l: Leaf) => l.jan, fmt: N0 }] : []),
  ];
  const FIRST = 4, nData = list.length, LAST = FIRST + nData - 1;
  const c0 = labels.length + 1; // первый числовой столбец
  const colL = (i: number) => ws.getColumn(c0 + i).letter;

  ws.getCell(1, 1).value = `FW 26/27 — данные: заказ, приход, не пришло и план на ${new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}`;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  // группы шапки и шапка
  const GROUP_FILL: Record<string, string> = { "Заказ": "FFE8EEFC", "Приход": "FFE7F5EC", "Приход по месяцам, шт.": "FFDDF0E4", "Не пришло": "FFFFF4DC", "План прихода от остатка, шт.": "FFE0F0FA" };
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
  hr.height = 62;
  // данные (шапка на строке 3, данные с 4; строка итогов — внизу, чтобы не мешать фильтру)
  list.forEach((l, r) => {
    const x = ws.getRow(FIRST + r);
    [l.fur, l.l1, l.l2, l.article, l.color || "(без цвета)"].forEach((v, i) => { x.getCell(i + 1).value = v; });
    cols.forEach((c, i) => { const cell = x.getCell(c0 + i); cell.value = c.get(l); cell.numFmt = c.fmt; });
  });
  const tr = ws.getRow(LAST + 2);
  tr.getCell(1).value = "Итого (по видимым строкам фильтра)";
  cols.forEach((c, i) => {
    const cell = tr.getCell(c0 + i);
    cell.value = { formula: `SUBTOTAL(109,${colL(i)}${FIRST}:${colL(i)}${LAST})`, result: list.reduce((a, l) => a + c.get(l), 0) };
    cell.numFmt = c.fmt;
  });
  for (let c = 1; c < c0 + cols.length; c++) { tr.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } }; tr.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2A5C" } }; }
  [16, 26, 24, 34, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  cols.forEach((c, i) => { ws.getColumn(c0 + i).width = c.head.length > 24 ? 18 : 11; });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: LAST, column: c0 + cols.length - 1 } };

  // ───────── Лист 2: Сводная ─────────
  const pv = wb.addWorksheet("Сводная", { views: [{ state: "frozen", xSplit: 3, ySplit: 3 }], properties: { outlineLevelRow: 3 } });
  pv.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  pv.getCell(1, 1).value = "FW 26/27 — сводная по листу «Данные» (формулы; меняете «Данные» — сводная пересчитывается)";
  pv.getCell(1, 1).font = { bold: true, size: 13 };
  gs = 0;
  const pc0 = 4;
  cols.forEach((c, i) => {
    if (i === cols.length - 1 || cols[i + 1].group !== c.group) {
      pv.mergeCells(2, pc0 + gs, 2, pc0 + i);
      const g = pv.getCell(2, pc0 + gs); g.value = c.group; g.font = { bold: true, size: 10 }; g.alignment = { horizontal: "center" };
      for (let j = gs; j <= i; j++) pv.getCell(2, pc0 + j).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP_FILL[c.group] } };
      gs = i + 1;
    }
  });
  const ph = pv.getRow(3);
  ["Тип меха", "Категория 1", "Категория 2"].forEach((h, i) => { ph.getCell(i + 1).value = h; });
  cols.forEach((c, i) => { ph.getCell(pc0 + i).value = c.head; });
  for (let c = 1; c < pc0 + cols.length; c++) {
    const x = ph.getCell(c); x.font = { bold: true, size: 10 }; x.alignment = { wrapText: true, vertical: "middle", horizontal: c < pc0 ? "left" : "center" };
    x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c < pc0 ? "FFEFEFEF" : GROUP_FILL[cols[c - pc0].group] } }; x.border = { bottom: { style: "thin" } };
  }
  ph.height = 62;
  const rng = (i: number) => `Данные!$${colL(i)}$${FIRST}:$${colL(i)}$${LAST}`;
  const A = `Данные!$A$${FIRST}:$A$${LAST}`, B = `Данные!$B$${FIRST}:$B$${LAST}`, C = `Данные!$C$${FIRST}:$C$${LAST}`;
  const LVL_FILL = ["FF1B2A5C", "FFDDE3F5", "FFF6F7FB"];
  let pr = 4;
  const writeRow = (level: number, a: string, b: string, c: string, subset: Leaf[]) => {
    const x = pv.getRow(pr++);
    x.getCell(1).value = a; if (b) x.getCell(2).value = b; if (c) x.getCell(3).value = c;
    cols.forEach((col, i) => {
      const crit = [level >= 0 && a !== "Всего" ? `${A},$A${x.number}` : "", level >= 1 ? `${B},$B${x.number}` : "", level >= 2 ? `${C},$C${x.number}` : ""].filter(Boolean);
      const f = crit.length ? `SUMIFS(${rng(i)},${crit.join(",")})` : `SUM(${rng(i)})`;
      const cell = x.getCell(pc0 + i);
      cell.value = { formula: f, result: subset.reduce((s, l) => s + col.get(l), 0) }; cell.numFmt = col.fmt;
    });
    for (let k = 1; k < pc0 + cols.length; k++) {
      const cell = x.getCell(k);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LVL_FILL[level < 0 ? 0 : level === 0 ? 1 : 2] } };
      if (level < 0) cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; else if (level <= 1) cell.font = { bold: true };
    }
    x.outlineLevel = Math.max(0, level + 1 > 2 ? 2 : level + 1);
    if (level < 0) x.outlineLevel = 0;
  };
  writeRow(-1, "Всего", "", "", list);
  const furs = [...new Set(list.map((l) => l.fur))];
  // типы меха — по убыванию заказа
  furs.sort((p, q) => list.filter((l) => l.fur === q).reduce((s, l) => s + l.conf, 0) - list.filter((l) => l.fur === p).reduce((s, l) => s + l.conf, 0));
  for (const f of furs) {
    const lf = list.filter((l) => l.fur === f);
    writeRow(0, f, "", "", lf);
    for (const c1 of [...new Set(lf.map((l) => l.l1))]) {
      const l1 = lf.filter((l) => l.l1 === c1);
      writeRow(1, f, c1, "", l1);
      for (const c2 of [...new Set(l1.map((l) => l.l2))]) writeRow(2, f, c1, c2, l1.filter((l) => l.l2 === c2));
    }
  }
  [16, 26, 24].forEach((w, i) => { pv.getColumn(i + 1).width = w; });
  cols.forEach((c, i) => { pv.getColumn(pc0 + i).width = c.head.length > 24 ? 18 : 11; });

  // ───────── Лист 3: Как читать ─────────
  const info = wb.addWorksheet("Как читать");
  [
    "Что в файле",
    "• «Данные» — одна строка на тип меха × категория 1 × категория 2 × артикул × цвет. Включён фильтр: итог внизу считается по видимым строкам.",
    "• «Моделей» — число позиций (артикул-цвет), по которым есть заказ / приход (1 или 0 на строку); в сводной это число позиций. «Евро» — сумма из отчёта «заказ и продажи» (Conf EUR / Deliv EUR).",
    "• «Приход по месяцам» — файл «поступления и продажи» по дате прихода; корректировки с минусом зачтены в предыдущие месяцы того же артикула и цвета.",
    "• «Всего не пришло» = заказ − приход (не меньше нуля). «В ТЗ есть, не пришло — получим в ноябре» — часть этого остатка, которая заведена в наши ТЗ (включая уже сделанное): считаем, что она придёт в ноябре точно.",
    "• «План прихода от остатка»: ноябрь = ТЗ + половина остатка без ТЗ, декабрь = вторая половина. Если правили план в разделе «Приход по месяцам» — берутся правки.",
    "• «Сводная» — формулы по листу «Данные»: тип меха → кат. 1 → кат. 2, слева кнопки 1–3 сворачивают уровни.",
  ].forEach((t, i) => { const c = info.getCell(i + 1, 1); c.value = t; c.alignment = { wrapText: true, vertical: "top" }; if (i === 0) c.font = { bold: true, size: 13 }; });
  info.getColumn(1).width = 130;

  const iso = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
  const path = `${dir}/FW26_данные_и_сводная_${iso}.xlsx`;
  writeFileSync(path, Buffer.from(await wb.xlsx.writeBuffer()));
  const t = (f: (l: Leaf) => number) => list.reduce((a, l) => a + f(l), 0);
  console.log(path, JSON.stringify({ rows: list.length, conf: t((l) => l.conf), confEur: Math.round(t((l) => l.confEur)), deliv: t((l) => l.deliv), delivEur: Math.round(t((l) => l.delivEur)), aw: t((l) => l.aw), tz: t((l) => l.tz), nov: t((l) => l.nov), dec: t((l) => l.dec), months }));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
