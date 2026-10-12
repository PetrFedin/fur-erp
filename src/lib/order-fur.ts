// Вид меха ТЗ — единый источник для всех экранов. Сам вид определяет loadOrderRows (analytics-orders.ts): ручной вид ТЗ
// (furTypeOverride) > сырьё из списаний (через справочник меха) > текст артикула и описания (FUR_TEXT_RULES). Здесь — то, что
// делают с этим видом списки и фильтры: разбор «A + B» на виды и добавление видов, которых нет среди лотов
// (например, «Бобр» — сырьё подрядчика, закупки и лотов нет, а изделия из него в ТЗ есть).
import { UNDEFINED_FUR } from "@/lib/product-category";
import type { FilterOption } from "@/lib/filters";

/** Подпись пункта вида меха, у которого нет лотов закупки. */
export const NO_LOTS_FUR_TITLE = "Сырьё подрядчика: лотов закупки нет, есть только изделия в ТЗ";

/** Виды меха одного ТЗ: «Норка + Соболь» → [«Норка», «Соболь»]; «Мех не определён» — пусто. */
export const furKindsOfOrder = (fur: string | null | undefined): string[] =>
  (fur ?? "").split(" + ").map((s) => s.trim()).filter((s) => s && s !== UNDEFINED_FUR);

/** Все виды меха по ТЗ (уникальные, по алфавиту). */
export function orderFurKinds(orders: Iterable<{ fur: string }>): string[] {
  const out = new Set<string>();
  for (const o of orders) for (const k of furKindsOfOrder(o.fur)) out.add(k);
  return Array.from(out).sort((a, b) => a.localeCompare(b, "ru"));
}

/** Список вариантов «Вид меха»: варианты по лотам + виды, которые есть только в ТЗ (с пометкой, что лотов нет). */
export function withOrderFurOptions(base: FilterOption[], orders: Iterable<{ fur: string }>): FilterOption[] {
  const have = new Set(base.map((o) => o.value));
  const extra = orderFurKinds(orders).filter((k) => !have.has(k)).map<FilterOption>((value) => ({ value, label: value, title: NO_LOTS_FUR_TITLE }));
  if (!extra.length) return base;
  return [...base, ...extra].sort((a, b) => a.label.localeCompare(b.label, "ru"));
}
