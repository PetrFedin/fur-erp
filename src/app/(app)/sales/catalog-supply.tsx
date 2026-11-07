"use client";

import { useMemo } from "react";
import type { SupplyLeaf } from "@/lib/supply-report";

/** Отчёт по заказу и поставкам — оформление как в отчёте поставщика : Total, категория 1, мех, категория 2; Order / Deliv: OPT (позиций), PCS, EUR; затем поставки по месяцам, прогноз — красным курсивом. */
type Tot = { opt: number; pcs: number; eur: number };
type Agg = { order: Tot; deliv: Tot; months: Record<string, number> };
type Node = { id: string; level: 1 | 2 | 3; label: string; leaves: SupplyLeaf[]; children: Node[] };

const EN = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const nf = (v: number) => Math.round(v).toLocaleString("ru-RU");
const cellv = (v: number) => (Math.abs(v) < 0.5 ? "-" : nf(v));
const RANK: Record<string, number> = { Одежда: 0, Аксессуары: 1 };

function aggOf(ls: SupplyLeaf[], keys: string[], months: string[], fcOn: boolean): Agg {
  const a: Agg = { order: { opt: 0, pcs: 0, eur: 0 }, deliv: { opt: 0, pcs: 0, eur: 0 }, months: Object.fromEntries(months.map((m) => [m, 0])) };
  for (const l of ls) {
    let c = 0, d = 0;
    for (const k of keys) {
      const v = l.by[k]; if (!v) continue;
      c += v.conf; d += v.deliv; a.order.pcs += v.conf; a.order.eur += v.confEur; a.deliv.pcs += v.deliv; a.deliv.eur += v.delivEur;
      for (const [m, p] of Object.entries(l.months[k] ?? {})) if (m in a.months) a.months[m] += p;
    }
    if (fcOn) for (const [m, p] of Object.entries(l.fc)) if (m in a.months) a.months[m] += p;
    if (c > 0) a.order.opt++;
    if (d > 0) a.deliv.opt++;
  }
  return a;
}

function buildTree(ls: SupplyLeaf[], keys: string[]): Node[] {
  const eur = (x: SupplyLeaf[]) => x.reduce((s, l) => s + keys.reduce((t, k) => t + (l.by[k]?.confEur ?? 0), 0), 0);
  const group = (arr: SupplyLeaf[], pick: (l: SupplyLeaf) => string) => { const m = new Map<string, SupplyLeaf[]>(); for (const l of arr) { const k = pick(l); (m.get(k) ?? m.set(k, []).get(k)!).push(l); } return [...m]; };
  return group(ls, (l) => l.cat1).sort((a, b) => (RANK[a[0]] ?? 9) - (RANK[b[0]] ?? 9) || a[0].localeCompare(b[0], "ru")).map(([c1, l1]) => ({
    id: c1, level: 1 as const, label: c1, leaves: l1,
    children: group(l1, (l) => l.fur).sort((a, b) => eur(b[1]) - eur(a[1])).map(([f, l2]) => ({
      id: `${c1}/${f}`, level: 2 as const, label: f, leaves: l2,
      children: group(l2, (l) => l.cat2).sort((a, b) => eur(b[1]) - eur(a[1])).map(([c2, l3]) => ({ id: `${c1}/${f}/${c2}`, level: 3 as const, label: c2, leaves: l3, children: [] })),
    })),
  }));
}

const TONE: Record<0 | 1 | 2 | 3, string> = {
  0: "bg-[#23234f] font-bold text-white",
  1: "bg-[#66669e] font-bold text-white",
  2: "bg-[#ccccff] font-bold text-neutral-900",
  3: "bg-white text-neutral-900",
};
const THICK = "border-l-2 border-l-[#111]";

export function SupplyTable({ leaves, keys, depth, shut, onToggle }: { leaves: SupplyLeaf[]; keys: string[]; depth: 1 | 2 | 3; shut: Set<string>; onToggle: (id: string) => void }) {
  const fcOn = keys.includes("FW26/27");
  const { months, fcSet } = useMemo(() => {
    const set = new Set<string>(); const fc = new Set<string>();
    for (const l of leaves) {
      for (const k of keys) for (const m of Object.keys(l.months[k] ?? {})) set.add(m);
      if (fcOn) for (const [m, v] of Object.entries(l.fc)) if (v) { set.add(m); fc.add(m); }
    }
    return { months: [...set].sort(), fcSet: fc };
  }, [leaves, keys, fcOn]);
  // В выбранном периоде показываем только позиции с заказом или приходом.
  const active = useMemo(() => leaves.filter((l) => keys.some((k) => (l.by[k]?.conf ?? 0) + (l.by[k]?.deliv ?? 0) > 0)), [leaves, keys]);
  const tree = useMemo(() => buildTree(active, keys), [active, keys]);
  const years = [...new Set(months.map((m) => m.slice(0, 4)))].map((y) => ({ y, n: months.filter((m) => m.startsWith(y)).length }));
  const grid = { gridTemplateColumns: `minmax(8.5rem,15rem) repeat(6, minmax(3.1rem,auto)) repeat(${months.length}, minmax(2.6rem,auto))` };
  const hd = "sticky z-10 bg-white px-2 py-1 text-center text-[13px] font-bold border-b border-[#111]";

  const row = (label: string, level: 0 | 1 | 2 | 3, a: Agg, node?: Node) => {
    const tone = TONE[level];
    const hasKids = node && node.children.length > 0 && node.level < depth;
    const closed = node ? shut.has(node.id) : false;
    const cells: { v: string; cls?: string; italic?: boolean }[] = [
      { v: cellv(a.order.opt), cls: THICK }, { v: cellv(a.order.pcs) }, { v: cellv(a.order.eur) },
      { v: cellv(a.deliv.opt), cls: THICK }, { v: cellv(a.deliv.pcs) }, { v: cellv(a.deliv.eur) },
      ...months.map((m, i) => ({ v: cellv(a.months[m] ?? 0), cls: i === 0 ? THICK : "", italic: fcSet.has(m) })),
    ];
    return (
      <div key={node?.id ?? "total"} role="row" className="contents">
        <div role="rowheader" className={`sticky left-0 z-[5] flex min-h-8 items-center border-b border-[#111] text-[13px] ${tone}`} style={{ paddingLeft: 6 + (level === 0 ? 0 : (level - 1) * 14 + (level > 1 ? 6 : 6)) }}>
          {hasKids ? (
            <button type="button" aria-expanded={!closed} onClick={() => onToggle(node!.id)} className="flex min-h-8 w-full items-center gap-1 pr-2 text-left">
              <span aria-hidden className="w-3 text-[10px]">{closed ? "▸" : "▾"}</span><span className="truncate">{label}</span>
            </button>
          ) : <span className="truncate pr-2">{label}</span>}
        </div>
        {cells.map((c, i) => <div role="cell" key={i} className={`flex min-h-8 items-center justify-end border-b border-[#111] px-1.5 text-[13px] tabular-nums ${tone} ${c.cls ?? ""} ${c.italic ? "italic" : ""}`}>{c.v}</div>)}
      </div>
    );
  };
  const flat = (nodes: Node[]): React.ReactNode[] => nodes.flatMap((n) => [row(n.label, n.level, aggOf(n.leaves, keys, months, fcOn), n), ...(n.level < depth && !shut.has(n.id) ? flat(n.children) : [])]);

  return (
    <div>
      <div role="table" aria-label="Отчёт по заказу и поставкам" className="grid min-w-[760px] border-2 border-[#111]" style={grid}>
        <div role="row" className="contents">
          <div role="columnheader" className={`${hd} left-0 top-0 z-20 border-b-0`} />
          <div role="columnheader" className={`${hd} top-0 col-span-3 ${THICK}`}>Заказано</div>
          <div role="columnheader" className={`${hd} top-0 col-span-3 ${THICK}`}>Пришло</div>
          {years.map((g) => <div role="columnheader" key={g.y} className={`${hd} top-0 ${THICK}`} style={{ gridColumn: `span ${g.n}` }}>{g.y}</div>)}
        </div>
        <div role="row" className="contents">
          <div role="columnheader" className={`${hd} left-0 top-8 z-20`} />
          {["Моделей", "шт.", "EUR", "Моделей", "шт.", "EUR"].map((t, i) => <div role="columnheader" key={i} className={`${hd} top-8 ${i % 3 === 0 ? THICK : ""}`}>{t}</div>)}
          {months.map((m, i) => <div role="columnheader" key={m} title={fcSet.has(m) ? "прогноз поставок" : undefined} className={`${hd} top-8 ${i === 0 ? THICK : ""} ${fcSet.has(m) ? "italic text-red-600" : ""}`}>{EN[Number(m.slice(5, 7)) - 1]}</div>)}
        </div>
        {row("Итого", 0, aggOf(active, keys, months, fcOn))}
        {flat(tree)}
      </div>
    </div>
  );
}
