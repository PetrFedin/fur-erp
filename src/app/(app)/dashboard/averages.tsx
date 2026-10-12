"use client";

import { TotalLabel } from "@/components/total-label";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { REPAIR_CATEGORY } from "@/lib/dashboard-calc";
import type { DrillData, DrillOrder } from "@/lib/dashboard-drill";
import { InfoHint } from "@/components/info-hint";
import { CATEGORY_GROUPS, NO_GROUP } from "@/lib/category-groups";
import { loadProductionDrill } from "./actions";
import { CAROUSEL_ARROW } from "@/components/tile-carousel";
import { TILE_BOX, TileCaption, TileHead, TileValue } from "./tile";
import { addOrder, blank, build, cmpFor, cost, type Agg, type Lvl } from "./production-table";

const money = (v: number) => formatMoney(Math.round(v));
const qtyOf = (g: Agg) => Array.from(g.orders.values()).reduce((s, o) => s + o.qty, 0);
const per = (v: number, q: number) => (q > 0 ? v / q : null);
const m = (v: number | null) => (v == null || !isFinite(v) ? "—" : money(v));
const nz = (v: number | null) => (v == null || Math.abs(v) < 0.05 ? "—" : n1(v));
const n1 = (v: number | null) => (v == null ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 1 }));

/** Средние на одно изделие по группе ТЗ (без ремонта). */
function avgs(g: Agg) {
  const q = qtyOf(g);
  const whole = true;
  return {
    q,
    cost: whole ? per(cost(g), q) : null,
    fur: per(g.fur, q),
    hides: per(g.hides, q),
    hidePrice: g.hides > 0 ? g.hideSum / g.hides : null,
    meters: whole ? per(g.meters, q) : null,
    meterPrice: whole && g.meters > 0 ? g.liningSum / g.meters : null,
    work: whole ? per(g.work, q) : null,
    c4: whole ? per(g.c4, q) : null,
  };
}

/** Срезы внутри выбранной группы (первый уровень — сама группа: одежда, аксессуары). */
const MODES: { id: string; label: string; levels: Lvl[] }[] = [
  { id: "cat", label: "Категория → мех → артикул", levels: ["cat", "furl", "model"] },
  { id: "fur", label: "Мех → категория → артикул", levels: ["furl", "cat", "model"] },
  { id: "model", label: "Категория → артикул", levels: ["cat", "model"] },
];

export function useDrill(search: Record<string, string[]>) {
  const [data, setData] = useState<DrillData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    loadProductionDrill("all", search).then((d) => alive && setData(d)).catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [search]);
  return { data, error };
}

export function AveragesTile({ data }: { data: DrillData | null }) {
  const { mode: vat } = useVatDisplay();
  const [modal, setModal] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  // Средние считаются отдельно по группе: в группах разные категории и разные количества, общее среднее ничего не значит.
  const groups = useMemo(() => {
    const items = (data?.orders ?? []).filter((o) => o.cat !== REPAIR_CATEGORY);
    const names: string[] = [...CATEGORY_GROUPS];
    if (items.some((o) => o.grp === NO_GROUP)) names.push(NO_GROUP);
    return names.map((name) => {
      const t = blank(name, name);
      for (const o of items) if (o.grp === name) addOrder(t, o, vat);
      return { name, agg: t };
    });
  }, [data, vat]);

  const goTo = (i: number) => scroller.current?.scrollTo({ left: i * scroller.current.clientWidth, behavior: "smooth" });
  const onScroll = () => { const el = scroller.current; if (el && el.clientWidth) setIdx(Math.round(el.scrollLeft / el.clientWidth)); };
  const cur = groups[Math.min(idx, groups.length - 1)];

  return (
    <div className="relative">
      <div className={TILE_BOX + " tile-click shadow-sm print:shadow-none"}>
        <TileHead>Среднее на изделие · {cur ? cur.name : ""}</TileHead>
        <div ref={scroller} onScroll={onScroll} className="-mx-1 flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-roledescription="карусель" aria-label="Среднее на изделие по группам">
          {groups.map((g, i) => {
            const a = avgs(g.agg);
            return (
              <button key={g.name} type="button" onClick={() => setModal(g.name)} aria-haspopup="dialog" aria-label={`Среднее на изделие: ${g.name} — открыть детализацию`} aria-hidden={i !== idx} tabIndex={i === idx ? 0 : -1}
                className="min-w-full snap-center px-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">
                <TileValue>{data ? m(a.cost) : "…"}</TileValue>
                <TileCaption>{formatQty(a.q)} шт.</TileCaption>
                <dl className="mt-1 space-y-0.5 text-xs">
                  {[
                    ["Шкур на изделие", `${n1(a.hides)} шт.`],
                    ["Средняя цена шкуры", m(a.hidePrice)],
                    ["Подкладки на изделие", a.meters != null && a.meters >= 0.05 ? `${n1(a.meters)} м` : "—"],
                    ["Средняя цена подкладки, ₽/м", m(a.meterPrice)],
                    ["Работа на изделие", m(a.work)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-3">
                      <dt className="text-neutral-600">{k}</dt>
                      <dd className="whitespace-nowrap font-medium tabular-nums">{data ? v : "…"}</dd>
                    </div>
                  ))}
                </dl>
              </button>
            );
          })}
        </div>
        <div className="mt-auto flex items-center justify-center gap-2 pt-3">
          <button type="button" className={CAROUSEL_ARROW} onClick={() => goTo(Math.max(0, idx - 1))} disabled={idx === 0} aria-label="Предыдущий слайд">‹</button>
          <div className="flex items-center justify-center gap-1.5" role="tablist" aria-label="Группа">
            {groups.map((g, i) => (
              <button key={g.name} type="button" role="tab" aria-selected={i === idx} aria-label={g.name} title={g.name} onClick={() => goTo(i)}
                className={"h-2 rounded-full transition-all " + (i === idx ? "w-5 bg-neutral-900" : "w-2 bg-neutral-300 hover:bg-neutral-400")} />
            ))}
          </div>
          <button type="button" className={CAROUSEL_ARROW} onClick={() => goTo(Math.min(groups.length - 1, idx + 1))} disabled={idx >= groups.length - 1} aria-label="Следующий слайд">›</button>
        </div>
      </div>
      <div className="absolute right-3 top-3">
        <InfoHint label="Что такое среднее на изделие" wide align="right">
          <p>Считается отдельно по группам категорий: у одежды и аксессуаров разные категории и разные количества, общее среднее было бы искажено. Листайте вправо-влево или нажмите на точку внизу.</p>
          <p className="mt-1">Сумма по ТЗ группы (факт списания, без ремонта) делится на число изделий группы; цена шкуры и подкладки — средневзвешенная по списанию (без 4%). Нажмите на плитку — срезы по категориям, меху, годам и партиям внутри группы.</p>
        </InfoHint>
      </div>
      {modal && data ? <AveragesModal initialGroup={modal} orders={data.orders.filter((o) => o.cat !== REPAIR_CATEGORY)} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

function AveragesModal({ initialGroup, orders: allOrders, onClose }: { initialGroup: string; orders: DrillOrder[]; onClose: () => void }) {
  const [group, setGroup] = useState(initialGroup);
  const groupNames = useMemo(() => {
    const names: string[] = [...CATEGORY_GROUPS];
    if (allOrders.some((o) => o.grp === NO_GROUP)) names.push(NO_GROUP);
    return names;
  }, [allOrders]);
  const orders = useMemo(() => allOrders.filter((o) => o.grp === group), [allOrders, group]);
  const { mode: vat } = useVatDisplay();
  const [modeId, setModeId] = useState("cat");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const closeRef = useRef<HTMLButtonElement>(null);
  const levels = MODES.find((x) => x.id === modeId)!.levels;
  const rows = useMemo(() => build(orders, vat, levels), [orders, vat, levels]);
  const total = useMemo(() => { const t = blank("all", "Всего по группе"); for (const o of orders) addOrder(t, o, vat); return t; }, [orders, vat]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  // Тонкие вертикальные линии между блоками колонок: «Изделие» | «Мех и подкладка» | «Работа и надбавка».
  const BL = " border-l border-neutral-200";
  const cells = (g: Agg, cls: string) => {
    const a = avgs(g);
    const c = "whitespace-nowrap px-2 text-right tabular-nums " + cls;
    return (
      <>
        <td className={c}>{formatQty(a.q)}</td>
        <td className={c + " font-medium"}>{m(a.cost)}</td>
        <td className={c + BL}>{m(a.fur)}</td>
        <td className={c}>{n1(a.hides)}</td>
        <td className={c}>{m(a.hidePrice)}</td>
        <td className={c}>{nz(a.meters)}</td>
        <td className={c}>{m(a.meterPrice)}</td>
        <td className={c + BL}>{m(a.work)}</td>
        <td className={c}>{m(a.c4)}</td>
      </>
    );
  };
  const depthMax = levels.length - 1;
  const render = (nodes: Agg[], depth: number, path: string): React.ReactNode =>
    nodes.map((r) => {
      const pk = path + "/" + r.key;
      const canOpen = depth < depthMax && r.children.size > 0;
      const isOpen = open.has(pk);
      const dark = depth === 1 && canOpen && isOpen;
      return (
        <Fragment key={pk}>
          <tr className={"border-b border-neutral-100 " + (depth > 0 ? "bg-neutral-50/70" : "")}>
            <td className={depth === 0 ? "py-1.5 pr-2 text-sm font-semibold" : "py-1 pr-2 text-xs " + (dark ? "text-neutral-900" : "text-neutral-700")} style={{ paddingLeft: depth * 16 }}>
              {canOpen ? (
                <button type="button" onClick={() => toggle(pk)} aria-expanded={isOpen} aria-label={`Раскрыть: ${r.label}`} className="flex items-center gap-1 text-left">
                  <span aria-hidden className={"inline-block w-4 text-neutral-500 transition-transform " + (isOpen ? "rotate-90" : "")}>›</span>{r.label}
                </button>
              ) : <span className={depth > 0 ? "pl-4" : ""}>{r.label}</span>}
            </td>
            {cells(r, depth === 0 ? "py-1.5 text-sm" : "py-1 text-xs " + (dark ? "text-neutral-900" : "text-neutral-600"))}
          </tr>
          {canOpen && isOpen ? render(Array.from(r.children.values()).sort(cmpFor(levels[depth + 1])), depth + 1, pk) : null}
        </Fragment>
      );
    });

  const th = "px-2 py-1.5 text-right font-medium";
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 sm:items-center sm:p-4 print:hidden" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="avg-modal-title" className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 p-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Средние на одно изделие · {group} · без ремонта</div>
            <h2 id="avg-modal-title" className="mt-0.5 text-lg font-semibold">{group}: {m(avgs(total).cost)} · {formatQty(avgs(total).q)} шт.</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Закрыть окно" className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">✕ Закрыть</button>
        </div>
        <div className="overflow-y-auto p-4">
          <div role="tablist" aria-label="Группа категорий" className="mb-2 inline-flex flex-wrap overflow-hidden rounded-lg border border-neutral-300 text-sm">
            {groupNames.map((g) => (
              <button key={g} type="button" role="tab" aria-selected={group === g} onClick={() => { setGroup(g); setOpen(new Set()); }}
                className={"px-4 py-2 " + (group === g ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50")}>{g}</button>
            ))}
          </div>
          <div role="tablist" aria-label="Разрез" className="mb-3 flex flex-wrap gap-1.5">
            {MODES.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={modeId === x.id} onClick={() => { setModeId(x.id); setOpen(new Set()); }}
                className={"rounded-lg border px-3 py-1.5 text-xs " + (modeId === x.id ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50")}>{x.label}</button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  <th />
                  <th colSpan={2} className="border-b border-neutral-200 px-2 pb-1 text-left">Изделие</th>
                  <th colSpan={5} className={"border-b border-neutral-200 px-2 pb-1 text-left" + BL}>Мех и подкладка</th>
                  <th colSpan={2} className={"border-b border-neutral-200 px-2 pb-1 text-left" + BL}>Работа и надбавка</th>
                </tr>
                <tr className="border-b border-neutral-200 text-xs text-neutral-500">
                  <th className="py-1.5 pr-2 font-medium">Строка</th>
                  <th className={th}>Изделий, шт.</th>
                  <th className={th}>Себестоимость изделия</th>
                  <th className={th + BL}>Мех на изделие</th>
                  <th className={th}>Шкур на изделие</th>
                  <th className={th}>Ср. цена шкуры</th>
                  <th className={th}>Подкладки на изделие, м</th>
                  <th className={th}>Ср. цена подкладки, ₽/м</th>
                  <th className={th + BL}>Работа на изделие</th>
                  <th className={th}>4% на изделие</th>
                </tr>
              </thead>
              <tbody>
                {render(rows, 0, "")}
                <tr className="row-total">
                  <td className="py-1.5 pr-2 text-sm"><TotalLabel unit="₽/изд." avg extra={group} /></td>
                  {cells(total, "py-1.5 text-sm")}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-neutral-500">Все цифры — на одно изделие: сумма по ТЗ ÷ число изделий. Смешанные ТЗ («Норка + Соболь») входят в каждый свой вид меха: шкуры — свои, а подкладка, работа, расходы и 4% на подкладку делятся между видами пропорционально стоимости шкур в ТЗ (сумма долей = ТЗ). Изделия смешанного ТЗ учтены в каждом виде целиком, поэтому число изделий по видам меха между собой не суммируется, а суммы ₽ суммируются. Фильтры Главной, год, НДС применяются. Мех на изделие включает шкуры подрядчика, цена шкуры — только списание из лотов (без 4%).</p>
        </div>
      </div>
    </div>
  );
}
