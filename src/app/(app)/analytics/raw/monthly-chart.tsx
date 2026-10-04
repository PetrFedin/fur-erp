"use client";

import { useState } from "react";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";

export type MonthPoint = { month: string; qty: number; incl: number; excl: number };

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const label = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;

/** Динамика закупок по месяцам: переключатель «шт / ₽» (одна ось, два отдельных графика, не двойная ось). Цвет — один, величина — высота. */
export function MonthlyChart({ points, unit }: { points: MonthPoint[]; unit: string }) {
  const { mode } = useVatDisplay();
  const [metric, setMetric] = useState<"qty" | "rub">("qty");
  const [hover, setHover] = useState<number | null>(null);
  const val = (p: MonthPoint) => (metric === "qty" ? p.qty : mode === "excl" ? p.excl : p.incl);
  const fmt = (v: number) => (metric === "qty" ? `${formatQty(v)} ${unit}` : formatMoney(v));
  const max = Math.max(1, ...points.map(val));
  const W = 640, H = 170, padB = 22, padT = 16;
  const slot = W / Math.max(points.length, 1);
  const bw = Math.min(28, slot * 0.6);
  const h = hover != null ? points[hover] : null;

  if (points.length === 0) return <p className="text-sm text-neutral-400">Нет закупок.</p>;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <div className="inline-flex rounded-md border border-neutral-300 p-0.5">
          {(["qty", "rub"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              className={"rounded px-2 py-1 " + (metric === m ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")}
            >
              {m === "qty" ? unit : mode === "excl" ? "₽ без НДС" : "₽ с НДС"}
            </button>
          ))}
        </div>
        <span className="text-neutral-500">{h ? `${label(h.month)}: ${fmt(val(h))}` : `Максимум за месяц: ${fmt(max)}`}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Закупки по месяцам">
        <line x1="0" x2={W} y1={H - padB} y2={H - padB} stroke="#d4d4d4" />
        {points.map((p, i) => {
          const v = val(p);
          const bh = Math.max(v > 0 ? 2 : 0, (v / max) * (H - padB - padT));
          const x = i * slot + (slot - bw) / 2;
          const r = Math.min(4, bh);
          return (
            <g key={p.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(i)}>
              <rect x={i * slot} y={0} width={slot} height={H - padB} fill="transparent" />
              <path
                d={`M${x},${H - padB} v${-(bh - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${bh - r} z`}
                fill={hover === i ? "#115e59" : "#0f766e"}
              />
              {points.length <= 18 || i % 2 === 0 ? (
                <text x={i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#737373">
                  {label(p.month)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
