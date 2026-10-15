"use client";

import { cn } from "@/lib/utils";
import { useYearDisplay } from "@/lib/year-display";
import type { YearFilter } from "@/lib/year-filter";

const HINT = "Год: закупки по дате заказа, оплаты по дате платежа, ТЗ по дате ТЗ. Действует на всех страницах.";

// В кабинете поставщика про оплаты не говорим: он их не видит.
const HINT_SUPPLIER = "Год: расчёты и закупки по дате аукциона, ТЗ по дате ТЗ. Действует на всех страницах.";

/** Переключатель «Все | 2025 | 2026 | …» в шапке: новые годы появляются сами. */
export function YearToggle({ supplier = false }: { supplier?: boolean }) {
  const { year, setYear, pending, years } = useYearDisplay();
  const btn = (y: YearFilter, text: string) => (
    <button
      key={y}
      type="button"
      onClick={() => year !== y && setYear(y)}
      aria-pressed={year === y}
      className={cn(
        "rounded-sm px-2 py-1 font-medium transition-colors max-md:min-h-8",
        year === y ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-900",
      )}
    >
      {text}
    </button>
  );
  return (
    <div title={supplier ? HINT_SUPPLIER : HINT} className={cn("flex items-center rounded-md border border-neutral-300 bg-white p-0.5 text-xs", pending && "opacity-70")}>
      {btn("all", "Все")}
      {years.map((y) => btn(y as YearFilter, y))}
    </div>
  );
}
