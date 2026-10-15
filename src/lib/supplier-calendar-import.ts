import ExcelJS from "exceljs";
import { assertSafeZip } from "@/lib/zip-guard";
import { SUP_STAGES } from "@/lib/supplier-calendar";

/** Одна строка предпросмотра импорта из «Таблицы по запуску изделий» Веллмеха. */
export type ImportRow = { line: number; articleCode: string; color: string; size: string; quantity: number; status: string; planDate: string; factDate: string; notes: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
function toDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return iso(new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())));
  if (typeof v === "string") {
    const m = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s*$/.exec(v);
    if (m) {
      const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
      const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
      if (d.getUTCMonth() === Number(m[2]) - 1) return iso(d);
    }
  }
  return "";
}
function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && v !== null && "result" in v) return text((v as { result: unknown }).result);
  if (typeof v === "object" && v !== null && "richText" in v) return (v as { richText: { text: string }[] }).richText.map((x) => x.text).join("").trim();
  if (v instanceof Date) return "";
  return String(v).replace(/\s+/g, " ").trim();
}
function dateOf(v: unknown): string {
  const raw = typeof v === "object" && v !== null && "result" in v ? (v as { result: unknown }).result : v;
  return toDate(raw);
}

/**
 * Читает таблицу запуска изделий. Колонки ищутся по заголовку (строка с «модель» и «размер»):
 * модель, мех/цвет, размер, запуск, «шубы сданы», «сдача …» (плановые), «принято …», «примечание», «дополнение».
 * Одна строка таблицы — одно изделие (количество 1). Этап: принято → «Принято в Коптево», сдано → «Готово / сдано»,
 * «портн» в дополнении → «У портного», «скорн» → «У скорняка», есть запуск → «Запуск».
 */
export async function parseLaunchTable(buf: Buffer): Promise<{ rows: ImportRow[]; skipped: number; error?: string }> {
  const wb = new ExcelJS.Workbook();
  try {
    assertSafeZip(buf);
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    return { rows: [], skipped: 0, error: "Не удалось прочитать файл: нужен Excel (.xlsx)" };
  }
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], skipped: 0, error: "В файле нет листов" };
  let hdr = 0;
  const cols: Record<string, number> = {};
  const planCols: number[] = [];
  ws.eachRow((row, i) => {
    if (hdr || i > 30) return;
    const vals = row.values as unknown[];
    const low = vals.map((v) => text(v).toLowerCase());
    if (low.some((x) => x === "модель") && low.some((x) => x === "размер")) {
      hdr = i;
      low.forEach((h, c) => {
        if (!h) return;
        if (h === "модель") cols.model = c;
        else if (h.startsWith("мех")) cols.color = c;
        else if (h === "размер") cols.size = c;
        else if (h.startsWith("запуск")) cols.launch = c;
        else if (h.startsWith("шубы сданы")) cols.done = c;
        else if (h.startsWith("сдача")) planCols.push(c);
        else if (h.startsWith("принято")) cols.accepted = c;
        else if (h.startsWith("примечание")) cols.note = c;
        else if (h.startsWith("дополнение")) cols.extra = c;
      });
    }
  });
  if (!hdr || !cols.model) return { rows: [], skipped: 0, error: "Не нашли строку заголовков с колонками «модель» и «размер»" };
  const rows: ImportRow[] = [];
  let skipped = 0;
  const label = (k: string) => SUP_STAGES.find((s) => s.key === k)!.key;
  ws.eachRow((row, i) => {
    if (i <= hdr) return;
    const v = row.values as unknown[];
    const article = text(v[cols.model]);
    if (!article) return;
    const launch = cols.launch ? dateOf(v[cols.launch]) : "";
    const done = cols.done ? dateOf(v[cols.done]) : "";
    const accepted = cols.accepted ? dateOf(v[cols.accepted]) : "";
    const plan = planCols.map((c) => dateOf(v[c])).find(Boolean) ?? "";
    const extra = cols.extra ? text(v[cols.extra]).toLowerCase() : "";
    const noteDate = cols.note ? dateOf(v[cols.note]) : "";
    const note = [cols.note ? text(v[cols.note]) : "", cols.extra ? text(v[cols.extra]) : ""].filter(Boolean).join("; ");
    let status = "", fact = "";
    if (accepted) { status = label("accepted"); fact = accepted; }
    else if (done) { status = label("ready"); fact = done; }
    else if (extra.includes("портн")) { status = label("tailor"); fact = launch; }
    else if (extra.includes("скорн")) { status = label("furrier"); fact = launch; }
    else if (extra.includes("сдано")) { status = label("ready"); fact = launch; }
    else if (launch) { status = label("launch"); fact = launch; }
    const planDate = plan || noteDate || fact || launch;
    if (!status || !planDate) { skipped++; return; }
    rows.push({
      line: i, articleCode: article, color: cols.color ? text(v[cols.color]) : "", size: cols.size ? text(v[cols.size]) : "",
      quantity: 1, status, planDate, factDate: status === "launch" ? launch : fact, notes: note.slice(0, 500),
    });
  });
  return { rows, skipped };
}
