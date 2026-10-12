import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { getYearFilter } from "@/lib/year-filter";
import { YearNote } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { OrdersTree } from "@/components/orders-tree";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, parseFilters, pick } from "@/lib/filters";
import { loadOrderRows } from "@/lib/analytics-orders";
import { isTzFilterActive, matchedOrderIds, tzOptions, type ArticleFilterValues } from "@/lib/article-filters";
import { RepairTiles } from "./repair-tiles";

// Фильтры ремонта: те же понятия и тот же отбор ТЗ, что на «Изделиях» (уровень ТЗ + артикул).
const REPAIR_FILTERS = defineFilters({
  ...pick(["model", "fur", "color", "batch"], { fur: { label: "Вид (тип) меха" }, batch: { label: "Партия" }, model: { label: "Артикул" } }),
  tz: { kind: "multi", label: "ТЗ", maxLen: 60 },
  tzyear: { kind: "multi", label: "Год ТЗ", pattern: /^\d{4}$/ },
});

export const metadata = { title: "Ремонт" };

/** Ремонт — отдельно от производства изделий: ТЗ на ремонт не входят в «Произведено» и в средние цены, считаются здесь (данные те же, что на Главной). */
export default async function RepairPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseFilters(REPAIR_FILTERS, await searchParams);
  const session = await requireSession();
  const c4 = await getCommission4Mode();
  const year = await getYearFilter();
  const repairAll = (await loadOrdersDrill(session.user.organizationId, year, c4)).filter((o) => o.cat === "Ремонт");
  // Фильтры: артикул — по ТЗ напрямую; остальные — как на «Изделиях» (matchedOrderIds по строкам ТЗ общего года).
  const repairIds = new Set(repairAll.map((o) => o.id));
  const orderRows = (await loadOrderRows(session.user.organizationId, year, c4)).filter((r) => repairIds.has(r.id));
  const fv: ArticleFilterValues = { q: "", category: [], size: [], season: [], lining: [], price: [], fur: f.fur, color: f.color, batch: f.batch, tzyear: f.tzyear, tz: f.tz };
  const matched = matchedOrderIds(orderRows, new Map(), fv);
  const orders = repairAll.filter((o) => (f.model.length === 0 || f.model.includes(o.mid)) && (!matched || matched.includes(o.id)));
  const tzOpts = tzOptions(orderRows);
  const modelOpts = Array.from(new Map(orderRows.map((r) => [r.modelId, r.modelLabel || r.modelName])), ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "ru", { numeric: true }));
  const filtered = isTzFilterActive(fv) || f.model.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Изделия", href: "/articles" }, { label: "Ремонт" }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center">
          <h1 className="text-xl font-semibold">Ремонт</h1>
          <YearNote year={year} />
          <span className="ml-2 inline-flex">
            <InfoHint label="О странице «Ремонт»">Отдельно от производства: ТЗ на ремонт не входят в «Произведено» и в средние цены изделий. Затраты ремонта остаются в общей себестоимости на Главной («из них ремонт»).</InfoHint>
          </span>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/production/new" className="rounded-lg border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">+ Новое ТЗ на ремонт</Link>
          <Link href="/articles" className="px-1 py-1.5 text-blue-700 hover:underline">← Изделия</Link>
        </div>
      </div>
      <div className="print:hidden">
        <FilterBar
          oneRow
          title="Фильтры ремонта"
          controls={[
            { type: "multi", name: "model", label: "Артикул", options: modelOpts },
            { type: "multi", name: "fur", label: "Тип меха", aliases: ["kind"], options: tzOpts.fur },
            { type: "multi", name: "color", label: "Цвет", options: tzOpts.color },
            { type: "multi", name: "tz", label: "ТЗ", options: tzOpts.tz },
            { type: "multi", name: "tzyear", label: year === "all" ? "Год" : `Год (внутри ${year})`, options: tzOpts.tzyear },
            { type: "multi", name: "batch", label: "Партия пошива", options: tzOpts.batch, noneLabel: "Без партии" },
          ]}
        />
      </div>
      <RepairTiles orders={orders} c4={c4} filtered={filtered} />
      <OrdersTree
        orders={orders}
        c4={c4}
        title="ТЗ на ремонт и их состав"
        countRepairQty
        defaultOpenDepth={0}
        modes={[{ id: "order", label: "ТЗ", dims: ["order"] }]}
        hint={<p>Каждое ТЗ раскрывается до строк списания материалов (лот и закупка — ссылками), расходов и работы. Суммы — как в блоке «Производство» на Главной.</p>}
        empty={filtered ? "Под выбранные фильтры ТЗ на ремонт нет." : "ТЗ на ремонт пока нет. Создайте ТЗ и выберите изделие категории «Ремонт»."}
      />
    </div>
  );
}
