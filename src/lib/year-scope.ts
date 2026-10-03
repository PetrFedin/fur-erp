// Общий год (cookie yearFilter) для страниц сырья, закупок и производства.
// Даты записей: закупка/лот/аукцион — orderDate закупки; ТЗ — workOrderDate
// (если нет — endDate, затем startDate, затем год партии); партия — по датам её ТЗ.
import { Prisma } from "@prisma/client";
import { yearRange, type YearFilter } from "./year-filter";

export type { YearFilter };

/** Условие по дате закупки для Prisma-запроса к Purchase: `where: { ...purchaseYear(y) }`. */
export function purchaseYear(y: YearFilter): Prisma.PurchaseWhereInput {
  const r = yearRange(y);
  return r ? { orderDate: r } : {};
}

/** Условие для лотов (RawMaterialLot): по дате закупки, из которой пришёл лот. Лоты без закупки при выбранном годе не показываются. */
export function lotYear(y: YearFilter): Prisma.RawMaterialLotWhereInput {
  const r = yearRange(y);
  return r ? { purchase: { orderDate: r } } : {};
}

type OrderDates = {
  workOrderDate?: Date | string | null;
  endDate?: Date | string | null;
  startDate?: Date | string | null;
  batch?: { year: number | null } | null;
};

/** Дата ТЗ для фильтра года: workOrderDate → endDate → startDate. Нет дат — null (тогда по году партии). */
export function orderDateOf(o: OrderDates): Date | null {
  const d = o.workOrderDate ?? o.endDate ?? o.startDate;
  return d ? new Date(d) : null;
}

/** Год ТЗ: по его дате, иначе по году партии; иначе null. */
export function orderYearOf(o: OrderDates): number | null {
  const d = orderDateOf(o);
  if (d) return d.getUTCFullYear();
  return o.batch?.year ?? null;
}

/** Попадает ли ТЗ в выбранный год. */
export function orderInYear(o: OrderDates, y: YearFilter): boolean {
  if (y === "all") return true;
  return orderYearOf(o) === Number(y);
}

/** Prisma-условие для ТЗ — то же правило, что orderInYear (дата ТЗ, иначе год партии). */
export function orderYearWhere(y: YearFilter): Prisma.ProductionOrderWhereInput {
  const r = yearRange(y);
  if (!r) return {};
  return {
    OR: [
      { workOrderDate: r },
      { workOrderDate: null, endDate: r },
      { workOrderDate: null, endDate: null, startDate: r },
      { workOrderDate: null, endDate: null, startDate: null, batch: { year: Number(y) } },
    ],
  };
}

/** «Год: 2026» для заголовка; пусто при «Все годы». */
export const yearCaption = (y: YearFilter) => (y === "all" ? "" : `Год: ${y}`);

/** «за 2026 год записей нет» для пустого результата. */
export const emptyYearText = (y: YearFilter, what = "записей") => (y === "all" ? "" : `за ${y} год ${what} нет`);
