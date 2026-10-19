import { ZiSourceButton, type ZiDiffView } from "./zi-source";
import type { ZiSupply } from "@/lib/shipment-zi";

const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Накладные ЦУМ (ЗИ): поставки и расхождения «заказ ЦУМ ↔ накладная поставщика» — свёрнутый блок под итоговой таблицей приёмки.
 * Подрядчику priceDiffs приходит пустым (цены ЦУМ ему не отдаются), блок для него — только список поставок.
 */
export function ZiDiffs({ supplies, priceDiffs, unmatched }: { supplies: ZiSupply[]; priceDiffs: ZiDiffView[]; unmatched: number }) {
  return (
    <details className="rounded-lg border border-neutral-200 bg-white p-3" data-zi>
      <summary className="cursor-pointer text-sm font-semibold text-neutral-900 max-md:min-h-11">Накладные ЦУМ (ЗИ){priceDiffs.length ? " и расхождения с заказом" : ""}</summary>
      <div className="mt-2 flex flex-col gap-2">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
          {supplies.map((s) => (
            <li key={s.code}><span className="font-medium text-neutral-800">Поставка {s.code}</span> · ЗИ {s.ziNumbers.join(", ")} · файл от {s.savedOn.split("-").reverse().join(".")}</li>
          ))}
        </ul>
        {unmatched > 0 && <p className="text-xs text-amber-800">В накладных есть {unmatched} шт., которых нет в составе отгрузки (артикул/размер не совпали) — проверьте состав.</p>}
        {priceDiffs.length > 0 && (
          <div className="flex flex-col gap-1" data-zi-price-diffs>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Расхождения: заказ ЦУМ ↔ накладная поставщика (цена за единицу, с НДС)</h3>
            <div className="overflow-x-auto rounded-md border border-neutral-200">
              <table className="w-full min-w-[480px] text-xs">
                <thead className="bg-neutral-50 text-left text-neutral-500"><tr><th className="px-2 py-1.5">Артикул</th><th className="px-2 py-1.5 text-right">Заказ ЦУМ, ₽</th><th className="px-2 py-1.5 text-right">Накладная, ₽</th><th className="px-2 py-1.5 text-right">Разница, ₽</th></tr></thead>
                <tbody className="divide-y divide-neutral-100">
                  {priceDiffs.map((d) => (
                    <tr key={d.article}>
                      <td className="px-2 py-1.5">{d.article}</td>
                      <td className="px-2 py-0.5 text-right tabular-nums"><ZiSourceButton v={d} which="order" /></td>
                      <td className="px-2 py-0.5 text-right tabular-nums"><ZiSourceButton v={d} which="invoice" /></td>
                      <td className={"px-2 py-1.5 text-right tabular-nums " + (d.diff < 0 ? "text-red-700" : "text-neutral-700")}>{money(d.diff)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-neutral-500">Разница = заказ ЦУМ − накладная; минус значит, что в накладной цена выше заказа. Причина по документам не названа. Нажмите на цифру, чтобы увидеть, откуда она.</p>
          </div>
        )}
      </div>
    </details>
  );
}
