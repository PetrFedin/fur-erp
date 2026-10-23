"use client";

import { Fragment, useState } from "react";
import type { ForecastLine, RawForecast } from "@/lib/raw-forecast";
import { formatDec1, formatInt, formatMoney } from "@/lib/utils";

const TH = "px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-neutral-500";
const TD = "px-3 py-2 text-right text-sm tabular-nums";
const key = (fur: string) => fur.split(" + ").sort().join(" + ");

export function LinesTable({ lines, noData }: { lines: ForecastLine[]; noData: RawForecast["noData"] }) {
  const [fur, setFur] = useState<string>("all");
  const counts = new Map<string, number>();
  for (const x of lines) counts.set(key(x.fur), (counts.get(key(x.fur)) ?? 0) + x.left);
  for (const x of noData) counts.set(key(x.fur), (counts.get(key(x.fur)) ?? 0) + x.left);
  const opts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const L = lines.filter((x) => fur === "all" || key(x.fur) === fur);
  const ND = noData.filter((x) => fur === "all" || key(x.fur) === fur);
  type Sums = { left: number; hides: number; fur$: number; meters: number; lining$: number; c4$: number; work$: number; total$: number };
  const sumOf = (g: Sums[]): Sums => g.reduce((a, x) => ({ left: a.left + x.left, hides: a.hides + x.hides, fur$: a.fur$ + x.fur$, meters: a.meters + x.meters, lining$: a.lining$ + x.lining$, c4$: a.c4$ + x.c4$, work$: a.work$ + x.work$, total$: a.total$ + x.total$ }), { left: 0, hides: 0, fur$: 0, meters: 0, lining$: 0, c4$: 0, work$: 0, total$: 0 });
  const m = (v: number) => formatMoney(Math.round(v / 1000) * 1000);
  const SEP = " border-l border-neutral-200";
  const cell = (v: string, per: string, cls = "") => <td className={TD + " whitespace-nowrap leading-tight " + cls}>{v}<div className="whitespace-nowrap text-[11px] font-normal text-neutral-500">{per}</div></td>;
  const d1 = formatDec1;
  const cells = (x: Sums, n: number, extra = 0) => {
    const k = n || 1;
    return (
      <>
        <td className={TD}>{formatInt(n + extra)}{extra ? <div className="whitespace-nowrap text-[11px] font-normal text-neutral-500">без расчёта {formatInt(extra)}</div> : null}</td>
        {cell(formatInt(x.hides), `${d1(x.hides / k)} / изд.`, SEP)}{cell(m(x.fur$), `${m(x.fur$ / k)} / изд.`)}
        {cell(formatInt(x.meters), `${d1(x.meters / k)} м / изд.`, SEP)}{cell(m(x.lining$), `${m(x.lining$ / k)} / изд.`)}
        {cell(m(x.c4$), `${m(x.c4$ / k)} / изд.`, SEP)}
        {cell(m(x.work$), `${m(x.work$ / k)} / изд.`, SEP)}
        {cell(m(x.total$), `${m(x.total$ / k)} / изд.`, SEP + " font-semibold")}
      </>
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Тип меха" className="flex flex-wrap gap-1.5">
        {["all", ...opts].map((o) => (
          <button key={o} type="button" aria-pressed={fur === o} onClick={() => setFur(o)}
            className={"min-h-11 rounded-lg border px-3 text-sm " + (fur === o ? "border-[var(--ui-accent)] bg-[var(--ui-soft)] font-semibold" : "border-neutral-300 bg-white hover:border-neutral-500")}>
            {o === "all" ? "Все" : o}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[1000px]">
          <thead>
            <tr><th colSpan={3} />
              <th colSpan={2} className={TH + " text-center" + SEP}>Мех</th><th colSpan={2} className={TH + " text-center" + SEP}>Подкладка</th><th className={TH + " text-center" + SEP}>Надбавка</th><th className={TH + " text-center" + SEP}>Работа</th><th className={TH + " text-center" + SEP}>Всего</th></tr>
            <tr className="border-b border-neutral-200">
              <th className={TH + " text-left"}>Категория 2</th><th className={TH + " text-left"}>Артикул</th><th className={TH}>Изд.</th>
              <th className={TH + SEP}>Шкур</th><th className={TH}>₽</th><th className={TH + SEP}>Метров</th><th className={TH}>₽</th><th className={TH + SEP}>4%, ₽</th><th className={TH + SEP}>₽</th><th className={TH + SEP}>Себестоимость, ₽</th>
            </tr>
          </thead>
          <tbody>
            {([["clothes", "Одежда"], ["acc", "Аксессуары"]] as const).map(([cls, title]) => {
              const g = L.filter((x) => x.cls === cls);
              const nd = ND.filter((x) => x.cls === cls);
              const ndN = nd.reduce((a, x) => a + x.left, 0);
              if (!g.length && !nd.length) return null;
              return (
                <Fragment key={cls}>
                  <tr className="bg-neutral-100"><td colSpan={10} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-600">{title}</td></tr>
                  {g.map((x, i) => (
                    <tr key={x.acode + i} className="border-b border-neutral-100">
                      <td className="px-3 py-2 text-sm text-neutral-600">{x.cat2}</td>
                      <td className="px-3 py-2 text-sm">{x.acode}{x.source === "категория" ? <span className="ml-1 text-[11px] text-neutral-400">по категории</span> : null}</td>
                      {cells(x, x.left)}
                    </tr>
                  ))}
                  {nd.map((x) => <tr key={x.acode} className="border-b border-neutral-100 text-neutral-500"><td className="px-3 py-2 text-sm">{x.cat2}</td><td className="px-3 py-2 text-sm">{x.acode}</td><td className={TD}>{formatInt(x.left)}</td><td colSpan={7} className="px-3 py-2 text-xs">нет шкур и цен в ТЗ — в расчёт не входит</td></tr>)}
                  <tr className="bg-neutral-50 font-semibold"><td colSpan={2} className="px-3 py-2 text-sm">Итого: {title.toLowerCase()}</td>{cells(sumOf(g), sumOf(g).left, ndN)}</tr>
                </Fragment>
              );
            })}
            <tr className="border-t-2 border-neutral-300 bg-neutral-100 font-semibold"><td colSpan={2} className="px-3 py-2 text-sm">Общий итог</td>{cells(sumOf(L), sumOf(L).left, ND.reduce((a, x) => a + x.left, 0))}</tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
