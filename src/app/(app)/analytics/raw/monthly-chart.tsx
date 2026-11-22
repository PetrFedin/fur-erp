"use client";

import { useState } from "react";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { Chart, type Pt, type Series } from "../../dashboard/sales-block-charts";
import { SEG_GROUP, segCls } from "@/components/segmented";

export type MonthPoint = { month: string; qty: number; incl: number; excl: number };

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
/** «янв 2026»: год виден и в подписи оси, и в подсказке при наведении. */
const label = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

/**
 * Динамика закупок по месяцам: тот же график, что в «Продажах и остатках» (подсказка с цифрами при наведении или касании,
 * подписи месяцев с годом), переключатель «шт / ₽».
 */
export function MonthlyChart({ points, unit }: { points: MonthPoint[]; unit: string }) {
  const { mode } = useVatDisplay();
  const [metric, setMetric] = useState<"qty" | "rub">("qty");
  if (points.length === 0) return <p className="text-sm text-neutral-500">Нет закупок.</p>;
  const pts: Pt[] = points.map((p) => ({ key: p.month, label: label(p.month) }));
  const series: Series[] = [
    metric === "qty"
      ? { name: `Куплено, ${unit}`, color: "#d93a0e", vals: points.map((p) => p.qty), kind: "bar", axis: "l", fmt: (v) => `${formatQty(v)}` }
      : { name: mode === "excl" ? "Куплено, ₽ без НДС" : "Куплено, ₽ с НДС", color: "#d93a0e", vals: points.map((p) => (mode === "excl" ? p.excl : p.incl)), kind: "bar", axis: "l", fmt: (v) => formatMoney(Math.round(v)) },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Что показывать" className={SEG_GROUP + " self-start"}>
        {(["qty", "rub"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)} className={segCls(metric === m, "sm")}>
            {m === "qty" ? unit : mode === "excl" ? "₽ без НДС" : "₽ с НДС"}
          </button>
        ))}
      </div>
      <Chart pts={pts} series={series} label="Закупки по месяцам" testId="monthly-chart" />
    </div>
  );
}
