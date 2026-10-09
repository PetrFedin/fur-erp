// Список годов учёта (чистая функция, можно из клиентских компонентов).
export const FIRST_YEAR = 2025;

/** Годы для переключателя и форм: с 2025 по последний — текущий календарный, самый поздний год в данных или 2026. */
export function availableYears(dataMaxYear?: number | null): string[] {
  const last = Math.max(2026, new Date().getFullYear(), dataMaxYear ?? 0);
  return Array.from({ length: last - FIRST_YEAR + 1 }, (_, i) => String(FIRST_YEAR + i));
}
