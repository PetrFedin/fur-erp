/**
 * Единый реестр единиц измерения для подписей колонок и итогов.
 * Правило: подпись = «Название» + единица (отдельной мелкой строкой через <TH label unit />
 * или после запятой: headerText("Сумма", UNIT.rub) → «Сумма, ₽»).
 * Запрещены в заголовках: «руб.», «р.», «RUB», «USD», «долл.», «шт» (без точки), «пог.м», «м.п.», «м.».
 * Колонки без единицы (названия, даты, номера, статусы) — без единицы, по левому краю.
 */
export const UNIT = {
  rub: "₽",
  usd: "$",
  pcs: "шт.",
  m: "м",
  pct: "%",
  rubPerPcs: "₽/шт.",
  usdPerPcs: "$/шт.",
  rubPerM: "₽/м",
  usdPerM: "$/м",
  rubPerItem: "₽/изд.",
  pcsPerItem: "шт./изд.",
  mPerItem: "м/изд.",
} as const;

export type UnitKey = keyof typeof UNIT;

/** «Название, ед.» — для мест, где допустима только одна строка (title, aria-label, CSV). */
export function headerText(label: string, unit?: string | null): string {
  return unit ? `${label}, ${unit}` : label;
}

/** Разбор «Сумма, ₽» → { label: "Сумма", unit: "₽" }; без запятой — только название. */
export function splitHeader(text: string): { label: string; unit?: string } {
  const i = text.lastIndexOf(", ");
  if (i < 0) return { label: text };
  const unit = text.slice(i + 2).trim();
  if (/^(₽|\$|шт\.|м|%|₽\/(шт\.|м|изд\.)|\$\/(шт\.|м)|шт\.\/изд\.|м\/изд\.)$/.test(unit)) return { label: text.slice(0, i), unit };
  return { label: text };
}

/** Запрещённые написания единиц в заголовках (проверка при ревью: grep по этому выражению). */
export const BANNED_UNIT_RE = /(руб\.?|\bр\.|\bRUB\b|\bUSD\b|долл\.?|пог\.?\s?м|м\.п\.|\bшт\b(?!\.))/i;
