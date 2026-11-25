import Link from "next/link";
import { CATEGORY_GROUPS, NO_GROUP_ARTICLES_LABEL } from "@/lib/category-groups";
import { FilterBar } from "@/components/filters/filter-bar";
import { filterHref, type FilterOption } from "@/lib/filters";
import { NO_COLOR_LABEL, NO_SIZE_LABEL, type loadOrderAttrOptions } from "@/lib/order-filter-options";
import { LENGTH_OPTIONS } from "@/lib/length-class";
import { DOCS_OPTIONS, PROD_FILTERS, SORTS, VERIFIED_OPTIONS, type ProdFilters } from "./config";

/** Быстрый выбор группы категорий и панель фильтров производства. */
export function ProductionFilters({ f, opts, attr }: { f: ProdFilters; opts: Record<"season" | "batch" | "model" | "category" | "auction" | "fur" | "attr" | "client" | "contractor", FilterOption[]>; attr: Awaited<ReturnType<typeof loadOrderAttrOptions>> }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs print:hidden" role="group" aria-label="Группа категорий">
        <span className="text-neutral-500">Группа:</span>
        <div className="inline-flex overflow-hidden rounded-lg border border-neutral-300">
          {([[null, "Все"], ...CATEGORY_GROUPS.map((g) => [g, g] as const)] as const).map(([g, text]) => {
            // Быстрый выбор группы категорий; остальные фильтры сохраняются.
            const on = g === null ? f.catgroup.length === 0 : f.catgroup.length === 1 && f.catgroup[0] === g;
            return (
              <Link
                key={text}
                href={filterHref(PROD_FILTERS, "/production", f, { catgroup: g === null ? [] : [g] })}
                aria-current={on ? "page" : undefined}
                className={
                  "px-3 py-1.5 max-md:inline-flex max-md:min-h-11 max-md:items-center " +
                  (on ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-100")
                }
              >
                {text}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="print:hidden">
      <FilterBar
        title="Фильтры производства"
        oneRow
        hideChips
        controls={[
          { type: "text", name: "q", label: "№ ТЗ / поиск", placeholder: "№ ТЗ, артикул, заказчик" },
          { type: "multi", name: "season", label: "Сезон", options: opts.season, noneLabel: "Без сезона", more: true },
          { type: "multi", name: "batch", label: "Партия пошива", options: opts.batch, noneLabel: "Вне партий", allLabel: "Все партии" },
          { type: "multi", name: "model", label: "Артикул", options: opts.model },
          { type: "multi", name: "len", label: "Длина", more: true, options: LENGTH_OPTIONS, allLabel: "Любая" },
          { type: "multi", name: "catgroup", label: "Группа категорий", options: CATEGORY_GROUPS.map((g) => ({ value: g, label: g })), noneLabel: NO_GROUP_ARTICLES_LABEL, allLabel: "Все группы", more: true },
          { type: "multi", name: "category", label: "Категория", aliases: ["cat"], options: opts.category, noneLabel: "Без категории" },
          { type: "multi", name: "auction", label: "Аукцион / закупка", aliases: ["auc"], options: opts.auction, hint: "ТЗ, в которых списан мех этой партии закупки (аукциона)", more: true },
          { type: "multi", name: "fur", label: "Вид меха", aliases: ["kind"], options: opts.fur },
          ...(opts.attr.length > 0 ? [{ type: "multi" as const, name: "attr", label: "Признак меха", options: opts.attr, noneLabel: "Без признака", allLabel: "Все признаки", more: true, hint: "Признаки ТЗ и лотов, списанных в ТЗ: седина, дикий / клеточный, тонированный…" }] : []),
          { type: "multi", name: "color", label: "Цвет изделия", more: true, options: attr.color, noneLabel: attr.noColor > 0 ? NO_COLOR_LABEL : undefined, hint: "Все цвета ТЗ: составное ТЗ попадает под каждый свой цвет" },
          ...(attr.size.length > 1 ? [{ type: "multi" as const, name: "size", label: "Размер изделия", more: true, options: attr.size, noneLabel: attr.noSize > 0 ? NO_SIZE_LABEL : undefined, hint: "Размеры из ТЗ: ТЗ с несколькими размерами попадает под каждый" }] : []),
          { type: "multi", name: "client", label: "Заказчик", options: opts.client, more: true },
          ...(opts.contractor.length > 1 ? [{ type: "multi" as const, name: "contractor", label: "Подрядчик", options: opts.contractor, noneLabel: "Не указан", allLabel: "Все подрядчики" }] : []),
          { type: "multi", name: "docs", label: "Документы и оплата", aliases: ["need"], options: DOCS_OPTIONS, allLabel: "Все", more: true },
          { type: "multi", name: "verified", label: "Проверка", options: VERIFIED_OPTIONS, allLabel: "Любая", more: true },
          { type: "date", name: "from", label: "Дата ТЗ с", more: true },
          { type: "date", name: "to", label: "Дата ТЗ по", more: true },
          { type: "multi", name: "sort", label: "Сортировка", single: true, options: Object.entries(SORTS).map(([value, label]) => ({ value, label })), allLabel: "Сначала новые", more: true },
        ]}
      />
      </div>
    </>
  );
}
