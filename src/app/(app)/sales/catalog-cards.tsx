"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloseX, chip } from "./catalog-ui";
import { CatalogReport, type ReportData } from "./catalog-report";
import type { SupplyLeaf } from "@/lib/supply-report";

/** Каталог «как в магазине»: карточки с фото, под фото — сезоны (заказ · пришло · остаток); тап по подписи открывает детализацию. Данные готовит SeasonReport. */
export type CatalogPhoto = { id: string; variant: string };
/** Строка сезона под фото: заказ · пришло · продано · остаток · выручка (тыс. ₽). pairs — таблица SSN (за сезон) / TTL (всего) в детализации; showTtl=false у идущего сезона. */
export type CatalogSeason = {
  key: string; label: string; short: string;
  conf: number; deliv: number; sold: number; stock: number; rubK: number;
  /** TTL (всего) показываем только если он отличается от SSN (за сезон): у идущего сезона и там, где всё продано внутри сезона, колонки TTL нет. */
  showTtl: boolean; common: [string, string][]; pairs: { k: string; label: string; group: string; ssn: string; ttl: string }[];
};
export type CatalogItem = {
  id: string; title: string; fur: string; category: string; cls: "clothes" | "acc" | "other";
  modelId: string | null; photos: CatalogPhoto[];
  /** Розничная цена сейчас и маркап по ней — под фото на карточке. */
  retailNow: string | null; markupNow: string | null;
  /** Цена сейчас, себестоимость, маркап по цене сейчас, остаток сейчас — строки шапки детализации. */
  facts: [string, string][];
  seasons: CatalogSeason[];
  /** Общий TTL по всем показанным сезонам (если их два и больше): суммы и средневзвешенные (цена продажи, маркап по проданному товару этих сезонов). */
  total: { common: [string, string][]; pairs: { k: string; v: string }[] } | null;
  /** Цвета и размеры: заказано, пришло, продано, остаток (по показанным сезонам вместе). */
  colors: { label: string; conf: number; deliv: number; sold: number; stock: number; sizes: { label: string; conf: number; deliv: number; sold: number; stock: number }[] }[];
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
  const stat = (cap: string, val: string, title: string, unit?: string) => (
    <span className="flex min-w-0 flex-col" title={title}><span className="text-[11px] leading-4 text-neutral-500">{cap}</span><b className="whitespace-nowrap text-xs font-semibold">{val}{unit ? <span className="ml-0.5 text-[11px] font-normal text-neutral-600">{unit}</span> : null}</b></span>
  );
  return (
    <span className="flex flex-col gap-1 tabular-nums">
      <b className="text-xs">{item.retailNow ?? "–"}</b>
      <span className="grid grid-cols-[auto_auto_1fr] gap-x-2">
        {stat("MU", item.markupNow ?? "–", "Маркап по цене сейчас")}
        {stat("SO", so, "Продано ÷ заказано")}
        {stat("NS", cell(t.rubK), "Выручка по сезонам, тысяч рублей", t.rubK >= 0.5 ? "kRUR" : undefined)}
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
      {strong ? null : <div className="text-right text-[11px] leading-4 text-neutral-600" title="NS — выручка после скидок, тысяч рублей">NS {cell(v.rubK)}{v.rubK >= 0.5 ? " kRUR" : ""}</div>}
    </div>
  );
  return (
    <div className="mt-auto pt-1" role="group" aria-label="Сезоны: заказано, пришло, продано, остаток; ниже выручка в тысячах рублей">
      <div className={`grid ${COLS} gap-x-1.5`}>
        <span /><span className={H} title="Заказано, шт.">Зак</span><span className={H} title="Пришло, шт.">При</span><span className={H} title="Продано, шт.">Про</span><span className={H} title="Остаток, шт.">Ост</span>
      </div>
      {item.seasons.map((s) => block(s.key, s.short, s))}
      {item.seasons.length > 1 ? block("ttl", "Итого", tot, true) : null}
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

/** Таблица сезонов: у каждого сезона колонка SSN (за сезон), справа ОДИН общий TTL по всем сезонам (суммы и средневзвешенные). Если сезон один — SSN и, если отличается, TTL. */
function SeasonTable({ seasons, total }: { seasons: CatalogSeason[]; total: CatalogItem["total"] }) {
  // «Продано всего» раскрывается: под ним — сколько продано позже по календарным сезонам (по умолчанию свёрнуто).
  const [open, setOpen] = useState(false);
  const PARENT = "all", isKid = (k: string) => k.startsWith("later_");
  type Col = { id: string; head: string; sub: string; ttl: boolean; s?: CatalogSeason };
  const cols: Col[] = [
    ...seasons.flatMap((s) => [{ id: s.key + "ssn", head: s.short, sub: "сезон", ttl: false, s } as Col, ...(!total && s.showTtl ? [{ id: s.key + "ttl", head: s.short, sub: "всего", ttl: true, s } as Col] : [])]),
    ...(total ? [{ id: "total", head: "Итого", sub: "", ttl: true } as Col] : []),
  ];
  const commonKeys = [...new Set([...seasons.flatMap((s) => s.common.map(([k]) => k)), ...(total?.common.map(([k]) => k) ?? [])])];
  const pairKeys = [...new Set(seasons.flatMap((s) => s.pairs.map((p) => p.k)))];
  const grid = { gridTemplateColumns: `minmax(0,1fr) repeat(${cols.length}, minmax(2.6rem, auto))` };
  const common = (k: string, c: Col) => (c.id === "total" ? total?.common.find(([kk]) => kk === k)?.[1] ?? "" : c.ttl ? "" : c.s?.common.find(([kk]) => kk === k)?.[1] ?? "–");
  const pair = (k: string, c: Col) => (c.id === "total" ? total?.pairs.find((p) => p.k === k)?.v ?? "–" : (() => { const p = c.s?.pairs.find((x) => x.k === k); return p ? (c.ttl ? p.ttl : p.ssn) : "–"; })());
  const cellCls = "border-b border-neutral-100 py-1.5 pl-2 text-right text-[13px]";
  const heads: { label: string; span: number }[] = [];
  for (const c of cols) { const last = heads[heads.length - 1]; if (last && last.label === c.head && c.id !== "total") last.span++; else heads.push({ label: c.head, span: 1 }); }
  return (
    <div role="table" aria-label="Показатели по сезонам" className="grid text-sm tabular-nums" style={grid}>
      <div role="row" className="contents">
        <span role="columnheader" className="py-1 text-[11px] text-neutral-500">шт.</span>
        {heads.map((h, i) => <span role="columnheader" key={i} style={{ gridColumn: `span ${h.span}` }} className="border-b border-neutral-300 py-1 pl-2 text-right text-xs font-semibold text-neutral-800">{h.label}</span>)}
      </div>
      <div role="row" className="contents">
        <span role="columnheader" />
        {cols.map((c) => <span role="columnheader" key={c.id} title={c.ttl ? "Всего" : "За сезон"} className="py-0.5 pl-2 text-right text-[11px] font-medium text-neutral-500">{c.sub}</span>)}
      </div>
      {commonKeys.map((k) => (
        <div role="row" key={"c" + k} className="contents">
          <span role="rowheader" className="border-b border-neutral-100 py-1.5 pr-2 text-neutral-600">{k}</span>
          {cols.map((c) => <span role="cell" key={c.id} className={cellCls}>{common(k, c)}</span>)}
        </div>
      ))}
      {pairKeys.map((k, idx) => {
        if (isKid(k) && !open) return null;
        const meta = seasons[0].pairs.find((p) => p.k === k)!, prev = idx > 0 ? seasons[0].pairs.find((p) => p.k === pairKeys[idx - 1]) : null;
        const parent = k === PARENT && pairKeys.some(isKid), kid = isKid(k), newGroup = !prev || prev.group !== meta.group;
        return (
          <Fragment key={"p" + k}>
            {newGroup ? <div role="row" className="contents"><span role="rowheader" style={{ gridColumn: `1 / span ${cols.length + 1}` }} className="mt-2 border-b border-neutral-300 bg-neutral-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">{meta.group}</span></div> : null}
            <div role="row" className="contents">
              <span role="rowheader" className={`border-b border-neutral-100 pr-2 text-neutral-600 ${kid ? "py-1 pl-5 text-[12px] text-neutral-500" : "py-1.5"}`}>
                {parent ? (
                  <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="-my-1.5 flex min-h-11 w-full items-center gap-1.5 text-left">
                    <span aria-hidden className="w-3 text-[10px]">{open ? "▾" : "▸"}</span>{meta.label}
                  </button>
                ) : meta.label}
              </span>
              {cols.map((c) => <span role="cell" key={c.id} className={`${cellCls} ${kid ? "!py-1 text-[12px] text-neutral-500" : ""}`}>{pair(k, c)}</span>)}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Цвета × размеры: заказано, пришло, продано, остаток. Кнопка «Размеры» раскрывает размеры у всех цветов; клик по цвету — только у него. */
function ColorSizes({ colors }: { colors: CatalogItem["colors"] }) {
  const [all, setAll] = useState(false);
  const [one, setOne] = useState<Set<string>>(new Set());
  if (!colors.length) return null;
  const T = colors.reduce((a, c) => ({ conf: a.conf + c.conf, deliv: a.deliv + c.deliv, sold: a.sold + c.sold, stock: a.stock + c.stock }), { conf: 0, deliv: 0, sold: 0, stock: 0 });
  const g = "grid-cols-[minmax(0,1fr)_repeat(4,minmax(2.4rem,auto))]";
  const line = (key: string, label: React.ReactNode, v: { conf: number; deliv: number; sold: number; stock: number }, cls = "") => (
    <div role="row" key={key} className={`grid ${g} items-center gap-x-2 border-b border-neutral-100 text-[13px] tabular-nums ${cls}`}>
      <span role="rowheader" className="min-w-0">{label}</span>
      <span role="cell" className="text-right">{cell(v.conf)}</span><span role="cell" className="text-right">{cell(v.deliv)}</span><span role="cell" className="text-right">{cell(v.sold)}</span><span role="cell" className="text-right font-semibold">{cell(v.stock)}</span>
    </div>
  );
  return (
    <section aria-label="Цвета и размеры">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Цвета и размеры</h3>
        <button type="button" aria-pressed={all} onClick={() => { setAll((v) => !v); setOne(new Set()); }} className={chip(all) + " !min-h-9 !px-3 text-xs"}>Размеры</button>
      </div>
      <div role="table" className="border-t border-neutral-200">
        <div role="row" className={`grid ${g} gap-x-2 py-1 text-[11px] text-neutral-500`}>
          <span role="columnheader" />{["Заказ", "Пришло", "Продано", "Остаток"].map((t) => <span role="columnheader" key={t} className="text-right">{t}</span>)}
        </div>
        {colors.map((c) => {
          const open = all || one.has(c.label), can = c.sizes.length > 0;
          return (
            <div key={c.label}>
              {line("c" + c.label, can ? (
                <button type="button" aria-expanded={open} onClick={() => setOne((x) => { const n = new Set(x); if (n.has(c.label)) n.delete(c.label); else n.add(c.label); return n; })} className="flex min-h-10 w-full items-center gap-1.5 py-1 text-left font-medium">
                  <span aria-hidden className="w-3 text-[10px]">{open ? "▾" : "▸"}</span><span className="truncate">{c.label}</span>
                </button>
              ) : <span className="block py-2 pl-[1.1rem] font-medium">{c.label}</span>, c)}
              {open ? c.sizes.map((z) => line("s" + c.label + z.label, <span className="block py-1.5 pl-7 text-neutral-600">{z.label}</span>, z, "bg-neutral-50")) : null}
            </div>
          );
        })}
        {line("tot", <span className="block py-1.5 pl-[1.1rem] font-semibold">Итого</span>, T, "border-t border-neutral-300 font-semibold")}
      </div>
    </section>
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
            <SeasonTable seasons={item.seasons} total={item.total} />
            <ColorSizes colors={item.colors} />
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

export function CatalogCards({ items, seasonOptions, picked, onToggleSeason, furs, furPick, onFur, q, onQ, vatEx = false, onVat, report, supply = [], embedded = false }: {
  vatEx?: boolean; onVat?: (ex: boolean) => void; report?: ReportData; supply?: SupplyLeaf[]; /** Внутри «Продаж → Сезоны → Карточки с фото»: без заголовка и кнопок отчётов, карточки те же, что в каталоге. */ embedded?: boolean;
  items: CatalogItem[]; seasonOptions: SeasonOption[]; picked: string[]; onToggleSeason: (key: string) => void;
  furs: string[]; furPick: string; onFur: (f: string) => void; q: string; onQ: (v: string) => void;
}) {
  const [cat, setCat] = useState<"all" | "clothes" | "acc">("all");
  const [filters, setFilters] = useState(false);
  const [reportTab, setReportTab] = useState<null | "sales" | "supply">(null);
  const activeFilters = (picked.length < seasonOptions.length ? 1 : 0) + (furPick !== "all" ? 1 : 0) + (q.trim() ? 1 : 0);
  const [open, setOpen] = useState<CatalogItem | null>(null);
  const [zoom, setZoom] = useState<{ item: CatalogItem; i: number } | null>(null);
  const counts = useMemo(() => ({ all: items.length, clothes: items.filter((x) => x.cls === "clothes").length, acc: items.filter((x) => x.cls === "acc").length }), [items]);
  const shown = useMemo(() => items.filter((x) => cat === "all" || x.cls === cat), [items, cat]);
  const groups = (["clothes", "acc", "other"] as const).map((c) => ({ c, list: shown.filter((x) => x.cls === c) })).filter((g) => g.list.length);
  const closeZoom = useCallback(() => setZoom(null), []);
  return (
    <div className="flex flex-col gap-3">
      <div className={embedded ? "hidden" : "flex items-center justify-between gap-2"}>
        <h1 className="text-xl font-semibold">Каталог</h1>
        {report ? (
          <div className="flex gap-2">
            {([["sales", "Продажи"], ["supply", "Поставки"]] as const).map(([k, t]) => (
              <button key={k} type="button" onClick={() => setReportTab(k)} aria-haspopup="dialog" className={chip(false) + " gap-2 !px-3.5"}>
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 5h16v14H4zM4 10h16M10 5v14" /></svg>
                Отчёт: {t.toLowerCase()}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className={embedded ? "hidden" : "sticky top-0 z-20 -mx-3 flex items-center gap-2 border-b border-neutral-200 bg-white/95 px-3 py-2 backdrop-blur"}>
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-keep-scroll role="group" aria-label="Категория">
          {([["all", "Все"], ["clothes", "Одежда"], ["acc", "Аксессуары"]] as const).map(([k, t]) => (
            <button key={k} type="button" aria-pressed={cat === k} onClick={() => setCat(k)} className={chip(cat === k) + " !px-3.5"} aria-label={`${t}: ${counts[k]}`}>{t}</button>
          ))}
        </div>
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

      {reportTab && report ? <CatalogReport key={reportTab} data={report} supply={supply} tab={reportTab} cat={cat} vatEx={vatEx} onVat={onVat} onClose={() => setReportTab(null)} /> : null}
      {filters ? <FiltersDialog seasonOptions={seasonOptions} picked={picked} onToggleSeason={onToggleSeason} furs={furs} furPick={furPick} onFur={onFur} q={q} onQ={onQ} total={shown.length} onClose={() => setFilters(false)} vatEx={vatEx} onVat={onVat} /> : null}
      {open ? <Detail item={open} onClose={() => setOpen(null)} onZoom={(i) => setZoom({ item: open, i })} /> : null}
      {zoom ? <Lightbox item={zoom.item} start={zoom.i} onClose={closeZoom} /> : null}
    </div>
  );
}
