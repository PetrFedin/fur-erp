"use client";

import { useEffect, useRef, useState } from "react";
import { BreakdownTable } from "@/components/breakdown-table";
import { formatNum, formatRate } from "@/lib/utils";

type Breakdown = {
  furDescription?: string | null;
  exchangeRateInvoice?: string | null;
  exchangeRateFixed?: string | null;
  items: { label: string; value: number }[];
};

const fmt = (n: number) => formatNum(n, 1);
// Курс — ровно 2 знака после запятой.
const fmtRate = (n: number) => formatRate(n);
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
  const excl = toNum(unitCostExcl);
  const incl = toNum(unitCostIncl);
  const q = toNum(qty);
  const showLot = q != null && Number.isFinite(q) && q > 0;
  const vatPct = (() => {
    const e = toNum(unitCostExcl), i = toNum(unitCostIncl);
    if (e == null || i == null || !(e > 0)) return null;
    const p = Math.round(((i / e) - 1) * 1000) / 10;
    return Number.isFinite(p) && p > 0 && p < 50 ? p : null;
  })();
  const hammer = (() => {
    const items = breakdown.items ?? [];
    const usd = items.find((x) => /^цена за ед/i.test(x.label.trim()));
    const rate = items.find((x) => /^курс/i.test(x.label.trim()));
    return usd ? { usd: usd.value, rate: rate ? rate.value : null } : null;
  })();
  const showFinal = excl != null && incl != null && Number.isFinite(excl) && Number.isFinite(incl);

  return (
    <div className="text-xs">
      <button type="button" onClick={() => (opened ? dialogRef.current?.showModal() : setOpened(true))} className="text-neutral-500 hover:underline max-md:inline-flex max-md:min-h-8 max-md:items-center">
        Состав цены
      </button>
      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="m-auto max-h-[85vh] w-[64rem] max-w-[95vw] overflow-y-auto overflow-x-hidden whitespace-normal break-words rounded-lg border border-neutral-200 bg-white p-0 text-left text-xs font-normal shadow-xl backdrop:bg-black/30"
      >
        {opened && (
        <div className="p-4">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-neutral-800">Цена лота{lotLabel ? ` ${lotLabel}` : ""}</p>
              {breakdown.furDescription && <p className="mt-0.5 text-neutral-500">{breakdown.furDescription}</p>}
            </div>
            <button type="button" onClick={() => dialogRef.current?.close()} className="rounded border border-neutral-200 px-2 py-0.5 text-neutral-500 hover:bg-neutral-50">Закрыть</button>
          </div>

          {showFinal && (
            <div className="flex flex-col gap-2" data-lot-result>
              <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-3">
                <p className="text-neutral-500">Одна {unit === "шт." ? "шкура" : unit}</p>
                <p className="text-xl font-semibold tabular-nums text-neutral-900">{fmt(incl)} ₽</p>
                <p className="text-neutral-600">
                  {fmt(excl)} ₽ без НДС + {fmt(incl - excl)} ₽ НДС{vatPct != null ? ` ${vatPct}%` : ""} <span className="text-neutral-400">· идёт в ТЗ</span>
                </p>
              </div>
              {showLot && (
                <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-3">
                  <p className="text-neutral-500">Весь лот: {fmt(q!)} {unit}</p>
                  <p className="text-xl font-semibold tabular-nums text-neutral-900">{fmt(incl * q!)} ₽</p>
                  <p className="text-neutral-600">{fmt(excl * q!)} ₽ без НДС + {fmt((incl - excl) * q!)} ₽ НДС</p>
                </div>
              )}
              {hammer && (
                <div className="rounded-lg border border-neutral-200 p-3">
                  <p className="text-neutral-500">Цена на аукционе (молоток)</p>
                  <p className="font-medium tabular-nums text-neutral-900">
                    <span className="text-sky-700">{fmt(hammer.usd)} $</span>
                    {hammer.rate != null && <> × курс {fmtRate(hammer.rate)} = <span>{fmt(hammer.usd * hammer.rate)} ₽</span></>}
                  </p>
                  <p className="text-neutral-400">Остальное до цены шкуры — сборы, выделка, доставка, комиссия, НДС.</p>
                </div>
              )}
            </div>
          )}

          <details open className="mt-3 rounded-md border border-neutral-200">
            <summary className="cursor-pointer px-3 py-2 font-medium text-neutral-700 hover:bg-neutral-50">Таблица поставщика</summary>
            <div className="border-t border-neutral-200 p-3">
              {(breakdown.exchangeRateInvoice || breakdown.exchangeRateFixed) && (
                <p className="mb-1 text-neutral-500">
                  Курс инвойса: {breakdown.exchangeRateInvoice ? fmtRate(Number(breakdown.exchangeRateInvoice)) : "—"} · Курс ЦБ (фиксация): {breakdown.exchangeRateFixed ? fmtRate(Number(breakdown.exchangeRateFixed)) : "—"}
                </p>
              )}
              <BreakdownTable items={breakdown.items ?? []} />
              <p className="mt-2 text-neutral-500">Таблица — из отчёта поставщика как есть; карточки выше посчитаны здесь.</p>
            </div>
          </details>
        </div>
        )}
      </dialog>
    </div>
  );
}
