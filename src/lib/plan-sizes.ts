// Размерная сетка плана заказа: наборы размеров, разбор вставки из Excel/CSV.
// Чистые функции (без базы) — годятся и для сервера, и для клиента.

export const LETTER_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
export const NUMERIC_SIZES = ["38", "40", "42", "44", "46", "48", "50"] as const;

/** Размер без лишнего: пробелы убраны, буквы заглавные, максимум 12 знаков. */
export function cleanSize(raw: unknown): string {
  return String(raw ?? "").trim().replace(/\s+/g, "").toUpperCase().slice(0, 12);
}

/** Порядок колонок: XS…XXL, затем числа по возрастанию, затем остальное. */
const LETTER_ORDER: Record<string, number> = { XXS: 0, XS: 1, S: 2, M: 3, L: 4, XL: 5, XXL: 6, XXXL: 7 };
export function compareSizeLabels(a: string, b: string): number {
  const la = LETTER_ORDER[a];
  const lb = LETTER_ORDER[b];
  if (la !== undefined && lb !== undefined) return la - lb;
  if (la !== undefined) return -1;
  if (lb !== undefined) return 1;
  const na = /^\d+([.,]\d+)?$/.test(a) ? Number(a.replace(",", ".")) : null;
  const nb = /^\d+([.,]\d+)?$/.test(b) ? Number(b.replace(",", ".")) : null;
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return a.localeCompare(b, "ru");
}

export type PlanRowInput = {
  articleCode: string;
  articleName?: string;
  color?: string;
  furType?: string;
  notes?: string;
  /** размер → количество (целое ≥ 0) */
  sizes: Record<string, number>;
};

export function rowTotal(sizes: Record<string, number>): number {
  return Object.values(sizes).reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);
}

/** Целое количество ≥ 0 из текста ячейки; пусто → null (ячейка не заполнена), мусор → NaN. */
export function parseCellQty(raw: string): number | null {
  const t = raw.replace(/[\s ]/g, "");
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return NaN;
  const n = Number(t);
  return n > 1_000_000 ? NaN : n;
}

export type ParsedPaste = {
  sizes: string[];
  rows: PlanRowInput[];
  errors: string[];
};

/**
 * Вставка из Excel/Google Sheets/CSV: первая строка — заголовок «Артикул [Название] [Цвет] [Мех] XS S M …»,
 * дальше строки данных. Разделитель — табуляция (из Excel), «;» или «,» (CSV). Столбцы размеров — все,
 * что не распознаны как служебные. Служебные: артикул/код, название, цвет, мех/вид меха, заметка/примечание.
 * Если заголовка нет (первая строка — данные), считаем: артикул + размеры по умолчанию XS…XXL.
 */
export function parsePastedPlan(text: string): ParsedPaste {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  const errors: string[] = [];
  if (lines.length === 0) return { sizes: [], rows: [], errors: ["Вставьте таблицу: первая строка — заголовок с размерами."] };
  const delim = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const cells = (l: string) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, "").trim());

  const SPECIAL: Array<[string, RegExp]> = [
    ["code", /^(артикул|арт\.?|код|модель|article|sku)$/i],
    ["name", /^(название|наименование|имя|name)$/i],
    ["color", /^(цвет|color)$/i],
    ["fur", /^(мех|вид меха|вид|fur)$/i],
    ["notes", /^(заметка|примечание|комментарий|notes?)$/i],
    ["total", /^(итого|всего|total|сумма)$/i],
  ];
  const head = cells(lines[0]);
  const kinds = head.map((h) => SPECIAL.find(([, re]) => re.test(h))?.[0] ?? null);
  const hasHeader = kinds.includes("code") || head.slice(1).some((h) => cleanSize(h) !== "" && (h.toUpperCase() in LETTER_ORDER || /^\d{2}$/.test(h)));

  let colKinds: (string | null)[];
  let colSizes: (string | null)[];
  let dataLines: string[];
  if (hasHeader) {
    colKinds = kinds.map((k, i) => (k ? k : i === 0 && !kinds.includes("code") ? "code" : null));
    colSizes = head.map((h, i) => (colKinds[i] ? null : cleanSize(h) || null));
    dataLines = lines.slice(1);
  } else {
    colKinds = head.map((_, i) => (i === 0 ? "code" : null));
    colSizes = head.map((_, i) => (i === 0 ? null : (LETTER_ORDER[LETTER_SIZES[i - 1]] !== undefined ? LETTER_SIZES[i - 1] : null)));
    dataLines = lines;
  }
  const sizeCols = colSizes.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  const sizes = [...new Set(sizeCols.map((i) => colSizes[i] as string))].sort(compareSizeLabels);
  if (sizeCols.length === 0) errors.push("Не найдены столбцы размеров в заголовке.");

  const rows: PlanRowInput[] = [];
  dataLines.forEach((line, idx) => {
    const c = cells(line);
    const get = (kind: string) => {
      const i = colKinds.indexOf(kind);
      return i >= 0 ? (c[i] ?? "") : "";
    };
    const code = get("code");
    const n = idx + (hasHeader ? 2 : 1);
    if (!code) return errors.push(`Строка ${n}: нет артикула — пропущена.`);
    const q: Record<string, number> = {};
    let bad = false;
    for (const i of sizeCols) {
      const sz = colSizes[i] as string;
      const v = parseCellQty(c[i] ?? "");
      if (v === null) continue;
      if (Number.isNaN(v)) {
        errors.push(`Строка ${n}, размер ${sz}: «${c[i]}» — не целое количество.`);
        bad = true;
        continue;
      }
      q[sz] = (q[sz] ?? 0) + v;
    }
    if (bad) return;
    if (rowTotal(q) <= 0) return errors.push(`Строка ${n} (${code}): все количества пустые или 0 — пропущена.`);
    rows.push({
      articleCode: code.slice(0, 100),
      articleName: get("name").slice(0, 200) || undefined,
      color: get("color").slice(0, 100) || undefined,
      furType: get("fur").slice(0, 100) || undefined,
      notes: get("notes").slice(0, 1000) || undefined,
      sizes: q,
    });
  });
  return { sizes, rows, errors };
}
