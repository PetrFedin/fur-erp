import { FilterBar } from "@/components/filters/filter-bar";
import { CATEGORY_GROUPS, NO_GROUP } from "@/lib/category-groups";
import { LENGTH_OPTIONS } from "@/lib/length-class";
import type { FilterOption } from "@/lib/filter-options";
import type { YearFilter } from "@/lib/year-filter";
import type { tzOptions } from "@/lib/article-filters";
import type { paramFilterOptions } from "@/lib/article-params";

export function ArticlesFilterBar({
  articleOpts,
  tzOpts,
  year,
  paramOpts,
}: {
  articleOpts: Record<"category" | "model", FilterOption[]>;
  tzOpts: ReturnType<typeof tzOptions>;
  year: YearFilter;
  paramOpts: ReturnType<typeof paramFilterOptions>;
}) {
  return (
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
        { type: "multi", name: "active", label: "Вкл / выкл", options: [{ value: "on", label: "Вкл" }, { value: "off", label: "Выкл" }], allLabel: "Все" },
        { type: "multi", name: "price", label: "Цена", more: true, options: [{ value: "yes", label: "Есть цена" }, { value: "no", label: "Нет цены" }] },
      ]}
    />
  );
}
