"use client";

import { useState } from "react";
import { groupBreakdownItems, labelUnit } from "@/lib/cost-breakdown-groups";

type Breakdown = {
  furDescription?: string | null;
  exchangeRateInvoice?: string | null;
  exchangeRateFixed?: string | null;
  items: { label: string; value: number }[];
};

const fmt = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const toNum = (v: number | string | null | undefined) => (v == null || v === "" ? null : Number(v));

export function CostBreakdownToggle({
  breakdown,
  unitCostExcl,
  unitCostIncl,
}: {
  breakdown: Breakdown;
  /** Себестоимость единицы без НДС — та, что идёт в ТЗ. Необязательно. */
  unitCostExcl?: number | string | null;
  /** Себестоимость единицы с НДС. Необязательно. */
  unitCostIncl?: number | string | null;
}) {
  const [open, setOpen] = useState(false);
  const groups = groupBreakdownItems(breakdown.items ?? []);
  const excl = toNum(unitCostExcl);
  const incl = toNum(unitCostIncl);
  const showFinal = excl != null && incl != null && Number.isFinite(excl) && Number.isFinite(incl);

  return (
    <div className="text-xs">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-neutral-500 hover:underline">
        {open ? "Скрыть" : "Из чего цена →"}
      </button>
      {open && (
        <div className="mt-1 rounded border border-neutral-200 bg-neutral-50 p-2">
          {breakdown.furDescription && <p className="mb-1 text-neutral-500">{breakdown.furDescription}</p>}
          {(breakdown.exchangeRateInvoice || breakdown.exchangeRateFixed) && (
            <p className="mb-1 text-neutral-500">
              Курс инвойса: {breakdown.exchangeRateInvoice ?? "—"} · Курс ЦБ (фиксация):{" "}
              {breakdown.exchangeRateFixed ?? "—"}
            </p>
          )}
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-neutral-400">
                <th className="py-0.5 pr-3 font-normal">Составляющая</th>
                <th className="py-0.5 pr-3 text-right font-normal">Значение</th>
                <th className="py-0.5 font-normal">Ед.</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.key}>
                <tr>
                  <td colSpan={3} className="border-t border-neutral-200 pt-1.5 pb-0.5 font-medium text-neutral-700">
                    {g.title}
                    {g.hint && <span className="ml-1 font-normal text-neutral-400">({g.hint})</span>}
                  </td>
                </tr>
                {g.items.map((item, i) => {
                  const bold = g.key === "totals";
                  const unit = labelUnit(item.label);
                  return (
                    <tr key={i} className={bold ? "font-semibold" : undefined}>
                      <td className={`py-px pr-3 ${bold ? "" : "text-neutral-500"}`}>{item.label}</td>
                      <td className="py-px pr-3 text-right font-mono">{fmt(item.value)}</td>
                      <td className="py-px text-neutral-400">{unit ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
          {showFinal && (
            <div className="mt-2 border-t border-neutral-300 pt-1.5">
              <p className="mb-0.5 font-medium text-neutral-700">Итог для приложения — себестоимость единицы, идёт в ТЗ</p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="text-neutral-400">Без НДС</div>
                  <div className="font-mono font-semibold">{fmt(excl)}</div>
                </div>
                <div>
                  <div className="text-neutral-400">НДС</div>
                  <div className="font-mono font-semibold">{fmt(incl - excl)}</div>
                </div>
                <div>
                  <div className="text-neutral-400">Всего</div>
                  <div className="font-mono font-semibold">{fmt(incl)}</div>
                </div>
              </div>
            </div>
          )}
          <p className="mt-1 text-neutral-400">Числа — из отчёта поставщика, в его единицах.</p>
        </div>
      )}
    </div>
  );
}
