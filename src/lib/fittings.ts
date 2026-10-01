export const FITTING_STATUS: Record<
  "PLANNED" | "HELD_REMARKS" | "HELD_OK",
  { label: string; variant: "default" | "info" | "warning" | "success" | "danger" }
> = {
  PLANNED: { label: "Запланирована", variant: "info" },
  HELD_REMARKS: { label: "Проведена — есть замечания", variant: "warning" },
  HELD_OK: { label: "Проведена — принято", variant: "success" },
};

export const FITTING_STATUS_KEYS = Object.keys(FITTING_STATUS) as (keyof typeof FITTING_STATUS)[];

export function isFittingStatus(v: unknown): v is keyof typeof FITTING_STATUS {
  return typeof v === "string" && v in FITTING_STATUS;
}

/** «ТЗ №132» либо «Заказ П-2026-0141», если у ТЗ нет номера. */
export function orderLabel(o: { workOrderNumber: string | null; number: string }) {
  return o.workOrderNumber ? `ТЗ №${o.workOrderNumber}` : `Заказ ${o.number}`;
}

/** Дата примерки хранится в полдень UTC, чтобы не «прыгала» по часовым поясам. */
export function parseFittingDate(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  if (v < "2020-01-01" || v > "2100-01-01") return null;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const FITTING_DATE_ERROR = "Укажите дату примерки между 01.01.2020 и 01.01.2100";

/** Дата из БД (полдень UTC) как YYYY-MM-DD. */
export function dateInputValue(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Сегодняшняя дата по местному времени (YYYY-MM-DD). */
export function localTodayIso() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function truncate(s: string | null, n: number) {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}
