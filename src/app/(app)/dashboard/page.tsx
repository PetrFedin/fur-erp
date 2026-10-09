import Link from "next/link";
import { IntegrityBanner } from "@/components/integrity-banner";
import { requireSession } from "@/lib/session";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { InfoHint } from "@/components/info-hint";
import { getYearFilter, yearLabel } from "@/lib/year-filter";
import { FilterBar } from "@/components/filters/filter-bar";
import { parseFilters } from "@/lib/filters";
import { loadDashboard } from "@/lib/dashboard-data";
import { CATEGORY_GROUPS, NO_GROUP } from "@/lib/category-groups";
import { DASH_FILTERS, ORDER_STATUS_LABELS, lotFiltersOn, orderFiltersOn, type DashFilters } from "@/lib/dashboard-calc";
import { RawBlock } from "./raw-block";
import { PayTiles } from "./pay-tiles";
import { ProductionBlock } from "./production-block";
import { YearsTable, RawTable } from "./dynamics-tables";
import { PrintButton } from "./print-button";
import { PageModes, type ModeInfo } from "./mode-line";

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
  const f = parseFilters(DASH_FILTERS, sp) as unknown as DashFilters;
  const filtersOn = lotFiltersOn(f) || orderFiltersOn(f);

  const d = await loadDashboard(organizationId, year, f, c4Mode);
  const yl = yearLabel(year);
  const search: Record<string, string[]> = { auction: f.auction, fur: f.fur, color: f.color, attr: f.attr, batch: f.batch, status: f.status, vat: f.vat, catgroup: f.catgroup };
  const prodNums = (t: typeof d.prod.done) => ({ repairOrders: t.repairOrders, repairQty: t.repairQty, repairCostIncl: t.repairCostIncl, repairCostExcl: t.repairCostExcl, orders: t.orders, qty: t.qty, costIncl: t.costIncl, costExcl: t.costExcl, work: t.workSum, furIncl: t.furIncl, furExcl: t.furExcl, liningIncl: t.liningIncl, liningExcl: t.liningExcl, matIncl: t.furIncl + t.liningIncl, matExcl: t.furExcl + t.liningExcl, c4Incl: t.c4Incl, c4Excl: t.c4Excl });
  const FILTER_NAMES: [keyof DashFilters, string][] = [["auction", "партия закупки"], ["fur", "вид меха"], ["color", "цвет"], ["attr", "признак меха"], ["vat", "НДС"], ["status", "статус ТЗ"], ["batch", "партия пр-ва"], ["catgroup", "группа категорий"]];
  const activeFilters = FILTER_NAMES.filter(([k]) => f[k].length > 0).map(([k, n]) => `${n} ×${f[k].length}`).join(", ");
  const info: ModeInfo = { year: yl, filters: activeFilters || null };

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
        <PrintButton />
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
          controls={[
            { type: "multi", name: "auction", label: "Партия закупки (аукцион)", aliases: ["auc"], options: d.options.auction, allLabel: "Все партии" },
            { type: "multi", name: "fur", label: "Вид меха", aliases: ["kind"], options: d.options.fur },
            { type: "multi", name: "color", label: "Цвет", options: d.options.color, allLabel: "Все цвета", noneLabel: d.noColorLots > 0 ? "Цвет не указан в документах" : undefined, hint: "Цвет лота по справочнику" },
            ...(d.options.attr.length > 0 ? [{ type: "multi" as const, name: "attr", label: "Признак меха", options: d.options.attr, allLabel: "Все признаки", noneLabel: "Без признака", hint: "Признаки лота по справочнику: седина, дикий / клеточный, тонированный…" }] : []),
            { type: "multi", name: "batch", label: "Партия производства", options: d.options.batch, noneLabel: "Без партии", allLabel: "Все партии" },
            { type: "multi", name: "catgroup", label: "Группа категорий", options: CATEGORY_GROUPS.map((g) => ({ value: g, label: g })), noneLabel: NO_GROUP, allLabel: "Все группы" },
            { type: "multi", name: "status", label: "Статус ТЗ", options: Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label })), allLabel: "Все статусы" },
            { type: "multi", name: "vat", label: "Ставка НДС", aliases: ["nds"], options: [{ value: "20", label: "20%" }, { value: "22", label: "22%" }], allLabel: "Любая", hint: "Ставка НДС лота" },
          ]}
          footer={
            <p className="mt-2 flex items-center gap-1 text-[11px] leading-4 text-neutral-500">
              Фильтры применяются сразу
              <InfoHint label="Что фильтруется на Главной" wide>
                <p>Год — общий, из шапки ({year === "all" ? "все годы" : `${year} год`}).</p>
                <p className="mt-1">Партия закупки, вид меха, цвет, признак меха и ставка НДС отбирают лоты (куплено, остаток, использовано) и ТЗ, в которых списан такой лот. Статус и партия производства отбирают ТЗ (и «использовано» — только по ним).</p>
                <p className="mt-1">Сужают блоки «Сырьё» и «Производство», обе таблицы динамики и «Долг заказчиков». Долг и оплаты поставщику (по закупкам и оплатам года) от фильтров не зависят{filtersOn ? " — сейчас фильтры включены" : ""}.</p>
              </InfoHint>
            </p>
          }
        />
      </div>

      <RawBlock rows={d.rawTable} fur={d.raw.fur} lining={d.raw.lining} c4={c4Mode} lots={d.raw.lots} info={info} orderFilters={orderFiltersOn(f)} />

      <YearsTable rows={d.years} c4={c4Mode} info={info} />

      <RawTable rows={d.rawTable} total={d.rawTableTotal} money={d.rawMoneyTotal} c4={c4Mode} info={info} orderFilters={orderFiltersOn(f)} />

      <ProductionBlock hides={d.hides} c4Parts={{ fur: { incl: Math.abs(d.raw.fur.incl.usedValue - d.raw.fur.incl.usedValueOther), excl: Math.abs(d.raw.fur.excl.usedValue - d.raw.fur.excl.usedValueOther) }, lining: { incl: Math.abs(d.raw.lining.incl.usedValue - d.raw.lining.incl.usedValueOther), excl: Math.abs(d.raw.lining.excl.usedValue - d.raw.lining.excl.usedValueOther) } }} years={d.years.filter((y) => y.key !== "all").map((y) => ({ label: y.label, qty: y.prod.qty }))} done={prodNums(d.prod.done)} work={prodNums(d.prod.work)} c4={c4Mode} search={search} info={info} bridge={{ usedBase: d.bridge.usedBase, comparable: d.bridge.usedComparable, lotFilters: lotFiltersOn(f), yearOnly: year !== "all" }} />

      {/* ───────── Оплаты, долги, задачи ───────── */}
      <section aria-labelledby="dash-pay" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="dash-pay" className="text-base font-semibold">Оплаты</h2>
          <Link href="/payments" className="text-xs text-blue-700 hover:underline print:hidden">→ Оплаты</Link>
        </div>
        <PayTiles d={d} c4Mode={c4Mode} year={year} />
      </section>
    </div>
  );
}
