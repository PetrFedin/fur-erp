"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { InfoHint } from "@/components/info-hint";
import { PinSection } from "@/components/pin-section";
import { WidgetRow } from "@/components/widget-row";
import { SalesModal } from "../sales/sales-modal";
import { money, n0, pct, seg, segGroup, x2 } from "../sales/sales-fmt";
import { FlowChart } from "./sales-block-charts";
import { HIER_LABEL, SalesTable, moneyK, type Hier } from "./sales-block-table";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue, type TileItem } from "./tile";
import type { OrdersSummary, SalesBlock, SalesCls } from "./sales-block-data";

// Блок «Продажи и остатки» на Главной: плитки Получено / Продано / Остаток (листаются: Тотал · Одежда · Аксессуары), график и таблица.
// Числа берутся из тех же функций, что раздел /sales (sales-block-data.ts), и должны с ним совпадать.

const SALES_CLS: SalesCls[] = ["all", "clothes", "acc"];
type Tile = "received" | "sold" | "stock";
const CLS_LABEL: Record<SalesCls, string> = { all: "Тотал", clothes: "Одежда", acc: "Аксессуары" };
const TILE_TITLE: Record<Tile, string> = { received: "Получено", sold: "Продано", stock: "Остаток" };

const qty = (v: number) => (v === 0 ? "—" : n0(v) + " шт.");

/** Переключатель «Все сезоны / сезон». */
function SeasonSwitch({ keys, value, onChange }: { keys: string[]; value: string; onChange: (k: string) => void }) {
  return (
    <div role="group" aria-label="Сезон" className={segGroup}>
      {["all", ...keys].map((k) => <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className={seg(value === k)}>{k === "all" ? "Все" : k}</button>)}
    </div>
  );
}

function HierSwitch({ value, onChange }: { value: Hier; onChange: (h: Hier) => void }) {
  return (
    <div role="group" aria-label="Иерархия строк" className={segGroup}>
      {(["fur", "cls"] as const).map((h) => <button key={h} type="button" aria-pressed={value === h} onClick={() => onChange(h)} className={seg(value === h)}>{HIER_LABEL[h]}</button>)}
    </div>
  );
}

/** Плитка-карусель: страницы листаются свайпом или скроллом вправо-влево, стрелками и точками. */
function Carousel({ label, pages, onOpen, index, onIndex }: { label: string; pages: { key: string; node: React.ReactNode }[]; onOpen: (key: string) => void; index: number; onIndex: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const i = index;
  const setI = onIndex;
  // Страница меняется снаружи (листнули соседнюю плитку): прокручиваем к ней.
  useEffect(() => {
    const el = ref.current;
    if (el && Math.round(el.scrollLeft / Math.max(1, el.clientWidth)) !== index) el.scrollTo({ left: index * el.clientWidth, behavior: "auto" });
  }, [index]);
  const go = (n: number) => {
    const el = ref.current;
    if (!el) return;
    const k = (n + pages.length) % pages.length;
    el.scrollTo({ left: k * el.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setI(k);
  };
  const btn = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-neutral-700 hover:bg-neutral-100";
  return (
    <div role="group" aria-roledescription="carousel" aria-label={label} className={TILE_BOX + " tile-click !p-0"}>
      <div ref={ref} tabIndex={0} onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); go(i + 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); } }}
        onScroll={(e) => { const el = e.currentTarget; const k = Math.round(el.scrollLeft / Math.max(1, el.clientWidth)); if (k !== i) setI(k); }}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto motion-safe:scroll-smooth [scrollbar-width:none]" data-keep-scroll>
        {pages.map((p, k) => (
          <div key={p.key} role="button" tabIndex={0} aria-haspopup="dialog" aria-label={`${k + 1} из ${pages.length}: ${p.key}`} onClick={() => onOpen(p.key)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(p.key); } }} className="relative flex w-full shrink-0 cursor-pointer snap-start flex-col p-4 text-left">
            {p.node}
          </div>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between px-1 pb-1 print:hidden">
        <button type="button" aria-label="Предыдущая страница" onClick={() => go(i - 1)} className={btn}>‹</button>
        <div className="flex items-center">
          {pages.map((p, k) => <button key={p.key} type="button" aria-label={`Страница ${k + 1}: ${p.key}`} aria-current={i === k} onClick={() => go(k)} className="inline-flex min-h-11 min-w-8 items-center justify-center"><span className={"block size-2 rounded-full " + (i === k ? "bg-neutral-900" : "bg-neutral-300")} /></button>)}
        </div>
        <button type="button" aria-label="Следующая страница" onClick={() => go(i + 1)} className={btn}>›</button>
      </div>
    </div>
  );
}

/** «Заказ и приход»: заказано (Conf отчёта по товарам), пришло и сколько ещё ждём. По FW25 и SS26 ничего не ждём — заказано = пришло. */
function OrdersPanel({ s, label }: { s: OrdersSummary; label: string }) {
  const td = "px-2 py-1.5 text-right tabular-nums";
  return (
    <section aria-label="Заказ и приход" data-testid="dash-sales-orders" className="rounded-lg border border-neutral-300 bg-white p-3">
      <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold">Заказ и приход · {label}, шт.
        <InfoHint label="Как считается заказ и приход" wide>
          <p><b>Заказано</b> — подтверждённый заказ (Conf) из отчёта по товарам. По FW 25/26 и SS 2026 больше ничего не ждём: заказано = пришло. По FW 26/27 заказано = Conf.</p>
          <p className="mt-1"><b>Пришло</b> — поступление. <b>Ждём</b> = заказано − пришло (только FW 26/27). Conf отчёта целиком: {n0(s.confReport)} шт.</p>
        </InfoHint>
      </h3>
      <div className="overflow-x-auto rounded-lg border border-neutral-200" data-keep-scroll tabIndex={0}>
        <table className="table-keep w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-600">
              <th scope="col" className="px-2 py-2 text-left font-semibold">Сезон</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Заказано</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Пришло</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Ждём</th>
            </tr>
          </thead>
          <tbody>
            {s.lines.map((l) => (
              <tr key={l.key} className="border-b border-neutral-100">
                <td className="px-2 py-1.5 text-left">{l.label}</td>
                <td className={td}>{n0(l.ordered)}</td>
                <td className={td}>{n0(l.delivered)}</td>
                <td className={td + (l.awaiting > 0 ? " font-medium text-[#b4310b]" : "")}>{l.awaiting > 0 ? n0(l.awaiting) : "—"}</td>
              </tr>
            ))}
            <tr className="row-total border-t-2 border-neutral-400 font-semibold">
              <td className="px-2 py-1.5 text-left">Всего</td>
              <td className={td}>{n0(s.total.ordered)}</td>
              <td className={td}>{n0(s.total.delivered)}</td>
              <td className={td}>{s.total.awaiting > 0 ? n0(s.total.awaiting) : "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function SalesBlockView({ b }: { b: SalesBlock }) {
  const { mode } = useVatDisplay();
  const v = mode === "incl" ? "in" : "ex";
  const vatNote = v === "in" ? "с НДС" : "без НДС";
  const href = b.href[v];
  const seasonKeys = b.seasons.map((s) => s.key);
  const [season, setSeason] = useState("all");
  /** Категория (Тотал / Одежда / Аксессуары): общая для трёх плиток, графика и таблицы. */
  const [cls, setCls] = useState<SalesCls>("all");
  const [hier, setHier] = useState<Hier>("fur");
  const [open, setOpen] = useState<{ tile: Tile; cls: SalesCls } | null>(null);
  const [mSeason, setMSeason] = useState("all");
  const [mHier, setMHier] = useState<Hier>("fur");

  if (!b.hasData) {
    return (
      <section aria-label="Продажи и остатки" className="space-y-2" data-testid="dash-sales">
        <WidgetRow id="sales" title="Продажи и остатки" headerEnd={<Link href="/sales" className="text-xs text-blue-700 hover:underline print:hidden">Продажи и остатки ›</Link>}>
          <p className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">Нет данных о продажах: выгрузка поступлений и продаж ещё не загружена.</p>
        </WidgetRow>
      </section>
    );
  }

  const slice = b.slices[season] ?? b.slices.all;
  const itemsOf = (t: Tile, c: SalesCls): TileItem[] => {
    const h = slice.head[c], m = h.money[v];
    if (t === "received") return [{ k: "По себестоимости ТЗ", v: money(m.recvCost) }, { k: "По прайсу 19.10", v: money(m.recvList) }];
    if (t === "sold") return [
      { k: `Выручка, ${vatNote}`, v: money(m.revenue) },
      { k: "Gross (до скидки)", v: money(m.grossRev) },
      { k: "Скидка", v: money(m.discount), share: m.grossRev > 0.5 && m.discount > 0.5 ? m.discount / m.grossRev : null },
      { k: "Средневзвешенная цена, ₽/шт.", v: moneyK(m.avgPrice) },
      { k: "Маркап продаж", v: x2(m.markupSold) },
    ];
    return [{ k: "По себестоимости ТЗ", v: money(m.stockCost) }, { k: "По прайсу 19.10", v: money(m.stockList) }, ...(slice.soAsEnd !== null ? [{ k: "SO AS (до конца сезона)", v: pct(h.soAs, 1) }] : []), { k: season === "all" ? "Sell-through" : "SO STD (на сегодня)", v: pct(h.sellThrough, 1) }, { k: "Маркап остатка", v: x2(m.markupStock) },
      ...(season === "all" ? [] : [{ k: "Сток тотал", v: qty(h.stockCum) }, { k: "Сток тотал в рознице", v: money(h.stockListCum[v]) }, { k: "Маркап стока тотал", v: x2(h.markupStockCum[v]) }, { k: "Доля сезона", v: h.stockCum > 0 ? pct(h.stock / h.stockCum, 0) : "—" }])];
  };
  const valueOf = (t: Tile, c: SalesCls, s = slice) => { const h = s.head[c]; return t === "received" ? h.received : t === "sold" ? h.sold : h.stock; };
  const captionOf = (t: Tile, c: SalesCls) => { const h = slice.head[c]; return t === "received" ? `${h.orders} заказов · ${h.articles} артикулов` : t === "sold" ? `нетто · возвраты ${n0(h.returns)}` : "приход − продано"; };
  const hintOf = (t: Tile) => t === "received" ? <p>Приход товара: штуки по строкам прихода выгрузки. Суммы — по себестоимости ТЗ и по прайсу 19.10; штуки без цены в сумму не входят.</p>
    : t === "sold" ? <p>Нетто: продажи минус возвраты. Цена — выручка ({vatNote}) ÷ нетто-штуки.</p>
    : <p>Остаток = приход − продано. Sell-through = продано ÷ получено.</p>;

  const tile = (t: Tile) => (
    <Carousel key={t} label={TILE_TITLE[t]} index={SALES_CLS.indexOf(cls)} onIndex={(k) => setCls(SALES_CLS[k] ?? "all")} onOpen={(k) => { setMSeason(season); setMHier("fur"); setOpen({ tile: t, cls: SALES_CLS.find((c) => CLS_LABEL[c] === k) ?? "all" }); }}
      pages={SALES_CLS.map((c) => ({
        key: CLS_LABEL[c],
        node: (
          <div data-hover-block={`sales-${t}`} data-testid={c === "all" ? `dash-sales-${t}` : undefined}>
            <TileHead>{TILE_TITLE[t]} · {CLS_LABEL[c]}</TileHead>
            <div className="absolute right-3 top-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <InfoHint label={`Что такое «${TILE_TITLE[t]}»`} align="right">{hintOf(t)}</InfoHint>
            </div>
            <TileValue>{qty(valueOf(t, c))}</TileValue>
            <TileCaption>{captionOf(t, c)}</TileCaption>
            <TileList items={itemsOf(t, c)} />
          </div>
        ),
      }))} />
  );

  const modal = open ? (() => {
    const sl = b.slices[mSeason] ?? b.slices.all;
    const sub = `${CLS_LABEL[open.cls]} · ${mSeason === "all" ? "все сезоны" : mSeason} · ${b.periodNote} · ${vatNote}`;
    return (
      <SalesModal wide title={`${TILE_TITLE[open.tile]}: ${qty(valueOf(open.tile, open.cls, sl))}`} subtitle={sub} onClose={() => setOpen(null)}>
        <div className="flex flex-wrap items-center gap-2">
          <HierSwitch value={mHier} onChange={setMHier} />
          <SeasonSwitch keys={seasonKeys} value={mSeason} onChange={setMSeason} />
        </div>
        <SalesTable key={mSeason + mHier + open.cls} view={sl.views[open.cls][mHier]} v={v} vatNote={vatNote} cumCol={mSeason !== "all"} soAs={sl.soAsEnd !== null} />
        <Link href={href} className="inline-flex min-h-11 items-center text-sm text-blue-700 hover:underline">Продажи и остатки ›</Link>
      </SalesModal>
    );
  })() : null;

  return (
    <section aria-label="Продажи и остатки" className="space-y-3" data-testid="dash-sales">
      {/* Сезон закреплён сверху: переключатель доступен при прокрутке всего блока (плитки, график, таблица). */}
      <div data-testid="dash-sales-season-bar" className="sticky top-0 z-30 -mx-1 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur print:hidden">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Сезон</span>
        <SeasonSwitch keys={seasonKeys} value={season} onChange={setSeason} />
      </div>
      <WidgetRow id="sales" title="Продажи и остатки"
        headerExtra={
          <InfoHint label="Как считаются продажи и остатки на Главной" wide>
            <p>Год и НДС — из шапки; сезон — переключатель ниже. Фильтры меха, цвета, партии и источника здесь не действуют.</p>
            <p className="mt-1">Числа те же, что в разделе «Продажи и остатки».</p>
          </InfoHint>
        }
        headerEnd={<Link href={href} data-testid="dash-sales-link" className="text-xs text-blue-700 hover:underline print:hidden">Продажи и остатки ›</Link>}>
        <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-3 print:grid-cols-3">
          {(["received", "sold", "stock"] as const).map(tile)}
        </div>
      </WidgetRow>

      {b.orderSummary[cls] ? <OrdersPanel s={b.orderSummary[cls]!} label={CLS_LABEL[cls]} /> : null}

      <FlowChart points={slice.months[cls]} note={CLS_LABEL[cls]} />

      <PinSection id="sales-table" title={`Продажи и остатки по типам меха · ${CLS_LABEL[cls]}`} value={[hier]} onRestore={(x) => { if (x[0] === "fur" || x[0] === "cls") setHier(x[0]); }}>
        <div className="mb-2 print:hidden"><HierSwitch value={hier} onChange={setHier} /></div>
        <SalesTable key={season + hier + cls} view={slice.views[cls][hier]} v={v} vatNote={vatNote} testId="dash-sales-table" cumCol={season !== "all"} soAs={slice.soAsEnd !== null} />
      </PinSection>
      {modal}
    </section>
  );
}
