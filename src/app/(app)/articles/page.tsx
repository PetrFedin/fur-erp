import { readSort, sortRows, thSort } from "@/lib/table-sort";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { uniqueOrderCount } from "@/lib/tz-key";
import { Fragment } from "react";
import { loadArticleFurTypes } from "@/lib/article-fur-type";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { buttonVariants } from "@/components/ui/button";
import { formatQty, formatMarkup } from "@/lib/utils";
import { Money } from "@/components/money";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { getYearFilter } from "@/lib/year-filter";
import { YearNote, emptyForYear } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { formatMoney } from "@/lib/utils";
import { parseSupplierDescription } from "@/lib/supplier-article";
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
import { MarkupCarousel, PerUnitCarousel, type MarkupRow } from "./article-widgets";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { isRepair, sumOrders, sumTotal } from "@/lib/orders-sum";
import type { DrillOrder } from "@/lib/dashboard-drill";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { articleMetrics } from "@/lib/article-metrics";
import { CostTwo } from "@/components/cost-two";
import { CATEGORY_GROUPS, NO_GROUP, groupOf } from "@/lib/category-groups";
import { TotalLabel } from "@/components/total-label";
import { LENGTH_OPTIONS } from "@/lib/length-class";
import { loadAllArticleParams, modelIdsWithParams, paramFilterOptions } from "@/lib/article-params";
import { PhotoGalleryButton } from "@/components/photo-gallery";
import { deleteArticlePhoto, deleteAllArticlePhotos } from "../models/photo-actions";
import { loadPhotoSummary, loadAllShopLinks } from "@/lib/article-photos";
import { galleryExtras, pluOfItem } from "@/lib/article-photo-color";
import { pluMatchIds, isPluParam } from "@/lib/article-photo-match";
import { ArticleShopEditor } from "@/components/article-shop-editor";
import { pluByVariant } from "@/lib/article-shop-core";
import { SupplierArticles } from "./supplier-view";
import { loadSupplierArticleIds } from "@/lib/supplier-articles";
import { Segmented } from "@/components/segmented";
import { ColumnPicker, type PickerColumn } from "@/components/column-picker";

export const metadata = { title: "Изделия" };

// Фильтры «Изделий». Уровень модели: поиск, категория, цена. Уровень ТЗ (остальные): модель остаётся в списке, если у неё есть ТЗ,
// подходящее под ВСЕ выбранные условия; её ср. взвеш. себестоимость и число ТЗ считаются только по таким ТЗ.
// «Год ТЗ» (tzyear) — дополнительный фильтр внутри общего года из шапки (cookie), общий год не заменяет.
const ARTICLE_FILTERS = defineFilters({
  ...pick(["q", "category", "catgroup", "model", "len", "fur", "color", "size", "season", "batch"], { q: { label: "Поиск" }, fur: { label: "Вид (тип) меха" }, batch: { label: "Партия" }, size: { label: "Размер изделия" }, model: { label: "Артикул" } }),
  lining: { kind: "multi", label: "Подкладка", allowed: ["yes", "no"] },
  tzyear: { kind: "multi", label: "Год ТЗ", pattern: /^\d{4}$/ },
  tz: { kind: "multi", label: "ТЗ", maxLen: 60 },
  price: { kind: "multi", label: "Цена", allowed: ["yes", "no"] },
  param: { kind: "multi", label: "Параметры", maxLen: 90 },
  empty: stateParam("Состав списка", { allowed: ["1"] }),
  src: stateParam("Источник", { allowed: ["supplier"] }),
  grp: stateParam("Одежда / аксессуары", { allowed: ["clothes", "acc"] }),
});

/** Колонки таблицы «Изделия»: на виду главные (артикул, фото, категория, мех, выпуск, себестоимость, цена, наценка, ТЗ), остальные — в «Колонки ▾». */
const ARTICLE_COLUMNS: PickerColumn[] = [
  { key: "name", label: "Артикул", fixed: true },
  { key: "photos", label: "Фото", on: true },
  { key: "plu", label: "PLU" },
  { key: "shop", label: "Ссылка на магазин" },
  { key: "category", label: "Категория / группа", on: true },
  { key: "fur", label: "Тип меха", on: true },
  { key: "color", label: "Цвет" },
  { key: "sizes", label: "Размеры" },
  { key: "lining", label: "Состав подкладки" },
  { key: "qty", label: "В выпуске", on: true },
  { key: "furQty", label: "Шкур, шт." },
  { key: "furSum", label: "Шкуры, сумма" },
  { key: "liningQty", label: "Подкладка, м" },
  { key: "liningSum", label: "Подкладка, сумма" },
  { key: "work", label: "Работа" },
  { key: "total", label: "Полная себестоимость", on: true },
  { key: "unit", label: "Себестоимость за ед.", on: true },
  { key: "vat", label: "НДС" },
  { key: "price", label: "Розничная цена", on: true },
  { key: "markup", label: "Наценка", on: true },
  { key: "orders", label: "ТЗ", on: true },
];

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = parseFilters(ARTICLE_FILTERS, sp);
  const q = f.q;
  const showEmpty = f.empty === "1";
  const session = await requireSession({ allowSupplier: true });
  // Поставщик (Веллмех): отдельный вид без денег — возвращаем ДО любых денежных запросов ниже.
  if (session.user.role === "SUPPLIER") return <SupplierArticles orgId={session.user.organizationId} q={q} noname={sp.noname === "1"} sp={sp} />;
  const c4Mode = await getCommission4Mode();
  const year = await getYearFilter();
  const canCreate = hasRole(session.user.role, ACCESS.models);
  const orgId = session.user.organizationId;
  const stocks = await prisma.finishedGoodsStock.findMany({ where: { organizationId: orgId }, select: { productModelId: true, quantity: true, avgUnitCost: true } });
  const articleOpts = await getFilterOptions(orgId, year, ["category", "model"]);

  // ТЗ общего года (без отменённых) со значениями для фильтров: вид меха, цвет, размер, сезон, партия — как в аналитике.
  const [orderRows, liningTexts] = await Promise.all([
    loadOrderRows(orgId, year, c4Mode),
    prisma.productionOrder.findMany({ where: { organizationId: orgId }, select: { id: true, lining: true } }),
  ]);
  const liningById = new Map(liningTexts.map((o) => [o.id, hasLiningText(o.lining)]));
  const colorsByOrder = new Map(orderRows.map((r) => [r.id, r.colors]));
  const tzActive = isTzFilterActive(f);
  const matchedIds = matchedOrderIds(orderRows, liningById, f);
  const tzOpts = tzOptions(orderRows);

  // Свои параметры артикулов (карточка артикула -> «+ Добавить параметр»): фильтр «Параметры» оставляет артикулы с выбранными «название: значение».
  const allParams = await loadAllArticleParams(prisma, orgId);
  const paramOpts = paramFilterOptions(allParams);
  const paramIds = f.param.length ? modelIdsWithParams(allParams, f.param) : null;
  const modelIds = paramIds ? (f.model.length ? paramIds.filter((x) => f.model.includes(x)) : paramIds) : null;

  // Поиск по PLU (свойство «PLU»): артикулы с подходящим PLU добавляются к обычному результату поиска.
  const pluIds = q ? pluMatchIds(allParams, q) : [];
  const fWhere = modelIds ? { ...f, model: modelIds.length ? modelIds : ["-"] } : f;
  const qWhere = pluIds.length ? { OR: [articleModelWhere(orgId, fWhere), { AND: [articleModelWhere(orgId, { ...fWhere, q: "" }), { id: { in: pluIds } }] }] } : articleModelWhere(orgId, fWhere);
  const photoSummary = await loadPhotoSummary(prisma, orgId);
  // Ссылки магазина, PLU и цвета фото — только сотрудникам заказчика (подрядчик уходит в supplier-view выше).
  const shopLinksAll = await loadAllShopLinks(prisma, orgId);
  const colorRefs = photoSummary.size || shopLinksAll.size ? await prisma.colorRef.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, aliases: true, note: true } }) : [];
  /** PLU артикула по цветам: [{ plu, label }] — подпись цвета нужна, только если PLU разных цветов. Источник: свойства «PLU…» (их пишет и редактор), страницы магазина — запасной. */
  const pluEntries = (id: string): { plu: string; label: string }[] => {
    const links = shopLinksAll.get(id) ?? [];
    const photos = photoSummary.get(id);
    const labels = new Map(galleryExtras(photos ?? [], null, colorRefs).groups.map((g) => [g.key, g.label]));
    const seen = new Set<string>();
    const out: { plu: string; label: string }[] = [];
    const push = (plu: string, label: string) => { if (!seen.has(plu)) { seen.add(plu); out.push({ plu, label }); } };
    const params = (allParams.get(id) ?? []).filter((x) => isPluParam(x.name));
    const keys = [...new Set([...(photos ?? []).map((x) => x.variant), ...links.map((l) => l.variant)])];
    const linkPlu = new Map<string, string>();
    for (const l of links) { const plu = pluOfItem(l.itemId); if (plu && !linkPlu.has(l.variant)) linkPlu.set(l.variant, plu); }
    for (const [variant, value] of pluByVariant(params, keys, linkPlu)) for (const plu of value.split(/\s*[,;]\s*/).filter(Boolean)) push(plu, labels.get(variant) ?? links.find((l) => l.variant === variant)?.color ?? variant);
    for (const l of links) { const plu = pluOfItem(l.itemId); if (plu) push(plu, labels.get(l.variant) ?? l.color ?? ""); }
    return out;
  };
  const models = await prisma.productModel.findMany({
    // Ремонт — не изделия: отдельная страница «Ремонт».
    where: { AND: [qWhere, { OR: [{ category: null }, { category: { not: "Ремонт" } }] }] },
    select: { id: true, name: true, sku: true, category: true, salesCode: true, salesName: true, description: true, sellingPrice: true, supplierWorkPrice: true, supplierFurPerUnit: true, isActive: true, categoryRef: { select: { group: true } } },
    orderBy: { name: "asc" },
  });

  // Артикулы, которые завёл Веллмех (по журналу изменений): пометка и фильтр «Новые от Веллмеха».
  const supplierMade = await loadSupplierArticleIds(prisma, orgId);
  const furTypes = await loadArticleFurTypes(orgId);

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
    // Показатели из тех же ТЗ: шкуры, подкладка, средневзвешенное, НДС, основной вид меха (src/lib/article-metrics.ts).
    const met = articleMetrics(os);
    // Профиль из описания артикула (строки «Мех/Подкладка/Размеры/Цвета» — собраны из Word-ТЗ): цвета — если нет ТЗ в базе.
    const own = parseSupplierDescription(m.description);
    const ownColors = own.colors ? own.colors.split(/,\s*/).filter(Boolean) : [];
    const colors0 = Array.from(new Set(os.flatMap((o) => colorsByOrder.get(o.id) ?? []))).sort((a, b) => a.localeCompare(b, "ru"));
    const colors = colors0.length ? colors0 : ownColors;
    return {
      id: m.id,
      name: m.name,
      bySupplier: supplierMade.has(m.id),
      // Заявка подрядчика по артикулу (не итог по ТЗ): цена работы за изделие и шкур на изделие — показываются в столбцах «Работа» и «Шкур» второй строкой.
      supplierWork: m.supplierWorkPrice ? formatMoney(m.supplierWorkPrice.toString()) : null,
      supplierFur: m.supplierFurPerUnit ? m.supplierFurPerUnit.toString() : null,
      plus: pluEntries(m.id),
      model: { name: m.name, category: m.category, salesCode: m.salesCode, salesName: m.salesName, sku: m.sku },
      group: groupOf(m.categoryRef?.group),
      isActive: m.isActive,
      orderCount: uniqueOrderCount(os),
      qty, wipQty, wipIncl, wipExcl, stockQty, stockIncl, stockExcl,
      costIncl, costExcl, unitIncl, unitExcl,
      sellingPrice: price,
      retailStock: price ? price * stockQty : null,
      markup: price && unitIncl && unitIncl > 0 ? price / unitIncl : null,
      primaryFur: met.primaryFur ?? furTypes.get(m.id)?.fur ?? null,
      met,
      colors,
      sizes: own.sizes,
      lining: own.lining,
    };
  });

  // Строки без ТЗ и без остатка скрыты по умолчанию (?empty=1 — показать). При поиске, фильтре категории или цены показываем всё найденное.
  // За выбранный год — артикулы с ТЗ этого года (остаток на складе — текущий, без даты).
  // Фильтры по ТЗ (вид меха, подкладка, год ТЗ, ТЗ, партия, цвет, размер, сезон): остаются артикулы, у которых есть подходящие ТЗ.
  const baseRows = year === "all" ? rows0.filter((r) => r.stockQty > 0 || r.orderCount > 0 || r.bySupplier) : rows0.filter((r) => r.orderCount > 0 || r.bySupplier);
  const emptyCount = tzActive ? 0 : rows0.length - baseRows.length;
  const modelFilterOn = !!q || f.category.length > 0 || f.catgroup.length > 0 || f.model.length > 0 || f.len.length > 0 || f.price.length > 0 || f.param.length > 0;
  const grpHref = (g: string) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (k !== "grp" && v !== undefined) for (const x of Array.isArray(v) ? v : [v]) u.append(k, x);
    if (g) u.set("grp", g);
    const t = u.toString();
    return `/articles${t ? `?${t}` : ""}`;
  };
  const grpName = f.grp === "clothes" ? "Одежда" : f.grp === "acc" ? "Аксессуары" : null;
  const rows1 = (f.src === "supplier" ? rows0.filter((r) => r.bySupplier) : tzActive ? rows0.filter((r) => r.orderCount > 0) : showEmpty || modelFilterOn ? rows0 : baseRows).filter((r) => !grpName || r.group === grpName).sort((a, b) => {
    const wa = a.stockQty > 0 || a.orderCount > 0 ? 0 : 1;
    const wb = b.stockQty > 0 || b.orderCount > 0 ? 0 : 1;
    return wa - wb || compareModelNames(a.name, b.name);
  });
  // Сортировка по клику на заголовок (?sort=…&dir=…) поверх порядка по умолчанию (есть склад или ТЗ — выше, затем по названию).
  const aSort = readSort(sp, ["name", "photos", "plu", "category", "fur", "color", "sizes", "lining", "qty", "furQty", "furSum", "liningQty", "liningSum", "work", "total", "unit", "price", "markup", "orders"]);
  const rows = sortRows(rows1, aSort, {
    name: (r) => r.name, photos: (r) => photoSummary.get(r.id)?.length ?? 0, plu: (r) => r.plus.map((x) => x.plu).join(", ") || null, category: (r) => r.model.category?.trim() || null, fur: (r) => r.primaryFur, color: (r) => r.colors[0] ?? null, sizes: (r) => r.sizes || null, lining: (r) => r.lining || null,
    qty: (r) => r.qty, furQty: (r) => r.met.fur.qty, furSum: (r) => r.met.fur.on.incl, liningQty: (r) => r.met.lining.qty, liningSum: (r) => r.met.lining.on.incl,
    work: (r) => r.met.work, total: (r) => (r.costIncl > 0 ? r.met.total.on.incl : null), unit: (r) => r.met.unit?.on.incl ?? null,
    price: (r) => r.sellingPrice ?? null, markup: (r) => r.markup ?? null, orders: (r) => r.orderCount,
  });
  const ath = (k: string) => thSort("/articles", sp, k, aSort);
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + pick(r), 0);
  const totalQty = sum((r) => r.qty);
  const totalCostIncl = sum((r) => r.costIncl);
  const totalCostExcl = sum((r) => r.costExcl);
  const totalFurQty = sum((r) => r.met.fur.qty);
  const totalLiningQty = sum((r) => r.met.lining.qty);
  const sumPair = (pick: (r: (typeof rows)[number]) => { incl: number; excl: number }) => rows.reduce((a, r) => ({ incl: a.incl + pick(r).incl, excl: a.excl + pick(r).excl }), { incl: 0, excl: 0 });
  const perItem = (q: number, n: number) => formatQty(Math.round((q / n) * 100) / 100);

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
  const fmtX = (v: number) => formatMarkup(v);

  // Плитки и дерево «артикул → ТЗ → состав» — из тех же ТЗ, что на Главной, по артикулам и ТЗ списка.
  // Ремонт в плитки «Себестоимость» добавляется отдельной строкой (как на Главной), если не выбраны фильтры списка.
  const listedModelIds = new Set(rows.map((r) => r.id));
  const drill = allDrill.filter((o) => !isRepair(o) && listedModelIds.has(o.mid) && (!matchedIds || matchedIds.includes(o.id)));
  const repairDrill = tzActive || modelFilterOn ? [] : allDrill.filter(isRepair);
  const markupRows: MarkupRow[] = rows.map((r) => ({ fur: r.primaryFur, grp: r.group, price: r.sellingPrice, unit: r.unitIncl, qty: r.qty, orders: r.orderCount }));

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Изделия" }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* «i» и метка года — рядом с заголовком, а не внутри: иначе имя заголовка читается как «Изделия О странице…». */}
        <div className="flex flex-wrap items-center">
          <h1 className="text-xl font-semibold">Изделия</h1>
          <YearNote year={year} />
          <span className="ml-2 inline-flex">
          <InfoHint label="О странице «Изделия»" wide>
            <p>Артикулы с выпуском, себестоимостью, розничной ценой и наценкой по ТЗ выбранного года; режимы «С НДС / Без НДС» и «С 4 %» меняют все суммы.</p>
            <p className="mt-1">Наценка = цена в карточке ÷ себестоимость за ед.{canCreate ? " Цену можно ввести прямо в таблице: Enter сохраняет." : ""} Продажи и остатки — по ссылке «продажи» в строке.</p>
          </InfoHint>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label="Одежда или аксессуары" items={([["", "Все", null], ["clothes", "Одежда", "Одежда"], ["acc", "Аксессуары", "Аксессуары"]] as const).map(([g, t, n]) => ({ key: g || "all", label: <>{t} <span className="ml-1 text-xs opacity-80">{n ? rows0.filter((r) => r.group === n).length : rows0.length}</span></>, on: (f.grp ?? "") === g, href: grpHref(g) }))} />
          <ColumnPicker id="articles" columns={ARTICLE_COLUMNS} />
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

      <div className="print:hidden">
      <FilterBar
        oneRow
        hideChips
        title="Фильтры изделий"
        controls={[
          { type: "text", name: "q", label: "Поиск", aliases: ["article"], placeholder: "код, название, код продаж, PLU" },
          { type: "multi", name: "model", label: "Артикул", options: articleOpts.model },
          { type: "multi", name: "len", label: "Длина", more: true, options: LENGTH_OPTIONS, allLabel: "Любая" },
          { type: "multi", name: "catgroup", label: "Группа", more: true, options: [...CATEGORY_GROUPS, NO_GROUP].map((g) => ({ value: g === NO_GROUP ? "none" : g, label: g })) },
          { type: "multi", name: "category", label: "Категория", aliases: ["cat"], options: articleOpts.category, noneLabel: "Без категории" },
          { type: "multi", name: "fur", label: "Тип меха", aliases: ["kind"], options: tzOpts.fur, hint: "по ТЗ изделия" },
          { type: "multi", name: "color", label: "Цвет", more: true, options: tzOpts.color },
          { type: "multi", name: "tz", label: "ТЗ", more: true, options: tzOpts.tz },
          { type: "multi", name: "tzyear", more: true, label: year === "all" ? "Год" : `Год (внутри ${year})`, options: tzOpts.tzyear, hint: "год ТЗ; дополнительно к общему году в шапке" },
          { type: "multi", name: "batch", label: "Партия пошива", options: tzOpts.batch, noneLabel: "Вне партий" },
          { type: "multi", name: "lining", label: "Подкладка", more: true, options: [{ value: "yes", label: "Да — есть подкладка" }, { value: "no", label: "Нет подкладки" }], hint: "по ТЗ: подкладка указана или списана" },
          { type: "multi", name: "size", label: "Размер изделия", options: tzOpts.size, more: true },
          { type: "multi", name: "season", label: "Сезон", options: tzOpts.season, noneLabel: "Без сезона", more: true },
          ...(paramOpts.length ? [{ type: "multi" as const, name: "param", label: "Параметры", more: true, options: paramOpts, hint: "свои параметры артикула из карточки" }] : []),
          { type: "multi", name: "price", label: "Цена", more: true, options: [{ value: "yes", label: "Есть цена" }, { value: "no", label: "Нет цены" }] },
        ]}
      />
      </div>

      <ProdTiles
        orders={[...drill, ...repairDrill]}
        c4={c4Mode}
        treeId="orders-tree"
        id="articles"
        title="Итоги выпуска"
        defaultCollapsed
        headerEnd={<Link href="/production" className="text-xs text-blue-700 hover:underline print:hidden">→ ТЗ</Link>}
        extraCount={1}
        carousel
        perUnit={<PerUnitCarousel key="per-unit" orders={drill} c4={c4Mode} />}
        extra={<MarkupCarousel key="markup" rows={markupRows} />}
      />

      {supplierMade.size > 0 && (
        <p className="print:hidden text-sm">
          {f.src === "supplier"
            ? <Link href="/articles" className="text-blue-700 hover:underline">← Все артикулы</Link>
            : <>Внёс Веллмех: <Link href="/articles?src=supplier" className="font-medium text-blue-700 hover:underline">{supplierMade.size} {supplierMade.size === 1 ? "артикул" : "артикулов"}</Link> — «Новые от Веллмеха»; без цены: <Link href="/articles?src=supplier&price=no" className="font-medium text-blue-700 hover:underline">{rows0.filter((r) => r.bySupplier && !r.sellingPrice).length}</Link></>}
        </p>
      )}

      <ResponsiveRows table={
      <Table anchor="table:articles" label="Таблица изделий" stickyHeader stickyFirst data-colset="articles" className="min-w-[960px]">
        <Thead>
          <Tr>
            <Th data-col="name" {...ath("name")}>Артикул</Th>
            <Th data-col="photos" {...ath("photos")}>Фото</Th>
            <Th data-col="plu" {...ath("plu")}>PLU</Th>
            <Th data-col="shop"><span className="sr-only">Ссылка на магазин</span></Th>
            <Th data-col="category" {...ath("category")}>Категория / группа</Th>
            <Th data-col="fur" {...ath("fur")}>Тип меха</Th>
            <Th data-col="color" {...ath("color")}>Цвет</Th>
            <Th data-col="sizes" {...ath("sizes")}>Размеры</Th>
            <Th data-col="lining" {...ath("lining")}>Состав подкладки</Th>
            <Th data-col="qty" {...ath("qty")} className="text-right" unit="шт." after={<InfoHint label="Что такое «в выпуске»">Все ТЗ артикула без отменённых и без ремонта: готово (завершённые) + в работе (план ТЗ «В работе» и «Запланировано») — как на Главной.</InfoHint>}>В выпуске</Th>
            <Th data-col="furQty" {...ath("furQty")} className="text-right" unit="шт." after={<InfoHint label="Шкуры">Сколько шкур списано в ТЗ артикула и сколько в среднем на 1 изделие (шкур ÷ в выпуске).</InfoHint>}>Шкур</Th>
            <Th data-col="furSum" {...ath("furSum")} className="text-right" unit="₽" after={<InfoHint label="Сумма шкур">Стоимость списанных шкур: основная цифра с 4 %, мелко — без 4 %. Включена в «Полную себестоимость итого». Цена за шкуру по видам меха — в карточке артикула.</InfoHint>}>Шкуры</Th>
            <Th data-col="liningQty" {...ath("liningQty")} className="text-right" unit="м">Подкладка</Th>
            <Th data-col="liningSum" {...ath("liningSum")} className="text-right" unit="₽">Подкладка</Th>
            <Th data-col="work" {...ath("work")} className="text-right" unit="₽">Работа</Th>
            <Th data-col="total" {...ath("total")} className="text-right" unit="₽" after={<InfoHint label="Из чего складывается">Шкуры + подкладка + 4 % + расходы + работа по всем ТЗ артикула. Итог равен «Полной себестоимости (с работой)» изделий (без ремонта) на Главной. Основная цифра — с 4 %, мелко — без 4 %.</InfoHint>}>Себестоимость итого</Th>
            <Th data-col="unit" {...ath("unit")} className="text-right" unit="₽/шт." after={<InfoHint label="Полная себестоимость единицы">Полная себестоимость итого ÷ «В выпуске».</InfoHint>}>Средневзв. себестоимость</Th>
            <Th data-col="vat">
              НДС
              <InfoHint label="НДС">Ставки НДС в строках списания шкур и подкладки (из лотов или заданные в ТЗ). Все суммы в таблице показываются «с НДС» или «без НДС» по переключателю в шапке.</InfoHint>
            </Th>
            <Th data-col="price" {...ath("price")} className="text-right" unit="₽" after={<InfoHint label="Розничная цена">Розничная цена артикула с НДС. Правится прямо здесь: Enter или переход в другое поле сохраняет, рядом появляется «Сохранено». Применяется к ТЗ в плане и в работе.</InfoHint>}>Цена с НДС</Th>
            <Th data-col="markup" {...ath("markup")} className="text-right" after={<InfoHint label="Как считается наценка">Розничная цена ÷ полная себестоимость за ед. (с работой, с НДС, с 4 %) — по всем ТЗ артикула (завершённым и в работе). В «Аналитика → Цены» база другая: себестоимость сырья без работы, только завершённые ТЗ. Пример: цена 10 000 ₽ при себестоимости 4 000 ₽ — ×2,50.</InfoHint>}>Наценка</Th>
            <Th data-col="orders" {...ath("orders")} className="text-right">ТЗ</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r) => (
            <Tr key={r.id} className={r.isActive ? "" : "opacity-60"}>
              <Td data-col="name" className="font-medium">
                <Link href={`/models/${r.id}`} className="text-blue-700 hover:underline" title="Карточка артикула">
                  <ArticleName model={r.model} compact />
                </Link>
                {r.bySupplier && <span className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-800" title="Артикул завёл поставщик — проверьте и проставьте цену">внёс: Веллмех</span>}
              </Td>
              <Td data-col="photos">
                <div className="flex items-center gap-2 whitespace-nowrap">
                {photoSummary.get(r.id) ? (() => {
                  const ex = galleryExtras(photoSummary.get(r.id)!, shopLinksAll.get(r.id) ?? [], colorRefs);
                  return <PhotoGalleryButton modelId={r.id} photos={photoSummary.get(r.id)!} groups={ex.groups} shops={ex.shops} title={r.name} compact {...(canCreate ? { onDelete: deleteArticlePhoto, onDeleteAll: deleteAllArticlePhotos } : {})} />;
                })() : null}
                {canCreate && <ArticleShopEditor modelId={r.id} title={r.name} />}
                </div>
              </Td>
              <Td data-col="plu" className="text-xs tabular-nums text-neutral-700">
                {r.plus.map((x) => <div key={x.plu} className="whitespace-nowrap">{x.plu}{r.plus.length > 1 && x.label ? <span className="text-[11px] text-neutral-400"> · {x.label}</span> : null}</div>)}
              </Td>
              <Td data-col="shop" className="w-12">
                {(() => {
                  const links = shopLinksAll.get(r.id) ?? [];
                  return links[0] ? <a href={links[0].url} target="_blank" rel="noopener noreferrer" aria-label="Товар в магазине" title={links.length > 1 ? `Товар в магазине (первая из ${links.length} страниц; остальные — в окне «Фото»)` : "Товар в магазине"} className="inline-flex size-11 items-center justify-center rounded-lg border border-neutral-300 bg-white text-sm hover:bg-neutral-50 sm:size-9">↗</a> : null;
                })()}
              </Td>
              <Td data-col="category" className="text-neutral-700">
                <div>{r.model.category?.trim() || "—"}</div>
                {r.group !== NO_GROUP ? <div className="text-[11px] text-neutral-400">{r.group}</div> : null}
              </Td>
              <Td data-col="fur" className="text-neutral-700" title={r.met.furNames.join(", ")}>
                {r.primaryFur ?? "—"}
                {r.met.furNames.length > 1 ? <span className="text-[11px] text-neutral-400"> +{r.met.furNames.length - 1}</span> : null}
              </Td>
              <Td data-col="color" className="text-neutral-700" title={r.colors.join(", ")}>
                {r.colors.length ? r.colors.slice(0, 2).join(", ") : "—"}
                {r.colors.length > 2 ? <span className="text-[11px] text-neutral-400"> +{r.colors.length - 2}</span> : null}
              </Td>
              <Td data-col="sizes" className="text-neutral-700 text-xs" title={r.sizes}>{r.sizes ? (r.sizes.length > 24 ? `${r.sizes.slice(0, 24)}…` : r.sizes) : "—"}</Td>
              <Td data-col="lining" className="text-neutral-700 text-xs" title={r.lining}>{r.lining ? (r.lining.length > 32 ? `${r.lining.slice(0, 32)}…` : r.lining) : "—"}</Td>
              <Td data-col="qty" className="text-right tabular-nums">{r.qty > 0 ? formatQty(r.qty) : "—"}</Td>
              <Td data-col="furQty" className="text-right tabular-nums">
                {r.met.fur.qty > 0 ? formatQty(Math.round(r.met.fur.qty * 100) / 100) : "—"}
                {r.met.fur.qty > 0 && r.qty > 0 ? <div className="text-[11px] text-neutral-400">{perItem(r.met.fur.qty, r.qty)} шк./изд.</div> : null}
                {r.supplierFur ? <div className="text-[11px] text-neutral-400" title="Заявка подрядчика по артикулу, не итог по ТЗ">подрядчик: {r.supplierFur} шк./изд.</div> : null}
              </Td>
              <Td data-col="furSum" className="text-right"><CostTwo on={r.met.fur.on} off={r.met.fur.off} /></Td>
              <Td data-col="liningQty" className="text-right tabular-nums">
                {r.met.lining.qty > 0 ? formatQty(Math.round(r.met.lining.qty * 100) / 100) : "—"}
                {r.met.lining.qty > 0 && r.qty > 0 ? <div className="text-[11px] text-neutral-400">{perItem(r.met.lining.qty, r.qty)} м/изд.</div> : null}
              </Td>
              <Td data-col="liningSum" className="text-right"><CostTwo on={r.met.lining.on} off={r.met.lining.off} /></Td>
              <Td data-col="work" className="text-right tabular-nums">
                {r.met.work > 0 ? <Money incl={r.met.work.toFixed(2)} excl={r.met.work.toFixed(2)} /> : "—"}
                {r.supplierWork ? <div className="text-[11px] text-neutral-400" title="Заявка подрядчика по артикулу, не итог по ТЗ">подрядчик: {r.supplierWork}/изд.</div> : null}
              </Td>
              <Td data-col="total" className="text-right"><CostTwo on={r.costIncl > 0 ? r.met.total.on : null} off={r.met.total.off} /></Td>
              <Td data-col="unit" className="text-right"><CostTwo on={r.met.unit ? r.met.unit.on : null} off={r.met.unit ? r.met.unit.off : null} /></Td>
              <Td data-col="vat" className="whitespace-nowrap tabular-nums text-neutral-700" title="Ставки НДС в строках списания">{r.met.vatRates.length ? r.met.vatRates.map((v) => `${v} %`).join(", ") : "—"}</Td>
              <Td data-col="price" className="text-right">
                <ArticlePriceForm modelId={r.id} sellingPrice={r.sellingPrice?.toString() ?? ""} canEdit={canCreate} />
              </Td>
              <Td data-col="markup" className="text-right tabular-nums">{r.markup ? fmtX(r.markup) : "—"}</Td>
              <Td data-col="orders" className="text-right tabular-nums">
                {r.orderCount > 0 ? (
                  <Link href={`/production?model=${r.id}`} className="text-blue-700 hover:underline" title="ТЗ этого артикула">
                    {r.orderCount}
                  </Link>
                ) : (
                  "—"
                )}
                <div><Link href={`/sales/movement?m=${encodeURIComponent(r.name)}`} className="text-[11px] text-blue-700 hover:underline" title="Приход, продажи и остаток артикула">продажи</Link></div>
              </Td>
            </Tr>
          ))}
          {rows.length > 0 && (
            <Tr className="row-total">
              <Td data-col="name"><TotalLabel unit="шт." /></Td>
              <Td data-col="photos" /><Td data-col="plu" /><Td data-col="shop" /><Td data-col="category" /><Td data-col="fur" /><Td data-col="color" /><Td data-col="sizes" /><Td data-col="lining" />
              <Td data-col="qty" className="text-right tabular-nums">{totalQty > 0 ? formatQty(totalQty) : "—"}</Td>
              <Td data-col="furQty" className="text-right tabular-nums">{totalFurQty > 0 ? formatQty(Math.round(totalFurQty * 100) / 100) : "—"}</Td>
              <Td data-col="furSum" className="text-right"><CostTwo on={sumPair((r) => r.met.fur.on)} off={sumPair((r) => r.met.fur.off)} /></Td>
              <Td data-col="liningQty" className="text-right tabular-nums">{totalLiningQty > 0 ? formatQty(Math.round(totalLiningQty * 100) / 100) : "—"}</Td>
              <Td data-col="liningSum" className="text-right"><CostTwo on={sumPair((r) => r.met.lining.on)} off={sumPair((r) => r.met.lining.off)} /></Td>
              <Td data-col="work" className="text-right tabular-nums"><Money incl={sum((r) => r.met.work).toFixed(2)} excl={sum((r) => r.met.work).toFixed(2)} /></Td>
              <Td data-col="total" className="text-right"><CostTwo on={totalQty > 0 || totalCostIncl > 0 ? sumPair((r) => r.met.total.on) : null} off={sumPair((r) => r.met.total.off)} /></Td>
              <Td data-col="unit" className="text-right">{totalQty > 0 ? <CostTwo on={{ incl: totalCostIncl / totalQty, excl: totalCostExcl / totalQty }} off={{ incl: sumPair((r) => r.met.total.off).incl / totalQty, excl: sumPair((r) => r.met.total.off).excl / totalQty }} /> : "—"}</Td>
              <Td data-col="vat" /><Td data-col="price" /><Td data-col="markup" /><Td data-col="orders" />
            </Tr>
          )}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={22} className="py-8 text-center text-neutral-500">
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
            subtitle={[r.model.category?.trim(), r.group !== NO_GROUP ? r.group : null, r.primaryFur, r.colors.slice(0, 2).join(", ") || null].filter(Boolean).join(" · ") || undefined}
            href={`/models/${r.id}`}
            fields={[
              { label: "В выпуске, шт.", value: r.qty > 0 ? formatQty(r.qty) : "—", strong: true },
              { label: "Полная себестоимость итого", value: <CostTwo on={r.costIncl > 0 ? r.met.total.on : null} off={r.met.total.off} /> },
              { label: "За ед.", value: <CostTwo on={r.met.unit ? r.met.unit.on : null} off={r.met.unit ? r.met.unit.off : null} /> },
              { label: "Наценка", value: r.markup ? fmtX(r.markup) : "—" },
              { label: "ТЗ", value: r.orderCount > 0 ? <Link href={`/production?model=${r.id}`} className="underline">{r.orderCount}</Link> : "—" },
            ]}
            details={[
              ...(() => {
                const ph = photoSummary.get(r.id);
                const ex = ph ? galleryExtras(ph, shopLinksAll.get(r.id) ?? [], colorRefs) : null;
                const links = shopLinksAll.get(r.id) ?? [];
                return [
                  ...(ph && ex ? [{ label: "Фото", value: <PhotoGalleryButton modelId={r.id} photos={ph} groups={ex.groups} shops={ex.shops} title={r.name} compact {...(canCreate ? { onDelete: deleteArticlePhoto, onDeleteAll: deleteAllArticlePhotos } : {})} /> }] : []),
                  ...(r.plus.length ? [{ label: "PLU", value: r.plus.map((x) => x.plu + (r.plus.length > 1 && x.label ? ` · ${x.label}` : "")).join(", ") }] : []),
                  ...(links[0] ? [{ label: "Товар в магазине", value: <a href={links[0].url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-blue-700 underline">Открыть ↗</a> }] : []),
                  ...(canCreate ? [{ label: "Магазин и фото", value: <ArticleShopEditor modelId={r.id} title={r.name} /> }] : []),
                ];
              })(),
              { label: "Шкур, шт.", value: r.met.fur.qty > 0 ? `${formatQty(Math.round(r.met.fur.qty * 100) / 100)}${r.qty > 0 ? ` (${perItem(r.met.fur.qty, r.qty)}/изд.)` : ""}` : "—" },
              { label: "Шкуры, сумма", value: <CostTwo on={r.met.fur.on} off={r.met.fur.off} /> },
              { label: "Подкладка, м", value: r.met.lining.qty > 0 ? `${formatQty(Math.round(r.met.lining.qty * 100) / 100)}${r.qty > 0 ? ` (${perItem(r.met.lining.qty, r.qty)}/изд.)` : ""}` : "—" },
              { label: "Подкладка, сумма", value: <CostTwo on={r.met.lining.on} off={r.met.lining.off} /> },
              { label: "Работа", value: r.met.work > 0 ? <Money incl={r.met.work.toFixed(2)} excl={r.met.work.toFixed(2)} /> : "—" },
              { label: "НДС в списаниях", value: r.met.vatRates.length ? r.met.vatRates.map((v) => `${v} %`).join(", ") : "—" },
            ]}
            extra={
              <div>
                <div className="mb-1 text-xs text-neutral-500">Розничная цена, с НДС</div>
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
        hint={<p>Количество — «В выпуске» (готово + в работе) как на Главной (все ТЗ без отменённых и без ремонта). Номер артикула ведёт в его карточку, номер ТЗ — в карточку ТЗ; в составе — ссылки на лот и закупку. Ремонт здесь не показывается — см. «Ремонт».</p>}
        empty="ТЗ по выбранным изделиям нет."
      />

      {markupTotal ? (
        <details className="rounded-lg border border-neutral-200 bg-white" data-testid="articles-markup">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium max-md:py-3">Наценка по меху и категориям</summary>
          <div className="overflow-x-auto border-t border-neutral-200">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <Th>Мех</Th>
                <Th>Категория</Th>
                <Th className="text-right" unit="шт.">Артикулов</Th>
                <Th className="text-right" unit="₽">Ср. розничная цена</Th>
                <Th className="text-right">
                  Ср. наценка
                  <InfoHint label="Как считается средневзвешенная наценка">Взвешено по выпуску (артикулы с ценой): цена = Σ(цена × выпуск) ÷ Σ выпуск, наценка = Σ(цена × выпуск) ÷ Σ(себестоимость ед. × выпуск). Мех артикула — тот, на который списано больше всего меха в его ТЗ. Считается по артикулам после фильтров.</InfoHint>
                </Th>
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
              <tr className="row-total">
                <td className="px-3 py-1.5"><TotalLabel unit="₽" avg /></td>
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
