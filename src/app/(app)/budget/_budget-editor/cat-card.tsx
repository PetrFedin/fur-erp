"use client";

import type { ReactNode } from "react";
import { formatPercent, formatDec1 } from "@/lib/utils";
import { type Agg, type BudgetNode, type BudgetParams } from "@/lib/budget-calc";
import { ZERO, mz, qz } from "./parts";

/** Окно категории: колонки длин (если есть) и «В среднем», статьи расходов на 1 изделие в строках. */
export function CatCard({ cat, byId, vKids, calc, params }: { cat: BudgetNode; byId: Map<string, BudgetNode>; vKids: Map<string | null, BudgetNode[]>; calc: Map<string, Agg>; params: BudgetParams }): ReactNode {
    const fur = cat.parentId ? byId.get(cat.parentId) : undefined;
    const lens = (vKids.get(cat.id) ?? []).filter((x) => x.kind === "len");
    const own = calc.get(cat.id) ?? ZERO;
    const cols = lens.length >= 2 ? [...lens.map((l) => ({ key: l.id, label: l.name, a: calc.get(l.id) ?? ZERO })), { key: cat.id, label: "В среднем", a: own }] : [{ key: cat.id, label: "На 1 изделие", a: own }];
    const k = 1 + params.c4 / 100;
    const per = (v: number, a: Agg) => (a.pcs > 0 ? v / a.pcs : 0);
    const rows: { label: string; v: (a: Agg) => string; bold?: boolean }[] = [
      { label: "Бюджет, шт.", v: (a) => qz(a.pcs) },
      { label: "Шкур на изделие", v: (a) => (a.pcs > 0 && a.hides > 0 ? formatDec1(a.hides / a.pcs) : "–") },
      { label: "Ср. цена шкуры", v: (a) => mz(a.hides > 0 ? a.mex / a.hides : null) },
      { label: `Мех + ${formatPercent(params.c4)}`, v: (a) => mz(per(a.mex * k, a) || null) },
      { label: "Подкладка, м", v: (a) => (a.pcs > 0 && a.meters > 0 ? formatDec1(a.meters / a.pcs) : "–") },
      { label: "Цена за метр", v: (a) => mz(a.meters > 0 ? a.lining / a.meters : null) },
      { label: `Подкладка + ${formatPercent(params.c4)}`, v: (a) => mz(per(a.lining * k, a) || null) },
      { label: "Работа", v: (a) => mz(per(a.work, a) || null) },
      { label: `в т.ч. надбавка ${formatPercent(params.c4)}`, v: (a) => mz(per(a.c4, a) || null) },
      { label: "СЕБЕСТОИМОСТЬ", v: (a) => mz(per(a.total, a) || null), bold: true },
      { label: "Сейчас по системе", v: (a) => mz(a.nowPcs > 0 ? a.nowTotal / a.nowPcs : null) },
    ];
    return (
      <div className="overflow-x-auto">
        <p className="mb-2 text-xs text-neutral-500">{fur?.name} · {cat.name}: расходы на 1 изделие, ₽ с НДС, до тысяч. Надбавки: {formatPercent(params.upFur)} к шкурам, {formatPercent(params.upLining)} к подкладке, {formatPercent(params.upWork)} к работе, {formatPercent(params.c4)} на мех и подкладку. «Сейчас по системе» — те же статьи без надбавок бюджета.</p>
        <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm">
          <thead><tr className="text-xs text-neutral-500"><th className="w-[34%] px-3 py-1.5 text-left font-medium" />{cols.map((c) => <th key={c.key} className={"px-3 py-1.5 text-right font-semibold " + (c.label === "В среднем" ? "border-l border-neutral-200 text-neutral-900" : "")}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={r.bold ? "bg-neutral-50 font-semibold" : ""}>
                <td className="border-t border-neutral-100 px-3 py-1.5 text-left">{r.label}</td>
                {cols.map((c) => <td key={c.key} className={"whitespace-nowrap border-t border-neutral-100 px-3 py-1.5 text-right tabular-nums " + (c.label === "В среднем" ? "border-l border-neutral-200" : "")}>{r.v(c.a)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
}
