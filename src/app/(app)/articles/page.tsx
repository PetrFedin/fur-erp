import { Fragment } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { buttonVariants } from "@/components/ui/button";
import { formatQty } from "@/lib/utils";
import { Money } from "@/components/money";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { getYearFilter } from "@/lib/year-filter";
import { YearNote, emptyForYear } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { formatMoney } from "@/lib/utils";
import { compareModelNames } from "@/lib/model-code";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { ArticlePriceForm } from "./price-form";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, parseFilters, pick, stateParam } from "@/lib/filters";
import { articleModelWhere, hasLiningText, isTzFilterActive, matchedOrderIds, tzOptions } from "@/lib/article-filters";
import { getFilterOptions } from "@/lib/filter-options";
import { loadOrderRows } from "@/lib/analytics-orders";
import { ArticleName } from "@/components/article-name";
import { OrdersTree } from "@/components/orders-tree";
import { ProdTiles } from "@/components/prod-tiles";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue } from "../dashboard/tile";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { isRepair, sumOrders, sumTotal } from "@/lib/orders-sum";
import type { DrillOrder } from "@/lib/dashboard-drill";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";

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
  const canCreate = hasRole(session.user.role, ACCESS.models);
  const orgId = session.user.organizationId;
  const stocks = await prisma.finishedGoodsStock.findMany({ where: { organizationId: orgId }, select: { productModelId: true, quantity: true, avgUnitCost: true } });
  const articleOpts = await getFilterOptions(orgId, year, ["category"]);

  // ТЗ общего года (без отменённых) со значениями для фильтров: вид меха, цвет, размер, сезон, партия — как в аналитике.
  const [orderRows, liningTexts] = await Promise.all([
    loadOrderRows(orgId, year, c4Mode),
    prisma.productionOrder.findMany({ where: { organizationId: orgId }, select: { id: true, lining: true } }),
  ]);
  const liningById = new Map(liningTexts.map((o) => [o.id, hasLiningText(o.lining)]));
  const tzActive = isTzFilterActive(f);
  const matchedIds = matchedOrderIds(orderRows, liningById, f);
  const tzOpts = tzOptions(orderRows);

  const models = await prisma.productModel.findMany({
    // Ремонт — не изделия: отдельная страница «Ремонт».
    where: { AND: [articleModelWhere(orgId, f), { OR: [{ category: null }, { category: { not: "Ремонт" } }] }] },
    select: { id: true, name: true, sku: true, category: true, salesCode: true, salesName: true, sellingPrice: true, isActive: true },
    orderBy: { name: "asc" },
  });

  // Единый источник чисел — ТЗ «Произведено» Главной (без отменённых и без ремонта): те же ТЗ в таблице, плитках и дереве, поэтому всё сходится.
  const allDrill = await loadOrdersDrill(orgId, year, c4Mode);
  const byModel = new Map<string, DrillOrder[]>();
  for (const o of allDrill) {
    if (isRepair(o) || (matchedIds && !matchedIds.includes(o.id))) continue;
    const list = byModel.get(o.mid) ?? [];
    list.push(o);
    byModel.set(o.mid, list);
  }

  const rows0 = models.map((m) => {
    const os = byModel.get(m.id) ?? [];
    const sI = sumOrders(os, "incl");
    const sE = sumOrders(os, "excl");
    const qty = sI.qty;
    const costIncl = sumTotal(sI);
    const costExcl = sumTotal(sE);
    const unitIncl = qty > 0 ? costIncl / qty : null;
    const unitExcl = qty > 0 ? costExcl / qty : null;
    const wip = os.filter((o) => o.st !== "COMPLETED");
    const wipQty = wip.reduce((a, o) => a + o.qty, 0);
    const done = os.filter((o) => o.st === "COMPLETED");
    const doneQty = done.reduce((a, o) => a + o.qty, 0);
    const doneIncl = sumTotal(sumOrders(done, "incl"));
    const doneExcl = sumTotal(sumOrders(done, "excl"));
    const modelStocks = stocks.filter((st) => st.productModelId === m.id);
    const stockQty = modelStocks.reduce((a, st) => a + st.quantity.toNumber(), 0);
    // Склад оценивается по средней себестоимости завершённых ТЗ; нет ТЗ в выбранном срезе — по учётной цене склада.
    const stockIncl = doneQty > 0 ? (stockQty * doneIncl) / doneQty : modelStocks.reduce((a, st) => a + st.quantity.toNumber() * st.avgUnitCost.toNumber(), 0);
    const stockExcl = doneQty > 0 ? (stockQty * doneExcl) / doneQty : stockIncl;
    const wipIncl = sumTotal(sumOrders(wip, "incl"));
    const wipExcl = sumTotal(sumOrders(wip, "excl"));
    const price = m.sellingPrice ? m.sellingPrice.toNumber() : null;
    // Основной вид меха — тот, на который списано больше всего меха в ТЗ артикула (для таблицы «мех × категория»).
    const furCost = new Map<string, number>();
    for (const o of os) for (const l of o.lines) if (l.k === "f" && l.fu) furCost.set(l.fu, (furCost.get(l.fu) ?? 0) + l.i);
    const primaryFur = Array.from(furCost.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      id: m.id,
      name: m.name,
      model: { name: m.name, category: m.category, salesCode: m.salesCode, salesName: m.salesName, sku: m.sku },
      isActive: m.isActive,
      orderCount: os.length,
      qty, wipQty, wipIncl, wipExcl, stockQty, stockIncl, stockExcl,
      costIncl, costExcl, unitIncl, unitExcl,
      sellingPrice: price,
      retailStock: price ? price * stockQty : null,
      markup: price && unitIncl && unitIncl > 0 ? price / unitIncl : null,
      primaryFur,
    };
  });

  // Строки без ТЗ и без остатка скрыты по умолчанию (?empty=1 — показать). При поиске, фильтре категории или цены показываем всё найденное.
  // За выбранный год — артикулы с ТЗ этого года (остаток на складе — текущий, без даты).
  // Фильтры по ТЗ (вид меха, подкладка, год ТЗ, ТЗ, партия, цвет, размер, сезон): остаются артикулы, у которых есть подходящие ТЗ.
  const baseRows = year === "all" ? rows0.filter((r) => r.stockQty > 0 || r.orderCount > 0) : rows0.filter((r) => r.orderCount > 0);
  const emptyCount = tzActive ? 0 : rows0.length - baseRows.length;
  const modelFilterOn = !!q || f.category.length > 0 || f.price.length > 0;
  const rows = (tzActive ? rows0.filter((r) => r.orderCount > 0) : showEmpty || modelFilterOn ? rows0 : baseRows).sort((a, b) => {
    const wa = a.stockQty > 0 || a.orderCount > 0 ? 0 : 1;
    const wb = b.stockQty > 0 || b.orderCount > 0 ? 0 : 1;
    return wa - wb || compareModelNames(a.name, b.name);
  });
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + pick(r), 0);
  const totalQty = sum((r) => r.qty);
  const totalStockQty = sum((r) => r.stockQty);
  const totalCostIncl = sum((r) => r.costIncl);
  const totalCostExcl = sum((r) => r.costExcl);
  const stockIncl = sum((r) => r.stockIncl);
  const stockExcl = sum((r) => r.stockExcl);
  const wipQtyAll = sum((r) => r.wipQty);
  const wipIncl = sum((r) => r.wipIncl);
  const wipExcl = sum((r) => r.wipExcl);
  const retailAll = sum((r) => r.retailStock ?? 0);

  // Таблица «мех × категория»: число артикулов, средняя розничная цена и средняя наценка (артикулы с ценой и себестоимостью).
  type Agg = { n: number; price: number; markup: number };
  // Средневзвешенные по выпуску: цена = Σ(цена × выпуск) ÷ Σ выпуск; маркап = Σ(цена × выпуск) ÷ Σ(себестоимость ед. × выпуск).
  const aggOf = (list: typeof rows): Agg | null => {
    const priced = list.filter((r) => r.markup && r.sellingPrice && r.unitIncl && r.qty > 0);
    if (priced.length === 0) return null;
    const sumW = priced.reduce((a, r) => a + r.qty, 0);
    const retail = priced.reduce((a, r) => a + r.sellingPrice! * r.qty, 0);
    const cost = priced.reduce((a, r) => a + r.unitIncl! * r.qty, 0);
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

  // Плитки и дерево «артикул → ТЗ → состав» — из тех же ТЗ, что на Главной, по артикулам и ТЗ списка.
  // Ремонт в плитки «Себестоимость» добавляется отдельной строкой (как на Главной), если не выбраны фильтры списка.
  const listedModelIds = new Set(rows.map((r) => r.id));
  const drill = allDrill.filter((o) => !isRepair(o) && listedModelIds.has(o.mid) && (!matchedIds || matchedIds.includes(o.id)));
  const repairDrill = tzActive || modelFilterOn ? [] : allDrill.filter(isRepair);
  const mny = (v: number | string) => formatMoney(Number(v).toFixed(2));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* «i» и метка года — рядом с заголовком, а не внутри: иначе имя заголовка читается как «Изделия О странице…». */}
        <div className="flex flex-wrap items-center">
          <h1 className="text-xl font-semibold">Изделия</h1>
          <YearNote year={year} />
          <span className="ml-2 inline-flex">
          <InfoHint label="О странице «Изделия»" wide>
            <p>Артикулы: сколько произведено, что лежит на складе, себестоимость, розничная цена и наценка. Данные — те же ТЗ, что в «Произведено» на Главной (без отменённых и без ремонта).</p>
            <p className="mt-1"><b>Год ({year === "all" ? "все годы" : year}):</b> произведено и себестоимость — по ТЗ выбранного года. Остаток на складе текущий, от года не зависит.</p>
            <p className="mt-1"><b>Себестоимость за ед.</b> = себестоимость всех ТЗ артикула ÷ произведено. <b>Наценка</b> = розничная цена ÷ себестоимость за ед.</p>
            <p className="mt-1">Режимы шапки «С НДС / Без НДС» и «С 4%» меняют все суммы. Ремонт — отдельная страница «Ремонт».</p>
            {canCreate && <p className="mt-1">Розничную цену можно ввести прямо в таблице: Enter или переход в другое поле сохраняет её.</p>}
          </InfoHint>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/repair" className={buttonVariants({ variant: "outline" })}>Ремонт</Link>
          <Link href="/analytics/products" className={buttonVariants({ variant: "outline" })}>
            Аналитика и цены
          </Link>
          {canCreate && (
            <Link href="/models/new" className={buttonVariants()}>
              + Новый артикул
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

      <ProdTiles
        orders={[...drill, ...repairDrill]}
        c4={c4Mode}
        treeId="orders-tree"
        id="articles"
        title="Изделия — итоги"
        extraCount={2}
        extra={
          <>
            <div className="relative">
              <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
                <TileHead>На складе</TileHead>
                <TileValue>{totalStockQty > 0 ? `${formatQty(totalStockQty)} шт.` : "—"}</TileValue>
                <TileCaption>готовая продукция · без ремонта</TileCaption>
                <TileList items={[
                  { k: "Стоимость остатка", v: totalStockQty > 0 ? <Money incl={stockIncl} excl={stockExcl} /> : "—" },
                  { k: wipQtyAll > 0 ? `ТЗ в работе, ${formatQty(wipQtyAll)} шт.` : "ТЗ в работе", v: wipQtyAll > 0 ? <Money incl={wipIncl} excl={wipExcl} /> : "—" },
                  { k: "В розничных ценах", v: retailAll > 0 ? mny(retailAll) : "—" },
                ]} />
              </div>
              <div className="absolute right-3 top-3">
                <InfoHint label="Как считается склад" wide align="right">
                  <p><b>Стоимость остатка</b> = остаток × средняя себестоимость завершённых ТЗ артикула. <b>ТЗ в работе</b> — изделия, которых ещё нет на складе, но их себестоимость уже в «Себестоимости» слева. Склад + в работе = себестоимость изделий.</p>
                  <p className="mt-1">Розничная стоимость — остаток × розничная цена артикула. Остаток текущий, от года не зависит.</p>
                </InfoHint>
              </div>
            </div>
            <div className="relative">
              <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
                <TileHead>Маркап</TileHead>
                <TileValue>{markupTotal ? fmtX(markupTotal.markup) : "—"}</TileValue>
                <TileCaption>розница ÷ себестоимость, средневзвешенно</TileCaption>
                <TileList items={[
                  { k: "Ср. розничная цена", v: markupTotal ? formatMoney(markupTotal.price.toFixed(0)) : "—" },
                  { k: "Артикулов с ценой", v: markupTotal ? String(markupTotal.n) : "—" },
                  { k: "Без цены", v: rows.filter((r) => !r.sellingPrice && r.orderCount > 0).length || "—" },
                ]} />
              </div>
              <div className="absolute right-3 top-3">
                <InfoHint label="Как считается маркап" wide align="right">
                  <p>Σ(цена × выпуск) ÷ Σ(себестоимость ед. × выпуск) по артикулам с розничной ценой. Подробно по меху и категориям — в таблице ниже.</p>
                </InfoHint>
              </div>
            </div>
          </>
        }
      />

      <ResponsiveRows table={
      <Table anchor="table:articles" label="Таблица изделий" stickyHeader>
        <Thead>
          <Tr>
            <Th>Артикул</Th>
            <Th>Категория</Th>
            <Th>
              Произведено, шт.
              <InfoHint label="Что такое произведено">Все ТЗ артикула без отменённых: завершённые и в работе (как на Главной).</InfoHint>
            </Th>
            <Th>
              На складе, шт.
              <InfoHint label="Что такое остаток">Готовая продукция на складах сейчас. Разница с «Произведено» — изделия в ТЗ, которые ещё в работе.</InfoHint>
            </Th>
            <Th>
              Себестоимость за ед.
              <InfoHint label="Как считается себестоимость единицы">Себестоимость всех ТЗ артикула (мех, подкладка, 4%, расходы, работа, шкуры подрядчика) ÷ произведено. Состав по лотам — в дереве выше и в карточке артикула.</InfoHint>
            </Th>
            <Th>
              Себестоимость всего
              <InfoHint label="Из чего складывается">Склад + ТЗ в работе. Итог равен «Себестоимости» изделий (без ремонта) на Главной.</InfoHint>
            </Th>
            <Th>Розничная цена</Th>
            <Th>
              Наценка
              <InfoHint label="Как считается наценка">Розничная цена ÷ себестоимость за ед. Пример: цена 10 000 ₽ при себестоимости 4 000 ₽ — ×2,50.</InfoHint>
            </Th>
            <Th>ТЗ</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r) => (
            <Tr key={r.id} className={r.isActive ? "" : "opacity-60"}>
              <Td className="font-medium">
                <Link href={`/models/${r.id}`} className="text-blue-700 hover:underline" title="Карточка артикула">
                  <ArticleName model={r.model} compact />
                </Link>
              </Td>
              <Td className="text-neutral-700">{r.model.category?.trim() || "—"}</Td>
              <Td>{r.qty > 0 ? formatQty(r.qty) : "—"}</Td>
              <Td>{r.stockQty > 0 ? formatQty(r.stockQty) : "—"}</Td>
              <Td>{r.unitIncl != null ? <Money incl={r.unitIncl.toFixed(2)} excl={r.unitExcl?.toFixed(2)} /> : "—"}</Td>
              <Td>{r.costIncl > 0 ? <Money incl={r.costIncl.toFixed(2)} excl={r.costExcl.toFixed(2)} /> : "—"}</Td>
              <Td>
                <ArticlePriceForm modelId={r.id} sellingPrice={r.sellingPrice?.toString() ?? ""} canEdit={canCreate} />
              </Td>
              <Td>{r.markup ? fmtX(r.markup) : "—"}</Td>
              <Td>
                {r.orderCount > 0 ? (
                  <Link href={`/production?model=${r.id}`} className="text-blue-700 hover:underline" title="ТЗ этого артикула">
                    {r.orderCount}
                  </Link>
                ) : (
                  "—"
                )}
              </Td>
            </Tr>
          ))}
          {rows.length > 0 && (
            <Tr className="border-t-2 border-neutral-300 bg-neutral-50 font-semibold">
              <Td>Итого</Td>
              <Td />
              <Td>{totalQty > 0 ? formatQty(totalQty) : "—"}</Td>
              <Td>{totalStockQty > 0 ? formatQty(totalStockQty) : "—"}</Td>
              <Td>{totalQty > 0 ? <Money incl={(totalCostIncl / totalQty).toFixed(2)} excl={(totalCostExcl / totalQty).toFixed(2)} /> : "—"}</Td>
              <Td><Money incl={totalCostIncl.toFixed(2)} excl={totalCostExcl.toFixed(2)} /></Td>
              <Td /><Td /><Td />
            </Tr>
          )}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={9} className="py-8 text-center text-neutral-500">
                {q || modelFilterOn || tzActive ? "Ничего не найдено" : year !== "all" ? emptyForYear(year, "ТЗ по артикулам", "") : emptyCount > 0 ? "Нет артикулов с ТЗ и остатком" : "Артикулов пока нет"}
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
            title={<ArticleName model={r.model} compact />}
            subtitle={r.model.category?.trim() || undefined}
            href={`/models/${r.id}`}
            fields={[
              { label: "Произведено, шт.", value: r.qty > 0 ? formatQty(r.qty) : "—", strong: true },
              { label: "На складе, шт.", value: r.stockQty > 0 ? formatQty(r.stockQty) : "—" },
              { label: "Себестоимость за ед.", value: r.unitIncl != null ? <Money incl={r.unitIncl.toFixed(2)} excl={r.unitExcl?.toFixed(2)} /> : "—" },
              { label: "Себестоимость всего", value: r.costIncl > 0 ? <Money incl={r.costIncl.toFixed(2)} excl={r.costExcl.toFixed(2)} /> : "—" },
              { label: "Наценка", value: r.markup ? fmtX(r.markup) : "—" },
              { label: "ТЗ", value: r.orderCount > 0 ? <Link href={`/production?model=${r.id}`} className="underline">{r.orderCount}</Link> : "—" },
            ]}
            extra={
              <div>
                <div className="mb-1 text-xs text-neutral-500">Розничная цена</div>
                <ArticlePriceForm mobile modelId={r.id} sellingPrice={r.sellingPrice?.toString() ?? ""} canEdit={canCreate} />
              </div>
            }
          />
        ))}
        {rows.length === 0 && (
          <p className="py-8 text-center text-neutral-500">
            {q || modelFilterOn || tzActive ? "Ничего не найдено" : year !== "all" ? emptyForYear(year, "ТЗ по артикулам", "") : emptyCount > 0 ? "Нет артикулов с ТЗ и остатком" : "Артикулов пока нет"}
          </p>
        )}
      </ResponsiveRows>

      <OrdersTree
        orders={drill}
        c4={c4Mode}
        title="Выпуск: группа → категория → мех → артикул → ТЗ → состав"
        modes={[
          { id: "group", label: "Группы", dims: ["group", "category", "fur", "article", "order"] },
          { id: "article", label: "Артикулы", dims: ["article", "order"] },
        ]}
        hint={<p>Количество — «Произведено» как на Главной (все ТЗ без отменённых и без ремонта). Номер артикула ведёт в его карточку, номер ТЗ — в карточку ТЗ; в составе — ссылки на лот и закупку. Ремонт здесь не показывается — см. «Ремонт».</p>}
        empty="ТЗ по выбранным изделиям нет."
      />

      {markupTotal ? (
        <details className="rounded-lg border border-neutral-200 bg-white" data-testid="articles-markup">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">Маркап по меху и категориям</summary>
          <div className="overflow-x-auto border-t border-neutral-200">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="px-3 py-2 font-medium">Мех</th>
                <th className="px-3 py-2 font-medium">Категория</th>
                <th className="px-3 py-2 text-right font-medium">Артикулов</th>
                <th className="px-3 py-2 text-right font-medium">Ср. розничная цена</th>
                <th className="px-3 py-2 text-right font-medium">
                  Ср. маркап
                  <InfoHint label="Как считается средневзвешенный маркап">Взвешено по выпуску (артикулы с ценой): цена = Σ(цена × выпуск) ÷ Σ выпуск, маркап = Σ(цена × выпуск) ÷ Σ(себестоимость ед. × выпуск). Мех артикула — тот, на который списано больше всего меха в его ТЗ. Считается по артикулам после фильтров.</InfoHint>
                </th>
              </tr>
            </thead>
            <tbody>
              {furGroups.map((g) => (
                <Fragment key={g.fur}>
                  <tr className="border-b border-neutral-100 bg-neutral-50">
                    <td className="px-3 py-1.5">{g.fur}</td>
                    <td className="px-3 py-1.5 text-neutral-500">все категории</td>
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
              <tr className="border-t-2 border-neutral-300 bg-neutral-100">
                <td className="px-3 py-1.5">Всего</td>
                <td className="px-3 py-1.5" />
                <td className="px-3 py-1.5 text-right tabular-nums">{markupTotal.n}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(markupTotal.price.toFixed(0))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtX(markupTotal.markup)}</td>
              </tr>
            </tbody>
          </table>
          </div>
        </details>
      ) : null}
    </div>
  );
}
