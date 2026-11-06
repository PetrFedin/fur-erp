"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloseX, chip } from "./catalog-ui";
import { CatalogReport, type ReportData } from "./catalog-report";

/** Каталог «как в магазине»: карточки с фото, под фото — сезоны (заказ · пришло · остаток); тап по подписи открывает детализацию. Данные готовит SeasonReport. */
export type CatalogPhoto = { id: string; variant: string };
/** Строка сезона под фото: заказ · пришло · продано · остаток · выручка (тыс. ₽). pairs — таблица SSN (за сезон) / TTL (всего) в детализации; showTtl=false у идущего сезона. */
export type CatalogSeason = {
  key: string; label: string; short: string;
  conf: number; deliv: number; sold: number; stock: number; rubK: number;
  /** TTL (всего) показываем только если он отличается от SSN (за сезон): у идущего сезона и там, где всё продано внутри сезона, колонки TTL нет. */
  showTtl: boolean; common: [string, string][]; pairs: { k: string; ssn: string; ttl: string }[];
};
export type CatalogItem = {
  id: string; title: string; fur: string; category: string; cls: "clothes" | "acc" | "other";
  modelId: string | null; photos: CatalogPhoto[];
  /** Розничная цена сейчас и маркап по ней — под фото на карточке. */
  retailNow: string | null; markupNow: string | null;
  /** Цена сейчас, себестоимость, маркап по цене сейчас, остаток сейчас — строки шапки детализации. */
  facts: [string, string][];
  seasons: CatalogSeason[];
  /** Остаток по цветам и размерам: «Чёрный — 5 шт. · 42: 2, 44: 3». */
  stockBy: { label: string; stock: number; sizes: string }[];
};
export type SeasonOption = { key: string; label: string };

const photoSrc = (modelId: string, id: string, thumb: boolean) => `/api/article-photos/${modelId}/${id}${thumb ? "?size=thumb" : ""}`;
const CLS_LABEL: Record<CatalogItem["cls"], string> = { clothes: "Одежда", acc: "Аксессуары", other: "Прочее" };
const n0 = (v: number) => Math.round(v).toLocaleString("ru-RU");
/** Ячейки без «0»: пусто — тире, чтобы строка читалась быстрее. */
const cell = (v: number) => (Math.abs(v) < 0.5 ? "–" : n0(v));


/** Под названием: Retail Price сейчас; ниже MU (маркап), SO (продано ÷ заказано по сезонам) и тотал NS (выручка по сезонам, тыс. ₽). */
function CardKpis({ item }: { item: CatalogItem }) {
  const t = item.seasons.reduce((a, s) => ({ conf: a.conf + s.conf, sold: a.sold + s.sold, rubK: a.rubK + s.rubK }), { conf: 0, sold: 0, rubK: 0 });
  const so = t.conf > 0 ? `${Math.round((t.sold / t.conf) * 100)} %` : "–";
  const stat = (cap: string, val: string, title: string) => (
    <span className="flex min-w-0 flex-col" title={title}><span className="text-[11px] leading-4 text-neutral-500">{cap}</span><b className="truncate text-xs font-semibold">{val}</b></span>
  );
  return (
    <span className="flex flex-col gap-1 tabular-nums">
      <b className="text-xs">{item.retailNow ?? "–"}</b>
      <span className="grid grid-cols-[auto_auto_1fr] gap-x-3">
        {stat("MU", item.markupNow ?? "–", "Маркап по цене сейчас")}
        {stat("SO", so, "Продано ÷ заказано")}
        {stat("NS", cell(t.rubK), "Выручка по сезонам, тысяч рублей")}
      </span>
    </span>
  );
}

const COLS = "grid-cols-[2rem_repeat(4,minmax(0,1fr))]";
/** Под фото: заголовок и по сезону — строка «сезон · заказ · пришло · продано · остаток» и под ней выручка в тыс. ₽ (kRUR); внизу TTL по всем сезонам. */
function SeasonLines({ item }: { item: CatalogItem }) {
  const tot = item.seasons.reduce((a, s) => ({ conf: a.conf + s.conf, deliv: a.deliv + s.deliv, sold: a.sold + s.sold, stock: a.stock + s.stock, rubK: a.rubK + s.rubK }), { conf: 0, deliv: 0, sold: 0, stock: 0, rubK: 0 });
  const H = "text-right text-[11px] leading-4 tracking-tighter text-neutral-500";
  const block = (key: string, label: string, v: { conf: number; deliv: number; sold: number; stock: number; rubK: number }, strong = false) => (
    <div key={key} className={"border-t pb-0.5 tabular-nums " + (strong ? "border-neutral-300 font-semibold" : "border-neutral-100")}>
      <div className={`grid ${COLS} items-baseline gap-x-1.5 text-[11px] leading-5`}>
        <span className="truncate text-neutral-700">{label}</span>
        <span className="text-right">{cell(v.conf)}</span><span className="text-right">{cell(v.deliv)}</span><span className="text-right">{cell(v.sold)}</span><span className="text-right font-semibold">{cell(v.stock)}</span>
      </div>
      {strong ? null : <div className="text-right text-[11px] leading-4 text-neutral-600" title="NS — выручка после скидок, тысяч рублей">NS {cell(v.rubK)}</div>}
    </div>
  );
  return (
    <div className="mt-auto pt-1" role="group" aria-label="Сезоны: заказано, пришло, продано, остаток; ниже выручка в тысячах рублей">
      <div className={`grid ${COLS} gap-x-1.5`}>
        <span /><span className={H} title="Заказано, шт.">Зак</span><span className={H} title="Пришло, шт.">При</span><span className={H} title="Продано, шт.">Про</span><span className={H} title="Остаток, шт.">Ост</span>
      </div>
      {item.seasons.map((s) => block(s.key, s.short, s))}
      {item.seasons.length > 1 ? block("ttl", "TTL", tot, true) : null}
    </div>
  );
}

/** Горизонтальная лента фото со свайпом (scroll-snap). Тап по фото или кнопка-лупа — увеличить, не открывая карточку. */
function Carousel({ item, onZoom, ratio = "aspect-[3/4]" }: { item: CatalogItem; onZoom: (i: number) => void; ratio?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const n = item.photos.length;
  const onScroll = () => { const el = ref.current; if (el && el.clientWidth) setI(Math.round(el.scrollLeft / el.clientWidth)); };
  const go = (d: number) => { const el = ref.current; if (el) el.scrollBy({ left: d * el.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); };
  if (!item.modelId || n === 0) {
    return <div role="img" aria-label="Фото нет" className={`${ratio} flex w-full overflow-hidden items-center justify-center bg-neutral-50 text-sm text-neutral-500`}>Фото нет</div>;
  }
  return (
    <div className={`group relative ${ratio} w-full overflow-hidden bg-neutral-50`}>
      <div ref={ref} onScroll={onScroll} style={{ scrollSnapType: "x mandatory" }} className="flex h-full w-full overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-keep-scroll role="group" aria-roledescription="карусель" aria-label={`Фото: ${item.title}`}>
        {item.photos.map((p, k) => (
          <button key={p.id} type="button" onClick={() => onZoom(k)} aria-label={`Увеличить фото ${k + 1} из ${n}`} className="h-full w-full shrink-0 snap-center cursor-zoom-in">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoSrc(item.modelId!, p.id, true)} alt={k === 0 ? item.title : ""} loading={k === 0 ? "eager" : "lazy"} decoding="async" draggable={false} className="h-full w-full object-contain" />
          </button>
        ))}
      </div>
      {n > 1 ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1" aria-hidden>
            {item.photos.map((p, k) => <span key={p.id} className={"h-1.5 rounded-full bg-white/90 shadow transition-all " + (k === i ? "w-4" : "w-1.5 opacity-70")} />)}
          </div>
          <button type="button" onClick={() => go(-1)} aria-label="Предыдущее фото" className="absolute left-1 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-lg shadow md:group-hover:flex">‹</button>
          <button type="button" onClick={() => go(1)} aria-label="Следующее фото" className="absolute right-1 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-lg shadow md:group-hover:flex">›</button>
        </>
      ) : null}
      <button type="button" onClick={() => onZoom(i)} aria-label="Увеличить фото" className="absolute right-1 top-1 flex size-11 items-center justify-center rounded-full bg-white/85 shadow">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.2-4.2M11 8.5v5M8.5 11h5" /></svg>
      </button>
    </div>
  );
}

/** Полноэкранный просмотр: листание вправо-влево, тап по фото — приблизить/вернуть. */
function Lightbox({ item, start, onClose }: { item: CatalogItem; start: number; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(start);
  const [zoomed, setZoomed] = useState<number | null>(null);
  useEffect(() => {
    const d = dlg.current; if (!d) return;
    if (!d.open) d.showModal();
    const el = strip.current; if (el) el.scrollTo({ left: start * el.clientWidth });
  }, [start]);
  const onScroll = () => { const el = strip.current; if (el && el.clientWidth) setI(Math.round(el.scrollLeft / el.clientWidth)); };
  return (
    <dialog ref={dlg} onClose={onClose} onClick={(e) => { if (e.target === dlg.current) onClose(); }} className="m-0 h-dvh max-h-none w-screen max-w-none bg-black p-0 text-white backdrop:bg-black">
      <div ref={strip} onScroll={onScroll} style={{ scrollSnapType: "x mandatory" }} data-keep-scroll className={"flex h-full w-full overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden " + (zoomed === null ? "overflow-x-auto" : "overflow-hidden")}>
        {item.photos.map((p, k) => (
          <div key={p.id} className={"h-full w-full shrink-0 snap-center " + (zoomed === k ? "overflow-auto" : "overflow-hidden")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoSrc(item.modelId!, p.id, false)} alt={`${item.title}, фото ${k + 1}`} draggable={false} onClick={() => setZoomed(zoomed === k ? null : k)}
              className={zoomed === k ? "h-auto w-[220%] max-w-none cursor-zoom-out" : "h-full w-full cursor-zoom-in object-contain"} />
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-2">
        <p className="min-w-0 truncate pl-2 text-sm">{item.title} · {i + 1}/{item.photos.length}</p>
        <CloseX onClick={onClose} dark />
      </div>
    </dialog>
  );
}

/** Одна таблица на все сезоны модели: у каждого сезона колонка SSN (за сезон) и рядом TTL (всего) — TTL только если отличается от SSN (у идущего сезона его нет). */
function SeasonTable({ seasons }: { seasons: CatalogSeason[] }) {
  const cols = seasons.flatMap((s) => [{ s, kind: "ssn" as const }, ...(s.showTtl ? [{ s, kind: "ttl" as const }] : [])]);
  const commonKeys = [...new Set(seasons.flatMap((s) => s.common.map(([k]) => k)))];
  const pairKeys = [...new Set(seasons.flatMap((s) => s.pairs.map((p) => p.k)))];
  const grid = { gridTemplateColumns: `minmax(0,1fr) repeat(${cols.length}, minmax(2.6rem, auto))` };
  const common = (k: string, c: (typeof cols)[number]) => (c.kind === "ssn" ? c.s.common.find(([kk]) => kk === k)?.[1] ?? "–" : "");
  const pair = (k: string, c: (typeof cols)[number]) => { const p = c.s.pairs.find((x) => x.k === k); return p ? (c.kind === "ssn" ? p.ssn : p.ttl) : "–"; };
  const cellCls = "border-b border-neutral-100 py-1.5 pl-2 text-right text-[13px]";
  return (
    <div role="table" aria-label="Показатели по сезонам" className="grid text-sm tabular-nums" style={grid}>
      <div role="row" className="contents">
        <span role="columnheader" className="py-1 text-[11px] text-neutral-500">тыс. ₽, шт.</span>
        {seasons.map((s) => <span role="columnheader" key={s.key} style={{ gridColumn: `span ${s.showTtl ? 2 : 1}` }} className="border-b border-neutral-300 py-1 pl-2 text-right text-xs font-semibold text-neutral-800">{s.short}</span>)}
      </div>
      <div role="row" className="contents">
        <span role="columnheader" />
        {cols.map((c) => <span role="columnheader" key={c.s.key + c.kind} title={c.kind === "ssn" ? "За сезон" : "Всего"} className="py-0.5 pl-2 text-right text-[11px] font-medium text-neutral-500">{c.kind === "ssn" ? "SSN" : "TTL"}</span>)}
      </div>
      {commonKeys.map((k) => (
        <div role="row" key={"c" + k} className="contents">
          <span role="rowheader" className="border-b border-neutral-100 py-1.5 pr-2 text-neutral-600">{k}</span>
          {cols.map((c) => <span role="cell" key={c.s.key + c.kind} className={cellCls}>{common(k, c)}</span>)}
        </div>
      ))}
      {pairKeys.map((k) => (
        <div role="row" key={"p" + k} className="contents">
          <span role="rowheader" className="border-b border-neutral-100 py-1.5 pr-2 text-neutral-600">{k}</span>
          {cols.map((c) => <span role="cell" key={c.s.key + c.kind} className={cellCls}>{pair(k, c)}</span>)}
        </div>
      ))}
    </div>
  );
}

/** Детализация карточки: фото, цена/себестоимость/маркап/остаток, показатели по каждому сезону, остаток по цветам и размерам. */
function Detail({ item, onZoom, onClose }: { item: CatalogItem; onZoom: (i: number) => void; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = dlg.current; if (d && !d.open) d.showModal(); }, []);
  return (
    <dialog ref={dlg} onClose={onClose} className="m-0 h-dvh max-h-none w-screen max-w-none bg-white p-0 text-neutral-900 md:mx-auto md:my-4 md:h-[calc(100dvh-2rem)] md:w-[min(56rem,100vw-2rem)] md:rounded-2xl">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2">
          <p className="min-w-0 truncate text-sm font-semibold">{item.title}</p>
          <CloseX onClick={onClose} />
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain md:grid md:grid-cols-[22rem_1fr]">
          <div className="md:sticky md:top-0 md:self-start">
            <div className="mx-auto w-full max-w-[18rem] md:max-w-none"><Carousel item={item} onZoom={onZoom} ratio="aspect-[3/4]" /></div>
          </div>
          <div className="flex flex-col gap-4 p-3">
            <div>
              <p className="text-xs text-neutral-500">{item.fur} · {item.category}</p>
              <p className="text-lg font-semibold leading-snug">{item.title}</p>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                {item.facts.map(([k, v]) => <div key={k} className="contents"><dt className="text-neutral-600">{k}</dt><dd className="text-right font-semibold tabular-nums">{v}</dd></div>)}
              </dl>
            </div>
            <SeasonTable seasons={item.seasons} />
            {item.stockBy.length ? (
              <section aria-label="Остаток по цветам и размерам">
                <h3 className="mb-1 text-sm font-semibold">Остаток по цветам и размерам</h3>
                <ul className="border-t border-neutral-200 text-sm">
                  {item.stockBy.map((c) => (
                    <li key={c.label} className="border-b border-neutral-100 py-1.5">
                      <div className="flex justify-between gap-3"><span>{c.label}</span><span className="font-semibold tabular-nums">{n0(c.stock)} шт.</span></div>
                      {c.sizes ? <p className="text-xs text-neutral-600">{c.sizes}</p> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </dialog>
  );
}

/** Окно фильтров: сезоны (можно несколько), тип меха, поиск. Закрывается кнопкой «Показать N» — карточки меняются сразу. */
function FiltersDialog({ seasonOptions, picked, onToggleSeason, furs, furPick, onFur, q, onQ, total, onClose, vatEx, onVat }: {
  vatEx: boolean; onVat?: (ex: boolean) => void;
  seasonOptions: SeasonOption[]; picked: string[]; onToggleSeason: (key: string) => void; furs: string[]; furPick: string; onFur: (f: string) => void; q: string; onQ: (v: string) => void; total: number; onClose: () => void;
}) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = dlg.current; if (d && !d.open) d.showModal(); }, []);
  return (
    <dialog ref={dlg} onClose={onClose} onClick={(e) => { if (e.target === dlg.current) onClose(); }} className="m-0 mt-auto max-h-[85dvh] w-screen max-w-none rounded-t-2xl bg-white p-0 text-neutral-900 md:mx-auto md:my-auto md:w-[28rem] md:rounded-2xl">
      <div className="flex max-h-[85dvh] flex-col">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
          <p className="text-base font-semibold">Фильтры</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { for (const s of seasonOptions) if (!picked.includes(s.key)) onToggleSeason(s.key); onFur("all"); onQ(""); }} className="inline-flex min-h-11 items-center text-sm text-neutral-600 underline">Сбросить</button>
            <CloseX onClick={onClose} />
          </div>
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          {onVat ? <section aria-label="НДС"><h3 className="mb-2 text-sm font-semibold">НДС</h3>
            <div className="flex gap-2">{([[false, "С НДС"], [true, "Без НДС"]] as const).map(([ex, t]) => <button key={t} type="button" aria-pressed={vatEx === ex} onClick={() => onVat(ex)} className={chip(vatEx === ex)}>{t}</button>)}</div>
          </section> : null}
          <section aria-label="Сезоны"><h3 className="mb-2 text-sm font-semibold">Сезоны</h3>
            <div className="flex flex-wrap gap-2">{seasonOptions.map((s) => <button key={s.key} type="button" aria-pressed={picked.includes(s.key)} onClick={() => onToggleSeason(s.key)} className={chip(picked.includes(s.key))}>{s.label}</button>)}</div>
          </section>
          <section aria-label="Тип меха"><h3 className="mb-2 text-sm font-semibold">Тип меха</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={furPick === "all"} onClick={() => onFur("all")} className={chip(furPick === "all")}>Весь мех</button>
              {furs.map((f) => <button key={f} type="button" aria-pressed={furPick === f} onClick={() => onFur(f)} className={chip(furPick === f)}>{f}</button>)}
            </div>
          </section>
          <section aria-label="Поиск"><h3 className="mb-2 text-sm font-semibold">Поиск</h3>
            <input type="search" value={q} onChange={(e) => onQ(e.target.value)} placeholder="Артикул, мех, категория, цвет" aria-label="Поиск" className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-base" />
          </section>
        </div>
        <div className="border-t border-neutral-200 p-3">
          <button type="button" onClick={onClose} className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-neutral-900 px-4 text-sm font-medium text-white">Показать {total}</button>
        </div>
      </div>
    </dialog>
  );
}

export function CatalogCards({ items, seasonOptions, picked, onToggleSeason, furs, furPick, onFur, q, onQ, vatEx = false, onVat, report }: {
  vatEx?: boolean; onVat?: (ex: boolean) => void; report?: ReportData;
  items: CatalogItem[]; seasonOptions: SeasonOption[]; picked: string[]; onToggleSeason: (key: string) => void;
  furs: string[]; furPick: string; onFur: (f: string) => void; q: string; onQ: (v: string) => void;
}) {
  const [cat, setCat] = useState<"all" | "clothes" | "acc">("all");
  const [filters, setFilters] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const activeFilters = (picked.length < seasonOptions.length ? 1 : 0) + (furPick !== "all" ? 1 : 0) + (q.trim() ? 1 : 0);
  const [open, setOpen] = useState<CatalogItem | null>(null);
  const [zoom, setZoom] = useState<{ item: CatalogItem; i: number } | null>(null);
  const counts = useMemo(() => ({ all: items.length, clothes: items.filter((x) => x.cls === "clothes").length, acc: items.filter((x) => x.cls === "acc").length }), [items]);
  const shown = useMemo(() => items.filter((x) => cat === "all" || x.cls === cat), [items, cat]);
  const groups = (["clothes", "acc", "other"] as const).map((c) => ({ c, list: shown.filter((x) => x.cls === c) })).filter((g) => g.list.length);
  const closeZoom = useCallback(() => setZoom(null), []);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Каталог</h1>
        {report ? (
          <button type="button" onClick={() => setReportOpen(true)} aria-haspopup="dialog" className={chip(false) + " gap-2"}>
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 5h16v14H4zM4 10h16M10 5v14" /></svg>
            Отчёт
          </button>
        ) : null}
      </div>
      <div className="sticky top-0 z-20 -mx-3 flex items-center gap-2 border-b border-neutral-200 bg-white/95 px-3 py-2 backdrop-blur">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-keep-scroll role="group" aria-label="Категория">
          {([["all", "Все"], ["clothes", "Одежда"], ["acc", "Аксессуары"]] as const).map(([k, t]) => (
            <button key={k} type="button" aria-pressed={cat === k} onClick={() => setCat(k)} className={chip(cat === k) + " !px-3.5"} aria-label={`${t}: ${counts[k]}`}>{t}</button>
          ))}
        </div>
        {onVat ? (
          <div className="flex shrink-0 gap-1" role="group" aria-label="НДС">
            {([[false, "С НДС"], [true, "Без НДС"]] as const).map(([ex, t]) => <button key={t} type="button" aria-pressed={vatEx === ex} onClick={() => onVat(ex)} className={chip(vatEx === ex) + " !px-3 max-[430px]:hidden"}>{t}</button>)}
          </div>
        ) : null}
        <button type="button" onClick={() => setFilters(true)} className={chip(activeFilters > 0) + " gap-1.5 max-[430px]:!px-3"} aria-haspopup="dialog" aria-label="Фильтры">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
          <span className="max-[430px]:sr-only">Фильтры</span>{activeFilters > 0 ? <span className="rounded-full bg-white px-1.5 text-xs font-semibold text-neutral-900">{activeFilters}</span> : null}
        </button>
      </div>

      {groups.length === 0 ? <p className="py-8 text-center text-sm text-neutral-600">По выбранным фильтрам ничего нет</p> : null}
      {groups.map(({ c, list }) => (
        <section key={c} aria-label={CLS_LABEL[c]}>
          <h2 className="mb-2 text-base font-semibold">{CLS_LABEL[c]} <span className="text-sm font-normal text-neutral-500">{list.length}</span></h2>
          <ul className="grid auto-rows-fr grid-cols-2 gap-2 sm:justify-start sm:gap-3 sm:[grid-template-columns:repeat(auto-fill,minmax(180px,210px))]">
            {list.map((it) => (
              <li key={it.id} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white">
                <Carousel item={it} onZoom={(i) => setZoom({ item: it, i })} />
                <button type="button" onClick={() => setOpen(it)} aria-label={`Подробнее: ${it.title}`} className="flex flex-1 flex-col gap-1 p-2 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-neutral-900">
                  <span className="truncate text-[11px] text-neutral-500">{it.fur} · {it.category}</span>
                  <span className="line-clamp-2 min-h-10 text-sm font-medium leading-5 [overflow-wrap:anywhere]">{it.title}</span>
                  <CardKpis item={it} />
                  <SeasonLines item={it} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {reportOpen && report ? <CatalogReport data={report} cat={cat} onClose={() => setReportOpen(false)} /> : null}
      {filters ? <FiltersDialog seasonOptions={seasonOptions} picked={picked} onToggleSeason={onToggleSeason} furs={furs} furPick={furPick} onFur={onFur} q={q} onQ={onQ} total={shown.length} onClose={() => setFilters(false)} vatEx={vatEx} onVat={onVat} /> : null}
      {open ? <Detail item={open} onClose={() => setOpen(null)} onZoom={(i) => setZoom({ item: open, i })} /> : null}
      {zoom ? <Lightbox item={zoom.item} start={zoom.i} onClose={closeZoom} /> : null}
    </div>
  );
}
