"use server";

import { requireSession } from "@/lib/session";

type Cell = string | number | null;
export type SheetKind = "month" | "year" | "total";
type Res = { ok: true; name: string; base64: string } | { ok: false; error: string };

/** Excel таблицы Cashflow: заголовки, строки периодов (месяц / итого года / итого) с числами; серверная сессия обязательна. */
export async function exportCashflowXlsx(v: { title: string; subtitle: string; head: string[]; rows: { label: string; kind: SheetKind; cells: Cell[] }[]; file: string }): Promise<Res> {
  await requireSession();
  if (!Array.isArray(v.head) || !Array.isArray(v.rows) || v.rows.length > 400 || v.head.length > 200) return { ok: false, error: "Слишком большая таблица" };
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Cashflow", { views: [{ state: "frozen", ySplit: 4, xSplit: 1 }] });
  ws.addRow([String(v.title).slice(0, 120)]).font = { bold: true, size: 14 };
  ws.addRow([String(v.subtitle).slice(0, 200)]).font = { color: { argb: "FF666666" } };
  ws.addRow([]);
  const head = ws.addRow(v.head.map((h) => String(h).slice(0, 120)));
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } }; c.alignment = { wrapText: true, vertical: "middle", horizontal: "center" }; });
  head.height = 48;
  for (const r of v.rows) {
    const x = ws.addRow([String(r.label), ...r.cells.map((c) => (typeof c === "number" && Number.isFinite(c) ? c : c ?? null))]);
    for (let i = 2; i <= x.cellCount; i++) x.getCell(i).numFmt = "#,##0;-#,##0;–";
    if (r.kind !== "month") { x.font = { bold: true }; x.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: r.kind === "total" ? "FFDDDDDD" : "FFF3F3F3" } }; }); }
  }
  ws.getColumn(1).width = 16; for (let c = 2; c <= v.head.length; c++) ws.getColumn(c).width = 15;
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return { ok: true, name: `${String(v.file).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 100) || "cashflow"}.xlsx`, base64: buf.toString("base64") };
}
