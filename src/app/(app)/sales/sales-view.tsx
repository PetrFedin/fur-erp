"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { useVatDisplay } from "@/lib/vat-display";
import type { DatamartStock } from "@/lib/datamart-stock";
import { makeCtx, type ReportSizeRow } from "@/lib/margin-tree";
import { deserializeInput, type MarginInputS } from "@/lib/margin";
import { CAT_LABEL } from "@/lib/sales-receipts-core";
import { addDays, applyFilters, cat2Of, furOf, bucketsOf, extOf, groupBy, lastMonthOf, NO_FILTERS, openingStock, sortSeasons, type Cat, type Ext, type Filters, type SLine } from "@/lib/sales-section";
import { DEFAULT_UI, TABS, uiQuery, type Tab, type Ui } from "@/lib/sales-url";
import { DASH, btn, dateRu, money, moneyC, n0, pct, seg, segGroup } from "./sales-fmt";
import { MiniTable, SalesModal } from "./sales-modal";
import { SalesCharts } from "./sales-charts";
import { SeasonsTab, StockTab, TopTab } from "./sales-tabs";
import type { Chain } from "@/lib/sales-server";
import { SalesTree, type PhotoIdx } from "./sales-tree";

type Props = { input: MarginInputS; sizes: ReportSizeRow[]; photos: PhotoIdx; today: string; initial: Ui; chain: Chain; dmStock?: DatamartStock | null; reportDate?: string };

type Col = { head: string; get: (e: Ext) => string };
type TileDef = { id: string; label: string; value: string; sub?: string; how: React.ReactNode; cols: Col[]; extra?: React.ReactNode };

/** Мультивыбор в выпадающей панели: пусто = все; закрывается по Esc и клику снаружи. */
function MultiPick({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const d = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", k); window.addEventListener("mousedown", d);
    return () => { window.removeEventListener("keydown", k); window.removeEventListener("mousedown", d); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={btn}>{label}: {value.length ? value.length === 1 ? value[0] : `${value.length} выбрано` : "все"} ▾</button>
      {open && (
        <div role="group" aria-label={label} className="absolute left-0 z-30 mt-1 flex max-h-[60vh] w-64 max-w-[85vw] flex-col overflow-y-auto rounded-lg border border-neutral-300 bg-white p-2 shadow-lg">
          {options.map((o) => <label key={o} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={value.includes(o)} onChange={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])} />{o}</label>)}
          {value.length > 0 && <button type="button" onClick={() => onChange([])} className={btn}>Все</button>}
        </div>
      )}
    </div>
  );
}

function Tile({ def, onOpen }: { def: TileDef; onOpen: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(def.id)} aria-haspopup="dialog" className="flex min-h-11 min-w-0 flex-col items-start gap-0.5 rounded-lg border border-neutral-300 bg-white p-3 text-left hover:border-neutral-500">
      <span className="text-xs text-neutral-700">{def.label}</span>
      <span data-metric={def.id} className="text-lg font-semibold tabular-nums text-neutral-900">{def.value}</span>
      {def.sub ? <span className="text-xs text-neutral-700">{def.sub}</span> : null}
    </button>
  );
}

export function SalesView({ input, sizes, photos, today, initial, chain, dmStock, reportDate = "19.10.2026" }: Props) {
  const [ui, setUi] = useState<Ui>(initial);
  const [hot, setHot] = useState<number | null>(null);
  const [tile, setTile] = useState<string | null>(null);
  const [fOpen, setFOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const patch = (p: Partial<Ui>) => setUi((u) => ({ ...u, ...p }));
  const setF = (p: Partial<Filters>) => setUi((u) => ({ ...u, f: { ...u.f, ...p } }));
  // НДС — один на весь сайт (переключатель в шапке, cookie vatDisplay): раздел следует за шапкой, а свой переключатель меняет и шапку.
  const vatDisp = useVatDisplay();
  useEffect(() => {
    const want = vatDisp.mode === "excl" ? "ex" : "in";
    setUi((u) => (u.vat === want ? u : { ...u, vat: want }));
  }, [vatDisp.mode]);

  useEffect(() => {
    const q = uiQuery(ui);
    window.history.replaceState(null, "", window.location.pathname + (q ? "?" + q : ""));
  }, [ui]);

  const inp = useMemo(() => deserializeInput(input), [input]);
  const all = input.lines as SLine[];
  const ex = ui.vat === "ex";
  const vatNote = ex ? "без НДС" : "с НДС";
  const ctx = useMemo(() => makeCtx(inp, ui.vat), [inp, ui.vat]);
  const env = useMemo(() => ({ lastMonth: lastMonthOf(all) }), [all]);
  const lines = useMemo(() => applyFilters(all, ui.f), [all, ui.f]);
  const opening = useMemo(() => openingStock(all, ui.f), [all, ui.f]);
  const seasons = useMemo(() => sortSeasons(all.map((l) => l.season)), [all]);
  const cat2s = useMemo(() => [...new Set(all.map(cat2Of))].sort(), [all]);
  const furs = useMemo(() => [...new Set(all.map(furOf))].sort(), [all]);
  const head = useMemo(() => extOf(ctx, lines, env), [ctx, lines, env]);
  const stockEnd = opening + head.received - head.sold;
  const buckets = useMemo(() => bucketsOf(ctx, env, lines, ui.gran, opening), [ctx, env, lines, ui.gran, opening]);
  const bySeason = useMemo(() => bucketsOf(ctx, env, lines, "season", 0), [ctx, env, lines]);
  const byOrder = useMemo(() => groupBy(ctx, env, lines, "order"), [ctx, env, lines]);
  const byCls = useMemo(() => (["clothes", "acc", "other"] as const).map((c) => ({ key: c, label: CAT_LABEL[c], m: extOf(ctx, lines.filter((l) => l.cls === c), env) })).filter((r) => r.m.received || r.m.sold || r.m.discountSum), [ctx, lines, env]);

  const isPlain = !ui.f.from && !ui.f.to && !ui.f.seasons.length && !ui.f.cat2.length && !ui.f.furs.length && !ui.f.q;
  const reportStock = sizes.filter((r) => ui.f.cat === "all" || r.cls === ui.f.cat).reduce((a, r) => a + r.stock, 0);
  const hasReport = sizes.length > 0;
  const diff = stockEnd - reportStock;
  // Остаток из витрины datamart на последнюю дату снимка (по нашим 5 заказам): всего / одежда / аксессуары.
  const dmLast = dmStock?.snapshots[dmStock.snapshots.length - 1];
  const dmRef = dmLast ? (ui.f.cat === "all" ? dmLast.total : ui.f.cat === "clothes" ? dmLast.rtw : ui.f.cat === "acc" ? dmLast.acc : null) : null;
  const dmDiff = dmRef === null ? 0 : stockEnd - dmRef;
  const dmDate = dmLast ? dmLast.date.split("-").reverse().join(".") : "";
  const orders = new Set(lines.map((l) => l.orderNo)).size, arts = new Set(lines.map((l) => l.article)).size;

  const tiles: TileDef[] = [
    { id: "received", label: "Получено, шт.", value: n0(head.received), sub: `${orders} заказов · ${arts} артикулов`,
      how: <p>Приход (Delivery): сумма штук строк прихода выгрузки за период. Корректировки прихода с минусом уже вычтены.</p>,
      cols: [{ head: "Получено, шт.", get: (e) => n0(e.received) }, { head: "Первая поставка", get: (e) => dateRu(e.firstReceipt) }] },
    { id: "sold", label: "Продано, шт.", value: n0(head.sold), sub: `выручка ${moneyC(head.revenue)} · ${vatNote}`,
      how: <><p>Нетто = валовое {n0(head.gross)} − возвраты {n0(head.returns)}. Деньги — за тот же период ({vatNote}; НДС 20 % до 2026, 22 % с 2026).</p>{head.noPcs > 0 ? <p className="mt-1">{head.noPcs} строк продаж без штук: только скидка, в штуки не входят.</p> : null}</>,
      cols: [{ head: "Нетто, шт.", get: (e) => n0(e.sold) }, { head: "Выручка, ₽", get: (e) => money(e.revenue) }, { head: "Ср. цена, ₽", get: (e) => money(e.avgPrice) }, { head: "Скидка", get: (e) => pct(e.discountGiven, 1) }, { head: "Маржа", get: (e) => (e.grossMarginPct === null ? DASH : pct(e.grossMarginPct / 100, 1)) }] },
    { id: "stock", label: "Остаток, шт.", value: n0(stockEnd), sub: dmRef !== null && isPlain ? `datamart на ${dmDate}: ${n0(dmRef)} · разница ${n0(Math.abs(dmDiff))}` : hasReport && isPlain ? `Report на ${reportDate}: ${n0(reportStock)} · разница ${n0(Math.abs(diff))}` : "приход − продано",
      how: <><p>Расчётный остаток = приход − продано нарастающим итогом на конец периода{opening ? ` (на начало периода: ${n0(opening)} шт.)` : ""}.</p>{dmStock && dmRef !== null && isPlain ? <p className="mt-1">Остаток по витрине datamart (по нашим заказам): {dmStock.snapshots.map((x) => `${x.date.split("-").reverse().join(".")} — ${n0(ui.f.cat === "clothes" ? x.rtw : ui.f.cat === "acc" ? x.acc : x.total)} шт.`).join(", ")}. Расчёт на {dmDate}: {n0(stockEnd)} шт., разница {n0(Math.abs(dmDiff))} шт.</p> : null}{hasReport && isPlain ? <p className="mt-1">В отчёте о товарах (Report) на {reportDate} остаток {n0(reportStock)} шт., расчёт даёт {n0(stockEnd)} шт.: {diff === 0 ? "совпадает" : `разница ${n0(Math.abs(diff))} шт.`}. Причина в выгрузке не видна.</p> : null}</>,
      cols: [{ head: "Приход", get: (e) => n0(e.received) }, { head: "Продано", get: (e) => n0(e.sold) }, { head: "Остаток", get: (e) => n0(e.stock) }] },
    { id: "sellThrough", label: "SO", value: pct(head.sellThrough), sub: "продано ÷ получено",
      how: <p>SO = продано ÷ получено, единицы за период. Без обрезки до 100 %: больше 100 % значит, что продажи включают остатки других поступлений. Приход 0 — «—».</p>,
      cols: [{ head: "Приход", get: (e) => n0(e.received) }, { head: "Продано", get: (e) => n0(e.sold) }, { head: "SO", get: (e) => pct(e.sellThrough) }] },
  ];
  // Цепочка по фактам владельца: заказано (все ТЗ без ремонта) → получено в рознице (приход) → продано → остаток. То, что не получено, считаем «в производстве»
  // (статус по таким изделиям не знаем); получено = отгружено и принято, поэтому отдельной «готовой продукции на складе ателье» в этой цепочке нет.
  const ordered = chain.produced + chain.inWork;
  const inProd = Math.max(0, ordered - head.received);
  type Link_ = { id: string; label: string; value: string; sub?: string; how: React.ReactNode; to: string[][] };
  const links = ([
    { id: "produced", label: "Произведено", value: n0(head.received), sub: `заказано ${n0(ordered)} · в производстве ${n0(inProd)} (завершены по ТЗ, но не получены ${n0(chain.inProdDone)} · в работе и запланированы ${n0(chain.inProdWork)})`, how: <><p>Произведено = получено в рознице по файлу прихода: {n0(head.received)} шт. Заказано по всем ТЗ (без ремонта): {n0(ordered)} шт.</p><p className="mt-1">Остальное ({n0(inProd)} шт.) считаем изделиями в производстве: статус по ним неизвестен, в «Произведено» они не входят.</p></>, to: [["/production", "Открыть ТЗ"]] },
    { id: "shipped", label: "Отгружено и получено", value: n0(head.received), sub: "приход в рознице", how: <p>Всё, что получено, отгружено и принято: {n0(head.received)} шт. по файлу прихода (все даты приёмок — в разделе «Отгрузки и календарь»).</p>, to: [["/shipments", "Отгрузки и календарь"]] },
    { id: "sold", label: "Продано", value: n0(head.sold), sub: `остаток ${n0(stockEnd)}`, how: <p>Продано (нетто возвратов) из полученного. Остаток в рознице = приход {n0(head.received)} − продано {n0(head.sold)}.</p>, to: [["/sales", "Продажи и остатки"]] },
  ] as Link_[]);
  const openLink = links.find((x) => x.id === link);
  const openDef = tiles.find((t) => t.id === tile);

  const quick: { key: string; label: string; f: Partial<Filters> }[] = [
    { key: "all", label: "Всё", f: { from: null, to: null } },
    { key: "2025", label: "2025", f: { from: "2025-01-01", to: "2025-12-31" } },
    { key: "2026", label: "2026", f: { from: "2026-01-01", to: "2026-12-31" } },
    { key: "30", label: "30 дней", f: { from: addDays(today, -29), to: today } },
    { key: "90", label: "90 дней", f: { from: addDays(today, -89), to: today } },
  ];
  const activeQuick = quick.find((q) => (q.f.from ?? null) === ui.f.from && (q.f.to ?? null) === ui.f.to)?.key ?? null;
  const filtered = JSON.stringify(ui.f) !== JSON.stringify(NO_FILTERS) || ui.vat !== DEFAULT_UI.vat;
  const periodNote = ui.f.from || ui.f.to ? `${dateRu(ui.f.from)}–${dateRu(ui.f.to)}` : "всё время";
  const note = `${periodNote} · ${CAT_LABEL[ui.f.cat]}${ui.f.q ? ` · «${ui.f.q}»` : ""} · ${vatNote} · ${lines.length} строк`;

  if (all.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Продажи и остатки</h1>
        <p className="rounded-lg border border-neutral-300 bg-white p-3 text-sm text-neutral-800">Нет данных о продажах: выгрузка поступлений и продаж ещё не загружена.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Продажи и остатки</h1>
        <div className="flex flex-wrap items-center gap-1 text-sm">
          
          <InfoHint label="Что такое Продажи и остатки" align="right" wide><p>Всё по товару: что и когда пришло, продалось и осталось. Источник — выгрузка «поступления и продажи» и отчёт о товарах на {reportDate}; остаток = получено − продано.</p></InfoHint>
        </div>
      </div>

      <div id="sales-filters" className="sticky top-0 z-20 -mx-3 border-b border-neutral-300 bg-white/95 px-3 py-1 backdrop-blur print:hidden md:-mx-4 md:px-4">
        <button type="button" aria-expanded={fOpen} aria-controls="sales-filters-panel" onClick={() => setFOpen((v) => !v)} className="flex min-h-11 w-full items-center justify-between text-left text-sm md:hidden">
          <span><b>Фильтры:</b> {periodNote} · {CAT_LABEL[ui.f.cat]} · {vatNote}</span><span aria-hidden>{fOpen ? "▴" : "▾"}</span>
        </button>
        <div id="sales-filters-panel" className={(fOpen ? "flex" : "hidden") + " flex-wrap items-center gap-2 pb-1 md:flex md:pb-0"}>
          <nav aria-label="Период" className={segGroup}>
            {quick.map((q) => <button key={q.key} type="button" aria-pressed={activeQuick === q.key} onClick={() => setF(q.f)} className={seg(activeQuick === q.key)}>{q.label}</button>)}
          </nav>
          <label className="flex items-center gap-1 text-xs text-neutral-700">С
            <input type="date" value={ui.f.from ?? ""} onChange={(e) => setF({ from: e.target.value || null })} className="min-h-11 rounded-md border border-neutral-300 px-2 text-sm" aria-label="Период с даты" />
          </label>
          <label className="flex items-center gap-1 text-xs text-neutral-700">по
            <input type="date" value={ui.f.to ?? ""} onChange={(e) => setF({ to: e.target.value || null })} className="min-h-11 rounded-md border border-neutral-300 px-2 text-sm" aria-label="Период по дату" />
          </label>
          <div role="group" aria-label="НДС" className={segGroup}>
            <button type="button" aria-pressed={!ex} onClick={() => { patch({ vat: "in" }); vatDisp.setMode("incl"); }} className={seg(!ex)}>С НДС</button>
            <button type="button" aria-pressed={ex} onClick={() => { patch({ vat: "ex" }); vatDisp.setMode("excl"); }} className={seg(ex)}>Без НДС</button>
          </div>
          <div role="group" aria-label="Категория 1" className={segGroup}>
            {(["all", "clothes", "acc"] as Cat[]).map((k) => <button key={k} type="button" aria-pressed={ui.f.cat === k} onClick={() => setF({ cat: k })} className={seg(ui.f.cat === k)}>{CAT_LABEL[k]}</button>)}
          </div>
          <MultiPick label="Категория 2" options={cat2s} value={ui.f.cat2} onChange={(v) => setF({ cat2: v })} />
          <MultiPick label="Мех" options={furs} value={ui.f.furs} onChange={(v) => setF({ furs: v })} />
          <MultiPick label="Сезон" options={seasons} value={ui.f.seasons} onChange={(v) => setF({ seasons: v })} />
          <input type="search" value={ui.f.q} onChange={(e) => setF({ q: e.target.value })} placeholder="Артикул, модель, цвет, заказ" aria-label="Поиск по артикулу, модели, цвету, заказу" className="min-h-11 w-56 max-w-full rounded-md border border-neutral-300 px-3 text-sm" />
          <button type="button" disabled={!filtered} onClick={() => setUi((u) => ({ ...u, f: NO_FILTERS, vat: DEFAULT_UI.vat }))} className={btn + " disabled:opacity-50"}>Сбросить</button>
        </div>
      </div>

      <nav aria-label="Разделы" role="tablist" className={segGroup + " self-start"}>
        {TABS.map((t) => <button key={t.key} type="button" role="tab" aria-selected={ui.tab === t.key} onClick={() => patch({ tab: t.key as Tab })} className={seg(ui.tab === t.key)}>{t.label}</button>)}
      </nav>

      {lines.length === 0 ? (
        <p className="rounded-lg border border-neutral-300 bg-white p-3 text-sm text-neutral-800">По выбранным фильтрам строк нет. Измените период, категорию или поиск.</p>
      ) : ui.tab === "overview" ? (
        <>
          <div>
            <button type="button" aria-expanded={ui.chain} onClick={() => patch({ chain: !ui.chain })} className={btn}>{ui.chain ? "Скрыть цепочку от производства ▴" : "Показать цепочку от производства ▾"}</button>
          </div>
          {ui.chain && <section aria-label="Цепочка от производства до остатка в рознице" className="flex flex-wrap items-stretch gap-1">
            {links.map((x, i) => (
              <div key={x.id} className="flex min-w-0 flex-1 basis-32 items-center gap-1">
                <button type="button" onClick={() => setLink(x.id)} aria-haspopup="dialog" className="flex min-h-11 min-w-0 flex-1 flex-col items-start rounded-lg border border-neutral-300 bg-white p-2 text-left hover:border-neutral-500">
                  <span className="text-xs text-neutral-700">{x.label}</span>
                  <span className="text-base font-semibold tabular-nums">{x.value}</span>
                  {x.sub ? <span className="text-xs text-neutral-700">{x.sub}</span> : null}
                </button>
                {i < links.length - 1 ? <span aria-hidden className="text-neutral-500">→</span> : null}
              </div>
            ))}
          </section>}
          <section aria-label="Ключевые показатели" className="grid grid-cols-2 items-stretch gap-2 md:grid-cols-4">
            {tiles.map((t) => <Tile key={t.id} def={t} onOpen={setTile} />)}
          </section>
          <SalesCharts buckets={buckets} gran={ui.gran} onGran={(g) => { patch({ gran: g }); setHot(null); }} hot={hot} setHot={setHot} />
          <SalesTree input={input} lines={lines} env={env} vat={ui.vat} cat={ui.f.cat} sizes={sizes} photos={photos} struct={ui.struct} onStruct={(s) => patch({ struct: s })}
            picked={ui.cols} onPicked={(k) => patch({ cols: k })} filtersNote={note} />
        </>
      ) : ui.tab === "seasons" ? (
        <SeasonsTab ctx={ctx} env={env} lines={lines} vatNote={vatNote} gran={ui.gran} onGran={(g) => patch({ gran: g })} ex={ex} />
      ) : ui.tab === "stock" ? (
        <StockTab ctx={ctx} env={env} lines={lines} vatNote={vatNote} photos={photos} today={today} />
      ) : ui.tab === "top" ? (
        <TopTab ctx={ctx} env={env} lines={lines} vatNote={vatNote} photos={photos} />
      ) : null}

      {openLink && (
        <SalesModal title={openLink.label} subtitle="Произведено → Отгружено и получено → Продано → Остаток" onClose={() => setLink(null)}>
          <div className="text-sm text-neutral-800">{openLink.how}</div>
          <p className="text-3xl font-semibold tabular-nums">{openLink.value}</p>
          <div className="flex flex-wrap gap-2">{openLink.to.map(([h, t]) => <Link key={h} href={h} className={btn}>{t} →</Link>)}</div>
        </SalesModal>
      )}
      {openDef && (
        <SalesModal title={openDef.label} subtitle={`${note}`} onClose={() => setTile(null)}>
          <div className="text-sm text-neutral-800">{openDef.how}</div>
          <p className="text-3xl font-semibold tabular-nums">{openDef.value}</p>
          <h3 className="text-sm font-semibold">По сезонам</h3>
          <MiniTable head={["Сезон", ...openDef.cols.map((c) => c.head)]} rows={bySeason.map((b) => [b.label, ...openDef.cols.map((c) => c.get(b.m))])} total={["Всего", ...openDef.cols.map((c) => c.get(head))]} />
          {openDef.id === "received" && (
            <>
              <h3 className="text-sm font-semibold">По заказам</h3>
              <MiniTable head={["Заказ", "Получено, шт."]} rows={byOrder.map((g) => [`№${g.label}`, n0(g.m.received)])} total={["Всего", n0(head.received)]} />
              <p className="text-sm text-neutral-800">Из них отгружено ателье: {n0(chain.shipped)} шт. → принято по приёмке: {n0(chain.accepted)} шт. (отгрузок: {chain.shipments}).</p>
              <div className="flex flex-wrap gap-2"><Link href="/shipments" className={btn}>Отгрузки →</Link><Link href="/production" className={btn}>ТЗ →</Link></div>
            </>
          )}
          <h3 className="text-sm font-semibold">По категориям</h3>
          <MiniTable head={["Категория 1", ...openDef.cols.map((c) => c.head)]} rows={byCls.map((b) => [b.label, ...openDef.cols.map((c) => c.get(b.m))])} total={["Всего", ...openDef.cols.map((c) => c.get(head))]} />
          {openDef.id === "stock" && dmRef !== null && isPlain ? (
            <p className="text-sm text-neutral-800">datamart на {dmDate}: {n0(dmRef)} шт. · расчёт: {n0(stockEnd)} шт. · разница: {dmDiff === 0 ? DASH : n0(Math.abs(dmDiff)) + " шт."}. Снимки: {dmStock!.snapshots.map((x) => `${x.date.split("-").reverse().join(".")} — ${n0(ui.f.cat === "clothes" ? x.rtw : ui.f.cat === "acc" ? x.acc : x.total)}`).join(", ")}.</p>
          ) : null}
          {openDef.id === "stock" && hasReport && isPlain ? (
            <p className="text-sm text-neutral-800">Report на {reportDate}: {n0(reportStock)} шт. · расчёт: {n0(stockEnd)} шт. · разница: {diff === 0 ? DASH : n0(Math.abs(diff)) + " шт."}. Причина в выгрузке не видна.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={() => { setTile(null); patch({ tab: "stock" }); }}>Остатки по артикулам</button>
            <button type="button" className={btn} onClick={() => { setTile(null); patch({ tab: "seasons" }); }}>Динамика по сезонам</button>
          </div>
        </SalesModal>
      )}
    </div>
  );
}
