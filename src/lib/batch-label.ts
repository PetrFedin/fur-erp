/**
 * Подпись производственной партии (ProductionBatch) с годом: «Партия 5 · 2025».
 * Год — ProductionBatch.year; если он пуст, год выводится по датам ТЗ партии (src/lib/year-scope.ts: orderYearOf) и помечается «≈»;
 * партия без года и без ТЗ — «пусто». Чистые функции без базы.
 */
import { orderYearOf } from "@/lib/year-scope";

type OrderDatesLite = { workOrderDate?: Date | string | null; endDate?: Date | string | null; startDate?: Date | string | null };

/** Год партии по датам её ТЗ: самый частый год; null — у ТЗ нет дат. */
export function derivedBatchYear(orders: OrderDatesLite[]): number | null {
  const counts = new Map<number, number>();
  for (const o of orders) {
    const y = orderYearOf(o);
    if (y != null) counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  let best: number | null = null;
  for (const [y, c] of counts) if (best == null || c > counts.get(best)! || (c === counts.get(best) && y > best)) best = y;
  return best;
}

/** Текст года: «2025», «≈2026» (выведен по ТЗ), «пусто» (в партии нет ТЗ), «без года». */
export function batchYearText(year: number | null | undefined, orders: OrderDatesLite[]): string {
  if (year) return String(year);
  const d = derivedBatchYear(orders);
  if (d != null) return `≈${d}`;
  return orders.length === 0 ? "пусто" : "без года";
}

/** «Партия 5 · 2025». */
export function batchLabel(number: number, year: number | null | undefined, orders: OrderDatesLite[]): string {
  return `Партия ${number} · ${batchYearText(year, orders)}`;
}
