"use client";

import { useState } from "react";

type Breakdown = {
  furDescription?: string | null;
  exchangeRateInvoice?: string | null;
  exchangeRateFixed?: string | null;
  items: { label: string; value: number }[];
};

export function CostBreakdownToggle({ breakdown }: { breakdown: Breakdown }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="text-xs">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-neutral-500 hover:underline">
        {open ? "Скрыть расчёт" : "Как получилась цена →"}
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
          <ul className="flex flex-col gap-0.5">
            {breakdown.items.map((item, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="text-neutral-500">{item.label}</span>
                <span className="font-mono">{item.value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-neutral-400">
            Составляющие расчёта из отчёта поставщика (в исходных единицах — $/₽/%, без пересчёта в одну валюту);
            себестоимость за ед. — уже финальный итог из отчёта.
          </p>
        </div>
      )}
    </div>
  );
}
