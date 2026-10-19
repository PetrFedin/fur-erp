// «Загрузка данных»: разбор xlsx и сравнение с базой. Чистые функции без БД (БД — в import-server.ts).
// Формат файлов — как в scripts/import-receipts-sales-2026-10-19.ts, apply-retail-prices-2026-10-19.ts, apply-report-sizes-2026-10-19.ts.
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { classOfLevel2, modelCodeOfArticle, normCode, parseSheetRow, type ParsedLine } from "@/lib/sales-receipts-core";

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export type ImportKind = "sales" | "prices" | "photos";
export type PartType = "sales" | "prices" | "sizes" | "photos";

/** Различие: ключ строки, поле, было → стало. */
export type DiffItem = { key: string; field: string; before: string; after: string };
export type Counts = { added: number; changed: number; same: number; removed: number; errors: number };
export type TotalRow = { label: string; file: string; db: string; unit?: string };
export type PartPreview = {
  type: PartType;
  title: string;
  counts: Counts;
  diffs: DiffItem[];
  diffTotal: number;
  totals: TotalRow[];
  warnings: string[];
  errors: string[];
};

export class ImportFormatError extends Error {}

export const sha256 = (buf: Buffer | Uint8Array) => createHash("sha256").update(buf).digest("hex");

/** Проверка, что это именно xlsx (zip с [Content_Types].xml), без макросов. */
export function checkXlsxBuffer(buf: Buffer, name: string): void {
  if (!/\.xlsx$/i.test(name)) throw new ImportFormatError("Нужен файл .xlsx");
  if (buf.length === 0) throw new ImportFormatError("Файл пустой");
  if (buf.length > MAX_IMPORT_BYTES) throw new ImportFormatError("Файл больше 20 МБ");
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new ImportFormatError("Это не файл Excel (.xlsx)");
  if (buf.includes(Buffer.from("vbaProject"))) throw new ImportFormatError("В файле есть макросы — загрузите книгу без макросов (.xlsx)");
}

export async function openWorkbook(buf: Buffer, name: string): Promise<ExcelJS.Workbook> {
  checkXlsxBuffer(buf, name);
  const wb = new ExcelJS.Workbook();
  try {
    // exceljs принимает Buffer; тип в его описании устарел
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  } catch {
    throw new ImportFormatError("Не удалось прочитать файл: он повреждён или это не Excel");
  }
  return wb;
}

const cellVal = (v: unknown) => (v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v);
const rowCells = (row: ExcelJS.Row) => (row.values as unknown[]).slice(1).map((v) => cellVal(v)) as (string | number | null)[];
const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
const num0 = (v: unknown) => { const x = cellVal(v); return x == null || x === "" ? 0 : Number(x); };
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const eq4 = (a: number | null, b: number | null) => (a == null || b == null ? a === b : Math.abs(a - b) < 0.00006);

const NBSP = " ";
export function fmtN(v: number, digits = 0): string {
  return v.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/ /g, NBSP);
}
const fmtDay = (iso: string) => iso.split("-").reverse().join(".");
const show = (v: unknown, digits = 2) => (v == null || v === "" ? "—" : typeof v === "number" ? fmtN(v, Number.isInteger(v) ? 0 : digits) : String(v));

export function cap<T>(list: T[], n: number): T[] { return list.length > n ? list.slice(0, n) : list; }

function emptyPart(type: PartType, title: string): PartPreview {
  return { type, title, counts: { added: 0, changed: 0, same: 0, removed: 0, errors: 0 }, diffs: [], diffTotal: 0, totals: [], warnings: [], errors: [] };
}

/* ============================== Поступления и продажи ============================== */

export type SalesRowDb = {
  id: string; sourceKey: string; kind: "RECEIPT" | "SALE"; orderNo: string; season: string; article: string; fabric: string | null; colorId: string | null; modelCode: string | null;
  level2: string | null; level3: string | null; level4: string | null; level5: string | null; date: Date; pcs: number | null;
  retailEur: number | null; retailEurExVat: number | null; retailRub: number | null; retailRubExVat: number | null;
  discountEur: number | null; discountEurExVat: number | null; discountRub: number | null; discountRubExVat: number | null;
};

const SALES_FIELDS: { f: keyof ParsedLine & keyof SalesRowDb; label: string; money?: boolean }[] = [
  { f: "pcs", label: "Штуки" },
  { f: "retailRub", label: "Выручка ₽ с НДС", money: true }, { f: "retailRubExVat", label: "Выручка ₽ без НДС", money: true },
  { f: "retailEur", label: "Выручка € с НДС", money: true }, { f: "retailEurExVat", label: "Выручка € без НДС", money: true },
  { f: "discountRub", label: "Скидка ₽ с НДС", money: true }, { f: "discountRubExVat", label: "Скидка ₽ без НДС", money: true },
  { f: "discountEur", label: "Скидка € с НДС", money: true }, { f: "discountEurExVat", label: "Скидка € без НДС", money: true },
  { f: "season", label: "Сезон" }, { f: "fabric", label: "Ткань" }, { f: "modelCode", label: "Код модели" },
  { f: "level2", label: "Уровень 2" }, { f: "level3", label: "Уровень 3" }, { f: "level4", label: "Уровень 4" }, { f: "level5", label: "Уровень 5" },
];

export type SalesParsed = { lines: ParsedLine[]; totals: Record<string, (number | null)[]>; errors: string[]; warnings: string[]; skipped: number };

/** Шапка листа: строка, где первая ячейка «Номер заказа». */
function findSalesHeader(ws: ExcelJS.Worksheet): { rn: number; cells: (string | number | null)[] } | null {
  for (let rn = 1; rn <= Math.min(ws.rowCount, 40); rn++) {
    const c = rowCells(ws.getRow(rn));
    if (String(c[0] ?? "").trim() === "Номер заказа" && String(c[2] ?? "").trim().toLowerCase() === "article") return { rn, cells: c };
  }
  return null;
}

export function parseSalesWorkbook(wb: ExcelJS.Workbook): SalesParsed {
  const out: SalesParsed = { lines: [], totals: {}, errors: [], warnings: [], skipped: 0 };
  for (const [kind, prefixes, label, minCols] of [["RECEIPT", ["постапления", "поступления"], "поступления", 16], ["SALE", ["продажи"], "продажи", 24]] as const) {
    const ws = wb.worksheets.find((w) => prefixes.some((p) => w.name.trim().toLowerCase().startsWith(p)));
    if (!ws) throw new ImportFormatError(`В файле нет листа «${label}»`);
    const head = findSalesHeader(ws);
    if (!head) throw new ImportFormatError(`Лист «${ws.name}»: не найдена шапка («Номер заказа», …, Article)`);
    const present = head.cells.filter((c) => c != null && String(c).trim() !== "").length;
    if (present < minCols) throw new ImportFormatError(`Лист «${ws.name}»: в шапке ${present} столбцов, нужно ${minCols}`);
    if (kind === "RECEIPT" && !/delivery/i.test(String(head.cells[15] ?? ""))) throw new ImportFormatError(`Лист «${ws.name}»: столбец 16 должен быть «Delivery PCS…»`);
    if (kind === "SALE" && !/sales/i.test(String(head.cells[15] ?? ""))) throw new ImportFormatError(`Лист «${ws.name}»: столбец 16 должен быть «Sales PCS…»`);
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      if (rn <= head.rn) return;
      const cells = rowCells(row).map((c) => (c === undefined ? null : c));
      if (cells[0] === "Общий итог") { out.totals[kind] = cells.slice(15).map((x) => (x == null ? null : Number(x))); return; }
      if (!cells[0]) return;
      const p = parseSheetRow(kind, cells);
      if (!p) { out.skipped++; out.warnings.push(`Лист «${ws.name}», строка ${rn}: нет даты — пропущена`); return; }
      if (p.pcs != null && (!Number.isFinite(p.pcs) || !Number.isInteger(p.pcs))) { out.errors.push(`Лист «${ws.name}», строка ${rn}: штуки «${cells[15]}» — не целое число`); return; }
      for (const f of ["retailEur", "retailEurExVat", "retailRub", "retailRubExVat", "discountEur", "discountEurExVat", "discountRub", "discountRubExVat"] as const) {
        if (p[f] != null && !Number.isFinite(p[f] as number)) { out.errors.push(`Лист «${ws.name}», строка ${rn}: в столбце «${f}» не число`); return; }
      }
      out.lines.push(p);
    });
  }
  if (out.lines.length === 0) throw new ImportFormatError("В листах «поступления» и «продажи» нет строк с данными");
  return out;
}

export type ModelRef = { name: string; salesCode: string | null };

export function buildModelIndex(models: ModelRef[]): Map<string, ModelRef[]> {
  const by = new Map<string, ModelRef[]>();
  for (const m of models) for (const k of new Set([normCode(m.name), ...(m.salesCode ? [normCode(m.salesCode)] : [])])) by.set(k, [...(by.get(k) ?? []), m]);
  return by;
}

function lineTitle(l: { kind: string; orderNo: string; article: string; colorId: string | null; iso: string }) {
  return `${l.kind === "SALE" ? "Продажа" : "Поступление"} · ${l.orderNo} · ${l.article} · ${l.colorId ?? "—"} · ${fmtDay(l.iso)}`;
}

export function dbRowToLine(r: SalesRowDb): ParsedLine {
  return { ...r, iso: r.date.toISOString().slice(0, 10) } as unknown as ParsedLine;
}

/** Сравнение файла с базой по ключу строки (sourceKey). */
export function diffSales(parsed: SalesParsed, db: SalesRowDb[], models: ModelRef[], removeMissing: boolean): { part: PartPreview; added: ParsedLine[]; changed: { line: ParsedLine; row: SalesRowDb; fields: string[] }[]; removed: SalesRowDb[] } {
  const part = emptyPart("sales", "Поступления и продажи");
  part.errors.push(...parsed.errors);
  part.warnings.push(...parsed.warnings);
  const lines = parsed.lines;
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  // Сверка с «Общим итогом» самого файла (штуки и деньги).
  const rec = lines.filter((l) => l.kind === "RECEIPT"), sale = lines.filter((l) => l.kind === "SALE");
  const saleT = parsed.totals.SALE ?? [];
  const checks: [string, number, number | null | undefined][] = [
    ["поступления, шт.", sum(rec.map((l) => l.pcs ?? 0)), parsed.totals.RECEIPT?.[0]],
    ["продажи, шт.", sum(sale.map((l) => l.pcs ?? 0)), saleT[0]],
    ["выручка € с НДС", sum(sale.map((l) => l.retailEur ?? 0)), saleT[1]],
    ["выручка € без НДС", sum(sale.map((l) => l.retailEurExVat ?? 0)), saleT[2]],
    ["выручка ₽ с НДС", sum(sale.map((l) => l.retailRub ?? 0)), saleT[3]],
    ["выручка ₽ без НДС", sum(sale.map((l) => l.retailRubExVat ?? 0)), saleT[4]],
    ["скидка ₽ с НДС", sum(sale.map((l) => l.discountRub ?? 0)), saleT[7]],
  ];
  for (const [name, mine, file] of checks) {
    if (file == null) { part.errors.push(`Нет «Общего итога» для сверки: ${name}`); continue; }
    if (Math.abs(mine - file) >= 0.01) part.errors.push(`Файл не сходится с «Общим итогом»: ${name} — строки ${fmtN(mine, 2)}, итог ${fmtN(file, 2)}`);
  }
  // Дубли ключа строки.
  const seen = new Map<string, number>();
  for (const l of lines) seen.set(l.sourceKey, (seen.get(l.sourceKey) ?? 0) + 1);
  for (const [k, n] of seen) if (n > 1) part.errors.push(`Ключ строки повторяется ${n} раза: ${k.replace(/\|/g, " · ")}`);

  const dbByKey = new Map(db.map((r) => [r.sourceKey, r]));
  const added: ParsedLine[] = [], changed: { line: ParsedLine; row: SalesRowDb; fields: string[] }[] = [];
  const diffs: DiffItem[] = [];
  let same = 0;
  for (const l of lines) {
    const row = dbByKey.get(l.sourceKey);
    if (!row) { added.push(l); diffs.push({ key: lineTitle(l), field: "строка", before: "—", after: "новая" }); continue; }
    const fields: string[] = [];
    for (const { f, label, money } of SALES_FIELDS) {
      const a = row[f] as unknown, b = l[f] as unknown;
      const diff = money || f === "pcs" ? !eq4(a as number | null, b as number | null) : (a ?? null) !== (b ?? null);
      if (diff) { fields.push(f); diffs.push({ key: lineTitle(l), field: label, before: show(a), after: show(b) }); }
    }
    if (fields.length) changed.push({ line: l, row, fields }); else same++;
  }
  const fileKeys = new Set(lines.map((l) => l.sourceKey));
  const removed = db.filter((r) => !fileKeys.has(r.sourceKey));
  for (const r of removed) diffs.push({ key: lineTitle({ ...r, iso: r.date.toISOString().slice(0, 10) }), field: "строка", before: "есть", after: removeMissing ? "будет удалена" : "нет в файле (останется)" });
  part.counts = { added: added.length, changed: changed.length, same, removed: removed.length, errors: part.errors.length };
  part.diffTotal = diffs.length;
  part.diffs = cap(diffs, 3000);

  // Итоги: файл против базы.
  const dRec = db.filter((r) => r.kind === "RECEIPT"), dSale = db.filter((r) => r.kind === "SALE");
  part.totals = [
    { label: "Σ приход", unit: "шт.", file: fmtN(sum(rec.map((l) => l.pcs ?? 0))), db: fmtN(sum(dRec.map((l) => l.pcs ?? 0))) },
    { label: "Σ продано", unit: "шт.", file: fmtN(sum(sale.map((l) => l.pcs ?? 0))), db: fmtN(sum(dSale.map((l) => l.pcs ?? 0))) },
    { label: "Выручка с НДС", unit: "₽", file: fmtN(sum(sale.map((l) => l.retailRub ?? 0))), db: fmtN(sum(dSale.map((l) => l.retailRub ?? 0))) },
    { label: "Выручка без НДС", unit: "₽", file: fmtN(sum(sale.map((l) => l.retailRubExVat ?? 0))), db: fmtN(sum(dSale.map((l) => l.retailRubExVat ?? 0))) },
  ];

  // Предупреждения: артикул не сопоставлен с изделием, неоднозначный код, кириллица в коде.
  const idx = buildModelIndex(models);
  const noCode = new Map<string, number>(), unknown = new Map<string, number>(), ambiguous = new Map<string, number>(), cyr = new Map<string, string>();
  for (const l of lines) {
    const raw = /^\s*([A-Za-zА-Яа-яЁё]{1,4}[\s-]?\d{1,3}[A-Za-zА-Яа-яЁё]?)(?=$|[\s/])/.exec(l.article)?.[1];
    if (!l.modelCode) { noCode.set(l.article, (noCode.get(l.article) ?? 0) + 1); continue; }
    if (raw && /[А-Яа-яЁё]/.test(raw)) cyr.set(raw, l.modelCode);
    const c = idx.get(l.modelCode) ?? [];
    if (c.length === 0) unknown.set(l.modelCode, (unknown.get(l.modelCode) ?? 0) + 1);
    else if (c.length > 1) ambiguous.set(l.modelCode, (ambiguous.get(l.modelCode) ?? 0) + 1);
  }
  const lst = (m: Map<string, number>) => [...m].slice(0, 8).map(([k, n]) => `${k} (${n})`).join(", ") + (m.size > 8 ? ` и ещё ${m.size - 8}` : "");
  if (unknown.size) part.warnings.push(`Артикул не сопоставлен с изделием (${unknown.size}): ${lst(unknown)}`);
  if (ambiguous.size) part.warnings.push(`Код у нескольких изделий — неоднозначно (${ambiguous.size}): ${lst(ambiguous)}`);
  if (noCode.size) part.warnings.push(`Код модели в артикуле не распознан (${noCode.size}): ${lst(noCode)}`);
  if (cyr.size) part.warnings.push(`Кириллица в коде, приведена к латинице: ${[...cyr].slice(0, 8).map(([a, b]) => `${a} → ${b}`).join(", ")}`);
  return { part, added, changed, removed };
}

/* ============================== Прайс розницы ============================== */

export type PriceRow = { acode: string; color: string; size: string; price: number; modelCode: string };
export const priceKey = (r: { acode: string; color: string; size: string }) => `${r.acode}|${r.color}|${r.size}`;
const priceTitle = (r: { acode: string; color: string; size: string }) => `${r.acode} · ${r.color || "—"} · ${r.size || "—"}`;

/** Ключи строк с учётом повторов: второй и следующий повтор того же ключа получает суффикс «#2», «#3» (порядок строк в файле). */
export function withDupKeys<T>(rows: T[], keyOf: (r: T) => string): { key: string; row: T; n: number }[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = keyOf(row);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { key: n > 1 ? `${base}#${n}` : base, row, n };
  });
}

export function parsePricesWorkbook(wb: ExcelJS.Workbook, models: ModelRef[]): { rows: PriceRow[]; errors: string[]; warnings: string[] } {
  const ws = wb.worksheets.find((w) => w.name === "Current Price");
  if (!ws) throw new ImportFormatError("В файле нет листа «Current Price»");
  const head = rowCells(ws.getRow(1)).map((c) => String(c ?? "").trim().toLowerCase());
  const col = (n: string) => head.indexOf(n.toLowerCase());
  const iA = col("ACODE"), iS = col("SizeID"), iC = col("OrderColorID"), iP = col("Current Price");
  const missing = [["ACODE", iA], ["SizeID", iS], ["OrderColorID", iC], ["Current Price", iP]].filter(([, i]) => (i as number) < 0).map(([n]) => n);
  if (missing.length) throw new ImportFormatError(`Лист «Current Price»: не найдены столбцы ${missing.join(", ")}`);
  const idx = buildModelIndex(models);
  const rows: PriceRow[] = [], errors: string[] = [], warn: string[] = [];
  const unmatched: string[] = [], ambiguous: string[] = [];
  const dup = new Map<string, number>();
  ws.eachRow((row, rn) => {
    if (rn === 1) return;
    const v = rowCells(row);
    if (!v[iA]) return;
    const price = numOrNull(v[iP]);
    if (price == null) return; // как в скрипте: строка без цены пропускается
    if (!Number.isFinite(price) || price < 0) { errors.push(`«Current Price», строка ${rn}: цена «${v[iP]}» — не число`); return; }
    const acode = String(v[iA]);
    const code = modelCodeOfArticle(acode);
    if (!code) { unmatched.push(`${acode} (код модели не распознан)`); return; }
    const c = idx.get(code) ?? [];
    if (c.length === 0) { unmatched.push(`${acode} (изделия ${code} нет)`); return; }
    if (c.length > 1) { ambiguous.push(`${acode} (${c.map((m) => m.name).join(", ")})`); return; }
    const r = { acode, color: String(v[iC] ?? ""), size: String(v[iS] ?? ""), price, modelCode: code };
    const k = priceKey(r);
    dup.set(k, (dup.get(k) ?? 0) + 1);
    rows.push(r);
  });
  const dups = [...dup].filter(([, n]) => n > 1);
  if (dups.length) warn.push(`Повтор ключа (артикул · цвет · размер) с разными ценами в файле: ${dups.length} — оба значения сохраняются по порядку строк (${dups.slice(0, 3).map(([k]) => k.replace(/\|/g, " · ")).join("; ")}${dups.length > 3 ? " …" : ""})`);
  if (unmatched.length) warn.push(`Артикул не сопоставлен с изделием (${unmatched.length}): ${unmatched.slice(0, 6).join("; ")}${unmatched.length > 6 ? " …" : ""}`);
  if (ambiguous.length) warn.push(`Неоднозначно, код у нескольких изделий (${ambiguous.length}): ${ambiguous.slice(0, 4).join("; ")}${ambiguous.length > 4 ? " …" : ""}`);
  if (rows.length === 0 && errors.length === 0) throw new ImportFormatError("В листе «Current Price» нет строк с ценой");
  return { rows, errors, warnings: warn };
}

export function asPriceRows(value: unknown): PriceRow[] {
  const rows = (value as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return [];
  return (rows as Partial<PriceRow>[]).filter((r) => r && typeof r.price === "number" && typeof r.acode === "string").map((r) => ({ acode: r.acode!, color: String(r.color ?? ""), size: String(r.size ?? ""), price: r.price!, modelCode: String(r.modelCode ?? "") }));
}

/** Версия прайса: объединение со строками текущей версии, которых нет в файле (если не стоит «удалить отсутствующие»). */
export function diffPrices(file: { rows: PriceRow[]; errors: string[]; warnings: string[] }, current: PriceRow[], removeMissing: boolean): { part: PartPreview; merged: PriceRow[]; changedAny: boolean } {
  const part = emptyPart("prices", "Прайс розницы");
  part.errors.push(...file.errors);
  part.warnings.push(...file.warnings);
  const cur = new Map(withDupKeys(current, priceKey).map((x) => [x.key, x.row]));
  const diffs: DiffItem[] = [];
  let added = 0, changed = 0, same = 0;
  for (const { key, row: r } of withDupKeys(file.rows, priceKey)) {
    const c = cur.get(key);
    if (!c) { added++; diffs.push({ key: priceTitle(r), field: "строка", before: "—", after: `${fmtN(r.price)} ₽` }); continue; }
    if (Math.abs(c.price - r.price) >= 0.005) { changed++; diffs.push({ key: priceTitle(r), field: "Цена, ₽", before: fmtN(c.price), after: fmtN(r.price) }); } else same++;
  }
  const fileKeys = new Set(withDupKeys(file.rows, priceKey).map((x) => x.key));
  const removed = withDupKeys(current, priceKey).filter((x) => !fileKeys.has(x.key)).map((x) => x.row);
  for (const r of removed) diffs.push({ key: priceTitle(r), field: "строка", before: `${fmtN(r.price)} ₽`, after: removeMissing ? "будет удалена" : "нет в файле (останется)" });
  part.counts = { added, changed, same, removed: removed.length, errors: part.errors.length };
  part.diffTotal = diffs.length;
  part.diffs = cap(diffs, 3000);
  const sumP = (a: PriceRow[]) => a.reduce((x, r) => x + r.price, 0);
  part.totals = [
    { label: "Строк прайса", unit: "шт.", file: fmtN(file.rows.length), db: fmtN(current.length) },
    { label: "Σ по цене прайса", unit: "₽", file: fmtN(sumP(file.rows)), db: fmtN(sumP(current)) },
  ];
  const merged = removeMissing ? file.rows : [...file.rows, ...removed];
  return { part, merged, changedAny: added + changed > 0 || (removeMissing && removed.length > 0) };
}

/* ============================== Размеры из отчёта (лист Report) ============================== */

export type SizeRow = { acode: string; color: string; size: string; modelCode: string | null; cls: string; conf: number; deliv: number; sold: number; stock: number; nsRub: number; nsRubEx: number };
export type SizeTotal = { conf: number; deliv: number; sold: number; stock: number; nsRub: number; nsRubEx: number };
const SIZE_NUM = ["conf", "deliv", "sold", "stock", "nsRub", "nsRubEx"] as const;
const SIZE_LABEL: Record<(typeof SIZE_NUM)[number], string> = { conf: "Подтверждено, шт.", deliv: "Поступило, шт.", sold: "Продано, шт.", stock: "Остаток, шт.", nsRub: "Выручка ₽ с НДС", nsRubEx: "Выручка ₽ без НДС" };
export const sizeKey = (r: { acode: string; color: string; size: string }) => `${r.acode}|${r.color}|${r.size}`;

export function parseSizesWorkbook(wb: ExcelJS.Workbook): { rows: SizeRow[]; total: SizeTotal; errors: string[]; warnings: string[] } {
  const ws = wb.worksheets.find((w) => w.name === "Report");
  if (!ws) throw new ImportFormatError("В файле нет листа Report");
  // Шапка: строка со столбцами ACODE (8-й) и SizeID (15-й).
  let headRn = 0;
  for (let rn = 1; rn <= Math.min(ws.rowCount, 40); rn++) {
    const c = rowCells(ws.getRow(rn));
    if (String(c[7] ?? "").trim().toUpperCase() === "ACODE" && String(c[14] ?? "").trim().toLowerCase() === "sizeid") { headRn = rn; break; }
  }
  if (!headRn) throw new ImportFormatError("Лист Report: не найдена шапка со столбцами ACODE и SizeID");
  const rows: SizeRow[] = [], errors: string[] = [], warnings: string[] = [];
  let total: SizeTotal | null = null;
  const seen = new Set<string>();
  ws.eachRow((row, rn) => {
    if (rn <= headRn) return;
    const v = rowCells(row);
    if (v[6] === "Total") { total = { conf: num0(v[18]), deliv: num0(v[20]), sold: num0(v[28]), stock: num0(v[31]), nsRub: num0(v[26]), nsRubEx: num0(v[30]) }; return; }
    if (v[2] !== 1 || !v[7]) return;
    const nums = [v[18], v[20], v[28], v[31], v[26], v[30]].map(num0);
    if (nums.some((x) => !Number.isFinite(x))) { errors.push(`Report, строка ${rn}: в числовых столбцах не число`); return; }
    const r: SizeRow = { acode: String(v[7]), color: String(v[17] ?? ""), size: String(v[14] ?? ""), modelCode: modelCodeOfArticle(String(v[7])), cls: classOfLevel2(String(v[10] ?? "")), conf: nums[0], deliv: nums[1], sold: nums[2], stock: nums[3], nsRub: nums[4], nsRubEx: nums[5] };
    const k = sizeKey(r);
    if (seen.has(k)) warnings.push(`Report, строка ${rn}: повтор ключа ${r.acode} · ${r.color || "—"} · ${r.size || "—"} — сохраняется по порядку строк`);
    seen.add(k);
    rows.push(r);
  });
  if (!total) throw new ImportFormatError("Лист Report: нет строки Total для сверки");
  if (rows.length === 0) throw new ImportFormatError("Лист Report: нет размерных строк");
  const t: SizeTotal = total;
  for (const k of SIZE_NUM) {
    const s = rows.reduce((a, r) => a + r[k], 0);
    if (Math.abs(s - t[k]) >= 0.01) errors.push(`Размерные строки не сходятся с Total: ${SIZE_LABEL[k]} — строки ${fmtN(s, 2)}, Total ${fmtN(t[k], 2)}`);
  }
  return { rows, total: t, errors, warnings };
}

export function asSizeRows(value: unknown): SizeRow[] {
  const rows = (value as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as SizeRow[]).filter((r) => r && typeof r.acode === "string") : [];
}

export function diffSizes(file: { rows: SizeRow[]; total: SizeTotal; errors: string[]; warnings: string[] }, current: SizeRow[], removeMissing: boolean): { part: PartPreview; merged: SizeRow[]; total: SizeTotal; changedAny: boolean } {
  const part = emptyPart("sizes", "Размеры из отчёта");
  part.errors.push(...file.errors);
  part.warnings.push(...file.warnings);
  const cur = new Map(withDupKeys(current, sizeKey).map((x) => [x.key, x.row]));
  const diffs: DiffItem[] = [];
  let added = 0, changed = 0, same = 0;
  const title = (r: SizeRow) => `${r.acode} · ${r.color || "—"} · ${r.size || "—"}`;
  for (const { key, row: r } of withDupKeys(file.rows, sizeKey)) {
    const c = cur.get(key);
    if (!c) { added++; diffs.push({ key: title(r), field: "строка", before: "—", after: `продано ${fmtN(r.sold)}, остаток ${fmtN(r.stock)}` }); continue; }
    let any = false;
    for (const k of SIZE_NUM) if (Math.abs((c[k] ?? 0) - r[k]) >= 0.005) { any = true; diffs.push({ key: title(r), field: SIZE_LABEL[k], before: fmtN(c[k] ?? 0, 2), after: fmtN(r[k], 2) }); }
    if (any) changed++; else same++;
  }
  const fileKeys = new Set(withDupKeys(file.rows, sizeKey).map((x) => x.key));
  const removed = withDupKeys(current, sizeKey).filter((x) => !fileKeys.has(x.key)).map((x) => x.row);
  for (const r of removed) diffs.push({ key: title(r), field: "строка", before: `продано ${fmtN(r.sold)}`, after: removeMissing ? "будет удалена" : "нет в файле (останется)" });
  part.counts = { added, changed, same, removed: removed.length, errors: part.errors.length };
  part.diffTotal = diffs.length;
  part.diffs = cap(diffs, 3000);
  const S = (a: SizeRow[], k: (typeof SIZE_NUM)[number]) => a.reduce((x, r) => x + (r[k] ?? 0), 0);
  part.totals = [
    { label: "Σ поступило", unit: "шт.", file: fmtN(S(file.rows, "deliv")), db: fmtN(S(current, "deliv")) },
    { label: "Σ продано", unit: "шт.", file: fmtN(S(file.rows, "sold")), db: fmtN(S(current, "sold")) },
    { label: "Σ остаток", unit: "шт.", file: fmtN(S(file.rows, "stock")), db: fmtN(S(current, "stock")) },
    { label: "Выручка с НДС", unit: "₽", file: fmtN(S(file.rows, "nsRub")), db: fmtN(S(current, "nsRub")) },
  ];
  const merged = removeMissing ? file.rows : [...file.rows, ...removed];
  const total: SizeTotal = removed.length && !removeMissing ? Object.fromEntries(SIZE_NUM.map((k) => [k, r4(S(merged, k))])) as SizeTotal : file.total;
  return { part, merged, total, changedAny: added + changed > 0 || (removeMissing && removed.length > 0) };
}

/* ============================== Фото артикулов (только предпросмотр) ============================== */

export type PhotoCandidate = { row: number; article: string; variant: string; imageId: string };

export function parsePhotosWorkbook(wb: ExcelJS.Workbook): PhotoCandidate[] {
  const ws = wb.worksheets.find((w) => w.name.trim().toLowerCase() === "фото");
  if (!ws) throw new ImportFormatError("В файле нет листа «фото»");
  const imgs = ws.getImages();
  if (imgs.length === 0) throw new ImportFormatError("На листе «фото» нет встроенных картинок");
  const byRow = new Map<number, string>();
  for (const im of imgs) byRow.set(Math.floor(im.range.tl.nativeRow) + 1, String(im.imageId));
  const out: PhotoCandidate[] = [];
  ws.eachRow((row, rn) => {
    const v = rowCells(row);
    const article = String(v[1] ?? "").trim();
    if (!article) return;
    const imageId = byRow.get(rn);
    if (!imageId) return;
    out.push({ row: rn, article, variant: String(v[2] ?? "").trim(), imageId });
  });
  if (out.length === 0) throw new ImportFormatError("На листе «фото» нет строк «артикул + картинка»");
  return out;
}

const normVariant = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();

export function previewPhotos(cands: PhotoCandidate[], models: (ModelRef & { id: string })[], have: Map<string, { variant: string }[]>): PartPreview {
  const part = emptyPart("photos", "Фото артикулов");
  const idx = buildModelIndex(models);
  const use = new Map<string, number>();
  for (const c of cands) use.set(c.imageId, (use.get(c.imageId) ?? 0) + 1);
  const diffs: DiffItem[] = [];
  let added = 0, same = 0;
  const shared: string[] = [], unmatched: string[] = [], ambiguous: string[] = [];
  const planned = new Set<string>();
  for (const c of cands) {
    if ((use.get(c.imageId) ?? 0) > 1) { shared.push(`строка ${c.row} «${c.article}»`); continue; }
    const code = modelCodeOfArticle(c.article);
    const list = code ? ((idx.get(code) ?? []) as (ModelRef & { id: string })[]) : [];
    if (!code || list.length === 0) { unmatched.push(`строка ${c.row} «${c.article}»`); continue; }
    if (list.length > 1) { ambiguous.push(`строка ${c.row} «${c.article}»`); continue; }
    const m = list[0];
    const variant = c.article.replace(/^\s*[A-Za-zА-Яа-я]{1,4}[\s-]?\d{1,3}[A-Za-zА-Яа-я]?(?=$|[\s/])/, "").replace(/^[\s/]+/, "").trim() || c.variant;
    const cur = have.get(m.id) ?? [];
    const k = `${m.id}|${normVariant(variant)}`;
    if (cur.some((p) => p.variant.trim() === "") || cur.some((p) => normVariant(p.variant) === normVariant(variant)) || planned.has(k)) { same++; continue; }
    planned.add(k);
    added++;
    diffs.push({ key: `${m.name} · ${variant || "без варианта"}`, field: "Фото", before: "нет", after: `кандидат, строка ${c.row}` });
  }
  part.counts = { added, changed: 0, same, removed: 0, errors: 0 };
  part.diffTotal = diffs.length;
  part.diffs = cap(diffs, 3000);
  part.totals = [{ label: "Строк на листе «фото»", file: fmtN(cands.length), db: "—" }, { label: "Картинок", file: fmtN(use.size), db: "—" }];
  if (shared.length) part.warnings.push(`Одна картинка у нескольких строк — не вносится, выбор за вами (${shared.length}): ${shared.slice(0, 5).join("; ")}${shared.length > 5 ? " …" : ""}`);
  if (unmatched.length) part.warnings.push(`Артикул не сопоставлен с изделием (${unmatched.length}): ${unmatched.slice(0, 5).join("; ")}${unmatched.length > 5 ? " …" : ""}`);
  if (ambiguous.length) part.warnings.push(`Неоднозначно, код у нескольких изделий (${ambiguous.length}): ${ambiguous.slice(0, 5).join("; ")}${ambiguous.length > 5 ? " …" : ""}`);
  return part;
}
