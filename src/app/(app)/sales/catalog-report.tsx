"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CloseX, chip } from "./catalog-ui";
import { SupplyTable } from "./catalog-supply";
import type { SupplyLeaf } from "@/lib/supply-report";

/** Показатели одного сезона по артикулу (всё в штуках и рублях; € — из отчёта заказа/прихода). */
export type ReportVals = {
  conf: number; confEur: number; deliv: number; delivEur: number; sold: number;
  /** Выручка товара сезона (NS) в четырёх видах: ₽ и € с НДС и без НДС — из отчёта, без пересчёта по курсу. */
  nsRubIn: number; nsRubEx: number; nsEurIn: number; nsEurEx: number;
  /** Маркап проданного = (NS EUR + Discount EUR) ÷ SC EUR из отчёта: gross — числитель, cost — знаменатель. */
  gross: number; cost: number;
  stock: number; sRetail: number; sPriced: number; sRetailBoth: number; sCostBoth: number;
  /** Олды — продажи товара прошлых сезонов в календаре сезона: шт. и gross/cost (€) для маркапа. */
  oSold: number; oGross: number; oCost: number;
  /** Выручка олдов (NS) в четырёх видах — для «Calendar»: SSN + олды. */
  oRubIn: number; oRubEx: number; oEurIn: number; oEurEx: number;
  /** Остаток всех сезонов (этот и прошлые): шт., цена по прайсу и себестоимость для средней цены и маркапа. */
  tStock: number; tRetail: number; tPriced: number; tRetailBoth: number; tCostBoth: number;
};
export type ReportLeaf = { cls: "clothes" | "acc" | "other"; cat1: string; fur: string; cat2: string; model: string; by: Record<string, ReportVals>;
  /** Заказано за все сезоны по отчёту (TTL Conf): шт. и €. */ ttlConf: number; ttlConfEur: number;
  /** Получено за все сезоны: шт. и €; остаток в € по закупочной цене изделия (FW26 и всего). */ ttlDeliv: number; ttlDelivEur: number; stockEur: number; stockEurTtl: number };
export type ReportData = { leaves: ReportLeaf[]; eurRate: number; ex: boolean };


type Agg = { models: number } & Omit<ReportVals, never>;
const zero = (): Agg => ({ models: 0, oRubIn: 0, oRubEx: 0, oEurIn: 0, oEurEx: 0, conf: 0, confEur: 0, deliv: 0, delivEur: 0, sold: 0, nsRubIn: 0, nsRubEx: 0, nsEurIn: 0, nsEurEx: 0, gross: 0, cost: 0, stock: 0, sRetail: 0, sPriced: 0, sRetailBoth: 0, sCostBoth: 0, oSold: 0, oGross: 0, oCost: 0, tStock: 0, tRetail: 0, tPriced: 0, tRetailBoth: 0, tCostBoth: 0 });
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
  // Порядок как в PDF: по убыванию заказа в € (FW26), при равенстве — по названию.
  const weight = (x: ReportLeaf[]) => x.reduce((s, l) => s + keys.reduce((t, k) => t + (l.by[k]?.confEur ?? 0), 0), 0);
  const group = (arr: ReportLeaf[], pick: (l: ReportLeaf) => string) => { const m = new Map<string, ReportLeaf[]>(); for (const l of arr) (m.get(pick(l)) ?? m.set(pick(l), []).get(pick(l))!).push(l); return [...m]; };
  return group(ls, (l) => l.cat1).sort((a, b) => (RANK[a[0]] ?? 9) - (RANK[b[0]] ?? 9) || a[0].localeCompare(b[0], "ru")).map(([c1, l1]) => ({
    id: c1, level: 1 as const, label: c1, leaves: l1,
    children: group(l1, (l) => l.fur).sort((a, b) => weight(b[1]) - weight(a[1]) || a[0].localeCompare(b[0], "ru")).map(([f, l2]) => ({
      id: `${c1}/${f}`, level: 2 as const, label: f, leaves: l2,
      children: group(l2, (l) => l.cat2).sort((a, b) => weight(b[1]) - weight(a[1]) || a[0].localeCompare(b[0], "ru")).map(([c2, l3]) => ({ id: `${c1}/${f}/${c2}`, level: 3 as const, label: c2, leaves: l3, children: [] })),
    })),
  }));
}

const nf = (v: number) => Math.round(v).toLocaleString("ru-RU");

const KEYS = ["FW26/27"];
// Оформление как в отчёте по поставкам: Total сверху, ярусы цвета, тонкая чёрная сетка.
const TONE: Record<0 | 1 | 2 | 3, string> = {
  0: "bg-[#23234f] font-bold text-white",
  1: "bg-[#66669e] font-bold text-white",
  2: "bg-[#ccccff] font-bold text-neutral-900",
  3: "bg-white text-neutral-900",
};
const THICK = "border-l-2 border-l-[#111]";
const hd = "sticky z-10 flex min-h-8 items-center justify-center bg-white px-2 py-1 text-center text-[13px] font-bold border-b border-l border-[#111]";
/** Линия между блоками второго уровня (FW26 / Calendar / TTL внутри Order и Stock). */
const MID = "border-l-2 border-l-neutral-600";

/** Отчёт по продажам FW26 поверх каталога: Total → категория 1 → тип меха → категория 2; деньги: EUR — как есть, RUR — тысячами с подписью «000 RUR». */
export function CatalogReport({ data, supply, tab: tab0, cat, onClose, vatEx, onVat }: { data: ReportData; supply: SupplyLeaf[]; tab: "sales" | "supply"; cat: "all" | "clothes" | "acc"; onClose: () => void; vatEx: boolean; onVat?: (ex: boolean) => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = dlg.current; if (d && !d.open) d.showModal(); }, []);
  const [tab, setTab] = useState<"sales" | "supply">(tab0);
  // Готовые Excel «Отчёт: продажи / поставки» (scripts/gen-two-reports.sh → publish-report-xlsx.ts): кнопка «Excel» есть, только если файл загружен.
  const [xl, setXl] = useState<Record<string, boolean>>({});
  useEffect(() => { let on = true; for (const t of ["sales", "supply"] as const) fetch(`/sales/catalog-xlsx?tab=${t}`, { method: "HEAD" }).then((r) => { if (on) setXl((x) => ({ ...x, [t]: r.ok })); }).catch(() => {}); return () => { on = false; }; }, []);
  const [cur, setCur] = useState<"EUR" | "RUR">("EUR");
  const [depth, setDepth] = useState<1 | 2 | 3>(2);
  const [shut, setShut] = useState<Set<string>>(new Set());
  const keys = KEYS;
  const toggleShut = (id: string) => setShut((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const supplyLeaves = useMemo(() => supply.filter((l) => cat === "all" || l.cls === cat), [supply, cat]);
  const rate = data.eurRate || 1;
  const leaves = useMemo(() => data.leaves.filter((l) => cat === "all" || l.cls === cat), [data.leaves, cat]);
  const tree = useMemo(() => buildTree(leaves, keys), [leaves]); // eslint-disable-line react-hooks/exhaustive-deps
  // Заказ и приход в деньгах — всегда EUR, как в отчёте (рублей в файлах заказа и прихода нет). Продажи и остаток — RUR (тысячами, подпись «000 RUR») или EUR (полными числами).
  const unit = cur === "EUR" ? "EUR" : "тыс. ₽";
  // NS (выручка товара сезона) — как в отчёте, без пересчёта по курсу: EUR/RUR и с НДС/без НДС выбираются кнопками.
  // Как в PDF владельца: NS 000'EUR excl VAT (тысячи евро без НДС), без переключателей НДС и валюты.
  const nsOf = (a: Agg) => a.nsEurEx;
  const nsK = (v: number) => (Math.abs(v) < 500 ? "–" : nf(v / 1000));
  const fromRub = (v: number | null) => (v === null ? null : cur === "RUR" ? v : v / rate);
  const money = (v: number | null) => (v === null || Math.abs(v) < 0.5 ? "–" : nf(cur === "RUR" ? v / 1000 : v));
  const eur = (v: number) => (Math.abs(v) < 0.5 ? "–" : nf(v));
  const q = (v: number) => (Math.abs(v) < 0.5 ? "–" : nf(v));
  const x2 = (v: number | null) => (v === null ? "–" : `×${v.toFixed(2).replace(".", ",")}`);
  // Как в отчёте владельца: Order (TTL, FW26) · Delivery (FW26) · Sales (SSN FW26, Calendar FW26) · Stock (FW26, TTL).
  const nsHead = "NS EUR";
  const subHeads = ["PCS", "EUR", "PCS", "EUR", "PCS", "EUR", "PCS", "EUR", "PCS", "SO, %", nsHead, "Avg MU", "PCS", nsHead, "Avg MU", "PCS", "PCS", "EUR", "EUR"];
  const groupStarts = [0, 4, 8, 15]; // толстая линия: начало блоков Order / Delivery / Sales / Stock
  const midStarts = [2, 6, 12]; // линия внутри блока: FW26 после TTL, Calendar, TTL остатка
  const sepClass = (i: number) => (groupStarts.includes(i) ? THICK : midStarts.includes(i) ? MID : "");
  const grid = { gridTemplateColumns: `minmax(8.5rem,15rem) repeat(${subHeads.length}, minmax(4.4rem,auto))` };
  const ttlOf = (ls: ReportLeaf[]) => ({ conf: ls.reduce((a, l) => a + l.ttlConf, 0), confEur: ls.reduce((a, l) => a + l.ttlConfEur, 0), deliv: ls.reduce((a, l) => a + l.ttlDeliv, 0), delivEur: ls.reduce((a, l) => a + l.ttlDelivEur, 0), stockEur: ls.reduce((a, l) => a + l.stockEur, 0), stockEurTtl: ls.reduce((a, l) => a + l.stockEurTtl, 0) });
  const oNsOf = (a: Agg) => a.oEurEx;

  const row = (label: string, level: 0 | 1 | 2 | 3, a: Agg, t: ReturnType<typeof ttlOf>, node?: Node) => {
    const so = a.conf > 0 && a.sold > 0 ? `${Math.round((a.sold / a.conf) * 100)}%` : "–"; // нуль — прочерк, как в PDF
    const cells = [
      q(t.conf), eur(t.confEur), q(a.conf), eur(a.confEur), q(t.deliv), eur(t.delivEur), q(a.deliv), eur(a.delivEur),
      q(a.sold), so, nsK(nsOf(a)), x2(a.cost > 0 ? a.gross / a.cost : null),
      q(a.sold + a.oSold), nsK(nsOf(a) + oNsOf(a)), x2(a.cost + a.oCost > 0 ? (a.gross + a.oGross) / (a.cost + a.oCost) : null),
      q(a.stock), q(a.tStock), eur(t.stockEur), eur(t.stockEurTtl),
    ];
    const hasKids = node && node.children.length > 0 && node.level < depth;
    const closed = node ? shut.has(node.id) : false;
    const tone = TONE[level];
    return (
      <div key={node?.id ?? "total"} role="row" className="contents">
        <div role="rowheader" className={`sticky left-0 z-[5] flex min-h-8 items-center border-b border-[#111] text-[13px] ${tone}`} style={{ paddingLeft: 6 + (level === 0 ? 0 : (level - 1) * 14 + 6) }}>
          {hasKids ? (
            <button type="button" aria-expanded={!closed} onClick={() => toggleShut(node!.id)} className="flex min-h-8 w-full items-center gap-1 pr-2 text-left">
              <span aria-hidden className="w-3 text-[10px]">{closed ? "▸" : "▾"}</span><span className="truncate">{label}</span>
            </button>
          ) : <span className="truncate pr-2">{label}</span>}
        </div>
        {cells.map((c, i) => <div role="cell" key={i} className={`flex min-h-8 items-center justify-end border-b border-l border-[#111] pl-3 pr-2 text-right text-[13px] tabular-nums ${tone} ${sepClass(i)}`}>{c}</div>)}
      </div>
    );
  };
  const flat = (nodes: Node[]): React.ReactNode[] => nodes.flatMap((n) => [row(n.label, n.level, aggOf(n.leaves, keys), ttlOf(n.leaves), n), ...(n.level < depth && !shut.has(n.id) ? flat(n.children) : [])]);

  return (
    <dialog ref={dlg} onClose={onClose} className="m-0 h-dvh max-h-none w-screen max-w-none bg-white p-0 text-neutral-900 md:mx-auto md:my-4 md:h-[calc(100dvh-2rem)] md:w-[min(96rem,100vw-2rem)] md:rounded-2xl">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2">
          <div className="flex min-w-0 gap-2" role="tablist" aria-label="Отчёт">
            {([["sales", "Продажи"], ["supply", "Поставки"]] as const).map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={chip(tab === k) + " !px-3 md:!px-4"}><span className="hidden md:inline">Отчёт:{"\u00a0"}</span>{t}{"\u00a0"}FW26</button>)}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {xl[tab] ? (
              <a href={`/sales/catalog-xlsx?tab=${tab}`} download className={chip(false) + " gap-1.5 !px-3"} aria-label={`Скачать Excel: отчёт ${tab === "sales" ? "продажи" : "поставки"}`}>
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" /></svg>
                Excel
              </a>
            ) : null}
            <CloseX onClick={onClose} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-200 px-3 py-2">
          <div className="flex gap-2 overflow-x-auto" data-keep-scroll role="group" aria-label="Уровень">
            {([[1, "Кат. 1"], [2, "Мех"], [3, "Кат. 2"]] as const).map(([d, t]) => <button key={d} type="button" aria-pressed={depth === d} onClick={() => { setDepth(d); setShut(new Set()); }} className={chip(depth === d) + " !px-3.5"}>{t}</button>)}
          </div>
        </div>
        <div className="border-b border-neutral-200 px-3 py-2">
          <h2 className="text-lg font-bold leading-tight">{tab === "sales" ? "Отчет по продажам меховых изделий FW26" : "Отчет по заказу и поставкам меховых изделий FW26"}</h2>
          <p className="text-xs text-neutral-700">{new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}</p>
          {tab === "sales" ? <p className="text-xs text-neutral-700">NS 000&apos;EUR excl VAT</p> : null}
        </div>
        {tab === "supply" ? (
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-2" data-keep-scroll tabIndex={0} role="region" aria-label="Таблица отчёта по заказу и поставкам">
            <SupplyTable leaves={supplyLeaves} keys={keys} depth={depth} shut={shut} onToggle={toggleShut} />
          </div>
        ) : (
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-2" data-keep-scroll tabIndex={0} role="region" aria-label="Таблица отчёта">
          <div role="table" aria-label="Отчёт по продажам FW26: категория 1, тип меха, категория 2" className="grid min-w-[1500px] border-2 border-[#111]" style={grid}>
            <div role="row" className="contents">
              <div role="columnheader" className={`${hd} left-0 top-0 z-20 border-b-0`} />
              <div role="columnheader" className={`${hd} top-0 ${THICK}`} style={{ gridColumn: "span 4" }}>Order</div>
              <div role="columnheader" className={`${hd} top-0 ${THICK}`} style={{ gridColumn: "span 4" }}>Delivery</div>
              <div role="columnheader" className={`${hd} top-0 ${THICK}`} style={{ gridColumn: "span 7" }}>Sales</div>
              <div role="columnheader" className={`${hd} top-0 ${THICK}`} style={{ gridColumn: "span 4" }}>Stock</div>
            </div>
            <div role="row" className="contents">
              <div role="columnheader" className={`${hd} left-0 top-8 z-20 border-b-0`} />
              <div role="columnheader" className={`${hd} top-8 ${THICK}`} style={{ gridColumn: "span 2" }}>TTL</div>
              <div role="columnheader" className={`${hd} top-8 ${MID}`} style={{ gridColumn: "span 2" }}>FW26</div>
              <div role="columnheader" className={`${hd} top-8 ${THICK}`} style={{ gridColumn: "span 2" }}>TTL</div>
              <div role="columnheader" className={`${hd} top-8 ${MID}`} style={{ gridColumn: "span 2" }}>FW26</div>
              <div role="columnheader" className={`${hd} top-8 ${THICK}`} style={{ gridColumn: "span 4" }}>SSN FW26</div>
              <div role="columnheader" className={`${hd} top-8 ${MID}`} style={{ gridColumn: "span 3" }}>Calendar FW26</div>
              <div role="columnheader" className={`${hd} top-8 ${THICK}`}>FW26</div>
              <div role="columnheader" className={`${hd} top-8`}>TTL</div>
              <div role="columnheader" className={`${hd} top-8`}>FW26</div>
              <div role="columnheader" className={`${hd} top-8`}>TTL</div>
            </div>
            <div role="row" className="contents">
              <div role="columnheader" className={`${hd} left-0 top-16 z-20`} />
              {subHeads.map((t, i) => <div role="columnheader" key={i} className={`${hd} top-16 ${sepClass(i)}`}>{t}</div>)}
            </div>
            {row("Total", 0, aggOf(leaves, keys), ttlOf(leaves))}
            {flat(tree)}
          </div>
        </div>
        )}
      </div>
    </dialog>
  );
}
