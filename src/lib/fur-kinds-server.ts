import "server-only";
import { getFilterOptions } from "@/lib/filter-options";
import { loadOrderRows } from "@/lib/analytics-orders";
import { NO_LOTS_FUR_TITLE, withOrderFurOptions } from "@/lib/order-fur";

/**
 * Единый список видов меха для Сырья и Главной: виды по лотам/справочнику + виды, которые есть только в ТЗ (сырьё подрядчика — «Бобр»:
 * лотов закупки нет). noLots — именно такие виды (для строки «—» и страницы вида меха без цен).
 */
export async function loadFurKinds(orgId: string) {
  const [base, orders] = await Promise.all([getFilterOptions(orgId, "all", ["fur"]).then((o) => o.fur), loadOrderRows(orgId, "all", "off")]);
  const options = withOrderFurOptions(base, orders);
  const noLots = options.filter((o) => o.title === NO_LOTS_FUR_TITLE).map((o) => o.value);
  return { options, noLots, orders };
}
