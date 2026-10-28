"use client";

import { useState } from "react";
import { n0, money, pct } from "../sales/sales-fmt";
import type { SsnData, SsnPart, SsnRow } from "./sales-block-data";

// «Как продавалось»: два вида одной таблицы.
//  1) Календарные сезоны в строках: пришло в этом сезоне (по дате прихода), продано всего, SSN — товар этого же сезона, non-SSN — товар прошлых сезонов.
//  2) Календарные сезоны в столбцах, сезон товара в строках (как в отчёте Sales): видно, как товар сезона продавался дальше, после окончания его календарного сезона.
const TD = "px-2 py-1.5 text-right tabular-nums", TH = "px-2 py-1 text-right";
const share = (a: number, b: number) => (b !== 0 ? a / b : null);

export function SsnTable({ data, v, vatNote, active }: { data: SsnData; v: "in" | "ex"; vatNote: string; active?: string }) {
  const [view, setView] = useState<"rows" | "cols">("rows");
  const { rows, matrix, cal } = data;
  const sum = (f: (r: SsnRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const tp = sum((r) => r.total.pcs), sp = sum((r) => r.ssn.pcs), np = sum((r) => r.non.pcs);
  const cellTxt = (c: SsnPart | undefined) => (c && c.pcs !== 0 ? `${n0(c.pcs)} · ${money(c.rub[v])}` : "–");
  return (
    <details className="rounded-lg border border-neutral-200 bg-white" data-testid="dash-sales-ssn">
      <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm font-medium hover:bg-neutral-50">Продажи по календарным сезонам: SSN и non-SSN <span className="font-normal text-neutral-500">· развернуть таблицу</span></summary>
      <div className="space-y-2 px-3 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Вид таблицы" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
            {([["rows", "Календарные сезоны в строках"], ["cols", "Календарные сезоны в столбцах"]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={"min-h-9 rounded-md px-3 text-sm " + (view === k ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")}>{t}</button>)}
          </div>
          <span className="text-xs text-neutral-600">Календарный сезон — по дате (SS: февраль–июль, FW: август–январь). Выручка {vatNote}.</span>
        </div>
        <div className="overflow-x-auto" data-keep-scroll tabIndex={0}>
          {view === "rows" ? (
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr className="border-b border-neutral-300 text-xs text-neutral-600">
                <th className="px-2 py-1 text-left">Календарный сезон</th><th className={TH}>Пришло, шт.</th><th className={TH}>Продано, шт.</th><th className={TH}>SSN, шт.</th><th className={TH}>non-SSN, шт.</th><th className={TH}>Доля SSN</th>
                <th className={TH}>Выручка, ₽</th><th className={TH}>SSN, ₽</th><th className={TH}>non-SSN, ₽</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={"border-b border-neutral-100 " + (active === r.key ? "bg-neutral-50 font-medium" : "")}>
                    <td className="px-2 py-1.5 text-left">{r.key}</td>
                    <td className={TD}>{n0(r.recv)}</td><td className={TD}>{n0(r.total.pcs)}</td><td className={TD}>{n0(r.ssn.pcs)}</td><td className={TD}>{n0(r.non.pcs)}</td><td className={TD}>{pct(share(r.ssn.pcs, r.total.pcs), 0)}</td>
                    <td className={TD}>{money(r.total.rub[v])}</td><td className={TD}>{money(r.ssn.rub[v])}</td><td className={TD}>{money(r.non.rub[v])}</td>
                  </tr>
                ))}
                <tr className="border-t border-neutral-300 font-semibold">
                  <td className="px-2 py-1.5 text-left">Всего</td><td className={TD}>{n0(sum((r) => r.recv))}</td><td className={TD}>{n0(tp)}</td><td className={TD}>{n0(sp)}</td><td className={TD}>{n0(np)}</td><td className={TD}>{pct(share(sp, tp), 0)}</td>
                  <td className={TD}>{money(sum((r) => r.total.rub[v]))}</td><td className={TD}>{money(sum((r) => r.ssn.rub[v]))}</td><td className={TD}>{money(sum((r) => r.non.rub[v]))}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-neutral-300 text-xs text-neutral-600">
                  <th className="px-2 py-1 text-left" rowSpan={2}>Сезон товара</th><th className={TH} rowSpan={2}>Пришло, шт.</th><th className={TH} rowSpan={2}>Продано, шт. · ₽</th>
                  <th className="px-2 py-1 text-center" colSpan={cal.length}>Продано в календарном сезоне, шт. · ₽</th>
                </tr>
                <tr className="border-b border-neutral-300 text-xs text-neutral-600">{cal.map((c) => <th key={c} className={TH}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {matrix.map((m) => (
                  <tr key={m.goods} className="border-b border-neutral-100">
                    <td className="px-2 py-1.5 text-left font-medium">{m.goods}</td>
                    <td className={TD}>{n0(m.recv)}</td><td className={TD}>{cellTxt(m.sold)}</td>
                    {cal.map((c) => <td key={c} className={TD + (c === m.goods ? " bg-neutral-50 font-medium" : "")}>{cellTxt(m.cells[c])}</td>)}
                  </tr>
                ))}
                <tr className="border-t border-neutral-300 font-semibold">
                  <td className="px-2 py-1.5 text-left">Всего</td><td className={TD}>{n0(matrix.reduce((a, m) => a + m.recv, 0))}</td>
                  <td className={TD}>{cellTxt({ pcs: matrix.reduce((a, m) => a + m.sold.pcs, 0), rub: { in: matrix.reduce((a, m) => a + m.sold.rub.in, 0), ex: matrix.reduce((a, m) => a + m.sold.rub.ex, 0) } })}</td>
                  {cal.map((c) => <td key={c} className={TD}>{cellTxt({ pcs: matrix.reduce((a, m) => a + (m.cells[c]?.pcs ?? 0), 0), rub: { in: matrix.reduce((a, m) => a + (m.cells[c]?.rub.in ?? 0), 0), ex: matrix.reduce((a, m) => a + (m.cells[c]?.rub.ex ?? 0), 0) } })}</td>)}
                </tr>
              </tbody>
            </table>
          )}
        </div>
        {view === "cols" ? <p className="text-xs text-neutral-600">Ячейка на диагонали (сезон товара = календарный сезон) — это SSN; справа от неё товар продаётся уже после окончания своего сезона (non-SSN для следующих сезонов).</p> : null}
      </div>
    </details>
  );
}
