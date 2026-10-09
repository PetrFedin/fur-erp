import { Fragment } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { buttonVariants } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix, sumUsagesWith4 } from "@/lib/commission4";
import { getYearFilter, yearRange } from "@/lib/year-filter";
import { orderYearWhere } from "@/lib/year-scope";
import { YearNote, emptyForYear } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { formatMoney } from "@/lib/utils";
import { compareModelNames } from "@/lib/model-code";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { ArticlePriceForm } from "./price-form";
import { SHIPMENT_STATUS, summarizeLines } from "@/lib/shipments";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, parseFilters, pick, stateParam } from "@/lib/filters";
import { articleModelWhere, hasLiningText, isTzFilterActive, matchedOrderIds, tzOptions } from "@/lib/article-filters";
import { getFilterOptions } from "@/lib/filter-options";
import { loadOrderRows } from "@/lib/analytics-orders";
import { ArticleDialog } from "./article-dialog";
import { getFurIndex } from "@/lib/fur-ref-server";
import { canonicalFur } from "@/lib/fur-ref";
import { ArticleName } from "@/components/article-name";
import { articleLabel } from "@/lib/article-label";

export const metadata = { title: "Изделия" };

// Фильтры «Изделий». Уровень модели: поиск, категория, цена. Уровень ТЗ (остальные): модель остаётся в списке, если у неё есть ТЗ,
// подходящее под ВСЕ выбранные условия; её ср. взвеш. себестоимость и число ТЗ считаются только по таким ТЗ.
// «Год ТЗ» (tzyear) — дополнительный фильтр внутри общего года из шапки (cookie), общий год не заменяет.
const ARTICLE_FILTERS = defineFilters({
  ...pick(["q", "category", "fur", "color", "size", "season", "batch"], { q: { label: "Поиск" }, fur: { label: "Вид (тип) меха" }, batch: { label: "Партия" } }),
  lining: { kind: "multi", label: "Подкладка", allowed: ["yes", "no"] },
  tzyear: { kind: "multi", label: "Год ТЗ", pattern: /^\d{4}$/ },
  tz: { kind: "multi", label: "ТЗ", maxLen: 60 },
  price: { kind: "multi", label: "Цена", allowed: ["yes", "no"] },
  empty: stateParam("Состав списка", { allowed: ["1"] }),
});

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseFilters(ARTICLE_FILTERS, await searchParams);
  const q = f.q;
  const showEmpty = f.empty === "1";
  const session = await requireSession();
  const c4Mode = await getCommission4Mode();
  const year = await getYearFilter();
  const furIdx = await getFurIndex(session.user.organizationId);
  const c4 = c4Suffix(c4Mode);
  const canCreate = hasRole(session.user.role, ACCESS.models);
  const orgId = session.user.organizationId;
  const [stocks, shipments] = await Promise.all([
    prisma.finishedGoodsStock.findMany({
      where: { organizationId: orgId },
      include: { warehouse: true },
    }),
    prisma.shipment.findMany({
      where: { organizationId: orgId, lines: { some: {} }, ...(yearRange(year) ? { plannedDate: yearRange(year) } : {}) },
      include: {
        lines: {
          orderBy: { id: "asc" },
          select: {
            size: true,
            quantity: true,
            productionOrder: { select: { productModelId: true, number: true, workOrderNumber: true } },
          },
        },
      },
      orderBy: { plannedDate: "desc" },
    }),
  ]);
  const articleOpts = await getFilterOptions(orgId, year, ["category"]);

  // ТЗ общего года (без отменённых) со значениями для фильтров: вид меха, цвет, размер, сезон, партия — как в аналитике.
  const [orderRows, liningTexts] = await Promise.all([
    loadOrderRows(orgId, year, c4Mode),
    prisma.productionOrder.findMany({ where: { organizationId: orgId }, select: { id: true, lining: true } }),
  ]);
  const liningById = new Map(liningTexts.map((o) => [o.id, hasLiningText(o.lining)]));
  const tzActive = isTzFilterActive(f);
  const matchedIds = matchedOrderIds(orderRows, liningById, f);
  const tzWhere = matchedIds ? { id: { in: matchedIds } } : {};
  const tzOpts = tzOptions(orderRows);

  const models = await prisma.productModel.findMany({
    where: articleModelWhere(orgId, f),
    include: {
      _count: { select: { productionOrders: { where: { ...orderYearWhere(year), ...tzWhere } } } },
      productionOrders: {
        // Общий год: себестоимость модели — по завершённым ТЗ выбранного года (дата ТЗ → конец → начало → год партии).
        where: { status: "COMPLETED", ...orderYearWhere(year), ...tzWhere },
        select: {
          unitCost: true,
          producedQuantity: true,
          materialUsages: {
            select: {
              quantity: true,
              totalCost: true,
              commission4: true,
              rawMaterial: { select: { name: true, unit: true } },
              lot: { select: { materialCostExclVat: true, expenseCostExclVat: true, unitCost: true, vatRate: true } },
            },
          },
          expenses: { select: { amount: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const rows0 = models.map((m) => {
    const totalProduced = m.productionOrders.reduce((s, o) => s.add(o.producedQuantity), new Decimal(0));
    const totalCost = m.productionOrders.reduce(
      (s, o) => s.add((o.unitCost ?? new Decimal(0)).mul(o.producedQuantity)),
      new Decimal(0)
    );
    // Excl-VAT counterpart of totalCost above, computed live from each
    // order's own materialUsages/expenses — same approach as
    // production/[id]'s estimatedUnitCostExclVat, since there is no stored
    // excl-VAT snapshot column for unitCost (see schema comment). Production
    // expenses carry no VAT at all, so they contribute the same amount to
    // both incl- and excl-VAT totals.
    // Режим «С 4%»: надбавка по сырью и подкладке каждого ТЗ (строки списаний с
    // commission4 = true); снимки unitCost хранятся «без 4%» и не меняются.
    let extra4Incl = new Decimal(0);
    let extra4Excl = new Decimal(0);
    const totalCostExclVat = m.productionOrders.reduce((s, o) => {
      const orderExpenseCost = o.expenses.reduce((es, e) => es.add(e.amount), new Decimal(0));
      const mats = sumUsagesWith4(o.materialUsages, c4Mode);
      extra4Incl = extra4Incl.add(mats.extraIncl);
      extra4Excl = extra4Excl.add(mats.extraExcl);
      return s.add(mats.excl.add(orderExpenseCost));
    }, new Decimal(0));
    // 4% «как будто включён» — для подсказки (не зависит от переключателя).
    const extraOn = m.productionOrders.reduce((s, o) => s.add(sumUsagesWith4(o.materialUsages, "on").extraIncl), new Decimal(0));
    const avgUnitCost = totalProduced.greaterThan(0) ? totalCost.add(extra4Incl).div(totalProduced).toDecimalPlaces(2) : null;
    const avgUnitCostExclVat = totalProduced.greaterThan(0) ? totalCostExclVat.div(totalProduced).toDecimalPlaces(2) : null;
    // Доля 4% в себестоимости модели: по ней пересчитывается себестоимость остатка на складе
    // (у остатка нет своей разбивки по ТЗ). Нет завершённых ТЗ — показываем «без 4%».
    const baseAvg = totalProduced.greaterThan(0) ? totalCost.div(totalProduced) : null;
    const c4Ratio = c4Mode === "on" && baseAvg && baseAvg.greaterThan(0) && avgUnitCost ? avgUnitCost.div(baseAvg) : null;
    const c4Missing = c4Mode === "on" && c4Ratio === null;
    const avgOn = baseAvg ? totalCost.add(extraOn).div(totalProduced).toDecimalPlaces(2) : null;
    const ratioOn = baseAvg && baseAvg.greaterThan(0) && avgOn ? avgOn.div(baseAvg) : null;
    const markup = m.sellingPrice && avgUnitCost && avgUnitCost.greaterThan(0) ? m.sellingPrice.div(avgUnitCost) : null;

    // Основной вид меха модели — по наибольшей стоимости списанного меха в её ТЗ (для средней наценки по сырью).
    const furCost = new Map<string, number>();
    for (const o of m.productionOrders) for (const u of o.materialUsages) {
      if (!u.rawMaterial || u.rawMaterial.unit === "M") continue;
      const fn = canonicalFur(u.rawMaterial.name, furIdx)?.name ?? u.rawMaterial.name;
      furCost.set(fn, (furCost.get(fn) ?? 0) + u.totalCost.toNumber());
    }
    const primaryFur = Array.from(furCost.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const modelStocks = stocks.filter((st) => st.productModelId === m.id);
    const stockQty = modelStocks.reduce((sum, st) => sum.add(st.quantity), new Decimal(0));
    // Себестоимость единицы — одно число (с одним округлением до копеек) и в таблице, и в раскрытии, и в стоимости остатка.
    const unitOf = (st: (typeof modelStocks)[number]) => avgUnitCost ?? st.avgUnitCost.mul(c4Ratio ?? 1).toDecimalPlaces(2);
    const stockValue = modelStocks.reduce((sum, st) => sum.add(st.quantity.mul(unitOf(st))), new Decimal(0));
    // Excl-VAT стоимость остатка: остаток × средневзвешенная себестоимость без НДС по
    // завершённым ТЗ модели (отдельного снимка нет). Нет данных — берём с НДС.
    // Для подсказки: стоимость остатка без 4% и с 4% (не зависит от переключателя); нет разбивки по ТЗ — 4% не посчитан.
    const stockBase = modelStocks.reduce((sum, st) => sum.add(st.quantity.mul(baseAvg ? baseAvg.toDecimalPlaces(2) : st.avgUnitCost)), new Decimal(0));
    const stockOn = modelStocks.reduce((sum, st) => sum.add(st.quantity.mul(avgOn ?? st.avgUnitCost.mul(ratioOn ?? 1).toDecimalPlaces(2))), new Decimal(0));
    const stockNoC4Data = stockQty.greaterThan(0) && ratioOn === null;
    const stockValueExclVat = avgUnitCostExclVat ? stockQty.mul(avgUnitCostExclVat) : stockValue;
    // Последние 10 отгрузок, где есть ТЗ этой модели (показываем только строки этой модели).
    const modelShipments = shipments
      .map((sh) => ({ sh, lines: sh.lines.filter((l) => l.productionOrder.productModelId === m.id) }))
      .filter((x) => x.lines.length > 0)
      .slice(0, 10);

    return {
      id: m.id,
      name: m.name,
      model: { name: m.name, category: m.category, salesCode: m.salesCode, salesName: m.salesName, sku: m.sku },
      isActive: m.isActive,
      orderCount: m._count.productionOrders,
      modelStocks,
      stockQty,
      stockValue,
      stockValueExclVat,
      stockBase,
      stockOn,
      stockNoC4Data,
      baseAvg,
      avgOn,
      unitOf,
      modelShipments,
      totalProduced,
      totalCost,
      totalCostExclVat,
      extra4Incl,
      extra4Excl,
      avgUnitCost,
      avgUnitCostExclVat,
      c4Ratio,
      c4Missing,
      sellingPrice: m.sellingPrice,
      markup,
      primaryFur,
    };
  });

  // Строки с нулевым остатком готовой продукции скрыты по умолчанию (?empty=1 — показать).
  // При поиске по названию показываем всё найденное, чтобы нужную модель не пришлось искать по скрытым.
  // За выбранный год показываем модели, по которым в этом году были ТЗ (остаток на складе — текущий, без даты).
  // Фильтры по ТЗ (вид меха, подкладка, год ТЗ, ТЗ, партия, цвет, размер, сезон): остаются модели, у которых есть подходящие ТЗ.
  const baseRows = year === "all" ? rows0.filter((r) => r.stockQty.greaterThan(0)) : rows0.filter((r) => r.orderCount > 0);
  const emptyCount = tzActive ? 0 : rows0.length - baseRows.length;
  const modelFilterOn = !!q || f.category.length > 0 || f.price.length > 0;
  const rows = (tzActive ? rows0.filter((r) => r.orderCount > 0) : showEmpty || modelFilterOn ? rows0 : baseRows).sort((a, b) => {
    const wa = a.stockQty.greaterThan(0) || a.orderCount > 0 ? 0 : 1;
    const wb = b.stockQty.greaterThan(0) || b.orderCount > 0 ? 0 : 1;
    return wa - wb || compareModelNames(a.name, b.name);
  });
  const totalStockValue = rows.reduce((s, r) => s.add(r.stockValue), new Decimal(0));
  const totalStockValueExclVat = rows.reduce((s, r) => s.add(r.stockValueExclVat), new Decimal(0));
  // Таблица «мех × категория»: число моделей, средняя розничная цена и средняя наценка (модели с ценой и себестоимостью).
  type Agg = { n: number; price: number; markup: number };
  // Средневзвешенные по выпуску (завершённые ТЗ): цена = Σ(цена × выпуск) ÷ Σ выпуск; маркап = Σ(цена × выпуск) ÷ Σ(себестоимость ед. × выпуск).
  const aggOf = (list: typeof rows): Agg | null => {
    const priced = list.filter((r) => r.markup && r.sellingPrice && r.avgUnitCost && r.totalProduced.greaterThan(0));
    if (priced.length === 0) return null;
    const w = (r: (typeof priced)[number]) => r.totalProduced.toNumber();
    const sumW = priced.reduce((a, r) => a + w(r), 0);
    const retail = priced.reduce((a, r) => a + r.sellingPrice!.toNumber() * w(r), 0);
    const cost = priced.reduce((a, r) => a + r.avgUnitCost!.toNumber() * w(r), 0);
    return { n: priced.length, price: retail / sumW, markup: cost > 0 ? retail / cost : 0 };
  };
  const catOf = (r: (typeof rows)[number]) => r.model.category?.trim() || "Без категории";
  const furGroups = Array.from(new Set(rows.filter((r) => r.markup && r.primaryFur).map((r) => r.primaryFur!)))
    .map((fur) => {
      const inFur = rows.filter((r) => r.primaryFur === fur);
      const cats = Array.from(new Set(inFur.filter((r) => r.markup).map(catOf)))
        .map((cat) => ({ cat, agg: aggOf(inFur.filter((r) => catOf(r) === cat))! }))
        .filter((c) => c.agg)
        .sort((x, y) => y.agg.markup - x.agg.markup);
      return { fur, total: aggOf(inFur)!, cats };
    })
    .filter((g) => g.total)
    .sort((x, y) => y.total.markup - x.total.markup);
  const markupTotal = aggOf(rows);
  const fmtX = (v: number) => `×${v.toFixed(2).replace(".", ",")}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* «i» и метка года — рядом с заголовком, а не внутри: иначе имя заголовка читается как «Изделия О странице…». */}
        <div className="flex flex-wrap items-center">
          <h1 className="text-xl font-semibold">Изделия</h1>
          <YearNote year={year} />
          <span className="ml-2 inline-flex">
          <InfoHint label="О странице «Изделия»" wide>
            <p>Модели, остаток готовой продукции на складах, средневзвешенная себестоимость единицы, розничная цена и наценка.</p>
            <p className="mt-1">
              <b>Год ({year === "all" ? "все годы" : year}):</b> себестоимость, число ТЗ и состав списка берутся по ТЗ выбранного года (дата ТЗ, иначе окончание или начало, иначе год партии). Остаток на складе — текущий, у него нет даты, поэтому от года не зависит. Отгрузки в раскрытии — по плановой/фактической дате.
            </p>
            <p className="mt-1">
              <b>Себестоимость единицы</b> = Σ(себестоимость ТЗ × выпуск) ÷ Σ выпуск по завершённым ТЗ модели — взвешено по количеству.
            </p>
            <p className="mt-1">
              <b>Наценка</b> = розничная цена ÷ средневзвешенная себестоимость единицы.
            </p>
            <p className="mt-1">«С 4%» добавляет 4% к сырью и подкладке каждого ТЗ (кроме ТЗ без 4%, например партия 6); работа не облагается.</p>
            {canCreate && <p className="mt-1">Розничную цену можно ввести прямо в таблице: Enter или переход в другое поле сохраняет её.</p>}
          </InfoHint>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/analytics/products" className={buttonVariants({ variant: "outline" })}>
            Аналитика изделий и цены
          </Link>
          {canCreate && (
            <Link href="/models/new" className={buttonVariants()}>
              + Новая модель
            </Link>
          )}
        </div>
      </div>

      <FilterBar
        oneRow
        title="Фильтры изделий"
        controls={[
          { type: "text", name: "q", label: "Поиск", aliases: ["article"], placeholder: "код, название, код продаж" },
          { type: "multi", name: "category", label: "Категория", aliases: ["cat"], options: articleOpts.category, noneLabel: "Без категории" },
          { type: "multi", name: "fur", label: "Вид (тип) меха", aliases: ["kind"], options: tzOpts.fur, hint: "по ТЗ изделия" },
          { type: "multi", name: "lining", label: "Подкладка", more: true, options: [{ value: "yes", label: "Да — есть подкладка" }, { value: "no", label: "Нет подкладки" }], hint: "по ТЗ: подкладка указана или списана" },
          { type: "multi", name: "tzyear", label: year === "all" ? "Год ТЗ" : `Год ТЗ (внутри ${year})`, options: tzOpts.tzyear, hint: "дополнительно к общему году в шапке", more: true },
          { type: "multi", name: "tz", label: "ТЗ", options: tzOpts.tz, more: true },
          { type: "multi", name: "batch", label: "Партия пошива", options: tzOpts.batch, noneLabel: "Без партии", more: true },
          { type: "multi", name: "color", label: "Цвет", options: tzOpts.color, more: true },
          { type: "multi", name: "size", label: "Размер", options: tzOpts.size, more: true },
          { type: "multi", name: "season", label: "Сезон", options: tzOpts.season, noneLabel: "Без сезона", more: true },
          { type: "multi", name: "price", label: "Цена", options: [{ value: "yes", label: "Есть цена" }, { value: "no", label: "Нет цены" }] },
        ]}
      />

      {markupTotal ? (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white" data-testid="articles-markup">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="px-3 py-2 font-medium">Мех</th>
                <th className="px-3 py-2 font-medium">Категория</th>
                <th className="px-3 py-2 text-right font-medium">Моделей</th>
                <th className="px-3 py-2 text-right font-medium">Ср. взвешенная розничная цена</th>
                <th className="px-3 py-2 text-right font-medium">
                  Ср. взвешенный маркап
                  <InfoHint label="Как считается средневзвешенный маркап">Взвешено по выпуску (завершённые ТЗ моделей с ценой): цена = Σ(цена × выпуск) ÷ Σ выпуск, маркап = Σ(цена × выпуск) ÷ Σ(себестоимость единицы × выпуск). Пересчитывается при вводе или удалении розничной цены. Вид меха модели — тот, на который списано больше всего меха в её ТЗ. Таблица считается по моделям после фильтров.</InfoHint>
                </th>
              </tr>
            </thead>
            <tbody>
              {furGroups.map((g) => (
                <Fragment key={g.fur}>
                  <tr className="border-b border-neutral-100 bg-neutral-50 font-semibold">
                    <td className="px-3 py-1.5">{g.fur}</td>
                    <td className="px-3 py-1.5 font-normal text-neutral-500">все категории</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{g.total.n}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(g.total.price.toFixed(0))}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtX(g.total.markup)}</td>
                  </tr>
                  {g.cats.map((c) => (
                    <tr key={g.fur + c.cat} className="border-b border-neutral-100">
                      <td className="px-3 py-1" />
                      <td className="px-3 py-1 text-neutral-700">{c.cat}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{c.agg.n}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{formatMoney(c.agg.price.toFixed(0))}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{fmtX(c.agg.markup)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="border-t-2 border-neutral-300 bg-neutral-100 font-semibold">
                <td className="px-3 py-1.5">Всего</td>
                <td className="px-3 py-1.5" />
                <td className="px-3 py-1.5 text-right tabular-nums">{markupTotal.n}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(markupTotal.price.toFixed(0))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtX(markupTotal.markup)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      <ResponsiveRows table={
      <Table anchor="table:articles" label="Таблица изделий" stickyHeader>
        <Thead>
          <Tr>
            <Th>Модель</Th>
            <Th>Категория</Th>
            <Th>Остаток, шт.</Th>
            <Th>
              Стоимость остатка
              <InfoHint label="Как считается стоимость остатка">Остаток × средневзвешенная себестоимость единицы (по завершённым ТЗ модели), с 4% на сырьё и подкладку. Нет данных для 4% — показано без 4%.</InfoHint>
            </Th>
            <Th>
              Себестоимость за ед.
              <InfoHint label="Как считается себестоимость единицы" wide>
                <p>Средневзвешенная себестоимость единицы по завершённым ТЗ модели: Σ(себестоимость ТЗ × выпуск) ÷ Σ выпуск — взвешено по количеству.</p>
                <p className="mt-1">В режиме «С 4%» надбавка 4% только на сырьё и подкладку; у ТЗ без 4% (партия 6 и др.) не добавляется.</p>
                <p className="mt-1">В раскрытии строки модели — пример: себестоимость без 4% и с 4% по этой модели.</p>
              </InfoHint>
            </Th>
            <Th>Розничная цена</Th>
            <Th>
              Наценка
              <InfoHint label="Как считается наценка">Наценка = розничная цена ÷ средневзвешенная (по количеству) себестоимость единицы по завершённым ТЗ. Пример: цена 10 000 ₽ при себестоимости 4 000 ₽ — ×2,50.</InfoHint>
            </Th>
            <Th>ТЗ</Th>
            <Th></Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r) => (
            <Tr key={r.id} className={r.isActive ? "" : "opacity-60"}>
              <Td className="font-medium">
                <ArticleDialog label={<ArticleName model={r.model} compact />} title={articleLabel(r.model)} tzHref={r.orderCount > 0 ? `/production?model=${r.id}` : undefined} tzCount={r.orderCount}>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm font-normal">
                    <dt className="text-neutral-500">Остаток на складе</dt>
                    <dd className="tabular-nums">
                      {r.modelStocks.length === 0 ? "0 шт." : r.modelStocks.map((st) => (
                        <div key={st.id}>{formatQty(st.quantity.toString())} шт.{r.modelStocks.length > 1 ? ` · ${st.warehouse.name}` : ""}</div>
                      ))}
                    </dd>
                    <dt className="text-neutral-500">Стоимость остатка</dt>
                    <dd className="tabular-nums">
                      {r.modelStocks.length === 0 ? "—" : <Money incl={r.stockValue} excl={r.stockValueExclVat} />}
                      {r.c4Missing && <span className="ml-1 text-xs text-neutral-500" title="Нет завершённых ТЗ с разбивкой по сырью — 4% не посчитан">(без 4%)</span>}
                    </dd>
                    <dt className="text-neutral-500">Себестоимость за ед.</dt>
                    <dd className="tabular-nums">
                      {r.baseAvg && r.avgOn ? (
                        <>
                          без 4% {formatMoney(r.baseAvg.toFixed(2))} · 4% {formatMoney(r.avgOn.sub(r.baseAvg).toFixed(2))} · <b>с 4% {formatMoney(r.avgOn.toFixed(2))}</b>
                        </>
                      ) : r.avgUnitCost ? <Money incl={r.avgUnitCost} excl={r.avgUnitCostExclVat} /> : "—"}
                    </dd>
                    <dt className="text-neutral-500">Розничная цена</dt>
                    <dd className="tabular-nums">{r.sellingPrice ? formatMoney(r.sellingPrice.toFixed(2)) : "—"}{r.markup ? <span className="ml-2 text-neutral-500">наценка {fmtX(r.markup.toNumber())}</span> : null}</dd>
                    {r.modelShipments.length > 0 && (
                      <>
                        <dt className="text-neutral-500">Отгрузки</dt>
                        <dd>
                          <ul className="flex flex-col gap-0.5">
                            {r.modelShipments.map(({ sh, lines }) => (
                              <li key={sh.id}>
                                <Link href={`/shipments/${sh.id}`} className="hover:underline">
                                  {sh.status === "SHIPPED" && sh.shippedDate ? `отгружена ${formatDate(sh.shippedDate)}` : `план ${formatDate(sh.plannedDate)}`}
                                </Link>{" "}
                                · {summarizeLines(lines).join("; ")} · {SHIPMENT_STATUS[sh.status].label}
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </>
                    )}
                  </dl>
                </ArticleDialog>
              </Td>
              <Td className="text-neutral-700">{r.model.category?.trim() || "—"}</Td>
              <Td>{formatQty(r.stockQty.toString())}</Td>
              <Td>{r.stockQty.greaterThan(0) ? <Money incl={r.stockValue} excl={r.stockValueExclVat} /> : "—"}</Td>
              <Td>
                {r.avgUnitCost ? (
                  <abbr title="ср. взвеш.: взвешено по количеству выпущенных изделий" className="cursor-help no-underline">
                    <Money incl={r.avgUnitCost} excl={r.avgUnitCostExclVat} />
                  </abbr>
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                <ArticlePriceForm modelId={r.id} sellingPrice={r.sellingPrice?.toString() ?? ""} canEdit={canCreate} />
              </Td>
              <Td className="font-medium">{r.markup ? `×${r.markup.toFixed(2).replace(".", ",")}` : "—"}</Td>
              <Td>
                {r.orderCount > 0 ? (
                  <Link href={`/production?model=${r.id}`} className="hover:underline" title="ТЗ этой модели">
                    {r.orderCount}
                  </Link>
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                <Link href={`/models/${r.id}`} className="whitespace-nowrap text-neutral-600 hover:underline">
                  Состав →
                </Link>
              </Td>
            </Tr>
          ))}
          {rows.length > 0 && (
            <Tr className="border-t-2 border-neutral-300 bg-neutral-50 font-semibold">
              <Td>Итого</Td>
              <Td />
              <Td>{formatQty(rows.reduce((s, r) => s.add(r.stockQty), new Decimal(0)).toString())}</Td>
              <Td><Money incl={totalStockValue} excl={totalStockValueExclVat} /></Td>
              <Td /><Td /><Td /><Td /><Td />
            </Tr>
          )}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={9} className="py-8 text-center text-neutral-500">
                {q || modelFilterOn || tzActive ? "Ничего не найдено" : year !== "all" ? emptyForYear(year, "ТЗ по моделям", "") : emptyCount > 0 ? "Нет моделей с ненулевым остатком" : "Моделей пока нет"}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
      }>
        {rows.map((r) => (
          <RowCard
            key={r.id}
            className={r.isActive ? "" : "opacity-60"}
            title={articleLabel(r.model)}
            href={`/models/${r.id}`}
            fields={[
              { label: "Остаток, шт.", value: formatQty(r.stockQty.toString()), strong: true },
              { label: "Стоимость остатка", value: r.stockQty.greaterThan(0) ? <Money incl={r.stockValue} excl={r.stockValueExclVat} /> : "—" },
              { label: `Себестоимость за ед.${c4}`, value: r.avgUnitCost ? <Money incl={r.avgUnitCost} excl={r.avgUnitCostExclVat} /> : "—" },
              { label: "Наценка", value: r.markup ? `×${r.markup.toFixed(2).replace(".", ",")}` : "—" },
              {
                label: "ТЗ",
                value: r.orderCount > 0 ? <Link href={`/production?model=${r.id}`} className="underline">{r.orderCount}</Link> : "—",
              },
            ]}
            extra={
              <div>
                <div className="mb-1 text-xs text-neutral-500">Розничная цена</div>
                <ArticlePriceForm mobile modelId={r.id} sellingPrice={r.sellingPrice?.toString() ?? ""} canEdit={canCreate} />
              </div>
            }
            details={[
              {
                label: "Склады",
                value:
                  r.modelStocks.length === 0
                    ? "Остаток на складе: 0"
                    : r.modelStocks.map((st) => (
                        <div key={st.id}>
                          {st.warehouse.name}: {formatQty(st.quantity.toString())} шт.
                        </div>
                      )),
              },
              {
                label: "Отгрузки по модели",
                value:
                  r.modelShipments.length === 0
                    ? "Отгрузок пока нет"
                    : r.modelShipments.map(({ sh, lines }) => (
                        <div key={sh.id}>
                          <Link href={`/shipments/${sh.id}`} className="underline">
                            {sh.status === "SHIPPED" && sh.shippedDate ? `отгружена ${formatDate(sh.shippedDate)}` : `план ${formatDate(sh.plannedDate)}`}
                          </Link>{" "}
                          · {summarizeLines(lines).join("; ")} · {SHIPMENT_STATUS[sh.status].label}
                        </div>
                      )),
              },
            ]}
          />
        ))}
        {rows.length === 0 && (
          <p className="py-8 text-center text-neutral-500">
            {q || modelFilterOn || tzActive ? "Ничего не найдено" : year !== "all" ? emptyForYear(year, "ТЗ по моделям", "") : emptyCount > 0 ? "Нет моделей с ненулевым остатком" : "Моделей пока нет"}
          </p>
        )}
      </ResponsiveRows>
    </div>
  );
}
