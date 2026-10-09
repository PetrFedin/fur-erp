import { cookies } from "next/headers";
import { FIRST_YEAR, availableYears } from "./year-list";

// Общий фильтр «Все годы | 2025 | 2026». Не "use client": читается серверными страницами.
// Cookie `yearFilter`: год (2025, 2026, 2027…), всё остальное — все годы.
// Что считается годом записи:
//   закупка — год orderDate; оплата (поставщику и производства) — год paidAt;
//   ТЗ — год workOrderDate (если нет — год endDate/startDate, затем год партии);
//   партия — год даты выпуска/первого ТЗ; аукцион — год его закупок.
export type YearFilter = "all" | `${number}`;
/** Базовые годы учёта. Новые годы (2027…) добавляются сами — см. availableYears. */
export const YEARS = ["2025", "2026"] as const;
export { FIRST_YEAR, availableYears };
export const YEAR_COOKIE = "yearFilter";

export function parseYearCookie(value: string | undefined): YearFilter {
  return value && /^20\d{2}$/.test(value) && Number(value) >= FIRST_YEAR ? (value as YearFilter) : "all";
}

/** Текущий фильтр из cookie (для серверных компонентов). */
export async function getYearFilter(): Promise<YearFilter> {
  const store = await cookies();
  return parseYearCookie(store.get(YEAR_COOKIE)?.value);
}

/** Диапазон дат для Prisma: `where: { orderDate: yearRange(y) }` (undefined — без ограничения). */
export function yearRange(y: YearFilter): { gte: Date; lt: Date } | undefined {
  if (y === "all") return undefined;
  const n = Number(y);
  return { gte: new Date(Date.UTC(n, 0, 1)), lt: new Date(Date.UTC(n + 1, 0, 1)) };
}

/** Попадает ли дата в выбранный год (для фильтрации в памяти). Без даты — только при «Все годы». */
export function inYear(d: Date | string | null | undefined, y: YearFilter): boolean {
  if (y === "all") return true;
  if (!d) return false;
  return new Date(d).getUTCFullYear() === Number(y);
}

export const yearLabel = (y: YearFilter) => (y === "all" ? "все годы" : `${y} год`);
