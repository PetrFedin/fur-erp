"use client";

import { useEffect, useRef, useState } from "react";
import { groupBreakdownItems, labelUnit } from "@/lib/cost-breakdown-groups";

type Breakdown = {
  furDescription?: string | null;
  exchangeRateInvoice?: string | null;
  exchangeRateFixed?: string | null;
  items: { label: string; value: number }[];
};

const fmt = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
// Курс показываем минимум с 4 знаками (до 6): округление до 2 знаков скрывало разницу в курсе.
const fmtRate = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
const isRateLabel = (label: string) => /^курс/i.test(label.trim());
const toNum = (v: number | string | null | undefined) => (v == null || v === "" ? null : Number(v));

export function CostBreakdownToggle({
  breakdown,
  unitCostExcl,
  unitCostIncl,
  qty,
  unit = "шт.",
  lotLabel,
}: {
  breakdown: Breakdown;
  /** Себестоимость единицы без НДС — та, что идёт в ТЗ. Необязательно. */
  unitCostExcl?: number | string | null;
  /** Себестоимость единицы с НДС. Необязательно. */
  unitCostIncl?: number | string | null;
  /** Количество в лоте — тогда в итоге показывается и стоимость всего лота. */
  qty?: number | string | null;
  unit?: string;
  /** Название лота для заголовка окна. */
  lotLabel?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Содержимое окна рисуем только после первого открытия: на странице закупки таких окон по числу позиций (десятки),
  // и каждое раньше сидело в разметке со всей таблицей составляющих.
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (opened && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, [opened]);
  const groups = opened ? groupBreakdownItems(breakdown.items ?? []) : [];
  const excl = toNum(unitCostExcl);
  const incl = toNum(unitCostIncl);
  const q = toNum(qty);
  const showLot = q != null && Number.isFinite(q) && q > 0;
  const showFinal = excl != null && incl != null && Number.isFinite(excl) && Number.isFinite(incl);

  return (
    <div className="text-xs">
      <button type="button" onClick={() => (opened ? dialogRef.current?.showModal() : setOpened(true))} className="text-neutral-500 hover:underline max-md:inline-flex max-md:min-h-8 max-md:items-center">
        Из чего цена →
      </button>
      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="m-auto max-h-[85vh] w-[34rem] max-w-[95vw] overflow-y-auto overflow-x-hidden whitespace-normal break-words rounded-lg border border-neutral-200 bg-white p-0 text-left text-xs font-normal shadow-xl backdrop:bg-black/30"
      >
        {opened && (
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
          {(lotLabel || breakdown.furDescription) && <p className="mb-2 text-neutral-500">{[lotLabel, breakdown.furDescription].filter(Boolean).join(" · ")}</p>}
          {showFinal && (
            <div className="mb-3 rounded-md border border-neutral-300 bg-neutral-50 p-3" data-lot-result>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">Итог: цена лота</p>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left text-neutral-500">
                    <th className="py-0.5 pr-2 font-normal" />
                    <th className="py-0.5 pr-2 text-right font-normal">Без НДС</th>
                    <th className="py-0.5 pr-2 text-right font-normal">НДС</th>
                    <th className="py-0.5 text-right font-normal">Всего, ₽</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  <tr>
                    <td className="py-0.5 pr-2 font-sans font-medium text-neutral-800">За 1 {unit}<span className="block text-[10px] font-normal text-neutral-500">идёт в ТЗ</span></td>
                    <td className="py-0.5 pr-2 text-right font-semibold">{fmt(excl)}</td>
                    <td className="py-0.5 pr-2 text-right">{fmt(incl - excl)}</td>
                    <td className="py-0.5 text-right font-semibold">{fmt(incl)}</td>
                  </tr>
                  {showLot && (
                    <tr className="border-t border-neutral-200">
                      <td className="py-0.5 pr-2 font-sans font-medium text-neutral-800">За весь лот<span className="block text-[10px] font-normal text-neutral-500">{fmt(q!)} {unit}</span></td>
                      <td className="py-0.5 pr-2 text-right font-semibold">{fmt(excl * q!)}</td>
                      <td className="py-0.5 pr-2 text-right">{fmt((incl - excl) * q!)}</td>
                      <td className="py-0.5 text-right font-semibold">{fmt(incl * q!)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">Из чего собрана цена (отчёт поставщика)</p>
          {(breakdown.exchangeRateInvoice || breakdown.exchangeRateFixed) && (
            <p className="mb-1 text-neutral-500">
              Курс инвойса: {breakdown.exchangeRateInvoice ?? "—"} · Курс ЦБ (фиксация): {breakdown.exchangeRateFixed ?? "—"}
            </p>
          )}
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="py-0.5 pr-3 font-normal">Составляющая</th>
                <th className="w-24 py-0.5 pr-2 text-right font-normal">Значение</th>
                <th className="w-10 py-0.5 font-normal">Ед.</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.key}>
                <tr>
                  <td colSpan={3} className="border-t border-neutral-200 pt-1.5 pb-0.5 font-medium text-neutral-700">
                    {g.title}
                    {g.hint && <span className="ml-1 font-normal text-neutral-500">({g.hint})</span>}
                  </td>
                </tr>
                {g.items.map((item, i) => {
                  const bold = g.key === "totals";
                  const unit = labelUnit(item.label);
                  return (
                    <tr key={i} className={bold ? "font-semibold" : undefined}>
                      <td className={`py-px pr-3 ${bold ? "" : "text-neutral-500"}`}>{item.label}</td>
                      <td className="py-px pr-2 text-right font-mono">{isRateLabel(item.label) ? fmtRate(item.value) : fmt(item.value)}</td>
                      <td className="py-px text-neutral-500">{unit ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
          <p className="mt-2 text-neutral-500">Составляющие переписаны из отчёта поставщика как есть: часть в $, часть в ₽, на шкуру или на весь лот. Итог выше посчитан приложением из цены лота и количества.</p>
        </div>
        )}
      </dialog>
    </div>
  );
}
