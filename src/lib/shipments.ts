// Общие функции раздела «Отгрузки» (годятся и для сервера, и для клиента).

export const SHIPMENT_STATUS: Record<
  string,
  { label: string; variant: "default" | "info" | "warning" | "success" | "danger" }
> = {
  PLANNED: { label: "Запланирована", variant: "info" },
  SHIPPED: { label: "Отгружена", variant: "success" },
  CANCELLED: { label: "Отменена", variant: "danger" },
};

export type SizeRow = { size: string; quantity: string };

/** «ТЗ №141» или, если номера ТЗ нет, «Заказ П-2026-0141». */
export function orderLabel(o: { workOrderNumber: string | null; number: string }) {
  return o.workOrderNumber ? `ТЗ №${o.workOrderNumber}` : `Заказ ${o.number}`;
}

/** Числовой № ТЗ для сортировки; ТЗ без числового номера идут в конец. */
export function orderSortKey(o: { workOrderNumber: string | null }) {
  const n = parseInt(o.workOrderNumber ?? "", 10);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

/**
 * Размеры из строки ТЗ («42 44», «40, 42, 42, 44») -> строки «размер | кол-во»:
 * одинаковые размеры складываются. Если размера нет или он один — одна строка
 * «—» (или этот размер) с общим количеством.
 */
export function suggestSizeRows(sizeText: string | null | undefined, totalQty: number): SizeRow[] {
  const total = String(Math.max(0, Math.round(totalQty)));
  const tokens = (sizeText ?? "")
    .split(/[\s,;/]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [{ size: "", quantity: total }];
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  if (counts.size === 1) return [{ size: tokens[0], quantity: total }];
  return [...counts].map(([size, n]) => ({ size, quantity: String(n) }));
}

/** Сжатая запись состава: «ТЗ №141: 42×1, 44×1». */
export function summarizeLines(
  lines: { size: string | null; quantity: number; productionOrder: { workOrderNumber: string | null; number: string } }[]
) {
  const byOrder = new Map<string, { label: string; parts: string[] }>();
  for (const l of lines) {
    const label = orderLabel(l.productionOrder);
    const e = byOrder.get(label) ?? { label, parts: [] };
    e.parts.push(`${l.size ?? "—"}×${l.quantity}`);
    byOrder.set(label, e);
  }
  return [...byOrder.values()].map((e) => `${e.label}: ${e.parts.join(", ")}`);
}

/** Сегодняшняя дата как YYYY-MM-DD (по местному времени). */
export function todayIso() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Разумные пределы для вводимых данных. */
export const MAX_LINE_QTY = 100000;
export const MAX_TOTAL_QTY = 1000000;
export const MAX_LINES = 200;
export const MIN_DATE = "2020-01-01";
export const MAX_DATE = "2100-01-01";

/** Дата YYYY-MM-DD в допустимом диапазоне (строки сравниваются лексикографически). */
export function isDateInRange(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime()) && s >= MIN_DATE && s <= MAX_DATE;
}
export const DATE_RANGE_ERROR = "Дата должна быть между 01.01.2020 и 01.01.2100";
