"use client";

import { useId } from "react";
import { formatMoney } from "@/lib/utils";
import { type PayType } from "@/lib/cashflow-detail";
import { seriesOf } from "@/lib/cashflow";

export const SPEND = "#d93a0e", GET = "#1f7a4d", NAVY = "#1b2a5c", STOCK = "#8a6d1d";

/** Короткие названия статей для шапки таблицы (полное — в title и «i»). */
export const SHORT: Record<string, string> = { furAuction: "Мех: аукционы", furPurchase: "Мех: закупка", lining: "Подкладка", services: "Услуги УПД", work: "Работа подрядчику", hides: "Шкуры подрядчика" };

export const MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export const mon = (m: string) => MON[Number(m.slice(5, 7)) - 1];

export const full = (m: string) => `${mon(m)} ${m.slice(0, 4)}`;

export const dash = (v: number | null) => (v === null || Math.abs(v) < 0.5 ? "–" : formatMoney(v));

export const pcs = (v: number) => (v === 0 ? "–" : v.toLocaleString("ru-RU"));

export type Ser = ReturnType<typeof seriesOf>;

export type CumStyle = "bars" | "lines";

export const KIND_COLOR: Record<PayType, string> = { ADVANCE: "#d93a0e", PARTIAL: "#2f7f8f", FINAL: "#7a4a8c", OTHER: "#71717a" };

export const KIND_ORDER: PayType[] = ["ADVANCE", "PARTIAL", "FINAL", "OTHER"];

/** Спарклайн плитки. «bars» — месячные значения столбиками со знаком; «area» — накопительная линия с нулевой осью и заливкой (плюс зелёным, минус красным), последняя точка отмечена; иначе обычная линия. */
export function Spark({ values, kind = "line" }: { values: number[]; kind?: "line" | "bars" | "area" }) {
  const id = useId();
  if (values.length < 2) return null;
  const W = 100, H = 28;
  const lo = Math.min(...values, kind === "line" ? Infinity : 0), hi = Math.max(...values, kind === "line" ? -Infinity : 0);
  const y = (v: number) => (hi === lo ? H / 2 : 2 + ((hi - v) / (hi - lo)) * (H - 4));
  const x = (i: number) => (i / (values.length - 1)) * W;
  if (kind === "bars") {
    const bw = Math.max(1, W / values.length - 1);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-7 w-full" role="img" aria-label="Месячные значения">
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="#a1a1aa" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        {values.map((v, i) => <rect key={i} x={x(i) - bw / 2} width={bw} y={Math.min(y(v), y(0))} height={Math.abs(y(v) - y(0))} fill={v < 0 ? "#b4310b" : "#17613c"} />)}
      </svg>
    );
  }
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  if (kind === "area") {
    const z = y(0);
    const poly = `0,${z} ${pts} ${W},${z}`;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-7 w-full" role="img" aria-label="Накопленный итог по месяцам">
        <defs>
          <clipPath id={id + "up"}><rect x={0} y={0} width={W} height={z} /></clipPath>
          <clipPath id={id + "dn"}><rect x={0} y={z} width={W} height={H - z} /></clipPath>
        </defs>
        <polygon points={poly} fill="#17613c" opacity={0.25} clipPath={`url(#${id}up)`} />
        <polygon points={poly} fill="#b4310b" opacity={0.25} clipPath={`url(#${id}dn)`} />
        <line x1={0} x2={W} y1={z} y2={z} stroke="#a1a1aa" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        <polyline points={pts} fill="none" stroke="#1b2a5c" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={1.6} fill="#1b2a5c" />
      </svg>
    );
  }
  return <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-6 w-full" aria-hidden><polyline points={pts} fill="none" stroke="#5a6a94" strokeWidth={1.5} vectorEffect="non-scaling-stroke" /></svg>;
}

export type Page = { label: string; value: string; sub?: string; tone?: "bad" | "good"; spark?: number[]; sparkKind?: "line" | "bars" | "area"; hint?: React.ReactNode; /** Строки «подпись — значение» под значением (например деньги после количеств). */ rows?: [string, string][]; /** Подпись ряда под строками. */ foot?: string };
