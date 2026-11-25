"use client";
import { formatQty, formatMoney } from "@/lib/utils";
import type { draftTotals, vatByRate } from "@/lib/tz-calc";
import { M, Step } from "./parts";
import { cardCls } from "./types";

/** Шаг 3 «Итоги»: суммы черновика ТЗ, пересчитываются на лету. */
export function TotalsStep({ T, vatRows4, clientName }: { T: ReturnType<typeof draftTotals>; vatRows4: ReturnType<typeof vatByRate>; clientName: string | undefined }) {
  return (
    <Step n={3} title="Итоги" hint={<><p>Пересчитывается на лету, до сохранения; формулы те же, что в карточке ТЗ: мех + подкладка (с 4 % или без) + расходы + работа. «С 4 %» — основная цифра, под ней «без 4 %». Показ «С НДС / Без НДС» — общий переключатель шапки.</p><p className="mt-1">Средневзвешенная цена — сумма по лотам ÷ количество; расход на 1 изделие — количество шкур (метров) ÷ количество изделий.</p></>}>
      <div className={`${cardCls} grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6`}>
        {[
          ["Мех", T.fur.incl4, T.fur.excl4, T.fur.baseIncl, T.fur.baseExcl],
          ["Подкладка", T.lining.incl4, T.lining.excl4, T.lining.baseIncl, T.lining.baseExcl],
        ].map(([label, i4, e4, i0, e0]) => (
          <div key={label as string}>
            <div className="text-xs text-neutral-500">{label as string} · с 4 %</div>
            <div className="font-medium tabular-nums">{(i4 as number) > 0 ? <M incl={i4 as number} excl={e4 as number} /> : "–"}</div>
            {(i0 as number) > 0 && <div className="text-[11px] text-neutral-600">без 4 %: <M incl={i0 as number} excl={e0 as number} /></div>}
          </div>
        ))}
        <div>
          <div className="text-xs text-neutral-500">Расходы</div>
          <div className="font-medium tabular-nums">{T.expenses > 0 ? formatMoney(T.expenses) : "–"}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">Работа</div>
          <div className="font-medium tabular-nums">{T.work > 0 ? formatMoney(T.work) : "–"}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">Полная себестоимость ТЗ (с работой) · с 4 %</div>
          <div className="text-base font-semibold tabular-nums">{T.grandIncl4 > 0 ? <M incl={T.grandIncl4} excl={T.grandExcl4} /> : "–"}</div>
          {T.grandIncl0 > 0 && <div className="text-[11px] text-neutral-600">без 4 %: <M incl={T.grandIncl0} excl={T.grandExcl0} /></div>}
        </div>
        <div>
          <div className="text-xs text-neutral-500">На 1 изделие · с 4 %</div>
          <div className="font-medium tabular-nums">{T.perUnitIncl4 != null && T.grandIncl4 > 0 ? <M incl={T.perUnitIncl4} excl={T.perUnitExcl4 ?? 0} /> : "–"}</div>
          {T.perUnitIncl0 != null && T.grandIncl0 > 0 && <div className="text-[11px] text-neutral-600">без 4 %: <M incl={T.perUnitIncl0} excl={T.perUnitExcl0 ?? 0} /></div>}
        </div>
        <div>
          <div className="text-xs text-neutral-500">4 % добавляют</div>
          <div className="font-medium tabular-nums">{T.extra4 > 0.005 ? formatMoney(T.extra4) : "–"}</div>
        </div>
        <div className="col-span-2 sm:col-span-3 lg:col-span-3">
          <div className="text-xs text-neutral-500">НДС в списаниях (с 4 %)</div>
          <div className="tabular-nums">
            {vatRows4.length === 0 ? "–" : vatRows4.map((r) => (
              <span key={r.rate} className="mr-3 inline-block">НДС {r.rate} %: <b className="font-medium">{formatMoney(Math.round(r.vat))}</b> <span className="text-[11px] text-neutral-600">из {formatMoney(Math.round(r.incl))}</span></span>
            ))}
          </div>
        </div>
        <div className="col-span-2 sm:col-span-3 lg:col-span-3">
          <div className="text-xs text-neutral-500">Средневзвешенное · расход на 1 изделие</div>
          <div className="text-[13px] tabular-nums">
            <div>Мех: {T.furAvgPrice ? <><b className="font-medium">{formatMoney(Math.round(T.furAvgPrice.incl4))}</b>/шкуру <span className="text-[11px] text-neutral-600">(без 4 %: {formatMoney(Math.round(T.furAvgPrice.incl0))})</span></> : "–"}{T.furPerItem != null ? <> · {formatQty(Math.round(T.furPerItem * 100) / 100)} шк./изд.</> : ""}</div>
            {T.liningAvgPrice && (
              <div>Подкладка: <b className="font-medium">{formatMoney(Math.round(T.liningAvgPrice.incl4))}</b>/м <span className="text-[11px] text-neutral-600">(без 4 %: {formatMoney(Math.round(T.liningAvgPrice.incl0))})</span>{T.liningPerItem != null ? <> · {formatQty(Math.round(T.liningPerItem * 100) / 100)} м/изд.</> : ""}</div>
            )}
          </div>
        </div>
      </div>
      {clientName && <p className="text-xs text-neutral-500">Заказчик: {clientName}. Оплаты за работу разносятся на ТЗ в «Оплаты → За работу».</p>}
    </Step>
  );
}
