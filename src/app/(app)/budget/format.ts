import { formatDate, formatMoney, formatPercent, formatQty, formatShare } from "@/lib/utils";
// Форматирование чисел раздела «Бюджет» (без "use client": годится и серверным страницам).

export const money = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : formatMoney(v));
export const qty = (v: number | null | undefined, _digits?: number) => (v == null || !Number.isFinite(v) ? "—" : formatQty(v));
export const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : formatPercent(v, { sign: true }));
export const share = (part: number, whole: number) => (whole > 0 ? formatShare(part / whole) : "—");
export const dateRu = (iso: string) => formatDate(iso);
