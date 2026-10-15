"use client";

import { Fragment, useMemo, useState } from "react";
import { InfoHint } from "@/components/info-hint";
import { TH, THGroup } from "@/components/table-head";
import { TotalLabel } from "@/components/total-label";
import { useVatDisplay } from "@/lib/vat-display";
import { useClientSort } from "@/lib/use-client-sort";
import { formatMoney, formatQty } from "@/lib/utils";
import { REPAIR_CATEGORY } from "@/lib/dashboard-calc";
import type { DrillData } from "@/lib/dashboard-drill";
import { addOrder, blank, build, cost, type Agg, type Lvl } from "./production-table";

const money = (v: number | null) => (v == null || !isFinite(v) ? "—" : formatMoney(Math.round(v)));
const n2 = (v: number | null) => (v == null || !isFinite(v) || Math.abs(v) < 0.005 ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 2 }));
const qtyOf = (g: Agg) => Array.from(g.orders.values()).reduce((s, o) => s + o.qty, 0);
const per = (v: number, q: number) => (q > 0 ? v / q : null);

const TABS: { id: string; label: string; levels: Lvl[]; first: string }[] = [
  { id: "cat", label: "По категориям", levels: ["grp", "cat"], first: "Группа / категория" },
  { id: "fur", label: "По типам меха", levels: ["furl", "cat"], first: "Тип меха / категория" },
];

/** Средние на одно изделие строки: сумма ÷ число изделий (средневзвешенно, а не среднее по ТЗ), как «Средневзвешенные» на карточке артикула. */
const GET: Record<string, (g: Agg) => number | string | null> = {
  name: (g) => g.label,
  q: (g) => qtyOf(g),
  hides: (g) => per(g.hides, qtyOf(g)),
  meters: (g) => per(g.meters, qtyOf(g)),
  fur: (g) => per(g.fur, qtyOf(g)),
  lining: (g) => per(g.lining, qtyOf(g)),
  work: (g) => per(g.work, qtyOf(g)),
  full: (g) => per(cost(g), qtyOf(g)),
};

/** Блок «Среднее» (после «Объёмов»): по категориям изделий и по типам меха — средний расход шкур и подкладки, средняя стоимость меха, работы и полная себестоимость на одно изделие. */
export function AveragesTable({ data }: { data: DrillData | null }) {
  const { mode: vat } = useVatDisplay();
  const [tab, setTab] = useState("cat");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { th, sort } = useClientSort<Agg>(GET);
  const levels = TABS.find((t) => t.id === tab)!.levels;
  const items = useMemo(() => (data?.orders ?? []).filter((o) => o.cat !== REPAIR_CATEGORY), [data]);
  const rows = useMemo(() => build(items, vat, levels), [items, vat, levels]);
  const total = useMemo(() => { const t = blank("all", "Всего"); for (const o of items) addOrder(t, o, vat); return t; }, [items, vat]);
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const BL = " border-l border-neutral-200";
  const cells = (g: Agg, cls: string) => {
    const q = qtyOf(g);
    const c = "whitespace-nowrap px-2 text-right tabular-nums " + cls;
    return (
      <>
        <td className={c}>{formatQty(q)}</td>
        <td className={c + BL}>{n2(per(g.hides, q))}</td>
        <td className={c}>{n2(per(g.meters, q))}</td>
        <td className={c + BL}>{money(per(g.fur, q))}</td>
        <td className={c}>{money(per(g.lining, q))}</td>
        <td className={c}>{money(per(g.work, q))}</td>
        <td className={c + BL + " font-medium"}>{money(per(cost(g), q))}</td>
      </>
    );
  };
  const depthMax = levels.length - 1;
  const render = (nodes: Agg[], depth: number, path: string): React.ReactNode =>
    sort(nodes).map((r) => {
      const pk = path + "/" + r.key;
      const canOpen = depth < depthMax && r.children.size > 0;
      const isOpen = open.has(pk);
      return (
        <Fragment key={pk}>
          <tr className={"border-b border-neutral-100 " + (depth > 0 ? "bg-neutral-50/70" : "")}>
            <td className={depth === 0 ? "py-1.5 pr-2 text-sm font-semibold" : "py-1 pr-2 text-xs text-neutral-700"} style={{ paddingLeft: depth * 16 }}>
              {canOpen ? (
                <button type="button" onClick={() => toggle(pk)} aria-expanded={isOpen} aria-label={`Раскрыть: ${r.label}`} className="flex min-h-8 items-center gap-1 text-left">
                  <span aria-hidden className={"inline-block w-4 text-neutral-500 transition-transform " + (isOpen ? "rotate-90" : "")}>›</span>{r.label}
                </button>
              ) : <span className={depth > 0 ? "pl-4" : ""}>{r.label}</span>}
            </td>
            {cells(r, depth === 0 ? "py-1.5 text-sm" : "py-1 text-xs text-neutral-600")}
          </tr>
          {canOpen && isOpen ? render(Array.from(r.children.values()), depth + 1, pk) : null}
        </Fragment>
      );
    });
  const tot = qtyOf(total);
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 print:break-inside-avoid" data-testid="averages-table">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 text-sm font-semibold">
          Среднее на изделие по категориям и типам меха
          <InfoHint label="Как считается среднее" wide>
            <p>Средневзвешенное: сумма по ТЗ ÷ число изделий (а не среднее по ТЗ — ТЗ на 10 изделий весит больше, чем на 1), так же, как «Средневзвешенные» на карточке артикула. Ремонт не входит.</p>
            <p className="mt-1"><b>Шкур</b> — расход шкур на изделие; <b>Подкладки</b> — метров на изделие; <b>Мех</b>, <b>Подкладка</b>, <b>Работа</b> — ₽ на изделие; <b>Полная себестоимость</b> = (мех + подкладка + 4% + расходы ТЗ и прочее + работа) ÷ изделий. Режимы НДС и 4% — из шапки.</p>
            <p className="mt-1">Смешанные ТЗ («Норка + Соболь») входят в каждый свой вид меха: шкуры — свои, подкладка, работа и расходы делятся пропорционально стоимости шкур; изделия смешанного ТЗ учтены в каждом виде целиком, поэтому «Изделий» по видам не суммируется. Итог = сумма ÷ изделий.</p>
          </InfoHint>
        </h3>
        <div role="tablist" aria-label="Разрез среднего" className="inline-flex overflow-hidden rounded-lg border border-neutral-300 text-xs">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); setOpen(new Set()); }}
              className={"min-h-11 px-3 py-1.5 " + (tab === t.id ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50")}>{t.label}</button>
          ))}
        </div>
      </div>
      {!data ? <p className="py-4 text-sm text-neutral-500">Загрузка…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left">
            <thead>
              <tr>
                <th />
                <THGroup colSpan={1} sep={false}>Объём</THGroup>
                <THGroup colSpan={2}>Расход на изделие</THGroup>
                <THGroup colSpan={3}>Стоимость на изделие</THGroup>
                <THGroup colSpan={1}>Итого</THGroup>
              </tr>
              <tr className="border-b border-neutral-200 text-xs text-neutral-500">
                <TH label={TABS.find((t) => t.id === tab)!.first} align="left" {...th("name")} className="px-0 pr-2" />
                <TH label="Изделий" unit="шт." {...th("q")} />
                <TH label="Шкур" unit="шт./изд." sep {...th("hides")} />
                <TH label="Подкладки" unit="м/изд." {...th("meters")} />
                <TH label="Мех" unit="₽/изд." sep {...th("fur")} />
                <TH label="Подкладка" unit="₽/изд." {...th("lining")} />
                <TH label="Работа" unit="₽/изд." {...th("work")} />
                <TH label="Полная себестоимость" unit="₽/изд." sep {...th("full")} />
              </tr>
            </thead>
            <tbody>
              {render(rows, 0, "")}
              <tr className="row-total">
                <td className="py-1.5 pr-2 text-sm"><TotalLabel avg unit="₽/изд." /></td>
                {cells(total, "py-1.5 text-sm")}
              </tr>
            </tbody>
          </table>
          {tot === 0 ? <p className="py-2 text-xs text-neutral-500">Нет изделий по выбранным фильтрам.</p> : null}
        </div>
      )}
    </div>
  );
}
