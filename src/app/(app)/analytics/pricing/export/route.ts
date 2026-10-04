import { getFreshSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadOrderRows } from "@/lib/analytics-orders";
import { aggregatePricing, calcPrice, defaultMarkupPct, loadModelPrices, parsePricingParams, parsePricingSort, parseTargetMarkup, recommend, sortPricing } from "@/lib/analytics-pricing";
import { applyShared } from "@/lib/analytics-filters";
import { derived } from "@/lib/analytics-metrics";
import { csvNum, csvResponse, toCsv } from "@/lib/csv";

/**
 * CSV «Себестоимость и цены» (UTF-8 с BOM, «;», десятичная запятая). Параметры как у страницы: m, base, view, only, sort, dir
 * и все общие фильтры (цвет, мех, категория, размер, партия, сезон, НДС, диапазон себестоимости, молоток/подкладка, q …);
 * год и режим 4% — из cookie. part=lots — список лотов артикулов (с молотком). Деньги — с НДС и без НДС отдельными колонками.
 */
export async function GET(request: Request) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const orgId = session.user.organizationId;
  const url = new URL(request.url);
  const sp: Record<string, string | string[]> = {};
  for (const k of new Set(url.searchParams.keys())) sp[k] = url.searchParams.getAll(k);
  const p = parsePricingParams(sp);
  const year = await getYearFilter();
  const c4 = await getCommission4Mode();
  const [allYear, prices] = await Promise.all([loadOrderRows(orgId, year, c4), loadModelPrices(orgId)]);
  const all = applyShared(allYear, p);
  const models = aggregatePricing(all, "model", prices);
  const def = defaultMarkupPct(models, p.base);
  const target = parseTargetMarkup(p.m) ?? (def.pct != null ? Math.round(def.pct) : null);
  const s = parsePricingSort(p.sort, p.dir);
  const stamp = year === "all" ? "all" : year;
  const c4Label = c4 === "on" ? "с 4%" : "без 4%";

  if (url.searchParams.get("part") === "lots") {
    const rows = models.flatMap((a) =>
      a.lots.map((l) => [
        a.label, l.lotNumber, l.rawName, l.isLining ? "подкладка" : "мех", l.grade, l.color, l.purchaseNumber, l.auction,
        csvNum(l.qty, 3), csvNum(l.qty > 0 ? l.incl / l.qty : null), csvNum(l.qty > 0 ? l.excl / l.qty : null),
        csvNum(l.hammerIncl), csvNum(l.hammerExcl), csvNum(l.hammerUsd), l.orders,
      ]),
    );
    return csvResponse(
      `ceny-lots-${stamp}.csv`,
      toCsv(["Модель", "Лот", "Материал", "Тип", "Сорт", "Цвет", "Закупка", "Аукцион", "Списано", "Цена за ед. с НДС", "Цена за ед. без НДС", "Молоток за шкуру с НДС", "Молоток за шкуру без НДС", "Молоток, $", "ТЗ"], rows),
    );
  }

  const listAll = p.view === "model" ? models : aggregatePricing(all, p.view, prices);
  const list = sortPricing(listAll, s.sort, s.dir, p.base, target).filter((a) => (p.only === "noprice" ? a.modelId && !a.price : true));
  const u = (a: { unitsCosted: number }, x: number) => (a.unitsCosted > 0 ? csvNum(x / a.unitsCosted) : "");
  const pc = (x: number | null) => (x == null ? "" : csvNum(x * 100, 1));
  const rows = list.map((a) => {
    const c = calcPrice(a, p.base, a.price);
    const r = recommend(a, p.base, target);
    const d = derived(a.m);
    const seasons = Array.from(new Set(a.rows.map((x) => x.seasonCode).filter(Boolean))).join(", ");
    return [
      a.label, a.salesCode, a.category, a.modelId ? a.fur : "", csvNum(a.units, 3), a.orders, csvNum(a.unitsCosted, 3), seasons,
      csvNum(a.m.skins, 3), csvNum(d.skinsPerUnit, 3), csvNum(a.m.liningM, 3), csvNum(d.liningPerUnit, 3),
      csvNum(d.furPerUnit?.incl), csvNum(d.furPerUnit?.excl), csvNum(d.furPerSkin?.incl), csvNum(d.furPerSkin?.excl),
      csvNum(d.hammerPerSkin?.incl), csvNum(d.hammerPerSkin?.excl), pc(d.hammerSkinShare), a.m.lotsHammer, a.m.lots,
      csvNum(d.workPerUnit),
      u(a, a.costIncl), u(a, a.costExcl), csvNum(a.minUnitIncl), csvNum(a.maxUnitIncl),
      csvNum(d.fullPerUnit?.incl), csvNum(d.fullPerUnit?.excl), csvNum(a.m.minFullIncl), csvNum(a.m.maxFullIncl),
      u(a, a.furIncl), u(a, a.liningIncl), u(a, a.c4Incl), u(a, a.expenses), u(a, a.work), u(a, a.vat),
      pc(d.shFur), pc(d.shLining), pc(d.shC4), pc(d.shWork), pc(d.shExpenses),
      csvNum(c.baseIncl), csvNum(c.baseExcl),
      a.modelId ? csvNum(a.price) : "", c.markupX != null ? csvNum(c.markupX) : "", c.markupPct != null ? csvNum(c.markupPct, 1) : "", c.marginPct != null ? csvNum(c.marginPct, 1) : "",
      target != null ? csvNum(target, 1) : "", r ? csvNum(r.incl, 0) : "", r ? csvNum(r.excl, 0) : "",
      [a.modelId && !a.price ? "завести цену" : "", c.belowCost ? "цена ниже себестоимости" : "", a.noUsages.length ? `ТЗ без состава: ${a.noUsages.length}` : "", a.zeroCost.length ? `себестоимость 0: ${a.zeroCost.length}` : "", a.noWork.length ? `без цены работы: ${a.noWork.length}` : ""].filter(Boolean).join("; "),
    ];
  });
  const body = toCsv(
    [
      p.view === "model" ? "Модель" : p.view === "category" ? "Категория" : p.view === "fur" ? "Вид меха" : "Мех · категория", "Код продаж", "Категория", "Вид меха", "Единиц", "ТЗ", "Единиц с известной себестоимостью", "Сезоны",
      "Шкур", "Шкур на ед.", "Подкладка, м", "Подкладка, м на ед.",
      `Мех за ед. с НДС (${c4Label})`, `Мех за ед. без НДС (${c4Label})`, `Мех за шкуру с НДС (${c4Label})`, `Мех за шкуру без НДС (${c4Label})`,
      "Молоток за шкуру с НДС", "Молоток за шкуру без НДС", "Молоток: доля шкур с данными, %", "Молоток: лотов с данными", "Молоток: лотов всего",
      "Работа за ед.",
      `Себестоимость за ед. с НДС (${c4Label})`, `Себестоимость за ед. без НДС (${c4Label})`, "Мин. по ТЗ с НДС", "Макс. по ТЗ с НДС",
      `Полная себестоимость за ед. с НДС (${c4Label})`, `Полная себестоимость за ед. без НДС (${c4Label})`, "Полная мин. с НДС", "Полная макс. с НДС",
      "Мех за ед. (без 4%) с НДС", "Подкладка за ед. (без 4%) с НДС", `4% за ед. с НДС`, "Расходы за ед.", "Работа за ед. (по ТЗ с себестоимостью)", "НДС в материалах за ед.",
      "Доля меха, %", "Доля подкладки, %", "Доля 4%, %", "Доля работы, %", "Доля расходов, %",
      `База наценки за ед. с НДС (${p.base === "full" ? "с работой" : "материалы"})`, `База наценки за ед. без НДС`,
      "Цена", "Наценка ×", "Наценка %", "Маржа %", "Целевой маркап %", "Рекомендуемая цена с НДС (не факт)", "Рекомендуемая цена без НДС (не факт)", "Замечания",
    ],
    rows,
  );
  return csvResponse(`ceny-${p.view}-${stamp}.csv`, body);
}
