import { formatMoney, formatPercent } from "@/lib/utils";
import { calcPrice, type PriceAgg } from "@/lib/analytics-pricing";
import { UNDEFINED_CATEGORY } from "@/lib/product-category";

export const rub = (x: number) => formatMoney(x.toFixed(2));
export const pct1 = (x: number) => formatPercent(x);
export const orderLabel = (r: { workOrderNumber: string | null; number: string }) => r.workOrderNumber ?? r.number;

export function pricingIssues(a: PriceAgg, base: "mat" | "full") {
  const calcOf = (a: PriceAgg) => calcPrice(a, base, a.price);
  const c = calcOf(a);
  const out: string[] = [];
  if (a.modelId && !a.price) out.push("завести цену");
  if (c.belowCost) out.push("цена ниже себестоимости");
  if (a.noUsages.length) out.push(`ТЗ без состава: ${a.noUsages.length}`);
  if (a.zeroCost.length) out.push(`себестоимость 0: ${a.zeroCost.length}`);
  if (a.noWork.length) out.push(`ТЗ без цены работы: ${a.noWork.length}`);
  if (a.label === UNDEFINED_CATEGORY) out.push("категория не определена");
  return out;
}
