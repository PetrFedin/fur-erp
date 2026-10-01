import { z } from "zod";

/** Максимум для денежных полей (Decimal(14,2) вмещает < 1e12). */
export const MAX_MONEY = 999_999_999_999;
/** Максимум для количеств (Decimal(14,3) вмещает < 1e11). */
export const MAX_QTY = 99_999_999_999;

/**
 * Приводит ввод пользователя к числу: убирает пробелы (в т.ч. неразрывные),
 * запятую заменяет точкой. Пустая строка -> undefined, нечисло -> NaN
 * (чтобы валидатор выдал ошибку, а не молча проглотил значение).
 */
export function normalizeNumberInput(v: unknown): unknown {
  if (v == null) return undefined;
  if (typeof v !== "string") return v;
  const t = v.replace(/[\s  ]/g, "").replace(",", ".");
  if (t === "") return undefined;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}

type NumOpts = { positive?: boolean; min?: number; max?: number; int?: boolean };

function numberSchema(label: string, opts: NumOpts) {
  const max = opts.max ?? MAX_MONEY;
  let s = z.number({ message: `${label}: укажите число` }).finite(`${label}: укажите число`);
  if (opts.int) s = s.int(`${label}: значение должно быть целым числом`);
  if (opts.positive) {
    // Количества хранятся с 3 знаками, суммы с 2: меньший минимум округлится в 0 и уронит приёмку/расчёт.
    const minPositive = opts.max === MAX_QTY ? 0.001 : 0.01;
    s = s.min(minPositive, `${label}: значение должно быть не меньше ${String(minPositive).replace(".", ",")}`);
  }
  else s = s.min(opts.min ?? 0, `${label}: значение не может быть отрицательным`);
  return s.max(max, `${label}: слишком большое значение`);
}

/** Обязательное число с нормализацией запятой/пробелов и границами. */
export function zNum(label: string, opts: NumOpts = {}) {
  return z.preprocess(normalizeNumberInput, numberSchema(label, opts));
}

/** Необязательное число: пусто -> undefined, но «abc» — ошибка. */
export function zNumOpt(label: string, opts: NumOpts = {}) {
  return z.preprocess(normalizeNumberInput, numberSchema(label, opts).optional());
}

/** Удобный парсер одиночного значения формы. Возвращает число или текст ошибки. */
export function parseNumber(
  raw: unknown,
  label: string,
  opts: NumOpts = {}
): { value: number } | { error: string } {
  if (normalizeNumberInput(raw) === undefined) return { error: `${label}: укажите значение` };
  const r = zNum(label, opts).safeParse(raw);
  return r.success ? { value: r.data as number } : { error: r.error.issues[0]?.message ?? `${label}: некорректное значение` };
}

/** Убирает NUL и прочие управляющие символы из поискового ввода (иначе Postgres падает). */
export function cleanSearch(v: unknown, maxLen = 100): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLen);
}

/** Экранирует \\, % и _ для contains-запросов Prisma (иначе они работают как маска LIKE). */
export function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => "\\" + c);
}

/** Разбор даты из формы / query: валидная дата в разумных пределах или null. */
export function parseDateInput(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(v.trim())) return null;
  const d = new Date(v.trim());
  if (Number.isNaN(d.getTime())) return null;
  // «2026-02-30» JS молча переносит на март — такую дату отклоняем.
  const [yy, mm, dd] = v.trim().slice(0, 10).split("-").map(Number);
  if (d.getUTCMonth() + 1 !== mm || d.getUTCDate() !== dd || d.getUTCFullYear() !== yy) return null;
  const y = d.getUTCFullYear();
  if (y < 1990 || y > 2100) return null;
  return d;
}

/** Нарушение уникальности Prisma (P2002) — для дружелюбной русской ошибки вместо 500. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
