import { FilterBar, type BarControl } from "@/components/filters/filter-bar";
import { type Options } from "@/lib/analytics-filters";
import type { FilterOption } from "@/lib/filters";
import { UNDEFINED_COLOR, UNDEFINED_SIZE } from "@/lib/product-category";

const toOptions = (values: string[], label?: (v: string) => string): FilterOption[] => values.map((v) => ({ value: v, label: label ? label(v) : v }));

/** Параметр вида/расчёта страницы (группировка, статус, наценка…): применяется сразу, но фильтром не считается. */
export type LeadControl = BarControl;

/**
 * Единая панель фильтров «Изделий» и «Цен» на общих компонентах (<FilterBar>): одна строка, выпадающие списки с галочками,
 * применение сразу, чипы и «Сбросить всё». Параметры в адресе — канонические (category, fur, color, size, batch, season,
 * vat, auction, pyear, lotcolor, q…); сортировка, колонки и режим колонок (sort, dir, all, cols) панель сохраняет сама.
 * lead — поля страницы (группировка, статус, наценка) перед общими; они помечены state и фильтрами не считаются.
 */
export function AnalyticsFilterBar({ opts, lead = [], title = "Фильтры", aucOf }: { opts: Options; lead?: LeadControl[]; title?: string; aucOf?: (name: string) => { label: string; title: string } }) {
  const multi = (name: string, label: string, values: string[], extra: Partial<Extract<BarControl, { type: "multi" }>> = {}): BarControl[] =>
    values.length === 0 ? [] : [{ type: "multi", name, label, options: toOptions(values, name === "batch" ? (v) => opts.batchLabels[v] ?? `Партия ${v}` : name === "attr" ? (v) => (v === "none" ? "Без признака" : v) : name === "color" || name === "size" ? (v) => (v === UNDEFINED_COLOR || v === UNDEFINED_SIZE ? `${v} в документах` : v) : undefined), ...extra }];
  const controls: BarControl[] = [
    ...lead,
    ...multi("fur", "Вид меха", opts.fur),
    ...multi("color", "Цвет", opts.color, { more: true }),
    ...multi("category", "Категория", opts.cat, { aliases: ["cat"], more: true }),
    ...multi("size", "Размер изделия", opts.size, { more: true }),
    ...multi("batch", "Партия пошива", opts.batch, { more: true }),
    ...multi("season", "Сезон", opts.season, { more: true }),
    { type: "text", name: "q", label: "Модель, артикул", placeholder: "Код, название, № ТЗ, синоним", datalist: opts.models },
    ...(opts.auc.length
      ? [{ type: "multi" as const, name: "auction", label: "Аукцион / закупка", more: true, aliases: ["auc"], allLabel: "Все партии", options: opts.auc.map((v) => ({ value: v, label: aucOf?.(v).label ?? v, title: aucOf?.(v).title })) }]
      : []),
    ...multi("pyear", "Год закупки сырья", opts.py, { aliases: ["py"], more: true }),
    ...multi("lotcolor", "Цвет лота", opts.lc, { aliases: ["lc"], more: true }),
    ...multi("attr", "Признак меха", opts.attr, { more: true, hint: "Признаки ТЗ и списанных в него лотов: седина, дикий / клеточный, тонированный…" }),
    { type: "multi", name: "onlyH", label: "Молоток", single: true, more: true, allLabel: "Все", options: [{ value: "1", label: "Только с молотком" }] },
    { type: "multi", name: "onlyL", label: "Подкладка", single: true, more: true, allLabel: "Все", options: [{ value: "1", label: "Только с подкладкой" }] },
    { type: "text", name: "cmin", label: "Себестоимость сырья за ед. от, ₽", placeholder: "от", inputMode: "decimal", more: true, className: "sm:w-36" },
    { type: "text", name: "cmax", label: "Себестоимость сырья за ед. до, ₽", placeholder: "до", inputMode: "decimal", more: true, className: "sm:w-36" },
  ];
  return (
    <div className="print:hidden">
      <FilterBar title={title} controls={controls} oneRow hideChips footer={<p className="mt-2 text-[11px] leading-4 text-neutral-500">Фильтры применяются сразу</p>} />
    </div>
  );
}
