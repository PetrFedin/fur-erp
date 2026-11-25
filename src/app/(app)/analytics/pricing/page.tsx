import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { WidgetRow } from "@/components/widget-row";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix } from "@/lib/commission4";
import { buttonVariants } from "@/components/ui/button";
import { Segmented } from "@/components/segmented";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Money } from "@/components/money";
import { InfoHint } from "@/components/info-hint";
import { TILE_BOX, TileHead, TileValue } from "@/app/(app)/dashboard/tile";
import { YearNote } from "@/components/year-note";
import { Mode4Badge } from "@/components/c4-note";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { formatQty, formatMarkupPct, formatMarkup } from "@/lib/utils";
import { loadOrderRows } from "@/lib/analytics-orders";
import { ACC_CATEGORIES, VIEW_LABEL, aggregatePricing, calcPrice, defaultMarkupPct, loadModelPrices, parsePricingCols, parsePricingParams, parsePricingSort, parseTargetMarkup, pricingParams, sortPricing, type PriceAgg, type PricingParams, type PricingView } from "@/lib/analytics-pricing";
import { applyShared, filterOptions } from "@/lib/analytics-filters";
import { COLUMNS } from "@/lib/analytics-metrics";
import { weightedPercent } from "@/lib/weighted";
import { auctionLabeler } from "@/lib/filter-options";
import { AnalyticsFilterBar } from "../_shared/analytics-filter-bar";
import { MetricCell, MobileSort, SortTh, ViewBar, colLabel, sortHref } from "../_shared/metric-ui";
import { pricingIssues } from "./_page/format";
import { Bar } from "./_page/bar";
import { pricingDetails } from "./_page/details";
import { pricingCells } from "./_page/cells";
import { DataQuality } from "./_page/data-quality";
import { PricingAboutHint } from "./_page/about-hint";

export const metadata = { title: "Себестоимость и цены" };

const grpOk = (g: "" | "clothes" | "acc", cat: string) => g === "" || (g === "acc") === ACC_CATEGORIES.includes(cat);

export default async function PricingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const year = await getYearFilter();
  const c4Mode = await getCommission4Mode();
  const c4 = c4Suffix(c4Mode);
  const sp = await searchParams;
  const p = parsePricingParams(sp);
  // Раскрытая карточка артикула: подробности (лоты, ТЗ, состав) строятся только для неё —
  // иначе страница весила ~8 МБ и считалась ~9 с.
  const openRaw = sp.open;
  const openKey = (Array.isArray(openRaw) ? openRaw[0] : openRaw) ?? "";
  const canEditPrice = hasRole(session.user.role, ACCESS.models);
  const orgId = session.user.organizationId;
  const cols = parsePricingCols(p.cols, p.all);
  const sortState = parsePricingSort(p.sort, p.dir);

  const [allYear, prices] = await Promise.all([loadOrderRows(orgId, year, c4Mode), loadModelPrices(orgId)]);
  const aucOf = await auctionLabeler(orgId);
  const opts = filterOptions(allYear);
  const grpCount = (g: "" | "clothes" | "acc") => applyShared(allYear, p).filter((r) => grpOk(g, r.category)).length;
  const all = applyShared(allYear, p).filter((r) => grpOk(p.grp, r.category));
  const models = aggregatePricing(all, "model", prices);
  const def = defaultMarkupPct(models, p.base);
  const defRounded = def.pct != null ? Math.round(def.pct) : null;
  const typed = parseTargetMarkup(p.m);
  const target = typed ?? defRounded;
  const badInput = p.m !== "" && typed == null;

  const listAll = p.view === "model" ? models : aggregatePricing(all, p.view, prices);
  const calcOf = (a: PriceAgg) => calcPrice(a, p.base, a.price);
  const issuesOf = (a: PriceAgg) => pricingIssues(a, p.base);
  const filtered = listAll.filter((a) => (p.only === "noprice" ? a.modelId && !a.price : p.only === "issues" ? issuesOf(a).length > 0 : true));
  const shown = sortPricing(filtered, sortState.sort, sortState.dir, p.base, target);

  // Средняя наценка категории — по её ценообразованным моделям (вес — себестоимость партии).
  const catMarkup = new Map<string, { pct: number | null; priced: number; total: number }>();
  for (const a of models) {
    const cur = catMarkup.get(a.category) ?? { pct: null, priced: 0, total: 0 };
    cur.total += 1;
    if (a.price) cur.priced += 1;
    catMarkup.set(a.category, cur);
  }
  for (const [cat, v] of catMarkup) {
    const items = models
      .filter((a) => a.category === cat && a.price)
      .map((a) => {
        const c = calcOf(a);
        return c.markupPct != null && c.baseIncl ? { percent: c.markupPct, base: c.baseIncl * a.unitsCosted } : null;
      })
      .filter((x): x is { percent: number; base: number } => x !== null);
    v.pct = weightedPercent(items);
  }

  const modelsNoPrice = models.filter((a) => !a.price);
  const modelsBelow = models.filter((a) => calcOf(a).belowCost);
  const modelsNoUsages = models.filter((a) => a.noUsages.length > 0);
  const modelsZero = models.filter((a) => a.zeroCost.length > 0);
  const noWorkOrders = models.flatMap((a) => a.noWork);
  const inWorkNoCost = all.filter((r) => r.group === "work" && !(r.costIncl > 0));
  const pricedCount = models.filter((a) => a.price).length;
  const exampleModel = models.find((a) => a.price && calcOf(a).markupX && a.unitsCosted >= 3) ?? models.find((a) => a.price && calcOf(a).markupX);
  const exCalc = exampleModel ? calcOf(exampleModel) : null;

  const baseLabel = p.base === "full" ? "полная себестоимость (с работой)" : "себестоимость сырья (без работы)";
  const basis = `наценка ${target != null ? formatMarkupPct(target) : "–"}, база — ${baseLabel}${c4Mode === "on" ? ", с 4%" : ""}`;
  const qs = pricingParams(p).toString();
  const here = (over: Partial<PricingParams> = {}) => {
    const s = pricingParams(p, over).toString();
    return `/analytics/pricing${s ? `?${s}` : ""}`;
  };
  const sortOver = (o: { sort: string; dir: string }) => here({ sort: o.sort, dir: o.dir });
  const thHref = (key: string) => sortHref(sortOver, key, sortState);
  const openHref = (key: string, idx: number) => {
    const base = here();
    return `${base}${base.includes("?") ? "&" : "?"}open=${encodeURIComponent(key)}#row-${idx}`;
  };
  const closeHref = (idx: number) => `${here()}#row-${idx}`;
  // Подробности строки: только у раскрытой; у остальных — ссылка «Показать подробности».
  const lazyDetails = (a: PriceAgg, idx: number) =>
    a.key === openKey ? (
      <div>
        <Link href={closeHref(idx)} scroll={false} className="text-xs text-neutral-500 underline underline-offset-2">Свернуть подробности</Link>
        {details(a)}
      </div>
    ) : (
      <Link href={openHref(a.key, idx)} scroll={false} className="text-xs text-neutral-500 underline underline-offset-2" title="Сводка, состав, лоты, ТЗ">Подробности</Link>
    );

  const details = (a: PriceAgg) => pricingDetails(a, { base: p.base, target, c4Mode, c4 });
  const { costCell, priceCell, markupCell, recOf, recCell, noteCell } = pricingCells({ base: p.base, view: p.view, target, canEditPrice, catMarkup, basis });

  const pickerHidden = Array.from(pricingParams(p, { cols: [], all: false }).entries()) as [string, string][];
  const toggleAll = here(p.cols.length > 0 || !p.all ? { cols: [], all: !p.all || p.cols.length > 0 } : { cols: [], all: false });
  const labelHead = p.view === "model" ? "Модель" : p.view === "category" ? "Категория" : p.view === "fur" ? "Вид меха" : "Мех · категория";

  const mobileSortItems = [
    { key: "label", label: labelHead, href: thHref("label") },
    { key: "units", label: "Единиц", href: thHref("units") },
    { key: "cost", label: "Себестоимость сырья за ед.", href: thHref("cost") },
    ...cols.map((c) => ({ key: c, label: colLabel(c, c4), href: thHref(c) })),
    { key: "price", label: "Цена", href: thHref("price") },
    { key: "markup", label: "Наценка к сырью", href: thHref("markup") },
    { key: "rec", label: "Рекомендуемая цена", href: thHref("rec") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Изделия", href: "/articles" }, { label: "Цены" }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Себестоимость и цены</h1><YearNote year={year} />
          <Mode4Badge mode={c4Mode} />
          <PricingAboutHint exampleModel={exampleModel} exCalc={exCalc} target={target} /></div>
        <a href={`/analytics/pricing/export?${qs}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          CSV: таблица
        </a>
      </div>

      {/* Параметры и фильтры (над виджетами, как на Главной) */}
      <AnalyticsFilterBar
        opts={opts}
        aucOf={aucOf}
        lead={[
          { type: "text", name: "m", label: "Целевая наценка, %", state: true, inputMode: "decimal", placeholder: defRounded != null ? String(defRounded) : "например 300", className: "min-w-0 xl:w-40" },
          { type: "multi", name: "base", label: "База наценки", single: true, state: true, allLabel: "Себестоимость сырья (без работы)", options: [{ value: "full", label: "Полная себестоимость (с работой)" }], className: "min-w-0 xl:w-72" },
          { type: "multi", name: "only", label: "Показывать", single: true, state: true, allLabel: "Все", options: [{ value: "noprice", label: "Только без цены" }, { value: "issues", label: "Только с замечаниями" }] },
        ]}
      />
      {badInput && <span className="text-xs text-red-600">Наценка: введите число, например 350 — взято значение по умолчанию.</span>}

      {/* Сводка */}
      <WidgetRow id="pricing" title="Итоги">
      <div className="grid grid-cols-2 items-stretch gap-3 md:grid-cols-4">
        <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
          <TileHead>Моделей с завершёнными ТЗ</TileHead>
          <TileValue>{models.length}</TileValue>
        </div>
        <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
          <TileHead>С ценой / без цены</TileHead>
          <TileValue>{pricedCount} / <span className={"ml-1 " + (models.length - pricedCount > 0 ? "text-amber-700" : "")}>{models.length - pricedCount}</span></TileValue>
        </div>
        <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
          <TileHead>
            Средняя наценка
            <InfoHint label="Как посчитана" wide>Средневзвешенная по {def.count} моделям с ценой: Σ(наценка × себестоимость партии) ÷ Σ себестоимость партии. База — {baseLabel}{c4Mode === "on" ? ", с 4 %" : ", без 4 %"}.</InfoHint>
          </TileHead>
          <TileValue>{def.pct != null ? formatMarkup(1 + def.pct / 100) : "–"}</TileValue>
        </div>
        <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
          <TileHead>
            Целевая наценка
            <InfoHint label="О целевой наценке">Для рекомендаций по цене. {target != null ? `${formatMarkup(1 + target / 100)} = +${formatMarkupPct(target)}. ` : ""}{typed != null ? "Введена вручную." : defRounded != null ? "По умолчанию — из данных." : "Цен ещё нет — введите вручную."} В поле ниже наценка вводится в процентах: 300 значит цена в 4 раза выше себестоимости (×4).</InfoHint>
          </TileHead>
          <TileValue>{target != null ? formatMarkup(1 + target / 100) : "не задана"}</TileValue>
        </div>
      </div>
      </WidgetRow>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Структура" items={(Object.keys(VIEW_LABEL) as PricingView[]).map((v) => ({ key: v, label: VIEW_LABEL[v], on: p.view === v, href: here({ view: v, sort: "", dir: "desc" }) }))} />
          <Segmented label="Категория" items={([["", "Все"], ["clothes", "Одежда"], ["acc", "Аксессуары"]] as const).map(([g, t]) => ({ key: g || "all", label: <>{t} <span className="ml-1 text-xs opacity-80">{grpCount(g)}</span></>, on: p.grp === g, href: here({ grp: g }) }))} />
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-600" aria-label="Обозначения диаграммы">
          {[
            ["bg-emerald-600", "Мех"],
            ["bg-sky-500", "Подкладка"],
            ["bg-amber-500", "4 %"],
            ["bg-neutral-400", "НДС в материалах"],
            ["bg-violet-500", "Расходы ТЗ"],
            ["bg-rose-500", "Работа"],
          ].map(([c, l]) => (
            <span key={l} className="inline-flex items-center gap-1">
              <span className={`inline-block size-2.5 rounded-sm ${c}`} />
              {l}
            </span>
          ))}
          <InfoHint label="О диаграмме" align="right">Структура полной стоимости единицы (материалы без НДС, НДС отдельно, 4 %, расходы, работа) — сравнение «работа vs расходы vs материалы». Диаграмма всегда считается с НДС.</InfoHint>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ViewBar all={p.all} picked={p.cols.length > 0} cols={cols} toggleAllHref={toggleAll} action="/analytics/pricing" hidden={pickerHidden} />
        <MobileSort items={mobileSortItems} cur={sortState} />
        <span className="text-xs text-neutral-500">Строк: {shown.length}<InfoHint className="ml-1.5" label="Сортировка">Клик по заголовку колонки — сортировка.</InfoHint></span>
      </div>

      <ResponsiveRows
        table={
          <Table>
            <Thead>
              <Tr>
                <SortTh left label={labelHead} href={thHref("label")} active={sortState.sort === "label"} dir={sortState.dir} />
                <SortTh label="Ед." href={thHref("units")} active={sortState.sort === "units"} dir={sortState.dir} hint="Σ изделий по завершённым ТЗ строки (ниже — число ТЗ)." />
                <SortTh
                  label="Себестоимость сырья за ед."
                  suffix={c4}
                  href={thHref("cost")}
                  active={sortState.sort === "cost"}
                  dir={sortState.dir}
                  hint={<>Σ(себестоимость ТЗ) ÷ Σ единиц{p.base === "full" ? " + работа" : ""} по завершённым ТЗ с известной себестоимостью; ниже — разброс себестоимости единицы между ТЗ (мин–макс).</>}
                />
                {cols.map((c) => (
                  <SortTh key={c} label={colLabel(c, c4)} hint={COLUMNS[c].hint} href={thHref(c)} active={sortState.sort === c} dir={sortState.dir} />
                ))}
                <Th>Структура</Th>
                <SortTh label="Цена" href={thHref("price")} active={sortState.sort === "price"} dir={sortState.dir} hint="Розничная цена модели (поле на странице «Изделия»); у категорий и видов меха своей цены нет." />
                <SortTh label="Наценка" href={thHref("markup")} active={sortState.sort === "markup"} dir={sortState.dir} hint="Цена ÷ себестоимость (с НДС, по выбранной базе наценки: по умолчанию себестоимость сырья без работы, только завершённые ТЗ). В «Изделиях» наценка считается от полной себестоимости (с работой) по всем ТЗ — поэтому у одной модели числа разные." />
                <SortTh label="Рекомендуемая цена" href={thHref("rec")} active={sortState.sort === "rec"} dir={sortState.dir} hint="Себестоимость × (1 + целевая наценка), округлено до 100 ₽. Расчёт, не факт." />
              </Tr>
            </Thead>
            <Tbody>
              {shown.map((a, idx) => (
                <Tr key={a.key} id={`row-${idx}`} className={a.modelId && !a.price ? "bg-amber-50/60" : ""}>
                  <Td className="min-w-44 font-medium">
                    <div title={a.modelId ? a.rows[0]?.modelHint : undefined}>{a.modelId ? (a.rows[0]?.modelLabel ?? a.label) : a.label}</div>
                    <div className="mt-0.5 font-normal">{lazyDetails(a, idx)}</div>
                    <div className="text-[11px] font-normal text-neutral-500">
                      {a.modelId ? a.category : p.view === "fur" || p.view === "furcat" ? `${a.modelCount} моделей` : `${a.modelCount} моделей`}
                      {a.modelId && (
                        <>
                          {" · "}
                          <Link href={`/models/${a.modelId}`} className="underline underline-offset-2">карточка модели</Link>
                        </>
                      )}
                    </div>
                    {noteCell(a)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatQty(a.units)}
                    <div className="text-[11px] text-neutral-500">ТЗ {a.orders}{a.inWorkOrders ? ` (+${a.inWorkOrders} в работе)` : ""}</div>
                  </Td>
                  <Td className="text-right tabular-nums">{costCell(a)}</Td>
                  {cols.map((c) => (
                    <Td key={c} className="text-right tabular-nums">
                      <MetricCell col={c} m={a.m} total={a.m} />
                    </Td>
                  ))}
                  <Td className="min-w-40">
                    <Bar a={a} />
                  </Td>
                  <Td className="text-right tabular-nums">{priceCell(a)}</Td>
                  <Td className="text-right tabular-nums">{markupCell(a)}</Td>
                  <Td className="text-right tabular-nums">{recCell(a)}</Td>
                </Tr>
              ))}
              {shown.length === 0 && (
                <Tr>
                  <Td colSpan={7 + cols.length} className="py-8 text-center text-neutral-500">
                    {year !== "all" ? `За ${year} год завершённых ТЗ по этим условиям нет` : "Нет данных по этим условиям"}
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        }
      >
        {shown.map((a, idx) => {
          const r = recOf(a);
          return (
            <RowCard
              key={a.key}
              className={a.modelId && !a.price ? "bg-amber-50/60" : ""}
              title={a.modelId ? (a.rows[0]?.modelLabel ?? a.label) : a.label}
              href={a.modelId ? `/models/${a.modelId}` : undefined}
              subtitle={a.modelId ? a.category : `${a.modelCount} моделей`}
              fields={[
                { label: "Единиц", value: `${formatQty(a.units)} (ТЗ ${a.orders})`, strong: true },
                { label: `Себестоимость сырья за ед.${c4}`, value: costCell(a) },
                { label: "Цена", value: priceCell(a) },
                { label: "Наценка", value: markupCell(a) },
              ]}
              extra={
                <div className="flex flex-col gap-2">
                  <Bar a={a} />
                  {r && (
                    <div className="text-sm">
                      Рекомендуемая цена: <b><Money incl={r.incl} excl={r.excl} /></b>
                      
                    </div>
                  )}
                  {recCell(a)}
                  {noteCell(a)}
                  {lazyDetails(a, idx)}
                </div>
              }
              details={[
                ...cols.map((c) => ({ label: colLabel(c, c4), value: <MetricCell col={c} m={a.m} total={a.m} /> })),
              ]}
            />
          );
        })}
        {shown.length === 0 && <p className="py-8 text-center text-neutral-500">Нет данных по этим условиям</p>}
      </ResponsiveRows>

      {/* Качество данных */}
      <DataQuality
        modelsNoPrice={modelsNoPrice}
        modelsBelow={modelsBelow}
        modelsNoUsages={modelsNoUsages}
        modelsZero={modelsZero}
        inWorkNoCost={inWorkNoCost}
        noWorkOrders={noWorkOrders}
        noPriceHref={here({ only: "noprice", view: "model" })}
      />
    </div>
  );
}
