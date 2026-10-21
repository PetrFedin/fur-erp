"use client";

import { Fragment, useState } from "react";
import { TH, THGroup } from "@/components/table-head";
import { UNIT } from "@/lib/units";
import { DASH, money, n0, pct, x2 } from "../sales/sales-fmt";
import type { SalesRow, SalesView } from "./sales-block-data";

// Таблица «Продажи и остатки»: строки — иерархия (мех → кат.1 → кат.2 или кат.1 → кат.2 → мех), столбцы слева направо:
// Получено, шт. | Продано, шт., Выручка, Средневзвешенная цена продажи | Sell-through | Остаток, шт., Остаток в розничных ценах.

export type Hier = "fur" | "cls";
export const HIER_LABEL: Record<Hier, string> = { fur: "Тип меха → кат. 1 → кат. 2", cls: "Кат. 1 → кат. 2 → тип меха" };

// Ширины столбцов: название, получено (шт., себестоимость), продажи (шт., выручка, цена), SO, остаток (шт., розница, цена).
const WIDTHS = [250, 70, 120, 104, 70, 120, 104, 74, 64, 70, 124, 104, 74];
/** Средневзвешенная цена — округлённо до тысяч, чтобы читалась с первого взгляда. */
export const moneyK = (v: number | null) => (v === null || Math.abs(v) < 500 ? DASH : money(Math.round(v / 1000) * 1000));
const td = "whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums";
const GB = " border-l border-neutral-100";

export function SalesTable({ view, v, vatNote, testId, cumCol = false, soAs = false }: { view: SalesView; v: "in" | "ex"; vatNote: string; testId?: string; /** Сезон закончился: рядом с SO на сегодня показываем SO AS (проданное до конца сезона). */ soAs?: boolean; /** Выбран сезон: рядом с остатком сезона — весь остаток на сегодня и доля сезона в нём. */ cumCol?: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const cells = (r: SalesRow) => (
    <>
      <td className={td + GB}>{n0(r.received)}</td>
      <td className={td}>{r.recvCost[v] > 0.5 ? money(r.recvCost[v]) : DASH}</td>
      <td className={td}>{r.recvCost[v] > 0.5 && r.recvCostPcs > 0 ? moneyK(r.recvCost[v] / r.recvCostPcs) : DASH}</td>
      <td className={td + GB}>{n0(r.sold)}</td>
      <td className={td}>{money(r.revenue[v])}</td>
      <td className={td}>{moneyK(r.avgPrice[v])}</td>
      <td className={td}>{x2(r.markupSold[v])}</td>
      {soAs ? <td className={td + GB}>{pct(r.soAs, 1)}</td> : null}
      <td className={td + (soAs ? "" : GB)}>{pct(r.sellThrough, 1)}</td>
      <td className={td + GB}>{n0(r.stock)}</td>
      <td className={td}>{r.stockList[v] > 0.5 ? money(r.stockList[v]) : DASH}</td>
      <td className={td}>{r.stockList[v] > 0.5 && r.stockListPcs > 0 ? moneyK(r.stockList[v] / r.stockListPcs) : DASH}</td>
      <td className={td}>{x2(r.markupStock[v])}</td>
      {cumCol ? <td className={td}>{r.stockCum > 0 ? pct(r.stock / r.stockCum, 0) : DASH}</td> : null}
      {cumCol ? <td className={td + GB}>{n0(r.stockCum)}</td> : null}
      {cumCol ? <td className={td}>{r.stockListCum[v] > 0.5 ? money(r.stockListCum[v]) : DASH}</td> : null}
      {cumCol ? <td className={td}>{r.stockListCum[v] > 0.5 && r.stockListPcsCum > 0 ? moneyK(r.stockListCum[v] / r.stockListPcsCum) : DASH}</td> : null}
      {cumCol ? <td className={td}>{x2(r.markupStockCum[v])}</td> : null}
    </>
  );
  const render = (r: SalesRow): React.ReactNode => {
    const isOpen = open.has(r.id);
    const kids = r.children.filter((c) => c.received !== 0 || c.sold !== 0 || c.stock !== 0);
    return (
      <Fragment key={r.id}>
        <tr data-depth={r.depth} className={"border-b border-neutral-100 " + (r.depth === 0 ? "bg-white font-medium" : r.depth === 1 ? "bg-neutral-50 text-[13px] text-neutral-700" : r.depth === 2 ? "bg-white text-[13px] text-neutral-700" : "bg-white text-[12px] text-neutral-600")}>
          <td className="sticky left-0 z-[1] bg-inherit px-2 py-1.5 text-left">
            <div className="flex min-w-0 items-center" style={{ paddingLeft: Math.min(r.depth, 6) * 16 }}>
              <span className="inline-flex w-5 shrink-0 items-center">
                {kids.length > 0 ? <button type="button" onClick={() => toggle(r.id)} aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Раскрыть"}: ${r.label}`} className="inline-flex size-6 items-center justify-center text-neutral-500"><span aria-hidden className={"inline-block transition-transform " + (isOpen ? "rotate-90" : "")}>›</span></button> : null}
              </span>
              <span className="min-w-0 break-words leading-tight">{r.label.split(" · ")[0]}</span>
            </div>
          </td>
          {cells(r)}
        </tr>
        {isOpen ? kids.map(render) : null}
      </Fragment>
    );
  };
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white" data-keep-scroll tabIndex={0}>
      <table suppressHydrationWarning className="table-keep w-full min-w-[1700px] table-fixed text-sm" data-testid={testId}>
        <colgroup>{(() => { const w = cumCol ? [...WIDTHS, 64, 70, 124, 104, 74] : [...WIDTHS]; if (soAs) w.splice(8, 0, 64); return w; })().map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr className="border-b border-neutral-200">
            <TH rowSpan={2} align="left" className="sticky left-0 z-[2] bg-white px-2" label="Тип меха / категория" />
            <THGroup colSpan={3}>Получено</THGroup>
            <THGroup colSpan={4}>Продажи, {vatNote}</THGroup>
            {soAs ? <THGroup colSpan={2}>SO</THGroup> : <TH rowSpan={2} sep label={cumCol ? "SO STD" : "SO"} unit={UNIT.pct} />}
            <THGroup colSpan={cumCol ? 5 : 4}>{cumCol ? "Сток сезонный" : "Остаток"}</THGroup>
            {cumCol ? <THGroup colSpan={4}>Сток тотал</THGroup> : null}
          </tr>
          <tr className="border-b border-neutral-200">
            <TH sep label="Штуки" unit={UNIT.pcs} />
            <TH label="Себестоимость" unit={UNIT.rub} />
            <TH label="Ср. взвеш. цена" unit={UNIT.rubPerPcs} />
            <TH sep label="Продано" unit={UNIT.pcs} />
            <TH label="Выручка" unit={UNIT.rub} />
            <TH label="Ср. взвеш. цена" unit={UNIT.rubPerPcs} />
            <TH label="Маркап" unit="×" />
            {soAs ? <TH sep label="AS" unit={UNIT.pct} /> : null}
            {soAs ? <TH label="STD" unit={UNIT.pct} /> : null}
            <TH sep label="Штуки" unit={UNIT.pcs} />
            <TH label="В розничных ценах" unit={UNIT.rub} />
            <TH label="Ср. взвеш. цена" unit={UNIT.rubPerPcs} />
            <TH label="Маркап" unit="×" />
            {cumCol ? <TH label="Доля сезона" unit={UNIT.pct} /> : null}
            {cumCol ? <TH sep label="Штуки" unit={UNIT.pcs} /> : null}
            {cumCol ? <TH label="В розничных ценах" unit={UNIT.rub} /> : null}
            {cumCol ? <TH label="Ср. взвеш. цена" unit={UNIT.rubPerPcs} /> : null}
            {cumCol ? <TH label="Маркап" unit="×" /> : null}
          </tr>
        </thead>
        <tbody>
          {view.rows.map(render)}
          <tr className="row-total">
            <td className="sticky left-0 z-[1] bg-inherit px-2 py-1.5 text-left font-semibold"><span className="pl-5">Всего</span></td>
            {cells(view.total)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
