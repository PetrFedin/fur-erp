"use client";

import { Fragment, useState } from "react";
import { formatMoney } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { AcceptPriceButton } from "@/app/(app)/analytics/pricing/accept-price-button";

export type PriceModel = { id: string; name: string; current: number | null; rows: { acode: string; color: string; size: string; price: number }[] };

const th = "px-2 py-2 text-right text-xs font-semibold whitespace-nowrap";
const td = "px-2 py-1.5 text-right text-sm tabular-nums whitespace-nowrap";
const range = (vals: number[]) => {
  const a = Math.min(...vals), b = Math.max(...vals);
  return a === b ? formatMoney(a) : `${formatMoney(a)} – ${formatMoney(b)}`;
};

/** Розничные цены из прайса 19.10.2026 (с НДС) по модели → артикулу и цвету → размеру; расхождение с карточкой показано в строке, «Взять из прайса» — обычное редактирование цены. */
export function PricesBlock({ models, canEdit }: { models: PriceModel[]; canEdit: boolean }) {
  const [open, setOpen] = useState<string[]>([]);
  const toggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  return (
    <section aria-label="Розничные цены" className="flex min-w-0 scroll-mt-16 flex-col gap-3 rounded-lg border border-neutral-300 bg-white p-3">
      <h2 className="flex items-center gap-1 text-sm font-semibold">Розница по прайсу на 19.10.2026
        <InfoHint label="Про цены прайса" wide><p>Цены с НДС из листа «Current Price» (257 строк). Если у модели цены по цветам и размерам разные, показан диапазон, по вариантам — в раскрытии. Цена в карточке изделия автоматически не меняется: при расхождении в строке написано, что в карточке и что в прайсе, и можно взять цену из прайса (как обычное редактирование цены, с подтверждением и записью в журнал).</p></InfoHint>
      </h2>
      {models.length === 0 ? <p className="text-sm text-neutral-700">Прайс ещё не загружен.</p> : (
        <div className="max-h-[70vh] w-full min-w-0 max-w-full overflow-auto rounded-lg border border-neutral-300" tabIndex={0} role="region" aria-label="Цены по моделям">
          <table className="w-max min-w-full border-collapse">
            <thead>
              <tr className="border-b border-neutral-300">
                <th scope="col" className={th + " sticky left-0 top-0 z-[2] bg-white text-left"}>Модель / артикул / цвет / размер</th>
                <th scope="col" className={th + " sticky top-0 bg-white"}>Розница (прайс 19.10.2026), с НДС</th>
                <th scope="col" className={th + " sticky top-0 bg-white"}>В карточке изделия</th>
                <th scope="col" className={th + " sticky top-0 bg-white text-left"}>Сверка</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const prices = [...new Set(m.rows.map((r) => r.price))];
                const isOpen = open.includes(m.id);
                const single = prices.length === 1 ? prices[0] : null;
                const diff = m.current !== null && !m.rows.some((r) => Math.abs(r.price - m.current!) < 0.5);
                const arts = [...new Set(m.rows.map((r) => r.acode))];
                return (
                  <Fragment key={m.id}>
                    <tr className="border-b border-neutral-200">
                      <th scope="row" className="sticky left-0 z-[1] bg-white px-2 py-1 text-left text-sm font-semibold">
                        <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Развернуть"}: ${m.name}`} onClick={() => toggle(m.id)} className="inline-flex min-h-11 items-center gap-2 text-left"><span aria-hidden>{isOpen ? "▾" : "▸"}</span>{m.name}</button>
                      </th>
                      <td className={td}>{range(prices)}</td>
                      <td className={td}>{m.current === null ? "не задана" : formatMoney(m.current)}</td>
                      <td className="px-2 py-1.5 text-left text-sm">
                        {diff ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <span>в карточке {formatMoney(m.current!)}, в прайсе {single !== null ? formatMoney(single) : range(prices)}</span>
                            {canEdit && single !== null ? <AcceptPriceButton modelId={m.id} modelName={m.name} price={String(single)} priceText={formatMoney(single)} currentText={formatMoney(m.current!)} basis="розница из прайса на 19.10.2026" /> : null}
                          </span>
                        ) : m.current === null ? <span className="text-neutral-700">{single !== null ? "в карточке цены нет, в прайсе одна цена" : "цены по цветам разные — в карточке одна цена не задана"}</span> : <span className="text-neutral-700">совпадает</span>}
                      </td>
                    </tr>
                    {isOpen && arts.map((a) => {
                      const ar = m.rows.filter((r) => r.acode === a);
                      const colors = [...new Set(ar.map((r) => r.color))];
                      return colors.map((c) => {
                        const cr = ar.filter((r) => r.color === c);
                        return (
                          <tr key={m.id + a + c} className="border-b border-neutral-100 bg-neutral-50">
                            <th scope="row" className="sticky left-0 z-[1] bg-neutral-50 py-1.5 pl-10 pr-2 text-left text-sm font-normal">{a} · {c}</th>
                            <td className={td}>{range(cr.map((r) => r.price))}</td>
                            <td className="px-2 py-1.5 text-left text-xs text-neutral-700" colSpan={2}>размеры: {cr.map((r) => `${r.size} — ${formatMoney(r.price)}`).join("; ")}</td>
                          </tr>
                        );
                      });
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
