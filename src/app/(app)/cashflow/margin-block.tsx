"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import type { MarginData, SeasonRow } from "@/lib/margin";

const x2 = (v: number | null) => (v === null ? "нет данных" : "×" + v.toFixed(2).replace(".", ","));
const pc = (v: number | null, d = 0) => (v === null ? "нет данных" : v.toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: d }) + " %");
const f = (v: number | null) => (v === null ? "нет данных" : formatMoney(v));
const share = (v: number | null) => (v === null ? null : v * 100);

function Tile({ label, value, sub, hint }: { label: string; value: string; sub?: string; hint: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-neutral-300 bg-white p-3">
      <div className="flex items-center gap-1 text-xs text-neutral-600">{label}<InfoHint label={`Как считается: ${label}`} wide>{hint}</InfoHint></div>
      <div className="text-lg font-semibold tabular-nums text-neutral-900">{value}</div>
      {sub ? <div className="text-xs text-neutral-600">{sub}</div> : null}
    </div>
  );
}

/** Стрелка тренда относительно предыдущего сезона: словом и знаком (не только цветом). good — рост это хорошо. */
function Trend({ cur, prev, good, digits = 1 }: { cur: number | null; prev: number | null | undefined; good: boolean; digits?: number }) {
  if (cur === null || prev === null || prev === undefined) return null;
  const d = cur - prev;
  if (Math.abs(d) < Math.pow(10, -digits) / 2) return <span className="ml-1 text-xs text-neutral-600">без изменений</span>;
  const up = d > 0;
  return <span className={"ml-1 text-xs " + (up === good ? "text-[#17613c]" : "text-[#b4310b]")}>{up ? "▲ выше" : "▼ ниже"} на {Math.abs(d).toLocaleString("ru-RU", { maximumFractionDigits: digits })}</span>;
}

export function MarginBlock({ data }: { data: MarginData | null }) {
  const [models, setModels] = useState(false);
  if (!data) {
    return (
      <section aria-label="Маржа и наценка" className="rounded-lg border border-neutral-300 bg-white p-3">
        <h2 className="text-sm font-semibold">Маржа и наценка</h2>
        <p className="mt-1 text-sm text-neutral-700">Нет данных о продажах: выгрузка поступлений и продаж ещё не загружена.</p>
      </section>
    );
  }
  const seasons = data.seasons;
  const th = "px-2 py-2 text-right text-xs font-semibold whitespace-nowrap";
  const td = "px-2 py-1.5 text-right text-sm tabular-nums whitespace-nowrap";
  const cell = (s: SeasonRow, i: number, k: "markupW" | "discountVsRetail" | "grossMarginPct" | "gpOfRetail" | "sellThrough") => {
    const prev = seasons[i - 1];
    const val = (r: SeasonRow | undefined) => (r ? (k === "markupW" ? r.markupW : k === "grossMarginPct" ? r.grossMarginPct : share(r[k])) : null);
    const cur = val(s);
    return (
      <td className={td}>
        {k === "markupW" ? x2(cur) : pc(cur, k === "sellThrough" ? 0 : 1)}
        <Trend cur={cur} prev={val(prev)} good={k !== "discountVsRetail"} digits={k === "markupW" ? 2 : 1} />
      </td>
    );
  };
  return (
    <section aria-label="Маржа и наценка" className="flex flex-col gap-3 rounded-lg border border-neutral-300 bg-white p-3">
      <h2 className="text-sm font-semibold">Маржа и наценка</h2>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Tile label="Средний маркап" value={x2(data.avgMarkup)} sub={`простой по ${data.avgMarkupN} моделям`} hint={<p>Маркап модели = текущая розница с НДС ÷ себестоимость единицы с работой и НДС (как «Себестоимость» в «Изделиях»). Здесь — простое среднее по моделям, у которых есть и цена, и себестоимость. Наценка в % = (маркап − 1) × 100.</p>} />
        <Tile label="По приходу" value={x2(data.weightedByReceipts)} sub="вес — единицы прихода" hint={<p>Средневзвешенный маркап: Σ(розница × единицы прихода) ÷ Σ(себестоимость × единицы прихода). Вес — поступившие единицы модели.</p>} />
        <Tile label="По продажам" value={x2(data.weightedBySales)} sub="вес — проданные единицы" hint={<p>Σ(розница × проданные единицы) ÷ Σ(себестоимость × проданные единицы). Вес — проданные единицы модели (возвраты минус).</p>} />
        <Tile label="Валовая маржа" value={pc(data.totals.grossMarginPct, 1)} sub={data.totals.grossProfit === null ? undefined : `${formatMoney(data.totals.grossProfit)} без НДС`} hint={<p>Валовая прибыль = выручка без НДС − себестоимость проданных единиц (себестоимость единицы модели из ТЗ без НДС × проданные штуки). Маржа = прибыль ÷ выручка без НДС. Только по проданному, у чего есть себестоимость.</p>} />
        <Tile label="Охват данных" value={`${pc(share(data.costCoverage))} · ${pc(share(data.priceCoverage))}`} sub="проданные шт.: себестоимость · цена" hint={<p>Доля проданных единиц, по которым нашлась себестоимость модели в ТЗ, и текущая розница из прайса (по артикулу и цвету). Остальное в расчёты не входит — «нет данных».</p>} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-300" tabIndex={0} role="region" aria-label="Маржа по сезонам">
        <table className="w-full border-collapse">
          <caption className="px-2 py-2 text-left text-xs text-neutral-600">По сезонам продаж (сезон заказа из выгрузки; FW — осень–зима, SS — весна–лето). Стрелка — к предыдущему сезону.</caption>
          <thead>
            <tr className="border-b border-neutral-300">
              <th scope="col" className={th + " text-left"}>Сезон</th>
              <th scope="col" className={th}>Выручка без НДС</th>
              <th scope="col" className={th}>Продано / получено, шт.</th>
              <th scope="col" className={th}>Sell-through<InfoHint label="Sell-through сезона"><p>Продано ÷ получено единиц по заказам сезона.</p></InfoHint></th>
              <th scope="col" className={th}>Средняя цена продажи</th>
              <th scope="col" className={th}>Скидка от текущей розницы<InfoHint label="Скидка от розницы" wide><p>1 − выручка с НДС ÷ (штуки × текущая розница из прайса) по проданным позициям, у которых цена нашлась. Цена продажи уже после скидок магазина.</p></InfoHint></th>
              <th scope="col" className={th}>Валовая прибыль<InfoHint label="Валовая прибыль сезона" wide><p>Выручка без НДС − себестоимость проданных единиц без НДС.</p></InfoHint></th>
              <th scope="col" className={th}>Валовая маржа</th>
              <th scope="col" className={th}>Прибыль / розница<InfoHint label="Валовая прибыль к рознице" wide><p>Валовая прибыль ÷ розничная стоимость проданного без НДС (штуки × текущая розница ÷ 1,22), по позициям с ценой и себестоимостью.</p></InfoHint></th>
              <th scope="col" className={th}>Маркап прихода<InfoHint label="Маркап прихода сезона" wide><p>Средневзвешенный по единицам прихода сезона: Σ(розница × шт.) ÷ Σ(себестоимость × шт.).</p></InfoHint></th>
            </tr>
          </thead>
          <tbody>
            {seasons.map((s, i) => (
              <tr key={s.season} className="border-b border-neutral-200">
                <th scope="row" className="px-2 py-1.5 text-left text-sm font-semibold">{s.season}</th>
                <td className={td}>{f(s.revenueEx)}</td>
                <td className={td}>{s.sold} / {s.received}</td>
                {cell(s, i, "sellThrough")}
                <td className={td}>{f(s.avgPrice)}</td>
                {cell(s, i, "discountVsRetail")}
                <td className={td}>{f(s.grossProfit)}</td>
                {cell(s, i, "grossMarginPct")}
                {cell(s, i, "gpOfRetail")}
                {cell(s, i, "markupW")}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <button type="button" aria-expanded={models} onClick={() => setModels((v) => !v)} className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm">{models ? "Скрыть маркапы по моделям" : "Показать маркапы по моделям"}</button>
      </div>
      {models && (
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-neutral-300" tabIndex={0} role="region" aria-label="Маркапы по моделям">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-neutral-300">
                <th scope="col" className={th + " sticky left-0 bg-white text-left"}>Модель</th>
                <th scope="col" className={th}>Себестоимость ед., с НДС</th>
                <th scope="col" className={th}>Розница с НДС</th>
                <th scope="col" className={th}>Маркап</th>
                <th scope="col" className={th}>Наценка, %</th>
                <th scope="col" className={th}>Валовая на ед., без НДС</th>
                <th scope="col" className={th}>Получено, шт.</th>
                <th scope="col" className={th}>Продано, шт.</th>
              </tr>
            </thead>
            <tbody>
              {data.models.filter((m) => m.received !== 0 || m.sold !== 0).map((m) => (
                <tr key={m.code} className="border-b border-neutral-200">
                  <th scope="row" className="sticky left-0 bg-white px-2 py-1.5 text-left text-sm font-normal">{m.name}</th>
                  <td className={td}>{f(m.unitIncl)}</td>
                  <td className={td}>{f(m.price)}{m.priceKind === "прайс" ? <span className="text-xs text-neutral-600"> · по приходу</span> : null}</td>
                  <td className={td}>{x2(m.markup)}</td>
                  <td className={td}>{m.markupPct === null ? "нет данных" : pc(m.markupPct, 0)}</td>
                  <td className={td}>{f(m.grossPerUnit)}</td>
                  <td className={td}>{m.received}</td>
                  <td className={td}>{m.sold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
