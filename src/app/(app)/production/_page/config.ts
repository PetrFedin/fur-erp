import type { Prisma } from "@prisma/client";
import { defineFilters, pick, type FilterSchema, type FilterValues } from "@/lib/filters";
import { ORDER_COLORS_INCLUDE } from "@/lib/order-colors";

export const SORTS: Record<string, string> = {
  num_desc: "№ ТЗ: по убыванию",
  num_asc: "№ ТЗ: по возрастанию",
};
export const DOCS_OPTIONS = [
  { value: "docs", label: "Только без документов" },
  { value: "pay", label: "Только без оплаты" },
];
export const VERIFIED_OPTIONS = [
  { value: "yes", label: "Подтверждено" },
  { value: "no", label: "Не подтверждено" },
];
export const PROD_FILTERS = defineFilters({
  ...pick(["q", "season", "batch", "model", "len", "category", "catgroup", "auction", "fur", "color", "attr", "size", "docs", "verified", "from", "to", "sort", "view", "client", "contractor"], {
    size: { label: "Размер изделия" },
    batch: { pattern: /^(\d{1,6}|none)$/ },
    docs: { allowed: ["docs", "pay"] },
    verified: { allowed: ["yes", "no"], label: "Проверка" },
    color: { label: "Цвет изделия" },
    from: { label: "Дата ТЗ с" },
    to: { label: "Дата ТЗ по" },
    sort: { allowed: Object.keys(SORTS) },
  }),
});
type ProdDefs = typeof PROD_FILTERS extends FilterSchema<infer D> ? D : never;
export type ProdFilters = FilterValues<ProdDefs>;

// Надзаголовки блоков колонок и тонкая вертикальная линия слева у первой колонки блока.
export const GH = "border-b border-neutral-200 px-3 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500";
export const BLH = " border-l border-neutral-200";

/** include запроса списка ТЗ (тот же, что был в page.tsx). */
export const ORDER_LIST_INCLUDE = {
  productModel: { select: { id: true, name: true, category: true, salesCode: true, salesName: true } },
  season: { select: { code: true } },
  client: { select: { name: true } },
  contractor: { select: { name: true } },
  batch: { select: { number: true, year: true } },
  ...ORDER_COLORS_INCLUDE,
  materialUsages: {
    select: {
      totalCost: true,
      quantity: true,
      commission4: true,
      vatRate: true,
      lot: { select: { materialCostExclVat: true, expenseCostExclVat: true, unitCost: true, vatRate: true } },
      rawMaterial: { select: { unit: true } },
    },
  },
  expenses: { select: { amount: true } },
} satisfies Prisma.ProductionOrderInclude;

export type ListOrder = Prisma.ProductionOrderGetPayload<{ include: typeof ORDER_LIST_INCLUDE }>;
