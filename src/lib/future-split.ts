/**
 * Заготовка для будущих разбивок плиток Главной (решение владельца: пока НЕ показываем, в UI не подключено):
 *  — «Выпуск»: завершено / в работе (план);
 *  — «Остаток»: на складе / заказано, но ещё не получено.
 * Чистые функции над уже посчитанным DashboardData: ничего не пересчитывают и не читают из БД, расчёты Главной не затрагивают.
 * Где подключить — docs/future-split.md.
 */
import type { DashboardData } from "@/lib/dashboard-data";

export type IssueSplit = {
  /** Завершённые ТЗ (факт выпуска), шт. */
  doneQty: number;
  /** ТЗ в работе и запланированные (план), шт. */
  inWorkQty: number;
  /** Все ТЗ года, шт. (без ремонта) — то, что показывает плитка «Выпуск» сейчас. */
  totalQty: number;
};

/** «Выпуск»: завершено / в работе. totalQty — число, которое плитка показывает сейчас (done + inWork может отличаться, если у ТЗ есть ремонт — он в обе части не входит). */
export function issueSplit(d: Pick<DashboardData, "prod">): IssueSplit {
  return { doneQty: d.prod.done.qty, inWorkQty: d.prod.work.qty, totalQty: d.prod.all.qty };
}

export type RemainderSplit = {
  /** Остаток меха всего, шт. и ₽ (с НДС / без НДС) — то, что показывает плитка «Остаток» сейчас. */
  totalQty: number;
  totalIncl: number;
  totalExcl: number;
  /** Заказано, но не получено (лотов ещё нет), шт. и ₽. */
  orderedQty: number;
  orderedIncl: number;
  orderedExcl: number;
  /** На складе = остаток всего − заказано. */
  onStockQty: number;
  onStockIncl: number;
  onStockExcl: number;
};

/** «Остаток» меха: на складе / заказано. Источник заказанного — DashboardData.ordered (строки `ordered:*` в syntheticLots входят в «Куплено» и «Остаток»). */
export function remainderSplit(d: Pick<DashboardData, "raw" | "ordered">): RemainderSplit {
  const totalQty = d.raw.fur.incl.remQty;
  const totalIncl = d.raw.fur.incl.remValue;
  const totalExcl = d.raw.fur.excl.remValue;
  const { qty, incl, excl } = d.ordered;
  return { totalQty, totalIncl, totalExcl, orderedQty: qty, orderedIncl: incl, orderedExcl: excl, onStockQty: totalQty - qty, onStockIncl: totalIncl - incl, onStockExcl: totalExcl - excl };
}
