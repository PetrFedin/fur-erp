// Общие форматы раздела «Продажи и остатки»: нули — прочерком, деньги и проценты по-русски.
import { formatMoney, formatMoneyCompact } from "@/lib/utils";
import { SEG_GROUP, segCls } from "@/components/segmented";

export const DASH = "–";
export const n0 = (v: number) => (v === 0 ? DASH : v.toLocaleString("ru-RU"));
/** Штуки со знаком: «+12», «−3». */
export const nSigned = (v: number) => (v === 0 ? DASH : (v > 0 ? "+" : "−") + Math.abs(v).toLocaleString("ru-RU"));
export const money = (v: number | null) => (v === null || Math.abs(v) < 0.5 ? DASH : formatMoney(v));
export const moneyC = (v: number | null) => (v === null || Math.abs(v) < 0.5 ? DASH : formatMoneyCompact(v));
export const pct = (v: number | null, d = 0) => (v === null || v === 0 ? DASH : (v * 100).toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: d }) + " %");
export const spct = (v: number | null, d = 1) => (v === null ? DASH : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: d }) + " %");
export const x2 = (v: number | null) => (v === null ? DASH : "×" + v.toFixed(2).replace(".", ","));
export const d1 = (v: number | null) => (v === null ? DASH : v.toLocaleString("ru-RU", { maximumFractionDigits: 1, minimumFractionDigits: 1 }));
export const dateRu = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : DASH);

export const seg = (on: boolean) => segCls(on);
export const segGroup = SEG_GROUP;
export const btn = "inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-50";

export const NAVY = "#1b2a5c", GET = "#1f7a4d", STOCK = "#8a6d1d", PRICE = "#d93a0e", REV = "#4f6bb5";
