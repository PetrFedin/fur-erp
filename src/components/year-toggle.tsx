"use client";

import { cn } from "@/lib/utils";
import { SEG_GROUP, segCls } from "@/components/segmented";
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
      className={segCls(year === y, "sm")}
    >
      {text}
    </button>
  );
  return (
    <div title={supplier ? HINT_SUPPLIER : HINT} className={cn(SEG_GROUP, pending && "opacity-70")}>
      {btn("all", "Все")}
      {years.map((y) => btn(y as YearFilter, y))}
    </div>
  );
}
