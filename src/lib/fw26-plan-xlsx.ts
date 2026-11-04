import "server-only";
// Excel «FW 26/27: заказано, пришло, приход по месяцам и план прихода на ноябрь, декабрь (и январь 27)».
// Строки — категория 1 → тип меха → категория 2 → артикул → цвет → размер (группировка строк Excel по уровням), столбцы — заказ, приход, месяцы, остаток в производстве, план.
// Данные и правила те же, что в разделе «Продажи и остатки → Сезоны → Приход по месяцам» (src/lib/fw26-plan.ts).
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import type { Commission4Mode } from "@/lib/commission4-mode";
import { loadSalesInput } from "@/lib/sales-server";
import { tzAwaitSizes } from "@/lib/tz-await";
import { furRuLabel } from "@/lib/sales-receipts-core";
import { buildFw26Plan, monthLabelRu, type Overrides } from "@/lib/fw26-plan";

const STATE_KEY = "sales-fw26-forecast";
const FUR_RU: Record<string, string> = { SABLE: "Соболь", MINK: "Норка", FOX: "Лиса", SWAKARA: "Свакара", LYNX: "Рысь", BEAVER: "Бобр", CHINCHILLA: "Шиншилла" };
const LEVEL_FILL = ["FF1B2A5C", "FFDDE3F5", "FFEDF0FA", "FFF6F7FB", "FFFFFFFF", "FFFFFFFF"];

export async function buildFw26PlanFile(orgId: string, c4: Commission4Mode): Promise<{ name: string; buffer: Buffer; summary: { conf: number; deliv: number; aw: number; fc: Record<string, number> } }> {
  const [data, tz, state] = await Promise.all([
    loadSalesInput(orgId, c4),
    tzAwaitSizes(orgId, c4),
    prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: STATE_KEY } } }),
  ]);
  const st = (state?.value ?? {}) as { cells?: Overrides; janOn?: boolean };
  const plan = buildFw26Plan({
    sizes: data.sizes,
    receipts: data.input.lines.filter((l) => l.kind === "RECEIPT" && l.season === "FW 26/27").map((l) => ({ article: l.article, colorId: l.colorId, iso: l.iso, pcs: l.pcs })),
    tz: tz.map((r) => ({ model: r.modelCode ?? "", qty: r.fw26Conf ?? 0 })),
    overrides: st.cells ?? {},
    janOn: !!st.janOn,
    furRu: (k) => furRuLabel(k, FUR_RU),
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "МехУчёт";
  const ws = wb.addWorksheet("FW26 приход и план", { views: [{ state: "frozen", xSplit: 6, ySplit: 5 }], properties: { outlineLevelRow: 5 } });
  const LEVELS = ["Категория 1", "Тип меха", "Категория 2", "Артикул", "Цвет", "Размер"];
  const nMonths = plan.months.length, nFc = plan.fcMonths.length;
  const cConf = 7, cDeliv = 8, cMonth0 = 9, cAw = cMonth0 + nMonths, cFc0 = cAw + 1, cPlan = cFc0 + nFc, cCheck = cPlan + 1, cLast = cCheck;

  const today = new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
  ws.getCell(1, 1).value = "FW 26/27 — заказано, пришло, приход по месяцам и план прихода";
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getCell(2, 1).value = `На ${today}. Заказ и приход по размерам — отчёт «заказ и продажи»; приход по месяцам — файл «поступления и продажи» (корректировки с минусом зачтены в предыдущие месяцы); план — ноябрь: то, что заведено в наши ТЗ, но ещё не пришло (в том числе сделанное), плюс половина остатка заказа без ТЗ; декабрь: вторая половина.`;
  ws.getCell(2, 1).font = { color: { argb: "FF555555" }, size: 10 };
  ws.getCell(2, 1).alignment = { wrapText: true, vertical: "top" };
  ws.mergeCells(2, 1, 2, Math.min(cLast, 14));
  ws.getRow(2).height = 44;

  const groups: [number, number, string, string][] = [
    [cConf, cDeliv, "Заказ и приход, шт.", "FFE8EEFC"],
    [cMonth0, cAw - 1, "Пришло по месяцам, шт. (файл поступлений)", "FFE7F5EC"],
    [cAw, cAw, "В производстве", "FFFFF4DC"],
    [cFc0, cCheck, "План прихода, шт.", "FFE0F0FA"],
  ];
  for (const [a, b, text, color] of groups) {
    if (b < a) continue;
    ws.mergeCells(4, a, 4, b);
    const c = ws.getCell(4, a);
    c.value = text; c.font = { bold: true, size: 10 }; c.alignment = { horizontal: "center" };
    for (let i = a; i <= b; i++) ws.getCell(4, i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  }
  const head: string[] = [...LEVELS, "Заказано", "Пришло", ...plan.months.map(monthLabelRu), "Остаток в производстве (ждём)", ...plan.fcMonths.map((m) => `${monthLabelRu(m)} (план)`), "План всего", "План − остаток"];
  const hr = ws.getRow(5);
  head.forEach((h, i) => { const c = hr.getCell(i + 1); c.value = h; c.font = { bold: true, size: 10 }; c.alignment = { wrapText: true, vertical: "middle", horizontal: i < 6 ? "left" : "center" }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } }; c.border = { bottom: { style: "thin" } }; });
  hr.height = 44;

  const NUM = "#,##0;-#,##0;–";
  const put = (r: number, labels: string[], row: { conf: number; deliv: number; aw: number; months: Record<string, number>; fc: Record<string, number> }, noMonths: boolean, level: number, isTotal = false) => {
    const x = ws.getRow(r);
    labels.forEach((l, i) => { if (l) x.getCell(i + 1).value = l; });
    x.getCell(cConf).value = row.conf; x.getCell(cDeliv).value = row.deliv;
    plan.months.forEach((m, i) => { if (!noMonths && row.months[m]) x.getCell(cMonth0 + i).value = row.months[m]; });
    x.getCell(cAw).value = row.aw;
    let sum = 0;
    plan.fcMonths.forEach((m, i) => { x.getCell(cFc0 + i).value = row.fc[m] ?? 0; sum += row.fc[m] ?? 0; });
    x.getCell(cPlan).value = sum;
    x.getCell(cCheck).value = sum - row.aw;
    for (let c = cConf; c <= cCheck; c++) { x.getCell(c).numFmt = NUM; x.getCell(c).alignment = { horizontal: "right" }; }
    for (let c = 1; c <= cLast; c++) {
      x.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: isTotal ? "FF1B2A5C" : LEVEL_FILL[level] } };
      if (isTotal) x.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } }; else if (level <= 2) x.getCell(c).font = { bold: true };
    }
    if (!isTotal && sum - row.aw !== 0) x.getCell(cCheck).font = { bold: level <= 2, color: { argb: "FFB45309" } };
    x.outlineLevel = isTotal ? 0 : level;
  };
  put(6, ["Всего"], plan.total, false, 0, true);
  let r = 7;
  for (const row of plan.rows) { put(r, row.labels.slice(0, row.level + 1), row, row.noMonths, row.level); r += 1; }
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  [26, 18, 24, 34, 16, 9].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (let c = cConf; c <= cCheck; c++) ws.getColumn(c).width = c === cAw ? 16 : 12;
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: cLast } };

  const info = wb.addWorksheet("Как читать");
  const lines = [
    "Что в таблице",
    "• Строки: категория 1 → тип меха → категория 2 → артикул → цвет → размер. Слева у листа кнопки 1–6 сворачивают уровни.",
    "• «Заказано» и «Пришло» по размерам — отчёт «заказ и продажи» на дату загрузки; итоги по артикулу и выше сходятся с разделом «Продажи и остатки».",
    "• «Пришло по месяцам» — файл «поступления и продажи» по дате прихода; на уровне размера месяцев нет (в файле нет размера). Корректировки прихода с минусом зачтены в ближайшие предыдущие месяцы того же артикула и цвета.",
    "• «Остаток в производстве» = заказано − пришло (не меньше нуля).",
    "• План прихода: ноябрь — всё, что заведено в наши ТЗ (включая сделанные, но не пришедшие) плюс половина остатка заказа без ТЗ; декабрь — вторая половина; январь 27 — только если добавлен в разделе (вручную).",
    "• Правки плана, внесённые в разделе «Приход по месяцам», попадают в файл. На уровне размера план делится по «ждём» размеров.",
    "• «План − остаток» не ноль там, где план правили руками: файл показывает расхождение, а не скрывает его.",
  ];
  lines.forEach((t, i) => { const c = info.getCell(i + 1, 1); c.value = t; c.alignment = { wrapText: true, vertical: "top" }; if (i === 0) c.font = { bold: true, size: 13 }; });
  info.getColumn(1).width = 130;

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const iso = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
  return { name: `FW26_приход_и_план_${iso}.xlsx`, buffer, summary: { conf: plan.total.conf, deliv: plan.total.deliv, aw: plan.total.aw, fc: plan.total.fc } };
}
