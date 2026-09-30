"use client";

import { useRef } from "react";
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const groups = groupBreakdownItems(breakdown.items ?? []);
  const excl = toNum(unitCostExcl);
  const incl = toNum(unitCostIncl);
  const showFinal = excl != null && incl != null && Number.isFinite(excl) && Number.isFinite(incl);

  return (
    <div className="text-xs">
      <button type="button" onClick={() => dialogRef.current?.showModal()} className="text-neutral-500 hover:underline">
        Из чего цена →
      </button>
      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="m-auto max-h-[85vh] w-[34rem] max-w-[95vw] rounded-lg border border-neutral-200 bg-white p-0 text-xs shadow-xl backdrop:bg-black/30"
      >
        <div className="p-4">
          <div className="mb-2 flex items-start justify-between gap-4">
            <p className="text-sm font-semibold text-neutral-800">Из чего складывается цена лота</p>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded border border-neutral-200 px-2 py-0.5 text-neutral-500 hover:bg-neutral-50"
            >
              Закрыть
            </button>
          </div>
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
          <p className="mt-2 text-neutral-400">Числа — из отчёта поставщика, в его единицах.</p>
        </div>
      </dialog>
    </div>
  );
}
