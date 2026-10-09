import "server-only";
// ТЗ с составом списаний для разделов «ТЗ», «Партии», «Изделия», «Ремонт»: те же данные и те же формулы, что в окне «Стоимость производства» на Главной
// (loadDrillOrders → toDrillOrder), поэтому «Произведено», себестоимость, работа, 4% и шкуры подрядчика сходятся с Главной и между разделами.
import { loadDrillOrders } from "@/lib/dashboard-data";
import type { DashFilters } from "@/lib/dashboard-calc";
import type { DrillOrder } from "@/lib/dashboard-drill";
import type { Commission4Mode } from "@/lib/commission4-mode";
import type { YearFilter } from "@/lib/year-filter";

const EMPTY: DashFilters = { auction: [], fur: [], color: [], attr: [], batch: [], status: [], vat: [], catgroup: [] };

/**
 * Все ТЗ организации (без отменённых) за год. `ids` — оставить только ТЗ из списка страницы (фильтры страницы уже применены),
 * `hides: false` — не относить шкуры подрядчика (когда фильтр страницы их исключает: аукцион, цвет, признак, НДС, вид меха кроме Свакары).
 */
export async function loadOrdersDrill(orgId: string, year: YearFilter, c4: Commission4Mode, opts: { ids?: Set<string> | null; hides?: boolean } = {}): Promise<DrillOrder[]> {
  const all = await loadDrillOrders(orgId, year, EMPTY, c4, "all");
  const list = opts.ids ? all.filter((o) => opts.ids!.has(o.id)) : all;
  if (opts.hides === false) for (const o of list) { o.hI = 0; o.hE = 0; }
  return list;
}
