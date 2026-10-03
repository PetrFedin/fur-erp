import type { YearFilter } from "@/lib/year-filter";

/** Метка «Год: 2026» рядом с заголовком страницы (скрыта при «Все годы»). Выбор года — в шапке. */
export function YearNote({ year, className = "" }: { year: YearFilter; className?: string }) {
  if (year === "all") return null;
  return (
    <span className={`ml-2 rounded-full border border-neutral-300 bg-white px-2 py-0.5 align-middle text-xs font-medium text-neutral-600 ${className}`}>
      Год: {year}
    </span>
  );
}

/** Пустой результат при выбранном годе: «за 2026 год записей нет». */
export function emptyForYear(year: YearFilter, what: string, fallback: string): string {
  return year === "all" ? fallback : `За ${year} год ${what} нет`;
}
