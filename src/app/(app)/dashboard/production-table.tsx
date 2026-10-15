"use client";

import { InfoHint } from "@/components/info-hint";
import { TH, THGroup } from "@/components/table-head";
import { TotalLabel } from "@/components/total-label";
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { groupRank } from "@/lib/category-groups";
import { REPAIR_CATEGORY } from "@/lib/dashboard-calc";
import { NO_GROUP } from "@/lib/category-groups";
import { furKindsOfOrder } from "@/lib/order-fur";
import { UNDEFINED_CATEGORY } from "@/lib/product-category";
import { atomsOf, type DrillData, type DrillOrder } from "@/lib/dashboard-drill";
import { loadProductionDrill } from "./actions";
import { grpBlock, pathBlock } from "@/lib/block-hover";
import { useClientSort } from "@/lib/use-client-sort";

export type Agg = {
  key: string;
  label: string;
  orders: Map<string, DrillOrder>;
  fur: number; lining: number; c4: number; other: number; work: number;
  hides: number; hideSum: number; meters: number; liningSum: number;
  children: Map<string, Agg>;
};

export const blank = (key: string, label: string): Agg => ({ key, label, orders: new Map(), fur: 0, lining: 0, c4: 0, other: 0, work: 0, hides: 0, hideSum: 0, meters: 0, liningSum: 0, children: new Map() });

/** Добавляет ТЗ целиком (все его атомы + работа) в группу. */
export function addOrder(g: Agg, o: DrillOrder, vat: "incl" | "excl") {
  if (g.orders.has(o.id)) return;
  g.orders.set(o.id, o);
  g.work += o.work;
  for (const a of atomsOf(o)) {
    const v = vat === "incl" ? a.i : a.e;
    const c = vat === "incl" ? a.ci : a.ce;
    if (a.k === "f" || a.k === "h") g.fur += v - c;
    else if (a.k === "l") g.lining += v - c;
    else g.other += v;
    if (a.k === "f" || a.k === "l") g.c4 += c;
    if (a.k === "f") { g.hides += a.q; g.hideSum += v - c; }
    if (a.k === "l") { g.meters += a.q; g.liningSum += v - c; }
  }
}

export type Lvl = "grp" | "cat" | "fur" | "furl" | "year" | "batch" | "model";
const LEVELS: Record<"cat" | "fur", Lvl[]> = { cat: ["grp", "cat", "furl"], fur: ["furl", "grp", "cat"] };
const keyLabel = (o: DrillOrder, l: Lvl): [string, string] => {
  switch (l) {
    case "grp": return [o.grp, o.grp];
    case "cat": return [o.cat, o.cat];
    case "fur": return [o.fur, o.fur];
    case "furl": return [o.fur, o.fur];
    case "year": return [o.y == null ? "none" : String(o.y), o.y == null ? "Без года" : String(o.y)];
    case "batch": return [o.bk, o.bl];
    case "model": return [o.mid, o.ml];
  }
};
export const cost = (g: Agg) => g.fur + g.lining + g.c4 + g.other + g.work;

/** Дерево группировок: каждый ТЗ целиком (атомы + работа) попадает в узел на каждом уровне. */
/** Порядок строк уровня: группы — по справочнику, годы и партии — по номеру («без» в конце), остальное — по сумме. */
export const cmpFor = (l: Lvl) => (a: Agg, b: Agg): number => {
  if (l === "grp") return groupRank(a.key) - groupRank(b.key);
  if (l === "year" || l === "batch") {
    if (a.key === "none") return 1;
    if (b.key === "none") return -1;
    return Number(a.key) - Number(b.key);
  }
  return cost(b) - cost(a);
};

/**
 * Добавляет в узел долю ТЗ, относящуюся к виду меха fu (смешанное ТЗ «Норка + Соболь» делится по видам): шкуры вида — целиком,
 * подкладка, работа, расходы и надбавка 4% на подкладку — пропорционально стоимости шкур этого вида в ТЗ. Σ долей по видам = ТЗ.
 */
export function addOrderFur(g: Agg, o: DrillOrder, vat: "incl" | "excl", fu: string, kinds: number) {
  g.orders.set(o.id, o);
  const val = (a: { i: number; e: number }) => (vat === "incl" ? a.i : a.e);
  const c4 = (a: { ci: number; ce: number }) => (vat === "incl" ? a.ci : a.ce);
  let own = 0, all = 0;
  for (const l of o.lines) if (l.k === "f") { const v = val(l) - c4(l); all += v; if (l.fu === fu) own += v; }
  const share = all > 0 ? own / all : 1 / Math.max(1, kinds);
  for (const l of o.lines) {
    if (l.k === "f" && l.fu === fu) {
      g.fur += val(l) - c4(l); g.hides += l.q; g.hideSum += val(l) - c4(l); g.c4 += c4(l);
    } else if (l.k === "l") {
      g.lining += share * (val(l) - c4(l)); g.liningSum += share * (val(l) - c4(l)); g.meters += share * l.q; g.c4 += share * c4(l);
    }
  }
  for (const a of atomsOf(o)) {
    if (a.k === "h") g.fur += share * val(a);
    else if (a.k === "e" || a.k === "r") g.other += share * val(a);
  }
  g.work += share * o.work;
}

/** Виды меха ТЗ по строкам списания (у смешанных ТЗ — несколько) плюс вид самого ТЗ (order-fur.ts: ручной вид > списания > текст):
 *  ТЗ без списаний меха (бобр подрядчика) попадает в строку «Бобр», а ручной вид ТЗ не теряется. */
const furKinds = (o: DrillOrder): string[] => {
  const k = Array.from(new Set(o.lines.filter((l) => l.k === "f").map((l) => l.fu)));
  for (const x of furKindsOfOrder(o.fur)) if (!k.includes(x)) k.push(x);
  return k.length ? k : [o.fur];
};

/**
 * Дерево группировок: ТЗ целиком (атомы + работа) попадает в узлы выше уровня «furl»; на уровне «furl» и ниже —
 * отдельно по каждому виду меха ТЗ только его шкуры (смешанное ТЗ «Норка + Соболь» попадает и в «Норка», и в «Соболь»).
 */
export function build(orders: DrillOrder[], vat: "incl" | "excl", levels: Lvl[]): Agg[] {
  const root = new Map<string, Agg>();
  const insert = (level: Map<string, Agg>, depth: number, o: DrillOrder, restrict: string | null) => {
    if (depth >= levels.length) return;
    const l = levels[depth];
    const keys: Array<[string, string, string | null]> = l === "furl"
      ? furKinds(o).map((f) => [f, f, f] as [string, string, string | null])
      : [[...keyLabel(o, l), restrict] as [string, string, string | null]];
    for (const [k, label, r] of keys) {
      const g = level.get(k) ?? blank(k, label);
      level.set(k, g);
      if (r) addOrderFur(g, o, vat, r, furKinds(o).length); else addOrder(g, o, vat);
      insert(g.children, depth + 1, o, r);
    }
  };
  for (const o of orders) insert(root, 0, o, null);
  return Array.from(root.values()).sort(cmpFor(levels[0]));
}

const money = (v: number) => formatMoney(Math.round(v));
const dash = (v: number | null, f: (n: number) => string) => (v == null || !isFinite(v) ? "—" : f(v));

export function ProductionTable({ search }: { search: Record<string, string[]> }) {
  const { mode: vat } = useVatDisplay();
  const [data, setData] = useState<DrillData | null>(null);
  const [error, setError] = useState(false);
  const [by, setBy] = useState<"cat" | "fur">("cat");
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    loadProductionDrill("all", search).then((d) => alive && setData(d)).catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [search]);

  // Ремонт — не выпуск изделий: в штуки и средние цены не входит, показан отдельной строкой.
  const isRepair = (o: DrillOrder) => o.cat === REPAIR_CATEGORY;
  const rows = useMemo(() => (data ? build(data.orders.filter((o) => !isRepair(o)), vat, LEVELS[by]) : []), [data, vat, by]);
  const showOther = rows.some((r) => Math.abs(r.other) > 0.5);
  const { total, repair, all } = useMemo(() => {
    const t = blank("items", "Всего, ₽ без ремонта"), r = blank("repair", "Ремонт"), a = blank("all", "Всего, ₽ с ремонтом");
    if (data) for (const o of data.orders) { addOrder(isRepair(o) ? r : t, o, vat); addOrder(a, o, vat); }
    return { total: t, repair: r, all: a };
  }, [data, vat]);

  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const qty = (g: Agg) => Array.from(g.orders.values()).reduce((s, o) => s + o.qty, 0);
  const sum = cost;
  // Сортировка по клику на заголовок (▲/▼): строки каждого уровня дерева; без выбора — порядок по умолчанию (группы по справочнику, остальное по сумме).
  const per = (v: number, q: number) => (q > 0 ? v / q : null);
  const { th, sort: colSort } = useClientSort<Agg>({
    name: (g) => g.label, qty: (g) => qty(g), avg: (g) => per(sum(g), qty(g)), sum: (g) => sum(g), fur: (g) => g.fur, lining: (g) => g.lining, work: (g) => g.work, c4: (g) => g.c4, other: (g) => g.other,
    hides: (g) => g.hides, hidePrice: (g) => (g.hides > 0 ? g.hideSum / g.hides : null), meters: (g) => g.meters, meterPrice: (g) => (g.meters > 0 ? g.liningSum / g.meters : null), workUnit: (g) => per(g.work, qty(g)),
  });

  // Тонкая вертикальная линия между блоками колонок: «Производство» | «Расходы» | «Средние и расход».
  const BL = " border-l border-neutral-200";
  const cells = (g: Agg, small: boolean, noQty = false, dark = false) => {
    const q = noQty ? 0 : qty(g);
    const cls = "whitespace-nowrap px-2 text-right tabular-nums " + (small ? "py-1 text-xs " + (dark ? "text-neutral-900" : "text-neutral-600") : "py-1.5 text-sm");
    return (
      <>
        <td className={cls}>{noQty ? "—" : formatQty(q)}</td>
        <td className={cls}>{dash(q > 0 ? sum(g) / q : null, money)}</td>
        <td className={cls + (small ? "" : " font-medium")}>{money(sum(g))}</td>
        <td className={cls + BL}>{money(g.fur)}</td>
        <td className={cls}>{money(g.lining)}</td>
        <td className={cls}>{money(g.work)}</td>
        <td className={cls}>{money(g.c4)}</td>
        {showOther ? <td className={cls}>{money(g.other)}</td> : null}
        <td className={cls + BL}>{formatQty(g.hides)}</td>
        <td className={cls}>{dash(g.hides > 0 ? g.hideSum / g.hides : null, money)}</td>
        <td className={cls}>{formatQty(g.meters)}</td>
        <td className={cls}>{dash(g.meters > 0 ? g.liningSum / g.meters : null, money)}</td>
        <td className={cls}>{dash(q > 0 ? g.work / q : null, money)}</td>
      </>
    );
  };

  const depthMax = LEVELS[by].length - 1;
  const sortKids = (m: Map<string, Agg>, depth: number) =>
    Array.from(m.values()).sort(cmpFor(LEVELS[by][depth]));
  // Переход из листа дерева в «Изделия» (/articles): группа, категория и вид меха строки; общий год берётся из шапки (cookie),
  // цвет и партия Главной переносятся. Лист «Категории → мех» — вид меха, лист «Мех → категории» — категория.
  const articlesHref = (trail: Agg[]) => {
    const lv = LEVELS[by];
    const p = new URLSearchParams();
    trail.forEach((n, i) => {
      if (lv[i] === "grp") p.set("catgroup", n.key === NO_GROUP ? "none" : n.key);
      else if (lv[i] === "cat") p.set("category", n.key === UNDEFINED_CATEGORY ? "none" : n.key);
      else if (lv[i] === "furl") p.set("fur", n.key);
    });
    for (const k of ["color", "batch"]) for (const v of search[k] ?? []) p.append(k, v);
    return "/articles?" + p.toString();
  };
  const renderRows = (nodes: Agg[], depth: number, path: string, trail: Agg[] = [], anc: string[] = []): React.ReactNode =>
    colSort(nodes).map((r) => {
      const pk = path + "/" + r.key;
      const here = [...trail, r];
      const tok = pathBlock(pk);
      const canOpen = depth < depthMax && r.children.size > 0;
      const isOpen = open.has(pk);
      const label = canOpen ? (
        <button type="button" onClick={() => toggle(pk)} aria-expanded={isOpen} aria-label={`Раскрыть: ${r.label}`} className="flex items-center gap-1 text-left">
          <span aria-hidden className={"inline-block w-4 text-neutral-500 transition-transform " + (isOpen ? "rotate-90" : "")}>›</span>{r.label}
        </button>
      ) : depth === depthMax ? (
        <span className="inline-block w-4">
          <Link href={articlesHref(here)} className="whitespace-nowrap hover:underline focus-visible:underline" title="Открыть в «Изделиях» с этими фильтрами">{r.label}<span aria-hidden className="ml-1 text-[10px] text-neutral-400">↗</span></Link>
        </span>
      ) : <span className={depth > 0 ? "inline-block w-4" : ""}>{depth > 0 ? "" : null}{r.label}</span>;
      return (
        <Fragment key={pk}>
          <tr data-hover-block={canOpen ? tok : undefined} data-block={[...anc, depth === 0 && by === "cat" ? grpBlock(r.key) : ""].filter(Boolean).join(" ") || undefined} className={"border-b border-neutral-100 " + (depth > 0 ? "bg-neutral-50/70" : "")}>
            <td className={depth === 0 ? "py-1.5 pr-2 text-sm font-semibold" : "py-1 pr-2 text-xs " + (depth === 1 && canOpen && isOpen ? "text-neutral-900" : "text-neutral-700")} style={{ paddingLeft: depth * 16 }}>{label}</td>
            {cells(r, depth > 0, false, depth === 1 && canOpen && isOpen)}
          </tr>
          {canOpen && isOpen ? renderRows(sortKids(r.children, depth + 1), depth + 1, pk, here, [...anc, tok]) : null}
        </Fragment>
      );
    });

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 print:break-inside-avoid">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Объёмы по группам меха и категориям</h3>
        <div role="tablist" aria-label="Разрез таблицы" className="inline-flex overflow-hidden rounded-lg border border-neutral-300 text-xs">
          {([["cat", "Категории → мех"], ["fur", "Мех → категории"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={by === id} onClick={() => { setBy(id); setOpen(new Set()); }}
              className={"px-3 py-1.5 " + (by === id ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50")}>{label}</button>
          ))}
        </div>
      </div>
      {error ? <p className="py-4 text-sm text-neutral-500">Не удалось загрузить данные таблицы.</p> : !data ? <p className="py-4 text-sm text-neutral-500">Загрузка…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left">
            <thead>
              <tr>
                <th />
                <THGroup colSpan={3} sep={false}>Производство</THGroup>
                <THGroup colSpan={showOther ? 5 : 4}>Расходы</THGroup>
                <THGroup colSpan={5}>Объёмы и цены</THGroup>
              </tr>
              <tr className="border-b border-neutral-200 text-xs text-neutral-500">
                <TH align="left" label={by === "cat" ? "Группа / категория / мех" : "Мех / группа / категория"} {...th("name")} className="px-0 pr-2" />
                <TH {...th("qty")} label="Изделий" unit="шт." />
                <TH {...th("avg")} label="Ср. цена изделия" unit="₽/шт." />
                <TH {...th("sum")} label="Сумма производства" unit="₽" />
                <TH {...th("fur")} label="Мех" unit="₽" sep />
                <TH {...th("lining")} label="Подкладка" unit="₽" />
                <TH {...th("work")} label="Работа" unit="₽" />
                <TH {...th("c4")} label="4%" unit="₽" after={<InfoHint label="Что такое 4%"><p>Надбавка 4% к сырью (меху и подкладке).</p></InfoHint>} />
                {showOther ? <TH {...th("other")} label="Расходы и прочее" unit="₽" /> : null}
                <TH {...th("hides")} label="Шкур" unit="шт." sep />
                <TH {...th("hidePrice")} label="Ср. цена шкуры" unit="₽/шт." />
                <TH {...th("meters")} label="Подкладки" unit="м" />
                <TH {...th("meterPrice")} label="Ср. цена подкладки" unit="₽/м" />
                <TH {...th("workUnit")} label="Ср. цена работы" unit="₽/изд." />
              </tr>
            </thead>
            <tbody>
              {renderRows(rows, 0, "")}
              <tr className="row-total" data-block="prod">
                <td className="py-1.5 pr-2 text-sm"><TotalLabel /></td>
                {cells(total, false)}
              </tr>
              {repair.orders.size > 0 ? (
                <>
                  <tr className="border-b border-neutral-100">
                    <td className="py-1.5 pr-2 text-sm"><Link href="/repair" className="inline-flex items-center rounded-lg border border-[#1d4ed8] bg-white px-3 py-1 text-xs font-medium text-[#1d4ed8] hover:bg-[#EFF4FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d4ed8]" title="Открыть раздел «Ремонт» со всеми ТЗ ремонта">Ремонт</Link></td>
                    {cells(repair, true, true)}
                  </tr>
                  <tr className="row-total" data-block="prod">
                    <td className="whitespace-nowrap py-1.5 pr-2 text-sm"><TotalLabel note="с ремонтом" /></td>
                    {cells(all, false, true)}
                  </tr>
                </>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
