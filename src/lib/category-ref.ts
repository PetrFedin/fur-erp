/**
 * Справочник категорий изделий (CategoryRef): чистые функции без обращения к базе. Их используют страница
 * /settings/categories, компонент CategorySelect и скрипт scripts/seed-category-refs.ts.
 *
 * Ключ сравнения (categoryKey): без регистра, «ё»=«е», переводы строк и пробелы схлопнуты. У модели
 * (ProductModel.category) лежит свободный текст («Пальто женское из соболя», «Головной убор\n(ушанка)») —
 * он становится синонимом канонической категории («Пальто», «Головной убор»).
 */
import { categoryHitsFromText, categoryFromText } from "@/lib/product-category";

export type CategoryRefLite = { id: string; name: string; aliases: string[]; confirmed: boolean; note?: string | null };

export function categoryKey(raw: string | null | undefined): string {
  return (raw ?? "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

/** Текст для показа: переводы строк → пробел («Головной убор (ушанка)»). */
export function oneLine(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

export function capitalizeCategory(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function keysOf(ref: CategoryRefLite): string[] {
  return [ref.name, ...ref.aliases].map(categoryKey).filter(Boolean);
}

/** Точное соответствие: название или синоним совпадает с текстом. Только подтверждённые категории. */
export function matchCategoryRef<T extends CategoryRefLite>(raw: string | null | undefined, refs: T[]): T | null {
  const k = categoryKey(raw);
  if (!k) return null;
  for (const r of refs) if (r.confirmed && keysOf(r).includes(k)) return r;
  return null;
}

export type CategorySuggestion<T extends CategoryRefLite> = { ref: T; reason: string; disputed: boolean };

/**
 * Предложение для текста без точного соответствия: ключевое слово категории в тексте.
 * Одна категория — не спорно; несколько («Пальто … с шарфом») — берётся первая по тексту, помечено «спорно».
 */
export function suggestCategoryRef<T extends CategoryRefLite>(raw: string | null | undefined, refs: T[]): CategorySuggestion<T> | null {
  const text = oneLine(raw);
  if (!text) return null;
  const exact = refs.find((r) => keysOf(r).includes(categoryKey(text)));
  if (exact) return { ref: exact, reason: "совпадает с названием или синонимом", disputed: false };
  const hits = categoryHitsFromText(text);
  if (hits.length === 0) return null;
  const first = categoryFromText(text) ?? hits[0];
  const ref = refs.find((r) => categoryKey(r.name) === categoryKey(first));
  if (!ref) return null;
  return { ref, reason: hits.length === 1 ? "ключевое слово в тексте" : `в тексте несколько категорий (${hits.join(", ")})`, disputed: hits.length > 1 };
}
