"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CloseX, chip } from "./catalog-ui";
import { SupplyTable } from "./catalog-supply";
import type { SupplyLeaf } from "@/lib/supply-report";

/** Показатели одного сезона по артикулу (всё в штуках и рублях; € — из отчёта заказа/прихода). */
export type ReportVals = {
  conf: number; confEur: number; deliv: number; delivEur: number; sold: number; rub: number;
  /** Цена до скидки × штуки и штуки — для средневзвешенной цены продажи; gross/cost — для маркапа проданного. */
  priceNum: number; priceDen: number; gross: number; cost: number;
  stock: number; sRetail: number; sPriced: number; sRetailBoth: number; sCostBoth: number;
};
export type ReportLeaf = { cls: "clothes" | "acc" | "other"; cat1: string; fur: string; cat2: string; model: string; by: Record<string, ReportVals> };
export type ReportData = { leaves: ReportLeaf[]; eurRate: number; ex: boolean };

const SCOPES = [["FW25/26", "FW25"], ["SS26", "SS26"], ["FW26/27", "FW26"], ["all", "Всего"]] as const;
type Scope = (typeof SCOPES)[number][0];
const ALL_KEYS = ["FW25/26", "SS26", "FW26/27"];

type Agg = { models: number } & Omit<ReportVals, never>;
const zero = (): Agg => ({ models: 0, conf: 0, confEur: 0, deliv: 0, delivEur: 0, sold: 0, rub: 0, priceNum: 0, priceDen: 0, gross: 0, cost: 0, stock: 0, sRetail: 0, sPriced: 0, sRetailBoth: 0, sCostBoth: 0 });
function aggOf(ls: ReportLeaf[], keys: string[]): Agg {
  const a = zero(); const models = new Set<string>();
  for (const l of ls) {
    let active = false;
    for (const k of keys) {
      const v = l.by[k]; if (!v) continue;
      (Object.keys(v) as (keyof ReportVals)[]).forEach((f) => { a[f] += v[f]; });
      if (v.conf || v.deliv || v.sold || v.stock) active = true;
    }
    if (active) models.add(l.model);
  }
  a.models = models.size; return a;
}

type Node = { id: string; level: 1 | 2 | 3; label: string; leaves: ReportLeaf[]; children: Node[] };
const RANK: Record<string, number> = { Одежда: 0, Аксессуары: 1 };
function buildTree(ls: ReportLeaf[], keys: string[]): Node[] {
  const weight = (x: ReportLeaf[]) => x.reduce((s, l) => s + keys.reduce((t, k) => t + (l.by[k]?.conf ?? 0), 0), 0);
  const group = (arr: ReportLeaf[], pick: (l: ReportLeaf) => string) => { const m = new Map<string, ReportLeaf[]>(); for (const l of arr) (m.get(pick(l)) ?? m.set(pick(l), []).get(pick(l))!).push(l); return [...m]; };
  return group(ls, (l) => l.cat1).sort((a, b) => (RANK[a[0]] ?? 9) - (RANK[b[0]] ?? 9) || a[0].localeCompare(b[0], "ru")).map(([c1, l1]) => ({
    id: c1, level: 1 as const, label: c1, leaves: l1,
    children: group(l1, (l) => l.fur).sort((a, b) => weight(b[1]) - weight(a[1])).map(([f, l2]) => ({
      id: `${c1}/${f}`, level: 2 as const, label: f, leaves: l2,
      children: group(l2, (l) => l.cat2).sort((a, b) => weight(b[1]) - weight(a[1])).map(([c2, l3]) => ({ id: `${c1}/${f}/${c2}`, level: 3 as const, label: c2, leaves: l3, children: [] })),
    })),
  }));
}

const COLS = "grid-cols-[8.5rem_repeat(13,minmax(4.25rem,1fr))] md:grid-cols-[13rem_repeat(13,minmax(4.5rem,1fr))]";
const nf = (v: number) => Math.round(v).toLocaleString("ru-RU");
const th = "sticky z-10 bg-neutral-50 px-2 text-[11px] font-semibold leading-4 text-neutral-600";

/** Отчёт поверх каталога: категория 1 → тип меха → категория 2; период (всего / сезон) и валюта (EUR / RUR) переключаются кнопками, деньги — в тысячах. */
export function CatalogReport({ data, supply, tab: tab0, cat, onClose, vatEx, onVat }: { data: ReportData; supply: SupplyLeaf[]; tab: "sales" | "supply"; cat: "all" | "clothes" | "acc"; onClose: () => void; vatEx: boolean; onVat?: (ex: boolean) => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = dlg.current; if (d && !d.open) d.showModal(); }, []);
  const [tab, setTab] = useState<"sales" | "supply">(tab0);
  const [scope, setScope] = useState<Scope>("all");
  const [cur, setCur] = useState<"EUR" | "RUR">("RUR");
  const [depth, setDepth] = useState<1 | 2 | 3>(3);
  const [shut, setShut] = useState<Set<string>>(new Set());
  const keys = scope === "all" ? ALL_KEYS : [scope];
  const toggleShut = (id: string) => setShut((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const supplyLeaves = useMemo(() => supply.filter((l) => cat === "all" || l.cls === cat), [supply, cat]);
  const rate = data.eurRate || 1;
  const leaves = useMemo(() => data.leaves.filter((l) => cat === "all" || l.cls === cat), [data.leaves, cat]);
  const tree = useMemo(() => buildTree(leaves, keys), [leaves, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const sym = cur === "EUR" ? "€" : "₽";
  // Заказ и приход в деньгах — в € по отчёту, продажи и цены — в ₽; нужная валюта получается по курсу файла продаж.
  const fromEur = (v: number) => (cur === "EUR" ? v : v * rate);
  const fromRub = (v: number | null) => (v === null ? null : cur === "RUR" ? v : v / rate);
  const k = (v: number | null) => (v === null || Math.abs(v) < 0.5 ? "–" : nf(v / 1000));
  const q = (v: number) => (Math.abs(v) < 0.5 ? "–" : nf(v));
  const x2 = (v: number | null) => (v === null ? "–" : `×${v.toFixed(2).replace(".", ",")}`);

  const row = (label: string, level: 0 | 1 | 2 | 3, a: Agg, node?: Node) => {
    const so = a.conf > 0 ? `${Math.round((a.sold / a.conf) * 100)} %` : "–";
    const cells = [
      q(a.models), q(a.conf), k(fromEur(a.confEur)), q(a.deliv), k(fromEur(a.delivEur)),
      q(a.sold), so, k(fromRub(a.rub)), k(fromRub(a.priceDen > 0 ? a.priceNum / a.priceDen : null)), x2(a.cost > 0 ? a.gross / a.cost : null),
      q(a.stock), k(fromRub(a.sPriced > 0 ? a.sRetail / a.sPriced : null)), x2(a.sCostBoth > 0 ? a.sRetailBoth / a.sCostBoth : null),
    ];
    const hasKids = node && node.children.length > 0 && node.level < depth;
    const closed = node ? shut.has(node.id) : false;
    const tone = level === 0 ? "bg-neutral-900 font-semibold text-white" : level === 1 ? "bg-neutral-100 font-semibold" : level === 2 ? "bg-white font-medium" : "bg-white text-neutral-700";
    return (
      <div key={node?.id ?? "total"} role="row" className="contents">
        <div role="rowheader" className={`sticky left-0 z-[5] flex min-h-9 items-center border-b border-neutral-200 ${tone}`} style={{ paddingLeft: 6 + Math.max(0, level - 1) * 10 }}>
          {hasKids ? (
            <button type="button" aria-expanded={!closed} onClick={() => setShut((s) => { const n = new Set(s); if (n.has(node!.id)) n.delete(node!.id); else n.add(node!.id); return n; })} className="flex min-h-9 w-full items-center gap-1.5 pr-2 text-left text-[13px]">
              <span aria-hidden className="w-3 text-[10px]">{closed ? "▸" : "▾"}</span><span className="truncate">{label}</span>
            </button>
          ) : <span className="truncate pl-[1.1rem] pr-2 text-[13px]">{label}</span>}
        </div>
        {cells.map((c, i) => <div role="cell" key={i} className={`flex items-center justify-end border-b border-neutral-200 px-2 text-right text-[13px] tabular-nums ${tone}`}>{c}</div>)}
      </div>
    );
  };
  const flat = (nodes: Node[]): React.ReactNode[] => nodes.flatMap((n) => [row(n.label, n.level, aggOf(n.leaves, keys), n), ...(n.level < depth && !shut.has(n.id) ? flat(n.children) : [])]);

  return (
    <dialog ref={dlg} onClose={onClose} className="m-0 h-dvh max-h-none w-screen max-w-none bg-white p-0 text-neutral-900 md:mx-auto md:my-4 md:h-[calc(100dvh-2rem)] md:w-[min(96rem,100vw-2rem)] md:rounded-2xl">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2">
          <div className="flex gap-2" role="tablist" aria-label="Отчёт">
            {([["sales", "Продажи"], ["supply", "Поставки"]] as const).map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={chip(tab === k) + " !px-4"}>Отчёт: {t.toLowerCase()}</button>)}
          </div>
          <CloseX onClick={onClose} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-200 px-3 py-2">
          <div className="flex gap-2 overflow-x-auto" data-keep-scroll role="group" aria-label="Период">
            {SCOPES.map(([key, t]) => <button key={key} type="button" aria-pressed={scope === key} onClick={() => setScope(key)} className={chip(scope === key) + " !px-3.5"}>{t}</button>)}
          </div>
          {tab === "sales" && onVat ? (
            <div className="flex gap-2" role="group" aria-label="НДС">
              {([[false, "С НДС"], [true, "Без НДС"]] as const).map(([ex, t]) => <button key={t} type="button" aria-pressed={vatEx === ex} onClick={() => onVat(ex)} className={chip(vatEx === ex) + " !px-3.5"}>{t}</button>)}
            </div>
          ) : null}
          {tab === "sales" ? <div className="flex gap-2" role="group" aria-label="Валюта">
            {(["EUR", "RUR"] as const).map((c) => <button key={c} type="button" aria-pressed={cur === c} onClick={() => setCur(c)} className={chip(cur === c) + " !px-3.5"}>{c}</button>)}
          </div> : null}
          <div className="flex gap-2 overflow-x-auto" data-keep-scroll role="group" aria-label="Уровень">
            {([[1, "Кат. 1"], [2, "Мех"], [3, "Кат. 2"]] as const).map(([d, t]) => <button key={d} type="button" aria-pressed={depth === d} onClick={() => { setDepth(d); setShut(new Set()); }} className={chip(depth === d) + " !px-3.5"}>{t}</button>)}
          </div>
          {tab === "sales" ? <p className="text-xs text-neutral-600" title="Заказ и приход в деньгах — в € по отчёту, продажи и цены — в ₽; другая валюта считается по среднему курсу из файла продаж">деньги — тыс. {sym} · курс {rate ? rate.toFixed(1).replace(".", ",") : "–"} ₽/€</p> : null}
        </div>
        {tab === "supply" ? (
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-2" data-keep-scroll tabIndex={0} role="region" aria-label="Таблица отчёта по заказу и поставкам">
            <SupplyTable leaves={supplyLeaves} keys={keys} depth={depth} shut={shut} onToggle={toggleShut} />
          </div>
        ) : (
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain" data-keep-scroll tabIndex={0} role="region" aria-label="Таблица отчёта">
          <div role="table" aria-label="Отчёт: категория 1, тип меха, категория 2" className={`grid min-w-[1050px] md:min-w-[1180px] ${COLS}`}>
            <div role="row" className="contents">
              <div role="columnheader" className={`${th} left-0 top-0 z-20 py-1 text-left`}>Категория 1 → мех → категория 2</div>
              <div role="columnheader" className={`${th} top-0 py-1 text-right`}>Моделей</div>
              <div role="columnheader" className={`${th} top-0 col-span-2 border-l border-neutral-300 py-1 text-center`}>Заказано</div>
              <div role="columnheader" className={`${th} top-0 col-span-2 border-l border-neutral-300 py-1 text-center`}>Пришло</div>
              <div role="columnheader" className={`${th} top-0 col-span-5 border-l border-neutral-300 py-1 text-center`}>Продано</div>
              <div role="columnheader" className={`${th} top-0 col-span-3 border-l border-neutral-300 py-1 text-center`}>Остаток</div>
            </div>
            <div role="row" className="contents">
              <div role="columnheader" className={`${th} left-0 top-7 z-20 py-1 text-left font-normal`}>тыс. {sym}, шт.</div>
              {["шт.", "шт.", `${sym}`, "шт.", `${sym}`, "шт.", "SO", "NS", "Ср. цена", "Ср. маркап", "шт.", "Ср. цена", "Ср. маркап"].map((t, i) => <div role="columnheader" key={i} className={`${th} top-7 py-1 text-right ${[1, 3, 5, 10].includes(i) ? "border-l border-neutral-300" : ""}`}>{t}</div>)}
            </div>
            {flat(tree)}
            {row("Итого", 0, aggOf(leaves, keys))}
          </div>
        </div>
        )}
      </div>
    </dialog>
  );
}
