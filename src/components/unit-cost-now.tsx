"use client";

import { useMemo, useState } from "react";
import { InfoHint } from "@/components/info-hint";
import { SEG_GROUP, segCls } from "@/components/segmented";
import { WidgetRow } from "@/components/widget-row";
import { SalesModal } from "@/app/(app)/sales/sales-modal";
import { BUDGET_CAT_GROUPS, type BudgetStat } from "@/lib/budget-calc";
import { formatMoney, formatQty } from "@/lib/utils";

// «Себестоимость на 1 изделие — сейчас»: фактическая стоимость одного изделия по ТЗ (средневзвешенно), по типам меха и категориям;
// по клику на категорию — окно со сравнением длин (Short / Regular / Long) и расходами на 1 изделие. Без надбавок бюджета.
// Цены с НДС, до тысяч; надбавка 4 % — на мех и подкладку (как в системе).

const C4 = 4;
const K = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || v <= 0 ? "—" : formatMoney(Math.round(v / 1000) * 1000));
const GROUPED = new Set(Object.values(BUDGET_CAT_GROUPS).flat());
const LEN_ORDER = ["Short", "Regular", "Long"];

type Calc = { mexC4: number; liningC4: number; exp: number; qty: number; hides: number; hidePrice: number; mex: number; meters: number; meterPrice: number; lining: number; work: number; c4: number; total: number };
const calc = (s: BudgetStat): Calc => {
  const mex = s.hidesPer * s.hidePrice, lining = s.metersPer * s.meterPrice, exp = s.expPer ?? 0;
  // Надбавка — по правилам системы (не на все лоты): делим между мехом и подкладкой пропорционально их сумме.
  const c4 = s.c4Per ?? (mex + lining) * (C4 / 100);
  const base = mex + lining;
  return { mexC4: base > 0 ? mex + c4 * (mex / base) + exp : mex + exp, liningC4: base > 0 ? lining + c4 * (lining / base) : lining, exp, qty: s.qty, hides: s.hidesPer, hidePrice: s.hidePrice, mex, meters: s.metersPer, meterPrice: s.meterPrice, lining, work: s.workPer, c4, total: mex + lining + c4 + exp + s.workPer };
};

function CompareTable({ cols }: { cols: { key: string; label: string; c: Calc }[] }) {
  const rows: { label: string; v: (c: Calc) => string; bold?: boolean }[] = [
    { label: "Изделий в основе", v: (c) => formatQty(c.qty) },
    { label: "Шкур на изделие", v: (c) => (c.hides > 0 ? formatQty(Math.round(c.hides * 10) / 10) : "—") },
    { label: "Ср. цена шкуры", v: (c) => K(c.hidePrice) },
    { label: `Мех + ${C4} %`, v: (c) => K(c.mexC4) },
    { label: "Подкладка, м", v: (c) => (c.meters > 0 ? formatQty(Math.round(c.meters * 100) / 100) : "—") },
    { label: "Цена за метр", v: (c) => K(c.meterPrice) },
    { label: `Подкладка + ${C4} %`, v: (c) => K(c.liningC4) },
    { label: "Работа", v: (c) => K(c.work) },
    { label: `в т.ч. надбавка ${C4} %`, v: (c) => K(c.c4) },
    { label: "СЕБЕСТОИМОСТЬ на 1 изделие", v: (c) => K(c.total), bold: true },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-xs text-neutral-500">
            <th className="w-[34%] px-3 py-1.5 text-left font-medium" />
            {cols.map((x) => <th key={x.key} className={"px-3 py-1.5 text-right font-semibold " + (x.label === "В среднем" ? "border-l border-neutral-200 text-neutral-900" : "")}>{x.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={r.bold ? "bg-neutral-50 font-semibold" : ""}>
              <td className="border-t border-neutral-100 px-3 py-1.5 text-left">{r.label}</td>
              {cols.map((x) => <td key={x.key} className={"whitespace-nowrap border-t border-neutral-100 px-3 py-1.5 text-right tabular-nums " + (x.label === "В среднем" ? "border-l border-neutral-200" : "")}>{r.v(x.c)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UnitCostNow({ stats }: { stats: BudgetStat[] }) {
  const pairs = useMemo(() => stats.filter((s) => !s.modelId && !s.len), [stats]);
  const furs = useMemo(() => {
    const q = new Map<string, number>();
    for (const s of pairs) if (!GROUPED.has(s.cat)) q.set(s.fur, (q.get(s.fur) ?? 0) + s.qty);
    return [...q].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [pairs]);
  const [fur, setFur] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setExpanded((x) => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const cur = fur && furs.includes(fur) ? fur : furs[0] ?? "";
  const cats = useMemo(() => {
    const list = pairs.filter((s) => s.fur === cur && !GROUPED.has(s.cat));
    return list.sort((a, b) => (Object.keys(BUDGET_CAT_GROUPS).includes(b.cat) ? 1 : 0) - (Object.keys(BUDGET_CAT_GROUPS).includes(a.cat) ? 1 : 0) || b.qty - a.qty);
  }, [pairs, cur]);
  const lensOf = (s: BudgetStat) => stats.filter((x) => !x.modelId && x.len && x.fur === s.fur && x.cat === s.cat).sort((a, b) => LEN_ORDER.indexOf(a.len ?? "") - LEN_ORDER.indexOf(b.len ?? ""));
  const sel = open ? cats.find((s) => s.key === open) ?? null : null;

  if (furs.length === 0) return null;
  const c = "whitespace-nowrap px-2 py-1.5 text-right text-sm tabular-nums";
  const GB = " border-l border-neutral-200";
  return (
    <WidgetRow id="unit-cost" title="Себестоимость на 1 изделие — сейчас (в среднем)"
      headerExtra={<InfoHint label="Как читать" wide><p>Средневзвешенная стоимость одного изделия по ТЗ: шкуры, подкладка, работа и надбавка {C4} % на мех и подкладку; поправка НДС по документу подрядчика (20 % → 22 %) входит в мех. Цены с НДС, до тысяч, без надбавок бюджета. Нажмите на категорию: сравнение длин и расходы на 1 изделие.</p></InfoHint>}>
      <div className="mb-2 flex flex-wrap items-center gap-2 print:hidden">
        <div role="group" aria-label="Тип меха" className={SEG_GROUP}>
          {furs.map((f) => <button key={f} type="button" aria-pressed={cur === f} onClick={() => setFur(f)} className={segCls(cur === f)}>{f}</button>)}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white" data-keep-scroll tabIndex={0}>
        <table className="table-keep w-full min-w-[980px] text-sm" data-testid="unit-cost-now">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <th scope="col" rowSpan={2} className="px-2 py-2 text-left font-medium normal-case tracking-normal">Категория · длина</th>
              <th scope="col" colSpan={2} className="px-2 py-1 text-center">Изделие</th>
              <th scope="col" colSpan={3} className={"px-2 py-1 text-center" + GB}>Шкуры и мех</th>
              <th scope="col" colSpan={3} className={"px-2 py-1 text-center" + GB}>Подкладка</th>
              <th scope="col" className={"px-2 py-1 text-center" + GB}>Работа</th>
            </tr>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500 [&>th]:px-2 [&>th]:py-1.5 [&>th]:text-right [&>th]:font-medium">
              <th scope="col">Изделий<div className="text-[11px] font-normal">в основе</div></th>
              <th scope="col" className={GB + " text-neutral-800"}>Себестоимость<div className="text-[11px] font-normal">в среднем на 1 изд., ₽</div></th>
              <th scope="col" className={GB}>Шкур<div className="text-[11px] font-normal">на 1 изд.</div></th>
              <th scope="col">Цена шкуры<div className="text-[11px] font-normal">средневзв., ₽</div></th>
              <th scope="col">Мех + {C4} %<div className="text-[11px] font-normal">на 1 изд., ₽</div></th>
              <th scope="col" className={GB}>Метров<div className="text-[11px] font-normal">на 1 изд.</div></th>
              <th scope="col">Цена за метр<div className="text-[11px] font-normal">средневзв., ₽</div></th>
              <th scope="col">Подкладка + {C4} %<div className="text-[11px] font-normal">на 1 изд., ₽</div></th>
              <th scope="col" className={GB}>Работа<div className="text-[11px] font-normal">на 1 изд., ₽</div></th>
            </tr>
          </thead>
          <tbody>
            {cats.flatMap((s) => {
              const k = calc(s);
              const lens = lensOf(s);
              const isOpen = expanded.has(s.key);
              const cells = (x: Calc, strong = false) => (
                <>
                  <td className={c}>{formatQty(x.qty)}</td>
                  <td className={c + GB + (strong ? " font-semibold" : "")}>{K(x.total)}</td>
                  <td className={c + GB}>{x.hides > 0 ? formatQty(Math.round(x.hides * 10) / 10) : "—"}</td>
                  <td className={c}>{K(x.hidePrice)}</td>
                  <td className={c}>{K(x.mexC4)}</td>
                  <td className={c + GB}>{x.meters > 0 ? formatQty(Math.round(x.meters * 100) / 100) : "—"}</td>
                  <td className={c}>{K(x.meterPrice)}</td>
                  <td className={c}>{K(x.liningC4)}</td>
                  <td className={c + GB}>{K(x.work)}</td>
                </>
              );
              return [
                <tr key={s.key} className="border-b border-neutral-100">
                  <td className="px-2 py-1.5 text-left">
                    <div className="flex items-center gap-1">
                      {lens.length > 0 ? <button type="button" onClick={() => toggle(s.key)} aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Раскрыть"} длины: ${s.cat}`} className="inline-flex size-6 items-center justify-center text-neutral-500"><span aria-hidden className={"inline-block transition-transform " + (isOpen ? "rotate-90" : "")}>›</span></button> : <span className="inline-block w-6" />}
                      <button type="button" onClick={() => setOpen(s.key)} aria-haspopup="dialog" title="Сравнение длин и расходы на 1 изделие" className="text-left font-medium text-blue-800 underline decoration-dotted underline-offset-2 hover:text-blue-900">{s.cat}</button>
                    </div>
                  </td>
                  {cells(k, true)}
                </tr>,
                ...(isOpen ? lens.map((l) => (
                  <tr key={l.key} className="border-b border-neutral-100 bg-neutral-50 text-[13px] text-neutral-700">
                    <td className="px-2 py-1.5 text-left"><span className="pl-8">{l.len}</span></td>
                    {cells(calc(l))}
                  </tr>
                )) : []),
              ];
            })}
          </tbody>
        </table>
      </div>
      {sel ? (
        <SalesModal wide title={`${sel.fur} · ${sel.cat}: на 1 изделие`} subtitle="₽ с НДС, до тысяч, сейчас по ТЗ" onClose={() => setOpen(null)}>
          {(() => {
            const lens = lensOf(sel);
            const cols = lens.length >= 2 ? [...lens.map((l) => ({ key: l.key, label: l.len ?? "", c: calc(l) })), { key: sel.key, label: "В среднем", c: calc(sel) }] : [{ key: sel.key, label: "На 1 изделие", c: calc(sel) }];
            return <CompareTable cols={cols} />;
          })()}
        </SalesModal>
      ) : null}
    </WidgetRow>
  );
}
