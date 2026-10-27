"use client";

import { Fragment, useState } from "react";
import { formatMoney } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { AcceptPriceButton } from "@/app/(app)/analytics/pricing/accept-price-button";

export type PriceModel = { id: string; name: string; current: number | null; rows: { acode: string; color: string; size: string; price: number }[];
  /** Реальные цены из продаж по артикулу и цвету: (Retail + Discount) ÷ проданные шт.; нет продаж — записи нет. */
  real: { acode: string; color: string; pcs: number; price: number; discPct: number }[] };

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
        <InfoHint label="Про цены прайса" wide><p>Главная цена — в карточке артикула, прайс — справочник (цены с НДС, 257 строк). Расхождение видно в строке, «Взять из прайса» обновляет карточку с подтверждением и записью в журнал.</p><p className="mt-1"><b>Цена по продажам</b> = (Retail RUR + Discount RUR) ÷ проданные штуки по артикулу и цвету, с НДС — реальная цена до скидки; «К прайсу» — во сколько она отличается от прайса. Где продаж не было, цены нет и мы её не подставляем.</p></InfoHint>
      </h2>
      {models.length === 0 ? <p className="text-sm text-neutral-700">Прайс ещё не загружен.</p> : (
        <div className="max-h-[70vh] w-full min-w-0 max-w-full overflow-auto rounded-lg border border-neutral-300" tabIndex={0} role="region" aria-label="Цены по моделям">
          <table className="table-keep w-max min-w-full border-collapse">
            <thead>
              <tr className="border-b border-neutral-300">
                <th scope="col" className={th + " sticky left-0 top-0 z-[2] bg-white text-left"}>Модель / артикул / цвет / размер</th>
                <th scope="col" className={th + " sticky top-0 bg-white"}>Розница (прайс), с НДС</th>
                <th scope="col" className={th + " sticky top-0 bg-white"}>В карточке изделия</th>
                <th scope="col" className={th + " sticky top-0 bg-white text-left"}>Карточка и прайс</th>
                <th scope="col" className={th + " sticky top-0 bg-white"} title="Проданные штуки (без возвратов)">Продано, шт.</th>
                <th scope="col" className={th + " sticky top-0 bg-white"} title="(Retail RUR + Discount RUR) ÷ проданные штуки: цена до скидки по факту продаж, с НДС">Цена по продажам, до скидки</th>
                <th scope="col" className={th + " sticky top-0 bg-white"} title="Цена по продажам ÷ цена прайса − 1">К прайсу</th>
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
                        {m.current === null && single === null ? <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700" title="В карточке цены нет, а в прайсе цены по цветам разные: выберите, какую взять.">цена не задана</span> : null}
                        {diff || m.current === null ? (
                          <span className="flex flex-wrap items-center gap-2">
                            {diff ? <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900" title={`В карточке ${formatMoney(m.current!)}, в прайсе ${single !== null ? formatMoney(single) : range(prices)}`}>{single !== null ? `${single > m.current! ? "+" : "−"}${formatMoney(Math.abs(single - m.current!))} к карточке` : "в прайсе разные цены"}</span> : null}
                            {canEdit && single !== null ? <AcceptPriceButton label="Взять из прайса" modelId={m.id} modelName={m.name} price={String(single)} priceText={formatMoney(single)} currentText={m.current === null ? null : formatMoney(m.current)} basis="розница из прайса на 19.10.2026" /> : null}
                            {canEdit && single === null ? (
                              <details className="relative">
                                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-md border border-neutral-300 bg-white px-3 text-sm [&::-webkit-details-marker]:hidden">Взять из прайса ▾</summary>
                                <div className="absolute left-0 z-30 mt-1 flex w-64 flex-col gap-2 rounded-lg border border-neutral-300 bg-white p-3 shadow-lg">
                                  <p className="text-xs text-neutral-700">В карточке одна цена на модель, а в прайсе по цветам разные. Какую взять?</p>
                                  {([["максимальную", Math.max(...prices)], ["среднюю по цветам", Math.round(prices.reduce((x, y) => x + y, 0) / prices.length)], ["минимальную", Math.min(...prices)]] as [string, number][]).map(([t, v]) => (
                                    <div key={t} className="flex items-center justify-between gap-2 text-sm"><span>{t}: {formatMoney(v)}</span><AcceptPriceButton label="Взять" modelId={m.id} modelName={m.name} price={String(v)} priceText={formatMoney(v)} currentText={m.current === null ? null : formatMoney(m.current)} basis={`${t} розница из прайса на 19.10.2026`} /></div>
                                  ))}
                                  <p className="text-[11px] text-neutral-600">Цена «по цвету» в карточке не хранится: у модели одна цена.</p>
                                </div>
                              </details>
                            ) : null}
                          </span>
                        ) : <span className="text-neutral-700">совпадает</span>}
                      </td>
                      {(() => {
                        const pcs = m.real.reduce((t, r) => t + r.pcs, 0);
                        if (!pcs) return <td className={td + " text-neutral-500"} colSpan={3}>продаж нет — цену не ставим</td>;
                        const avg = m.real.reduce((t, r) => t + r.price * r.pcs, 0) / pcs;
                        const list = m.rows.filter((r) => m.real.some((x) => x.acode === r.acode && x.color === r.color)).map((r) => r.price);
                        const listAvg = list.length ? list.reduce((t, v) => t + v, 0) / list.length : null;
                        const d = listAvg ? avg / listAvg - 1 : null;
                        return (<>
                          <td className={td}>{pcs}</td>
                          <td className={td}>{m.real.length > 1 ? range(m.real.map((r) => Math.round(r.price))) : formatMoney(Math.round(avg))}</td>
                          <td className={td + (d !== null && Math.abs(d) >= 0.02 ? (d < 0 ? " text-[#b4310b]" : " text-[#17613c]") : "")}>{d === null ? "–" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d * 100).toFixed(0)} %`}</td>
                        </>);
                      })()}
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
                            {(() => {
                              const x = m.real.find((r) => r.acode === a && r.color === c);
                              if (!x) return <td className={td + " text-xs text-neutral-500"} colSpan={3}>продаж нет</td>;
                              const lp = cr.reduce((t, r) => t + r.price, 0) / cr.length, d = x.price / lp - 1;
                              return (<>
                                <td className={td}>{x.pcs}</td>
                                <td className={td} title={`Скидка в продажах ${x.discPct.toFixed(1)} %`}>{formatMoney(Math.round(x.price))}</td>
                                <td className={td + (Math.abs(d) >= 0.02 ? (d < 0 ? " text-[#b4310b]" : " text-[#17613c]") : "")}>{`${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d * 100).toFixed(0)} %`}</td>
                              </>);
                            })()}
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
