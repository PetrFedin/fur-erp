import { formatPercent, formatShare } from "@/lib/utils";
// Форматирование чисел раздела «Бюджет» (без "use client": годится и серверным страницам).

export const money = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("ru-RU") + " ₽");
export const qty = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: d }));
export const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : formatPercent(v, { sign: true }));
export const share = (part: number, whole: number) => (whole > 0 ? formatShare(part / whole) : "—");
export const dateRu = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Moscow" });
