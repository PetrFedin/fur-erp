import { getFreshSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadOrderRows } from "@/lib/analytics-orders";
import { aggregatePricing, calcPrice, defaultMarkupPct, loadModelPrices, parsePricingParams, parseTargetMarkup, recommend } from "@/lib/analytics-pricing";
import { csvNum, csvResponse, toCsv } from "@/lib/csv";

/**
 * CSV «Себестоимость и цены» (UTF-8 с BOM, «;», десятичная запятая). Параметры как у страницы: m, base, view, q, only;
 * год и режим 4% — из cookie. Деньги — с НДС и без НДС отдельными колонками.
 */
export async function GET(request: Request) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const orgId = session.user.organizationId;
  const p = parsePricingParams(Object.fromEntries(new URL(request.url).searchParams));
  const year = await getYearFilter();
  const c4 = await getCommission4Mode();
  const [all, prices] = await Promise.all([loadOrderRows(orgId, year, c4), loadModelPrices(orgId)]);
  const models = aggregatePricing(all, "model", prices);
  const def = defaultMarkupPct(models, p.base);
  const target = parseTargetMarkup(p.m) ?? (def.pct != null ? Math.round(def.pct) : null);
  const list = (p.view === "model" ? models : aggregatePricing(all, "category", prices)).filter(
    (a) => !p.q || `${a.label} ${a.category}`.toLowerCase().includes(p.q.toLowerCase()),
  );
  const c4Label = c4 === "on" ? "с 4%" : "без 4%";
  const u = (a: { unitsCosted: number }, x: number) => (a.unitsCosted > 0 ? csvNum(x / a.unitsCosted) : "");
  const rows = list
    .filter((a) => (p.only === "noprice" ? a.modelId && !a.price : true))
    .map((a) => {
      const c = calcPrice(a, p.base, a.price);
      const r = recommend(a, p.base, target);
      return [
        a.label, a.category, csvNum(a.units, 3), a.orders, csvNum(a.unitsCosted, 3),
        u(a, a.costIncl), u(a, a.costExcl),
        csvNum(a.minUnitIncl), csvNum(a.maxUnitIncl),
        u(a, a.furIncl), u(a, a.liningIncl), u(a, a.c4Incl), u(a, a.expenses), u(a, a.work), u(a, a.vat),
        csvNum(c.baseIncl), csvNum(c.baseExcl),
        a.modelId ? csvNum(a.price) : "", c.markupX != null ? csvNum(c.markupX) : "", c.markupPct != null ? csvNum(c.markupPct, 1) : "", c.marginPct != null ? csvNum(c.marginPct, 1) : "",
        target != null ? csvNum(target, 1) : "", r ? csvNum(r.incl, 0) : "", r ? csvNum(r.excl, 0) : "",
        [a.modelId && !a.price ? "завести цену" : "", c.belowCost ? "цена ниже себестоимости" : "", a.noUsages.length ? `ТЗ без состава: ${a.noUsages.length}` : "", a.zeroCost.length ? `себестоимость 0: ${a.zeroCost.length}` : "", a.noWork.length ? `без цены работы: ${a.noWork.length}` : ""].filter(Boolean).join("; "),
      ];
    });
  const body = toCsv(
    [p.view === "model" ? "Модель" : "Категория", "Категория", "Единиц", "ТЗ", "Единиц с известной себестоимостью",
      `Себестоимость за ед. с НДС (${c4Label})`, `Себестоимость за ед. без НДС (${c4Label})`, "Мин. по ТЗ с НДС", "Макс. по ТЗ с НДС",
      "Мех за ед. (без 4%) с НДС", "Подкладка за ед. (без 4%) с НДС", `4% за ед. с НДС`, "Расходы за ед.", "Работа за ед.", "НДС в материалах за ед.",
      `База наценки за ед. с НДС (${p.base === "full" ? "с работой" : "материалы"})`, `База наценки за ед. без НДС`,
      "Цена", "Наценка ×", "Наценка %", "Маржа %", "Целевой маркап %", "Рекомендуемая цена с НДС (не факт)", "Рекомендуемая цена без НДС (не факт)", "Замечания"],
    rows,
  );
  return csvResponse(`ceny-${p.view}-${year === "all" ? "all" : year}.csv`, body);
}
