// Фильтры страницы «Изделия» (/articles): чистая логика без React — её вызывает страница и проверочный скрипт scripts/verify-articles-filters.ts.
//
//  Уровень модели: поиск (код, название, код продаж, SKU, синонимы), категория (каноническое название справочника категорий), цена (есть / нет).
//  Уровень ТЗ: вид меха, подкладка, год ТЗ, номер ТЗ, партия, цвет, размер, сезон. Модель остаётся в списке, если у неё есть ТЗ, подходящее
//  под ВСЕ выбранные условия; число ТЗ и ср. взвеш. себестоимость модели считаются только по таким ТЗ.
import type { Prisma } from "@prisma/client";
import { escapeLike } from "@/lib/input";
import { matchesMulti, splitNone, type FilterOption } from "@/lib/filters";
import { modelCodeVariants } from "@/lib/model-code";
import { UNDEFINED_COLOR, UNDEFINED_SIZE } from "@/lib/product-category";
import { collectOrderSizes } from "@/lib/order-sizes";
import { lengthWhere } from "@/lib/length-class";

export type ArticleFilterValues = {
  q: string;
  category: string[];
  fur: string[];
  color: string[];
  size: string[];
  season: string[];
  batch: string[];
  lining: string[];
  tzyear: string[];
  tz: string[];
  price: string[];
};

/** Подкладка у ТЗ записана (не «-», не «нет»). */
export const hasLiningText = (t: string | null | undefined) => {
  const v = (t ?? "").trim().toLowerCase();
  return v !== "" && !/^[-–—]+$/.test(v) && v !== "нет" && v !== "без подкладки";
};

/** Строка ТЗ для фильтрации — подмножество OrderRow из analytics-orders. */
export type TzRow = {
  id: string;
  number: string;
  workOrderNumber?: string | null;
  modelName?: string;
  fur: string;
  /** ВСЕ цвета ТЗ (составной ТЗ — несколько); пусто — цвет в документах не указан. */
  colors: string[];
  /** Размеры из текста ТЗ (parseOrderSizes); пусто — размер не указан. */
  sizes: string[];
  seasonCode: string | null;
  batchNumber: number | null;
  /** «Партия 5 · 2025». */
  batchText?: string | null;
  year: number | null;
  liningQty: number;
};

export const furParts = (fur: string) => fur.split(" + ").map((x) => x.trim()).filter(Boolean);

export const isTzFilterActive = (f: ArticleFilterValues) => [f.fur, f.color, f.size, f.season, f.batch, f.lining, f.tzyear, f.tz].some((v) => v.length > 0);

/** Id ТЗ, подходящих под фильтры уровня ТЗ; null — ни один такой фильтр не выбран. liningText: id ТЗ → подкладка записана в ТЗ. */
export function matchedOrderIds(rows: TzRow[], liningText: Map<string, boolean>, f: ArticleFilterValues): string[] | null {
  if (!isTzFilterActive(f)) return null;
  return rows
    .filter(
      (r) =>
        (f.fur.length === 0 || furParts(r.fur).some((x) => f.fur.includes(x))) &&
        (f.color.length === 0 || (r.colors.length ? r.colors.some((c) => f.color.includes(c)) : f.color.includes(UNDEFINED_COLOR))) &&
        (f.size.length === 0 || (r.sizes.length ? r.sizes.some((x) => f.size.includes(x)) : f.size.includes(UNDEFINED_SIZE))) &&
        matchesMulti(f.season, r.seasonCode) &&
        matchesMulti(f.batch, r.batchNumber == null ? null : String(r.batchNumber)) &&
        (f.lining.length === 0 || f.lining.includes(liningText.get(r.id) === true || r.liningQty > 0 ? "yes" : "no")) &&
        (f.tzyear.length === 0 || (r.year != null && f.tzyear.includes(String(r.year)))) &&
        (f.tz.length === 0 || f.tz.includes(r.number)),
    )
    .map((r) => r.id);
}

/** Условие Prisma для моделей (уровень модели). Пустые фильтры — пустое условие. */
export function articleModelWhere(orgId: string, f: Pick<ArticleFilterValues, "q" | "category" | "price"> & { model?: string[]; catgroup?: string[]; len?: string[] }): Prisma.ProductModelWhereInput {
  const cat = splitNone(f.category);
  const grp = splitNone(f.catgroup ?? []);
  const q = f.q;
  return {
    organizationId: orgId,
    ...(q
      ? {
          OR: [
            ...modelCodeVariants(q).map((v) => ({ name: { contains: escapeLike(v), mode: "insensitive" as const } })),
            { sku: { contains: escapeLike(q), mode: "insensitive" as const } },
            { salesCode: { contains: escapeLike(q), mode: "insensitive" as const } },
            { salesName: { contains: escapeLike(q), mode: "insensitive" as const } },
            { aliases: { has: q } },
          ],
        }
      : {}),
    AND: [
      ...(f.category.length
        ? [
            {
              OR: [
                // Каноническое название справочника категорий; текст category у привязанных моделей совпадает с ним, у остальных — как записан.
                ...(cat.rest.length ? [{ categoryRef: { name: { in: cat.rest } } }, { categoryRefId: null, category: { in: cat.rest } }] : []),
                ...(cat.none ? [{ categoryRefId: null, category: null }] : []),
              ],
            },
          ]
        : []),
      // Группа — верхний уровень справочника категорий (CategoryRef.group); «Без группы» — нет категории из справочника или у неё пустая группа.
      ...(f.catgroup?.length
        ? [
            {
              OR: [
                ...(grp.rest.length ? [{ categoryRef: { group: { in: grp.rest } } }] : []),
                ...(grp.none ? [{ categoryRefId: null }, { categoryRef: { group: null } }] : []),
              ],
            },
          ]
        : []),
    ],
    ...(f.model?.length ? { id: { in: f.model } } : {}),
    ...(lengthWhere(f.len) ?? {}),
    ...(f.price.length === 1 ? { sellingPrice: f.price[0] === "yes" ? { not: null } : null } : {}),
  };
}

const count = (vals: Array<string | null>): FilterOption[] => {
  const m = new Map<string, number>();
  for (const v of vals) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return Array.from(m, ([value, count]) => ({ value, label: value, count }));
};
/** Пункт «не указан в документах» — только если такие ТЗ есть. */
const noneOption = (n: number, value: string): FilterOption[] => (n > 0 ? [{ value, label: `${value} в документах`, count: n }] : []);
const sizeOrder = (opts: FilterOption[]) => {
  const order = collectOrderSizes(opts.map((o) => o.value));
  return order.map((v) => opts.find((o) => o.value === v)!);
};
const byLabel = (a: FilterOption, b: FilterOption) => a.label.localeCompare(b.label, "ru");

/** Варианты фильтров уровня ТЗ из ТЗ общего года (счётчик — число ТЗ). */
export function tzOptions(rows: TzRow[]): Record<"fur" | "color" | "size" | "season" | "batch" | "tzyear" | "tz", FilterOption[]> {
  return {
    fur: count(rows.flatMap((r) => furParts(r.fur))).sort(byLabel),
    color: [
      ...count(rows.flatMap((r) => r.colors)).sort(byLabel),
      ...noneOption(rows.filter((r) => r.colors.length === 0).length, UNDEFINED_COLOR),
    ],
    size: [
      ...sizeOrder(count(rows.flatMap((r) => r.sizes))),
      ...noneOption(rows.filter((r) => r.sizes.length === 0).length, UNDEFINED_SIZE),
    ],
    season: count(rows.map((r) => r.seasonCode)).sort(byLabel),
    batch: count(rows.map((r) => (r.batchNumber == null ? null : String(r.batchNumber))))
      .map((o) => ({ ...o, label: rows.find((r) => String(r.batchNumber) === o.value)?.batchText ?? `Партия ${o.value}` }))
      .sort((a, b) => Number(b.value) - Number(a.value)),
    tzyear: count(rows.map((r) => (r.year == null ? null : String(r.year)))).sort((a, b) => Number(b.value) - Number(a.value)),
    tz: rows
      .map((r) => {
        const wo = r.workOrderNumber?.trim();
        const same = wo ? rows.filter((x) => x.workOrderNumber?.trim() === wo).length : 0;
        const label = wo ? (same > 1 ? `ТЗ ${wo} · ${r.modelName ?? r.number}` : `ТЗ ${wo}`) : r.number;
        return { value: r.number, label, title: [wo ? `ТЗ ${wo}` : null, `внутренний номер ${r.number}`, r.modelName].filter(Boolean).join(" · ") };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "ru", { numeric: true })),
  };
}
