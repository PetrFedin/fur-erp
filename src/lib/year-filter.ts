import { cookies } from "next/headers";

// Общий фильтр «Все годы | 2025 | 2026». Не "use client": читается серверными страницами.
// Cookie `yearFilter`: "2025" | "2026", всё остальное — все годы.
// Что считается годом записи:
//   закупка — год orderDate; оплата (поставщику и производства) — год paidAt;
//   ТЗ — год workOrderDate (если нет — год endDate/startDate, затем год партии);
//   партия — год даты выпуска/первого ТЗ; аукцион — год его закупок.
export type YearFilter = "all" | "2025" | "2026";
export const YEARS = ["2025", "2026"] as const;
export const YEAR_COOKIE = "yearFilter";

export function parseYearCookie(value: string | undefined): YearFilter {
  return value === "2025" || value === "2026" ? value : "all";
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
