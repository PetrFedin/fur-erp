import { formatMoney, formatNum, formatQtyTrim } from "@/lib/utils";
import { classifyLotSource } from "@/lib/purchase-source";
import type { FurSrc } from "@/components/fur-source-nav";
import type { FilterKey, FurKind, FurLot } from "@/lib/fur-table";

/** Константы и форматирование таблицы «куплено → использовано → остаток» (вынесено из fur-selection-total.tsx). */
export type ViewMode = "qty" | "money" | "all";
export type Level = "year" | "item" | "auction";

export const FILTER_LABELS: Record<FilterKey, { kind: Record<FurKind, string>; all: string }> = {
  item: { kind: { fur: "Мех", lining: "Ткань" }, all: "Все" },
  year: { kind: { fur: "Год закупки", lining: "Год закупки" }, all: "Все годы" },
  color: { kind: { fur: "Цвет", lining: "Цвет" }, all: "Все цвета" },
  size: { kind: { fur: "Размер шкуры / сорт", lining: "Размер" }, all: "Все размеры" },
  attr: { kind: { fur: "Признак меха", lining: "Признак" }, all: "Все признаки" },
  auction: { kind: { fur: "Аукцион / закупка", lining: "Аукцион / закупка" }, all: "Все партии" },
  rest: { kind: { fur: "Остаток", lining: "Остаток" }, all: "Любой" },
  supplier: { kind: { fur: "Поставщик", lining: "Поставщик" }, all: "Все поставщики" },
  status: { kind: { fur: "Статус закупки", lining: "Статус закупки" }, all: "Все статусы" },
  pay: { kind: { fur: "Оплата", lining: "Оплата" }, all: "Любая" },
  usage: { kind: { fur: "Использование", lining: "Использование" }, all: "Любое" },
  rate: { kind: { fur: "Ставка НДС", lining: "Ставка НДС" }, all: "Любая" },
};
/** Источник лота для слайдов: «all» — вся закупка, остальные — по classifyLotSource (аукцион / поставщик). */
export const inSrc = (s: FurSrc, l: FurLot) => s === "all" || classifyLotSource(l) === s;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const OTHER_FUR = "__other_fur";
export const MAIN_FUR = ["Соболь", "Рысь", "Норка", "Свакара", "Лиса"];
export const firstOf = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Карточка /analytics/raw/lot/<id> есть только у настоящих лотов: строки «заказано, не получено» (ordered:…) и «шкуры подрядчика» (hides) — заглушки без лота в БД (404). */
export const hasLotCard = (l: FurLot) => !l.id.startsWith("ordered:") && !l.id.startsWith("hides");

export const Q = (n: number | null) => (n == null || Math.abs(n) < 0.005 ? "–" : formatQtyTrim(n));
export const R = (n: number | null) => (n == null || Math.abs(n) < 0.5 ? "–" : formatMoney(n));
/** Средневзвешенная цена, ₽ за шт. (м): Σ ₽ ÷ Σ шт. — та же функция figures(), что даёт «Цена, ₽/шт.» в плитках. */
// Сначала до копеек (как avg в плитках: dashboard-data округляет цену до 2 знаков), затем формат — цифры совпадают с плитками.
export const A = (n: number | null) => (n == null || !Number.isFinite(n) || n <= 0 ? "–" : formatMoney(Math.round(n * 100) / 100));
/** Средневзвешенная цена в долларах: только по лотам, у которых цена $ названа в документах. */
export const U = (n: number | null) => (n == null || !Number.isFinite(n) || n <= 0 ? "–" : `$${formatNum(n, 1)}`);
