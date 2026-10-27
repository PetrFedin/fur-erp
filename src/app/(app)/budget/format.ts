import { formatDate, formatMoney, formatPercent, formatQty, formatDec1, formatShare } from "@/lib/utils";
// Форматирование чисел раздела «Бюджет» (без "use client": годится и серверным страницам).

/** Деньги в бюджете показываются до тысяч (значения в базе и в полях ввода не округляются). */
export const money = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "–" : formatMoney(Math.round(v / 1000) * 1000));
export const qty = (v: number | null | undefined, _digits?: number) => (v == null || !Number.isFinite(v) ? "–" : formatQty(v));
/** Шкуры и подкладка (м): всегда одна цифра после запятой. */
export const dec1 = (v: number | null | undefined) => formatDec1(v);
export const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? "–" : formatPercent(v, { sign: true }));
export const share = (part: number, whole: number) => (whole > 0 ? formatShare(part / whole) : "–");
export const dateRu = (iso: string) => formatDate(iso);
