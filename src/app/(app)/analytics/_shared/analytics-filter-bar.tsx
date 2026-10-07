import { FilterBar, type BarControl } from "@/components/filters/filter-bar";
import { VAT_LABEL, type Options } from "@/lib/analytics-filters";
import type { FilterOption } from "@/lib/filters";

const toOptions = (values: string[], label?: (v: string) => string): FilterOption[] => values.map((v) => ({ value: v, label: label ? label(v) : v }));

/** Параметр вида/расчёта страницы (группировка, статус, наценка…): применяется сразу, но фильтром не считается. */
export type LeadControl = BarControl;

/**
 * Единая панель фильтров «Изделий» и «Цен» на общих компонентах (<FilterBar>): одна строка, выпадающие списки с галочками,
 * применение сразу, чипы и «Сбросить всё». Параметры в адресе — канонические (category, fur, color, size, batch, season,
 * vat, auction, pyear, lotcolor, q…); сортировка, колонки и режим колонок (sort, dir, all, cols) панель сохраняет сама.
 * lead — поля страницы (группировка, статус, наценка) перед общими; они помечены state и фильтрами не считаются.
 */
export function AnalyticsFilterBar({ opts, lead = [], title = "Фильтры" }: { opts: Options; lead?: LeadControl[]; title?: string }) {
  const multi = (name: string, label: string, values: string[], extra: Partial<Extract<BarControl, { type: "multi" }>> = {}): BarControl[] =>
    values.length === 0 ? [] : [{ type: "multi", name, label, options: toOptions(values, name === "batch" ? (v) => `Партия ${v}` : undefined), ...extra }];
  const controls: BarControl[] = [
    ...lead,
    ...multi("fur", "Вид меха", opts.fur),
    ...multi("color", "Цвет", opts.color),
    ...multi("category", "Категория", opts.cat, { aliases: ["cat"] }),
    ...multi("size", "Размер", opts.size),
    ...multi("batch", "Партия", opts.batch),
    ...multi("season", "Сезон", opts.season),
    {
      type: "multi",
      name: "vat",
      label: "Ставка НДС",
      single: true,
      allLabel: "Любая",
      options: (Object.keys(VAT_LABEL) as (keyof typeof VAT_LABEL)[]).map((k) => ({ value: k, label: VAT_LABEL[k] })),
    },
    { type: "text", name: "q", label: "Модель, артикул", placeholder: "Код, название, № ТЗ, синоним", datalist: opts.models },
    ...multi("auction", "Аукцион / сессия закупки", opts.auc, { aliases: ["auc"] }),
    ...multi("pyear", "Год закупки сырья", opts.py, { aliases: ["py"] }),
    ...multi("lotcolor", "Цвет лота", opts.lc, { aliases: ["lc"] }),
    { type: "multi", name: "onlyH", label: "Молоток", single: true, allLabel: "Все", options: [{ value: "1", label: "Только с молотком" }] },
    { type: "multi", name: "onlyL", label: "Подкладка", single: true, allLabel: "Все", options: [{ value: "1", label: "Только с подкладкой" }] },
    { type: "text", name: "cmin", label: "Себестоимость от, ₽", placeholder: "от", inputMode: "decimal", className: "sm:w-36" },
    { type: "text", name: "cmax", label: "Себестоимость до, ₽", placeholder: "до", inputMode: "decimal", className: "sm:w-36" },
  ];
  return <FilterBar title={title} controls={controls} />;
}
