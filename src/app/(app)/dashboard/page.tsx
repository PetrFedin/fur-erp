import Link from "next/link";
import { IntegrityBanner } from "@/components/integrity-banner";
import { requireSession } from "@/lib/session";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { InfoHint } from "@/components/info-hint";
import { getYearFilter, yearLabel } from "@/lib/year-filter";
import { FilterBar } from "@/components/filters/filter-bar";
import { loadDashboard } from "@/lib/dashboard-data";
import { CATEGORY_GROUPS, noGroupLabelFor } from "@/lib/category-groups";
import { KIND_LABELS, lotFiltersOn, orderFiltersOn, parseDashFilters, type DashFilters } from "@/lib/dashboard-calc";
import { RawBlock } from "./raw-block";
import { PayTiles } from "./pay-tiles";
import { ProductionBlock } from "./production-block";
import { YearsTable, RawTable } from "./dynamics-tables";
import { PrintButton } from "./print-button";
import { PriceCompositionBlock } from "./price-composition-block";
import { priceComposition } from "@/lib/price-composition-server";
import { FurScope } from "@/components/fur-scope";
import { PageModes, type ModeInfo } from "./mode-line";
import { SalesBlockView } from "./sales-block";
import { SeasonScope } from "./season-scope";
import { CashflowOverview } from "../cashflow/cashflow-view";
import { loadCashflowOverview } from "@/lib/cashflow-server";
import { parsePeriod } from "@/lib/cashflow";
import { loadSalesBlock } from "./sales-block-data";

export const metadata = { title: "Главная" };

const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 8mm; }
  html { font-size: 10px; }
  html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .h-screen { height: auto !important; }
  .overflow-hidden, main { overflow: visible !important; }
  nav, aside, header, body > .fixed, body > div.fixed, button.fixed, [data-nextjs-dev-tools-button], nextjs-portal { display: none !important; }
  main { padding: 0 !important; }
  [class*="overflow-x-auto"], [class*="overflow-auto"], .table-scroll { overflow: visible !important; max-height: none !important; }
  table { font-size: 9px !important; min-width: 0 !important; width: 100% !important; }
  th, td { white-space: normal !important; }
  tr { break-inside: avoid; }
  section { break-inside: avoid-page; }
  [data-print-date] { display: block !important; }
}`;

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const session = await requireSession();
  const c4Mode = await getCommission4Mode();
  const sp = await searchParams;
  const forbidden = sp.error === "forbidden";
  const organizationId = session.user.organizationId;
  const year = await getYearFilter();
  const f = parseDashFilters(sp);
  const filtersOn = lotFiltersOn(f) || orderFiltersOn(f);

  const d = await loadDashboard(organizationId, year, f, c4Mode);
  const pc = await priceComposition(organizationId, d);
  // Продажи и остатки: внешний поставщик сюда не попадает (requireSession перенаправляет его в /supplier), данные не грузим для него и подавно.
  const salesBlock = session.user.role === "SUPPLIER" ? null : await loadSalesBlock(organizationId, c4Mode, year, f.fur);
  const cashflow = session.user.role === "SUPPLIER" ? null : await loadCashflowOverview(organizationId, d.rawMoneyTotal.unreceived.names);
  const yl = yearLabel(year);
  const search: Record<string, string[]> = { auction: f.auction, fur: f.fur, color: f.color, attr: f.attr, batch: f.batch, catgroup: f.catgroup, kind: f.kind ?? [] };
  const prodNums = (t: typeof d.prod.done) => ({ items: t.items, repairOrders: t.repairOrders, repairQty: t.repairQty, repairCostIncl: t.repairCostIncl, repairCostExcl: t.repairCostExcl, orders: t.orders, qty: t.qty, costIncl: t.costIncl, costExcl: t.costExcl, work: t.workSum, furIncl: t.furIncl, furExcl: t.furExcl, liningIncl: t.liningIncl, liningExcl: t.liningExcl, matIncl: t.furIncl + t.liningIncl, matExcl: t.furExcl + t.liningExcl, c4Incl: t.c4Incl, c4Excl: t.c4Excl });
  const FILTER_NAMES: [keyof DashFilters, string][] = [["auction", "аукцион / закупка"], ["fur", "вид меха"], ["color", "цвет"], ["attr", "признак меха"], ["batch", "партия пр-ва"], ["catgroup", "группа категорий"], ["kind", "тип"]];
  const activeFilters = FILTER_NAMES.filter(([k]) => (f[k]?.length ?? 0) > 0).map(([k, n]) => `${n} ×${f[k]?.length ?? 0}`).join(", ");
  const info: ModeInfo = { year: yl, filters: activeFilters || null };
  // Ссылки «→ Сырьё» и «→ ТЗ» несут фильтры Главной, которые понимает целевая страница (год, НДС и 4% — общие, из шапки):
  // «Сырьё» — вид меха, цвет, признак и партию закупки (в таблице «Мех» это параметр batch); «ТЗ» — партию закупки, вид меха, признак, партию производства и группу категорий.
  const qs = (pairs: [string, string[]][]) => {
    const p = new URLSearchParams();
    for (const [k, vs] of pairs) for (const v of vs) p.append(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const rawHref = "/lots" + qs([["fur", f.fur], ["color", f.color], ["attr", f.attr], ["batch", f.auction]]);
  const prodHref = "/production" + qs([["auction", f.auction], ["fur", f.fur], ["attr", f.attr], ["batch", f.batch], ["catgroup", f.catgroup]]);

  const SeasonWrap = ({ children }: { children: React.ReactNode }) => (salesBlock ? <SeasonScope keys={salesBlock.seasons.map((x) => x.key)}>{children}</SeasonScope> : <>{children}</>);
  return (
    <div className="flex flex-col gap-5">
      <style>{PRINT_CSS}</style>
      <IntegrityBanner />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Режимы и «i» — рядом с заголовком, а не внутри: иначе имя заголовка читается как «Сводка · все годы · с НДС … i». */}
        <div className="flex flex-wrap items-center">
          <h1 className="text-xl font-semibold">Главная</h1>
          <PageModes info={info} c4={c4Mode} />
        </div>
        <div className="flex items-center gap-2">
          <span className="relative inline-flex print:hidden" data-scheme-btn>
            <span aria-hidden className="absolute inset-0 animate-ping rounded-md bg-orange-400/60 motion-reduce:animate-none" />
            <Link href="/scheme" className="relative rounded-md border border-orange-500 bg-orange-500 px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-orange-600">Схема</Link>
          </span>
          <PrintButton />
        </div>
      </div>
      <p data-print-date className="hidden text-xs text-neutral-600">
        Напечатано: {new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "long", timeStyle: "short" })} (МСК) · {yl}{activeFilters ? ` · фильтры: ${activeFilters}` : ""}
      </p>
      {forbidden && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Недостаточно прав для этого действия
        </div>
      )}

      <div className="print:hidden">
        <FilterBar
          title="Фильтры сводки"
          oneRow
          hideChips
          dropOnChange={["status", "vat", "nds"]}
          controls={[
            { type: "multi", name: "auction", label: "Аукцион / закупка", aliases: ["auc"], options: d.options.auction, allLabel: "Все партии" },
            { type: "multi", name: "fur", label: "Вид меха", options: d.options.fur },
            { type: "multi", name: "color", label: "Цвет", options: d.options.color, allLabel: "Все цвета", noneLabel: d.noColorLots > 0 ? "Цвет не указан в документах" : undefined, hint: "Цвет лота по справочнику" },
            { type: "multi", name: "batch", label: "Партия производства", options: d.options.batch, noneLabel: "Вне партий", allLabel: "Все партии" },
            { type: "multi", name: "kind", label: "Тип", single: true, options: [{ value: "prod", label: KIND_LABELS.prod }, { value: "repair", label: KIND_LABELS.repair }], allLabel: "Все", hint: "Производство — все ТЗ, кроме ремонта" },
            ...(d.options.attr.length > 0 ? [{ type: "multi" as const, name: "attr", label: "Признак меха", options: d.options.attr, allLabel: "Все признаки", more: true, noneLabel: "Без признака", hint: "Из справочника: седина, дикий / клеточный, тонированный…" }] : []),
            { type: "multi", name: "catgroup", label: "Группа категорий", options: CATEGORY_GROUPS.map((g) => ({ value: g, label: g })), noneLabel: noGroupLabelFor(d.noGroup.repair, d.noGroup.other), allLabel: "Все группы", more: true, hint: "«Ремонт (без группы)» — у категории «Ремонт» в справочнике нет группы" },
          ]}
          footer={
            <div className="mt-2 flex items-center gap-1 text-[11px] leading-4 text-neutral-500">
              <InfoHint label="Что фильтруется на Главной" wide>
                <p>Год — общий, из шапки ({year === "all" ? "все годы" : `${year} год`}); ставки НДС показаны внутри карточек.</p>
                <p className="mt-1">Аукцион / закупка, вид меха, цвет и признак отбирают лоты (куплено, остаток, использовано) и ТЗ, где списан такой лот. Вид меха без лотов (например, бобр подрядчика) отбирает только ТЗ. Партия производства, группа категорий и тип отбирают ТЗ.</p>
                <p className="mt-1">Фильтры сужают «Сырьё», «Производство», обе таблицы динамики и, по виду меха, «Продажи и остатки». «Оплаты» показывают деньги по выбранным лотам. Cashflow от фильтров не зависит: это все платежи и вся выручка{filtersOn ? " — сейчас фильтры включены" : ""}.</p>
              </InfoHint>
            </div>
          }
        />
      </div>

      {/* ───────── Оплаты, долги, задачи ───────── */}
      <PayTiles d={d} c4Mode={c4Mode} year={year} headerEnd={<Link href="/payments" className="text-xs text-blue-700 hover:underline print:hidden">Оплаты ›</Link>} />

      {cashflow ? <CashflowOverview incl={cashflow.incl} ex={cashflow.ex} salesAll={cashflow.salesAll} period={parsePeriod(String(year))} prepaidBy={cashflow.prepaidBy} /> : null}


      {/* ───────── Главное: ключевые цифры одной полосой, каждая плитка ведёт в раздел ───────── */}

      {/* Область действия переключателя источника меха: только эти четыре блока; всё ниже (производство, оплаты) от него не зависит. */}
      <FurScope info={info}>
        <RawBlock href={rawHref} rows={d.rawTable} fur={d.raw.fur} lining={d.raw.lining} c4={c4Mode} lots={d.raw.lots} info={info} orderFilters={orderFiltersOn(f)} vat={d.vat} furSrc={d.rawFurBySource} />

        <YearsTable rows={d.years} bySrc={d.yearsFurBySrc} c4={c4Mode} info={info} />

        <RawTable auctionSrc={d.auctionSrc} rows={d.rawTable} total={d.rawTableTotal} money={d.rawMoneyTotal} c4={c4Mode} info={info} orderFilters={orderFiltersOn(f)} vatRates={d.vat} />

        {/* ───────── Из чего складывается стоимость меха (сразу под «Динамикой по сырью») ───────── */}
        <PriceCompositionBlock lots={pc.lots} href={rawHref} collapsed />

      </FurScope>

      {/* Панель «Сезон» начинается с «Производства» и закреплена сверху при прокрутке «Производства» и «Продаж и остатков». */}
      <SeasonWrap>
        <ProductionBlock href={prodHref} vatCost={d.vat.cost} kind={f.kind?.[0] ?? ""} hides={d.hides} c4Parts={{ fur: { incl: Math.abs(d.raw.fur.incl.usedValue - d.raw.fur.incl.usedValueOther), excl: Math.abs(d.raw.fur.excl.usedValue - d.raw.fur.excl.usedValueOther) }, lining: { incl: Math.abs(d.raw.lining.incl.usedValue - d.raw.lining.incl.usedValueOther), excl: Math.abs(d.raw.lining.excl.usedValue - d.raw.lining.excl.usedValueOther) } }} years={d.years.filter((y) => y.key !== "all").map((y) => ({ label: y.label, qty: y.prod.qty }))} done={prodNums(d.prod.done)} all={prodNums(d.prod.all)} work={prodNums(d.prod.work)} c4={c4Mode} search={search} info={info} bridge={{ usedBase: d.bridge.usedBase, comparable: d.bridge.usedComparable, lotFilters: lotFiltersOn(f), yearOnly: year !== "all" }} />

        {/* ───────── Продажи и остатки (после «Оплат», последним на странице) ───────── */}
        {salesBlock ? <SalesBlockView b={salesBlock} /> : null}
      </SeasonWrap>
    </div>
  );
}
