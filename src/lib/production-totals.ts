// ЕДИНОЕ определение «произведено» и «в работе» для всего приложения (Сводка, ТЗ, партии, изделия, аналитика, печать).
//
//   • Произведено = выпуск (producedQuantity) ТЗ в статусе «Завершён». Только они.
//   • В работе    = плановое количество (plannedQuantity) ТЗ «В работе» и «Запланировано»; себестоимость — по списаниям на сегодня.
//   • Отменённые ТЗ не считаются нигде.
// «Произведено» и «в работе» показываются ОТДЕЛЬНО и никогда не складываются в одно число.
// Любое место, где нужно количество изделий по ТЗ, берёт его отсюда — не из producedQuantity/plannedQuantity напрямую.

export type TzStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | (string & {});
type Qty = number | string | { toString(): string };
export type TzQty = { status: TzStatus; plannedQuantity: Qty; producedQuantity: Qty };

const num = (v: Qty) => {
  const n = Number(v.toString());
  return Number.isFinite(n) ? n : 0;
};

export const isProducedStatus = (s: TzStatus) => s === "COMPLETED";
export const isInWorkStatus = (s: TzStatus) => s === "IN_PROGRESS" || s === "PLANNED";

/** Произведено по ТЗ: выпуск завершённого ТЗ, иначе 0. */
export const producedUnits = (o: TzQty) => (isProducedStatus(o.status) ? num(o.producedQuantity) : 0);
/** В работе по ТЗ: плановое количество ТЗ «В работе» / «Запланировано», иначе 0. */
export const inWorkUnits = (o: TzQty) => (isInWorkStatus(o.status) ? num(o.plannedQuantity) : 0);
/** Количество изделий ТЗ для расчёта на единицу и цены работы: выпуск у завершённого, план у ТЗ в работе, 0 у отменённого. */
export const orderUnits = (o: TzQty) => producedUnits(o) + inWorkUnits(o);

export type ProductionSplit = { producedOrders: number; producedUnits: number; inWorkOrders: number; inWorkUnits: number };

/** Две отдельные суммы: произведено (завершённые) и в работе (запланированные + в работе). */
export function productionSplit(orders: Iterable<TzQty>): ProductionSplit {
  const t: ProductionSplit = { producedOrders: 0, producedUnits: 0, inWorkOrders: 0, inWorkUnits: 0 };
  for (const o of orders) {
    if (isProducedStatus(o.status)) { t.producedOrders += 1; t.producedUnits += num(o.producedQuantity); }
    else if (isInWorkStatus(o.status)) { t.inWorkOrders += 1; t.inWorkUnits += num(o.plannedQuantity); }
  }
  return t;
}

/** «1 234 шт. · в работе 56 шт.» — произведено и в работе рядом, но отдельными числами. */
export function producedAndInWork(produced: number, inWork: number, fmt: (v: number) => string = (v) => String(v)): string {
  return `${fmt(produced)} шт.${inWork > 0 ? ` · в работе ${fmt(inWork)} шт.` : ""}`;
}

/** Одинаковые подписи везде. */
export const PRODUCED_LABEL = "Произведено";
export const IN_WORK_LABEL = "В работе";
export const PRODUCED_RULE = "Произведено — выпуск ТЗ в статусе «Завершён».";
export const IN_WORK_RULE = "В работе — план ТЗ «В работе» и «Запланировано»; себестоимость — по списаниям сырья на сегодня.";
