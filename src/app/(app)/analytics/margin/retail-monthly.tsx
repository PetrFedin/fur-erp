"use client";

import { Fragment, useMemo, useState } from "react";
import { formatMoney } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { deserializeInput, type MarginInputS } from "@/lib/margin";
import { makeCtx, monthlyBySeason, seasonsOf, type Metrics } from "@/lib/margin-tree";

const MON = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const monthLabel = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const seasonHead = (s: string) => `${s} · ${/^SS/i.test(s) ? "лето" : "осень–зима"}`;
const th = "px-2 py-2 text-right text-xs font-semibold whitespace-nowrap";
const td = "px-2 py-1.5 text-right text-sm tabular-nums whitespace-nowrap";
const nodata = "нет данных";

/** «Розница по месяцам»: выручка и штуки по месяцам продаж внутри сезонов; сезон раскрывается на месяцы. Подчиняется фильтру категории страницы. */
export function RetailMonthly({ input, cat, shown }: { input: MarginInputS | null; cat: "all" | "clothes" | "acc"; shown: string }) {
  const [exVat, setExVat] = useState(false);
  const [open, setOpen] = useState<string[]>([]);
  const rows = useMemo(() => {
    if (!input) return [];
    const inp = deserializeInput(input);
    const lines = cat === "all" ? inp.lines : inp.lines.filter((l) => l.cls === cat);
    return monthlyBySeason(makeCtx(inp), lines, seasonsOf(lines));
  }, [input, cat]);
  if (!input) return null;
  const rev = (m: Metrics) => (exVat ? m.revenueEx : m.revenueIncl);
  const disc = (m: Metrics) => (m.discountVsRetail === null ? nodata : (m.discountVsRetail * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " %");
  const seg = (on: boolean) => "inline-flex min-h-11 items-center rounded-md px-3 text-sm " + (on ? "bg-neutral-900 text-white" : "text-neutral-700 hover:text-neutral-900");
  const toggle = (s: string) => setOpen((o) => (o.includes(s) ? o.filter((x) => x !== s) : [...o, s]));
  return (
    <section aria-label="Розница по месяцам" className="flex min-w-0 scroll-mt-16 flex-col gap-3 rounded-lg border border-neutral-300 bg-white p-3">
      <h2 className="flex items-center gap-1 text-sm font-semibold">Розница по месяцам
        <InfoHint label="Как считается розница по месяцам" wide><p>Выручка — чистые розничные продажи из выгрузки по дате продажи (после скидок, возвраты минус), с НДС или без — по переключателю. Штуки — проданные единицы. Средняя цена = выручка с НДС ÷ штуки. Скидка от прайса = 1 − выручка с НДС ÷ (штуки × текущая розница из прайса) по позициям, у которых цена нашлась. Месяц относится к сезону заказа; итог сезона = сумма его месяцев.</p></InfoHint>
      </h2>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-xs text-neutral-700">Показано: {shown}</span>
        <div role="group" aria-label="НДС розницы" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
          <button type="button" aria-pressed={!exVat} onClick={() => setExVat(false)} className={seg(!exVat)}>С НДС</button>
          <button type="button" aria-pressed={exVat} onClick={() => setExVat(true)} className={seg(exVat)}>Без НДС</button>
        </div>
      </div>
      <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-lg border border-neutral-300" data-keep-scroll tabIndex={0} role="region" aria-label="Розница по сезонам и месяцам">
        <table className="w-max min-w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-300">
              <th scope="col" className={th + " text-left"}>Сезон / месяц</th>
              <th scope="col" className={th}>Выручка {exVat ? "без НДС" : "с НДС"}</th>
              <th scope="col" className={th}>Продано, шт.</th>
              <th scope="col" className={th}>Средняя цена</th>
              <th scope="col" className={th}>Скидка от прайса</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = open.includes(r.season);
              return (
                <Fragment key={r.season}>
                  <tr className="border-b border-neutral-300 bg-neutral-50 font-semibold">
                    <th scope="row" className="px-2 py-1 text-left text-sm">
                      <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Развернуть"} по месяцам: ${r.season}`} onClick={() => toggle(r.season)} className="inline-flex min-h-11 items-center gap-2 text-left"><span aria-hidden>{isOpen ? "▾" : "▸"}</span>{seasonHead(r.season)}</button>
                    </th>
                    <td className={td}>{formatMoney(rev(r.total))}</td><td className={td}>{r.total.sold}</td>
                    <td className={td}>{r.total.avgPrice === null ? nodata : formatMoney(r.total.avgPrice)}</td><td className={td}>{disc(r.total)}</td>
                  </tr>
                  {isOpen && r.months.map((x) => (
                    <tr key={r.season + x.month} className="border-b border-neutral-200">
                      <th scope="row" className="py-1.5 pl-12 pr-2 text-left text-sm font-normal">{monthLabel(x.month)}</th>
                      <td className={td}>{formatMoney(rev(x.m))}</td><td className={td}>{x.m.sold}</td>
                      <td className={td}>{x.m.avgPrice === null ? nodata : formatMoney(x.m.avgPrice)}</td><td className={td}>{disc(x.m)}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
