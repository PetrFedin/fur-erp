/**
 * Простой вид расчёта аукциона (Веллмех): минимум ввода — аукцион, лоты, расходы; остальное считается само.
 * Чистая логика без БД: работает в браузере и в scripts/test-supplier-calc.ts. Формат payload не меняется.
 */
import { headerRate, rateCols, rowFilled, type CalcFormat, type CalcPayload, type CalcRow, type CalcTotals } from "@/lib/supplier-calc";

/** Формат расчёта по названию аукциона/продавца; null — не опознан (формат не меняем). */
export function detectFormat(auction: string, seller = ""): CalcFormat | null {
  const s = `${auction} ${seller}`.toLowerCase();
  if (/saga/.test(s)) return "SAGA";
  if (/\bfh\b|harvest|фур\s?харв/.test(s)) return "FH";
  if (/(^|[^а-яa-z])(сп|рп)([^а-яa-z]|$)|союзпушн|русьпушн|sojuz|rusp/.test(s)) return "SP_RP";
  return null;
}

/** Расходы шага 3: ключ ставки в шапке (rates) или «Прочее». Ключи те же, что у столбцов формата. */
export type SimpleExpense = { key: string; label: string; ph: string };
const EXP: Record<string, { label: string; ph: string }> = {
  feePct: { label: "Сбор аукциона, %", ph: "например 7,35" },
  dressing: { label: "Выделка, ₽ за шкуру", ph: "например 1159" },
  dressingUsd: { label: "Выделка + покраска, $ за шкуру", ph: "например 11" },
  transport: { label: "Транспорт, ₽ за шкуру", ph: "например 20" },
  trans1: { label: "Транспорт до выделки, $ за шкуру", ph: "например 6" },
  brokerPct: { label: "Комиссия / брокер, %", ph: "например 4,5" },
};
const MAIN_KEYS = ["feePct", "dressing", "dressingUsd", "transport", "trans1", "brokerPct"];
/** Главные расходы формата (поля шага 3) и остальные ставки (идут в «Ещё поля»). */
export function expenseFields(f: CalcFormat): { main: SimpleExpense[]; more: { key: string; label: string; ph: string }[] } {
  const cols = rateCols(f);
  const main = MAIN_KEYS.filter((k) => cols.some((c) => c.key === k)).map((k) => ({ key: k, ...EXP[k] }));
  const more = cols.filter((c) => !MAIN_KEYS.includes(c.key)).map((c) => ({ key: c.key, label: c.rate!.label, ph: c.rate!.ph }));
  return { main, more };
}
/** Ставка не введена ни в шапке, ни в строках — для короткого предупреждения «ставка не указана». */
export const rateIsSet = (p: CalcPayload, key: string) => headerRate(p.header, key) !== "" || p.rows.filter(rowFilled).some((r) => (r[key] ?? "").trim() !== "");

/** «Прочее, ₽ за шкуру» — одна запись прочих расходов с режимом «на шкуру». */
export const OTHER_NAME = "Прочее";
export const getOther = (p: CalcPayload) => p.header.extras.find((e) => e.mode === "perHide" && e.name === OTHER_NAME)?.amount ?? "";
export function setOther(p: CalcPayload, v: string): CalcPayload {
  const has = p.header.extras.some((e) => e.mode === "perHide" && e.name === OTHER_NAME);
  const extras = has
    ? p.header.extras.map((e) => (e.mode === "perHide" && e.name === OTHER_NAME ? { ...e, amount: v } : e))
    : v.trim() === "" ? p.header.extras : [...p.header.extras, { name: OTHER_NAME, amount: v, mode: "perHide" as const }];
  return { ...p, header: { ...p.header, extras } };
}
/** Есть ли расходы кроме «Прочее» (их правят в расширенном режиме). */
export const hasOtherExtras = (p: CalcPayload) => p.header.extras.some((e) => !(e.mode === "perHide" && e.name === OTHER_NAME));

/** Нужен ли расширенный режим, чтобы ничего не спрятать: свои столбцы, параметры, ручные значения, выбранные столбцы. */
export const needsAdvanced = (p: CalcPayload) =>
  p.format === "SHEET" || (p.customColumns?.length ?? 0) > 0 || (p.params?.length ?? 0) > 0 || Object.keys(p.overrides ?? {}).length > 0 || !!p.unitCostColumn || !!p.qtyColumn;

/** Финальные цифры: лотов, шкур, итого ₽, средняя себестоимость шкуры. */
export function finalFigures(p: CalcPayload, t: CalcTotals) {
  const lots = p.rows.filter(rowFilled).length;
  return { lots, qty: t.qty, totalRub: t.totalRub, avgRub: t.qty > 0 ? t.totalRub / t.qty : 0 };
}

// ---------------------------------------------------------------------------------------------- вставка из Excel
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
type Key = "lot" | "fur" | "size" | "qty" | "price";
const HEAD: [Key, RegExp][] = [
  ["lot", /^(lot|лот)/], ["qty", /^(qty|quantity|кол|шт|количество)/], ["price", /^(price|цена|закупка|стоимость за)/],
  ["fur", /^(fur|мех|вид|товар)/], ["size", /^(size|цвет|размер|описание|description|color|grade)/],
];
/**
 * Текст из буфера (Excel: табуляции; допускаются «;»). Колонки — по шапке, если она есть, иначе по порядку
 * «лот, мех, цвет/размер, кол-во, цена». Нечисловые количество/цена в строке без шапки → строка пропускается.
 */
export function parsePasted(text: string): { rows: CalcRow[]; skipped: number } | { error: string } {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { error: "Вставьте строки из Excel: лот, мех, цвет/размер, кол-во, цена." };
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : lines.some((l) => l.includes(";")) ? ";" : "\t";
  const table = lines.map((l) => l.split(sep).map((c) => c.trim()));
  const num = (s: string) => /^[\s\d.,$€₽]+$/.test(s) && /\d/.test(s);
  let order: Key[] = ["lot", "fur", "size", "qty", "price"];
  let start = 0;
  const first = table[0].map(norm);
  const mapped = first.map((h) => HEAD.find(([, re]) => re.test(h))?.[0]);
  if (mapped.filter(Boolean).length >= 3 && mapped.includes("qty") && mapped.includes("price")) {
    start = 1;
    order = mapped as Key[];
  } else if (first.some((c) => c !== "" && !num(c)) && !table[0].slice(3).some(num)) start = 1; // шапка без узнаваемых слов
  const rows: CalcRow[] = [];
  let skipped = 0;
  for (const cells of table.slice(start)) {
    const r: CalcRow = { lot: "", fur: "", size: "", qty: "", price: "" };
    cells.forEach((c, i) => { const k = order[i]; if (k) r[k] = r[k] ? `${r[k]} ${c}`.trim() : c; });
    r.qty = r.qty.replace(/[\s ]/g, ""); r.price = r.price.replace(/[\s $€₽]/g, "");
    if (!num(r.qty) || !num(r.price) || /^(итого|всего|total)/i.test(r.lot)) { skipped++; continue; }
    rows.push(r);
  }
  if (rows.length === 0) return { error: "Не нашёл строк с количеством и ценой. Порядок колонок: лот, мех, цвет/размер, кол-во, цена." };
  return { rows, skipped };
}
