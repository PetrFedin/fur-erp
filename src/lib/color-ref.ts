/**
 * Справочник цветов (ColorRef): чистые функции без обращения к базе — их используют и страница
 * /settings/colors, и компонент ColorSelect, и скрипт scripts/seed-color-refs.ts.
 *
 * Ключ сравнения (colorKey): без регистра, «ё»=«е», пробелы и скобки схлопнуты. Код вида «239264»
 * (5–7 цифр в конце) — не часть названия цвета: splitColorCode отделяет его.
 */

export type ColorRefLite = { id: string; name: string; aliases: string[]; note?: string | null };

/** Начало примечания у цвета, чьё название/синонимы только предложены и ещё не подтверждены владельцем. */
export const PROPOSED_MARK = "Предложено, ждёт подтверждения";

export function isProposed(note: string | null | undefined): boolean {
  return (note ?? "").trim().startsWith(PROPOSED_MARK);
}

export function colorKey(raw: string | null | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

const CODE_RE = /(?:^|\s)(\d{5,7})\s*$/;

/** «CLOUD 239264» → { base: «CLOUD», code: «239264» }. Без кода code = null. */
export function splitColorCode(raw: string | null | undefined): { base: string; code: string | null } {
  const t = (raw ?? "").trim();
  const m = CODE_RE.exec(t);
  if (!m) return { base: t, code: null };
  return { base: t.slice(0, m.index).trim(), code: m[1] };
}

/** Первая заглавная, остальное как есть: «светло-бежевый» → «Светло-бежевый». */
export function capitalizeColor(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function keysOf(ref: ColorRefLite): string[] {
  return [ref.name, ...ref.aliases].map(colorKey).filter(Boolean);
}

/**
 * Однозначное соответствие: название или синоним совпадает с текстом (после отделения кода).
 * Предложенные (неподтверждённые) цвета сюда не попадают — только подтверждённые.
 */
export function matchColorRef<T extends ColorRefLite>(raw: string | null | undefined, refs: T[]): T | null {
  const { base } = splitColorCode(raw);
  const k = colorKey(base);
  if (!k) return null;
  for (const r of refs) {
    if (isProposed(r.note)) continue;
    if (keysOf(r).includes(k)) return r;
  }
  return null;
}

export type ColorSuggestion<T extends ColorRefLite> = { ref: T; reason: string };

/** Ближайший цвет для значения без справочника: точный синоним (в т.ч. предложенный) → слово из названия внутри текста. */
export function suggestColorRef<T extends ColorRefLite>(raw: string | null | undefined, refs: T[]): ColorSuggestion<T> | null {
  const { base } = splitColorCode(raw);
  const k = colorKey(base);
  if (!k) return null;
  if (/[;×]|(?:^|\s)x\d/.test(k)) return null; // смешанное значение («синий x2, черный x1») — разнести вручную
  for (const r of refs) if (keysOf(r).includes(k)) return { ref: r, reason: "совпадает с названием или синонимом" };
  const words = k.split(/[\s()/,.;-]+/).filter((w) => w.length >= 3);
  let best: { ref: T; score: number } | null = null;
  for (const r of refs) {
    let score = 0;
    for (const key of keysOf(r)) {
      if (key.length >= 3 && k.includes(key)) score = Math.max(score, key.length + 10);
      else for (const w of words) if (w.length >= 4 && (key.includes(w) || w.includes(key))) score = Math.max(score, Math.min(w.length, key.length));
    }
    if (score > 0 && (!best || score > best.score)) best = { ref: r, score };
  }
  return best ? { ref: best.ref, reason: "похоже по написанию" } : null;
}
