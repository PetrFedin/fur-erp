"use client";

import { n0, money, pct } from "../sales/sales-fmt";
import type { SsnRow } from "./sales-block-data";

// «Как продавалось в календарном сезоне»: продано по дате продажи; SSN — товар этого же сезона (пришёл в этом сезоне), non-SSN — товар прошлых сезонов (уже был, продался «не по сезону»).
export function SsnTable({ rows, v, vatNote, active }: { rows: SsnRow[]; v: "in" | "ex"; vatNote: string; active?: string }) {
  const sum = (f: (r: SsnRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const share = (a: number, b: number) => (b !== 0 ? a / b : null);
  const body = rows.map((r) => (
    <tr key={r.key} className={"border-b border-neutral-100 " + (active === r.key ? "bg-neutral-50 font-medium" : "")}>
      <td className="px-2 py-1.5 text-left">{r.key}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{n0(r.total.pcs)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{n0(r.ssn.pcs)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{n0(r.non.pcs)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{pct(share(r.ssn.pcs, r.total.pcs), 0)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{money(r.total.rub[v])}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{money(r.ssn.rub[v])}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{money(r.non.rub[v])}</td>
    </tr>
  ));
  const tp = sum((r) => r.total.pcs), sp = sum((r) => r.ssn.pcs), np = sum((r) => r.non.pcs);
  return (
    <details className="rounded-lg border border-neutral-200 bg-white" data-testid="dash-sales-ssn">
      <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm font-medium hover:bg-neutral-50">Продажи по календарным сезонам: SSN и non-SSN <span className="font-normal text-neutral-500">· развернуть таблицу</span></summary>
      <div className="overflow-x-auto px-3 pb-3" data-keep-scroll tabIndex={0}>
        <p className="mb-2 text-xs text-neutral-600">Календарный сезон — по дате продажи. <b>SSN</b> — продажи товара этого же сезона (пришёл в этом сезоне). <b>non-SSN</b> — товар прошлых сезонов, проданный в этот период. Выручка {vatNote}.</p>
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b border-neutral-300 text-xs text-neutral-600">
            <th className="px-2 py-1 text-left">Календарный сезон</th><th className="px-2 py-1 text-right">Продано, шт.</th><th className="px-2 py-1 text-right">SSN, шт.</th><th className="px-2 py-1 text-right">non-SSN, шт.</th><th className="px-2 py-1 text-right">Доля SSN</th>
            <th className="px-2 py-1 text-right">Выручка, ₽</th><th className="px-2 py-1 text-right">SSN, ₽</th><th className="px-2 py-1 text-right">non-SSN, ₽</th>
          </tr></thead>
          <tbody>
            {body}
            <tr className="border-t border-neutral-300 font-semibold">
              <td className="px-2 py-1.5 text-left">Всего</td><td className="px-2 py-1.5 text-right tabular-nums">{n0(tp)}</td><td className="px-2 py-1.5 text-right tabular-nums">{n0(sp)}</td><td className="px-2 py-1.5 text-right tabular-nums">{n0(np)}</td><td className="px-2 py-1.5 text-right tabular-nums">{pct(share(sp, tp), 0)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(sum((r) => r.total.rub[v]))}</td><td className="px-2 py-1.5 text-right tabular-nums">{money(sum((r) => r.ssn.rub[v]))}</td><td className="px-2 py-1.5 text-right tabular-nums">{money(sum((r) => r.non.rub[v]))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}
