"use client";

import type { ReactNode } from "react";
import { formatPercent, formatDec1 } from "@/lib/utils";
import { perUnit, type Agg, type BudgetNode } from "@/lib/budget-calc";
import { Badge, money, qty, share } from "../ui";
import { Avg, KIND_LABEL, ZERO, mt, mz, qz, sepL } from "./parts";
import type { RowKit } from "./row-kit";

/** Строки трёх видов таблицы (Сводка, На 1 изделие, Детально) и карточки телефона — рекурсивно по дереву узлов. */
export function makeTreeRows(ctx: { vKids: Map<string | null, BudgetNode[]>; calc: Map<string, Agg>; collapsed: Set<string>; total: Agg; setUnitFor: (id: string | null) => void; canEdit: boolean; patch: (id: string, pt: Partial<BudgetNode>) => void; kit: RowKit }) {
  const { vKids, calc, collapsed, total, setUnitFor, canEdit, patch } = ctx;
  const { chevron, lockBtn, dot, actions, numCell, nameCell, cardField } = ctx.kit;
  // ---- Сводка (для руководства): без полей ввода
  const sumCell = "whitespace-nowrap px-1.5 py-2 text-right text-xs tabular-nums print:px-0.5 print:text-[11px] 2xl:px-3 2xl:text-[13px]";
  const sumRow = (key: string, label: ReactNode, a: Agg, o: { bg: string; bold?: boolean }) => {
    const sh = total.total > 0 ? a.total / total.total : 0;
    return (
      <tr key={key} className={`${o.bg} ${o.bold ? "font-semibold" : ""} [&>td]:border-b [&>td]:border-neutral-100 print:break-inside-avoid`}>
        <td className={`sticky left-0 z-10 min-w-[120px] max-w-[320px] border-r border-neutral-200 px-1.5 py-2 text-sm bg-inherit print:static`}>{label}</td>
        <td className={sumCell}>{qz(a.pcs)}</td>
        <td className={sumCell + " text-neutral-600"}>{qz(a.hides)}<Avg sum={a.hides} per={a.pcs} unit="шк./изд." d={1} /></td>
        <td className={sumCell + " " + sepL}>{mt(a.mex)}<Avg sum={a.mex} per={a.hides} unit="₽/шт." /></td>
        <td className={sumCell}>{mt(a.lining)}<Avg sum={a.lining} per={a.meters} unit="₽/м" /></td>
        <td className={sumCell}>{mt(a.work)}<Avg sum={a.work} per={a.pcs} unit="₽/изд." /></td>
        <td className={sumCell + " text-neutral-500"}>{mt(a.c4)}<Avg sum={a.c4} per={a.pcs} unit="₽/изд." /></td>
        <td className={sumCell + " text-sm font-semibold " + sepL}>
          {mt(a.total)}
          <div className="mt-1 flex items-center justify-end gap-1.5 text-[11px] font-normal text-neutral-500">
            <span className="h-1 w-8 overflow-hidden 2xl:w-16 rounded-full bg-neutral-200"><span className="block h-1 rounded-full bg-neutral-700" style={{ width: `${Math.min(100, sh * 100)}%` }} /></span>
            <span className="w-8 text-right">{share(a.total, total.total)}</span>
          </div>
        </td>
        <td className={sumCell}>{mt(perUnit(a))}</td>
      </tr>
    );
  };
  const summaryRows = (parentId: string | null, depth: number): ReactNode[] =>
    (vKids.get(parentId) ?? []).flatMap((n) => {
      const a = calc.get(n.id) ?? ZERO;
      const ch = vKids.get(n.id) ?? [];
      const open = !collapsed.has(n.id);
      const bg = n.kind === "fur" ? "bg-neutral-100" : ch.length ? "bg-neutral-50" : "bg-white";
      const label = (
        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 14 }}>
          {chevron(n, ch.length > 0, open, "h-7 w-5")}
          {lockBtn(n, false)}
          <span className={n.kind === "fur" ? "text-sm" : ""}>{n.name || "Без названия"}</span>
          {n.kind === "art" ? <Badge tone={n.modelId ? "info" : "manual"}>{n.modelId ? "арт." : "план"}</Badge> : null}
          
        </div>
      );
      return [sumRow(n.id, label, a, { bg, bold: n.kind === "fur" || ch.length > 0 }), ...(open ? summaryRows(n.id, depth + 1) : [])];
    });
  // ---- На 1 изделие: сколько обходится одно изделие по статьям (с надбавками), по каждому типу сырья, категории и длине
  const unitRows = (parentId: string | null, depth: number): ReactNode[] =>
    (vKids.get(parentId) ?? []).flatMap((n) => {
      const a = calc.get(n.id) ?? ZERO;
      const ch = vKids.get(n.id) ?? [];
      const open = !collapsed.has(n.id);
      const u = (v: number) => (a.pcs > 0 ? v / a.pcs : null);
      const hidesPer = u(a.hides), mexPer = u(a.mex), liningPer = u(a.lining), workPer = u(a.work), c4Per = u(a.c4), totalPer = u(a.total);
      const hidePrice = a.hides > 0 ? a.mex / a.hides : null, metersPer = u(a.meters), meterPrice = a.meters > 0 ? a.lining / a.meters : null;
      const nowPer = a.nowPcs > 0 ? a.nowTotal / a.nowPcs : null;
      const bg = n.kind === "fur" ? "bg-neutral-100" : ch.length ? "bg-neutral-50" : "bg-white";
      const c = "whitespace-nowrap px-1.5 py-2 text-right text-xs tabular-nums 2xl:text-[13px]";
      const row = (
        <tr key={"u" + n.id} className={`${bg} ${n.kind === "fur" || ch.length ? "font-semibold" : ""} [&>td]:border-b [&>td]:border-neutral-100`}>
          <td className="sticky left-0 z-10 min-w-[180px] border-r border-neutral-200 bg-inherit px-2 py-2 text-sm">
            <div className="flex items-center gap-1" style={{ paddingLeft: depth * 14 }}>
              {chevron(n, ch.length > 0, open, "h-7 w-5")}
              {n.kind === "cat" ? <button type="button" onClick={() => setUnitFor(n.id)} className="text-left font-medium text-blue-800 underline decoration-dotted underline-offset-2 hover:text-blue-900" aria-haspopup="dialog">{n.name || "Без названия"}</button> : <span>{n.name || "Без названия"}</span>}
              {n.kind !== "fur" && !ch.length ? dot(n) : null}
            </div>
          </td>
          <td className={c}>{qz(a.pcs)}</td>
          <td className={c + " " + sepL}>{hidesPer ? formatDec1(hidesPer) : "–"}</td>
          <td className={c}>{mz(hidePrice)}</td>
          <td className={c + " text-neutral-700"}>{mz(mexPer)}</td>
          <td className={c + " " + sepL}>{metersPer ? formatDec1(metersPer) : "–"}</td>
          <td className={c}>{mz(meterPrice)}</td>
          <td className={c + " text-neutral-700"}>{mz(liningPer)}</td>
          <td className={c + " " + sepL}>{mz(workPer)}</td>
          <td className={c + " text-neutral-500"}>{mz(c4Per)}</td>
          <td className={c + " " + sepL + " font-semibold text-neutral-900"}>{mz(totalPer)}</td>
          <td className={c + " text-neutral-500"}>{mz(nowPer)}</td>
        </tr>
      );
      return [row, ...(open ? unitRows(n.id, depth + 1) : [])];
    });

  // ---- Детально: таблица с полями (планшет и компьютер)
  const avg = (a: Agg) => ({
    hides: a.pcs > 0 ? a.hides / a.pcs : null, hidePrice: a.hides > 0 ? a.mex / a.hides : null,
    meters: a.pcs > 0 ? a.meters / a.pcs : null, meterPrice: a.meters > 0 ? a.lining / a.meters : null, work: a.pcs > 0 ? a.work / a.pcs : null,
  });

  const tableRows = (parentId: string | null, depth: number): ReactNode[] =>
    (vKids.get(parentId) ?? []).flatMap((n) => {
      const a = calc.get(n.id) ?? ZERO;
      const ch = vKids.get(n.id) ?? [];
      const hasKids = ch.length > 0;
      const leaf = n.kind !== "fur" && !hasKids;
      const open = !collapsed.has(n.id);
      const bg = n.kind === "fur" ? "bg-neutral-100" : hasKids ? "bg-neutral-50" : "bg-white";
      const av = avg(a);
      const g = (v: number | null, d = 1) => <td className="px-2 text-right text-xs tabular-nums text-neutral-500">{qz(v, d)}</td>;
      const gm = (v: number | null) => <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-500">{v == null ? "–" : money(v)}</td>;
      const row = (
        <tr key={n.id} className={`${bg} ${n.kind === "fur" ? "font-semibold" : ""} [&>td]:border-b [&>td]:border-neutral-100`}>
          {nameCell(n, depth, hasKids, open)}
          {leaf ? numCell(n, "pcs", "Бюджет, шт.", "w-[84px] min-w-[84px] " + sepL, undefined, ) : <td className={`whitespace-nowrap px-2 text-right text-sm tabular-nums ${sepL}`}>{qz(a.pcs)}</td>}
          {leaf ? numCell(n, "hides", "Шкур на изделие", "w-[80px] min-w-[80px]") : g(av.hides)}
          <td className="px-2 text-right text-xs tabular-nums text-neutral-600">{qz(a.hides)}<Avg sum={a.hides} per={a.pcs} unit="шк./изд." d={1} /></td>
          {leaf ? numCell(n, "hidePrice", "Цена шкуры", "w-[150px] min-w-[150px] " + sepL, "upFur") : <td className={`whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-500 ${sepL}`}>{av.hidePrice == null ? "–" : money(av.hidePrice)}</td>}
          {leaf ? numCell(n, "meters", "Подкладка, м на изделие", "w-[84px] min-w-[84px]") : g(av.meters)}
          {leaf ? numCell(n, "meterPrice", "Цена подкладки за м", "w-[132px] min-w-[132px]", "upLining") : gm(av.meterPrice)}
          {leaf ? numCell(n, "work", "Работа на изделие", "w-[150px] min-w-[150px]", "upWork") : gm(av.work)}
          <td className={`whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-600 ${sepL}`}>{mz(a.mex)}<Avg sum={a.mex} per={a.hides} unit="₽/шт." /></td>
          <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-600">{mz(a.lining)}<Avg sum={a.lining} per={a.meters} unit="₽/м" /></td>
          <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-600">{mz(a.work)}<Avg sum={a.work} per={a.pcs} unit="₽/изд." /></td>
          <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-500">{mz(a.c4)}<Avg sum={a.c4} per={a.pcs} unit="₽/изд." /></td>
          <td className="whitespace-nowrap px-2 text-right text-sm font-semibold tabular-nums">{mz(a.total)}</td>
          <td className="whitespace-nowrap px-2 text-right text-sm tabular-nums">{mz(perUnit(a))}</td>
          <td className="border-l border-neutral-200 bg-inherit px-1.5 py-1 lg:sticky lg:right-0 lg:z-10">{actions(n, hasKids)}</td>
        </tr>
      );
      return [row, ...(open ? tableRows(n.id, depth + 1) : [])];
    });

  const cards = (parentId: string | null, depth: number): ReactNode[] =>
    (vKids.get(parentId) ?? []).map((n) => {
      const a = calc.get(n.id) ?? ZERO;
      const ch = vKids.get(n.id) ?? [];
      const hasKids = ch.length > 0;
      const leaf = n.kind !== "fur" && !hasKids;
      const open = !collapsed.has(n.id);
      return (
        <div key={n.id} className={depth > 0 ? "ml-3 border-l-2 border-neutral-200 pl-2" : ""}>
          <div className={"rounded-lg border p-3 " + (n.kind === "fur" ? "border-neutral-300 bg-neutral-100" : "border-neutral-200 bg-white")}>
            <div className="flex items-center gap-1">
              {chevron(n, hasKids, open, "h-10 w-8 text-lg")}
              {canEdit ? <input value={n.name} onChange={(e) => patch(n.id, { name: e.target.value })} aria-label={`Название (${KIND_LABEL[n.kind]})`} className="min-h-10 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-sm font-semibold focus-visible:border-neutral-900 focus-visible:bg-white focus-visible:outline-none" />
                : <span className="min-w-0 flex-1 px-1 text-sm font-semibold">{n.name}</span>}
              {n.kind === "art" ? <Badge tone={n.modelId ? "info" : "manual"}>{n.modelId ? "арт." : "план"}</Badge> : null}
              
              {dot(n)}
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="text-xl font-semibold tabular-nums">{money(a.total)}</span>
              <span className="text-xs text-neutral-500 tabular-nums">{qty(a.pcs, 0)} изд.{total.pcs > 0 && a.pcs > 0 ? ` (${formatPercent((a.pcs / total.pcs) * 100)} заказа)` : ""} · на 1 изд. {money(perUnit(a))}</span>
            </div>
            {leaf ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {cardField(n, "pcs", "Бюджет, шт.")}{cardField(n, "hides", "Шкур на изделие")}
                  {cardField(n, "hidePrice", "Цена шкуры, ₽", "upFur")}{cardField(n, "meters", "Подкладка, м/изд.")}
                  {cardField(n, "meterPrice", "Цена за м, ₽", "upLining")}{cardField(n, "work", "Работа/изд., ₽", "upWork")}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {[["Всего шкур", formatDec1(a.hides)], ["Мех", money(a.mex)], ["Подкладка", money(a.lining)], ["Работа", money(a.work)], ["Надбавка", money(a.c4)], ["На 1 изделие", money(perUnit(a))]].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2"><dt className="text-neutral-500">{k}</dt><dd className="tabular-nums text-neutral-800">{v}</dd></div>
                  ))}
                </dl>
              </>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">{actions(n, hasKids)}</div>
          </div>
          {open && hasKids ? <div className="mt-2 flex flex-col gap-2">{cards(n.id, depth + 1)}</div> : null}
        </div>
      );
    });

  return { sumRow, summaryRows, unitRows, tableRows, cards };
}
