"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { InfoHint } from "@/components/info-hint";
import { PinSection } from "@/components/pin-section";
import { WidgetRow } from "@/components/widget-row";
import { SalesModal } from "../sales/sales-modal";
import { money, n0, pct, seg, segGroup, x2 } from "../sales/sales-fmt";
import { FlowChart } from "./sales-block-charts";
import { SeasonSwitch, useSeasonScope } from "./season-scope";
import { SsnTable } from "./sales-block-ssn";
import { SalesTable, moneyK } from "./sales-block-table";
import { HierSwitch, type Hier } from "@/components/hier-switch";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue, type TileItem } from "./tile";
import type { OrderNode, OrdersSummary, SalesBlock, SalesCls, SalesRow } from "./sales-block-data";

// Блок «Продажи и остатки» на Главной: плитки Получено / Продано / Остаток (листаются: Тотал · Одежда · Аксессуары), график и таблица.
// Числа берутся из тех же функций, что раздел /sales (sales-block-data.ts), и должны с ним совпадать.

const SALES_CLS: SalesCls[] = ["all", "clothes", "acc"];
type Tile = "ordered" | "received" | "sold" | "stock";
/** Сезон отчёта, по которому ещё что-то ждём (заказано больше, чем пришло): плитка «Заказано» только для «Все» и этого сезона. Значение дублирует ORDERS_OPEN_SEASON (в серверном модуле) — в клиент значения оттуда не импортируются. */
const ORDERS_OPEN = "FW 26/27";
const CLS_LABEL: Record<SalesCls, string> = { all: "Всего", clothes: "Одежда", acc: "Аксессуары" };
const TILE_TITLE: Record<Tile, string> = { ordered: "Заказано", received: "Получено", sold: "Продано", stock: "Остаток" };

const qty = (v: number) => (v === 0 ? "–" : n0(v) + " шт.");

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

/** Таблица «Заказ и приход»: штуки и деньги (по прайсу) по сезонам; сезон разворачивается на тип меха → кат. 1 → кат. 2 или кат. 1 → кат. 2 → тип меха. По FW 25/26 и SS 2026 больше ничего не ждём — заказано = пришло. */
function OrdersTable({ s, v, hier }: { s: OrdersSummary; v: "in" | "ex"; hier: Hier }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((x) => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const td = "whitespace-nowrap px-2 py-1.5 text-right tabular-nums";
  const rub = (m: { in: number; ex: number }) => (Math.abs(m[v]) < 500 ? "–" : money(Math.round(m[v] / 1000) * 1000));
  type Cells = { ordered: number; delivered: number; awaiting: number; orderedRub: { in: number; ex: number }; deliveredRub: { in: number; ex: number }; awaitingRub: { in: number; ex: number } };
  const cells = (l: Cells) => (
    <>
      <td className={td + " border-l border-neutral-100"}>{n0(l.ordered)}</td><td className={td}>{rub(l.orderedRub)}</td>
      <td className={td + " border-l border-neutral-100"}>{n0(l.delivered)}</td><td className={td}>{rub(l.deliveredRub)}</td>
      <td className={td + " border-l border-neutral-100" + (l.awaiting > 0 ? " font-medium text-[#b4310b]" : "")}>{l.awaiting !== 0 ? n0(l.awaiting) : "–"}</td><td className={td + (l.awaiting > 0 ? " text-[#b4310b]" : "")}>{l.awaiting !== 0 ? rub(l.awaitingRub) : "–"}</td>
    </>
  );
  const node = (n: OrderNode, depth: number, path: string): React.ReactNode => {
    const k = path + "/" + n.label, isOpen = open.has(k), kids = n.children.filter((c) => c.ordered !== 0 || c.delivered !== 0);
    return (
      <Fragment key={k}>
        <tr data-depth={depth} onClick={kids.length > 0 ? () => toggle(k) : undefined} className={"border-b border-neutral-100 " + (kids.length > 0 ? "cursor-pointer hover:bg-neutral-50 " : "") + (depth === 1 ? "bg-neutral-50 text-[13px] text-neutral-700" : "bg-white text-[13px] text-neutral-700")}>
          <td className="px-2 py-1.5 text-left">
            <div className="flex min-w-0 items-center" style={{ paddingLeft: Math.min(depth, 6) * 16 }}>
              <span className="inline-flex w-5 shrink-0 items-center">
                {kids.length > 0 ? <button type="button" onClick={(e) => { e.stopPropagation(); toggle(k); }} aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Раскрыть"}: ${n.label}`} className="inline-flex size-6 items-center justify-center text-neutral-500"><span aria-hidden className={"inline-block transition-transform " + (isOpen ? "rotate-90" : "")}>›</span></button> : null}
              </span>
              <span className="min-w-0 break-words leading-tight">{n.label}</span>
            </div>
          </td>
          {cells(n)}
        </tr>
        {isOpen ? kids.map((c) => node(c, depth + 1, k)) : null}
      </Fragment>
    );
  };
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white" data-keep-scroll tabIndex={0}>
      <table className="table-keep w-full min-w-[680px] text-sm" data-testid="dash-sales-orders">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-600">
            <th scope="col" rowSpan={2} className="px-2 py-2 text-left font-semibold">Сезон</th>
            <th scope="colgroup" colSpan={2} className="border-l border-neutral-100 px-2 py-1.5 text-center font-semibold">Заказано</th>
            <th scope="colgroup" colSpan={2} className="border-l border-neutral-100 px-2 py-1.5 text-center font-semibold">Пришло</th>
            <th scope="colgroup" colSpan={2} className="border-l border-neutral-100 px-2 py-1.5 text-center font-semibold">Ждём</th>
          </tr>
          <tr className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-600">
            {["шт.", "₽ по прайсу", "шт.", "₽ по прайсу", "шт.", "₽ по прайсу"].map((h, i) => <th key={i} scope="col" className={"px-2 py-1.5 text-right font-medium" + (i % 2 === 0 ? " border-l border-neutral-100" : "")}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {s.lines.map((l) => {
            const kids = (l.tree?.[hier] ?? []).filter((c) => c.ordered !== 0 || c.delivered !== 0), isOpen = open.has(l.key);
            return (
              <Fragment key={l.key}>
                <tr data-depth={0} onClick={kids.length > 0 ? () => toggle(l.key) : undefined} className={"border-b border-neutral-100 bg-white font-medium " + (kids.length > 0 ? "cursor-pointer hover:bg-neutral-50" : "")}>
                  <td className="px-2 py-1.5 text-left">
                    <div className="flex min-w-0 items-center">
                      <span className="inline-flex w-5 shrink-0 items-center">
                        {kids.length > 0 ? <button type="button" onClick={(e) => { e.stopPropagation(); toggle(l.key); }} aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Раскрыть"}: ${l.label}`} className="inline-flex size-6 items-center justify-center text-neutral-500"><span aria-hidden className={"inline-block transition-transform " + (isOpen ? "rotate-90" : "")}>›</span></button> : null}
                      </span>
                      {l.label}
                    </div>
                  </td>
                  {cells(l)}
                </tr>
                {isOpen ? kids.map((c) => node(c, 1, l.key)) : null}
              </Fragment>
            );
          })}
          <tr className="row-total border-t-2 border-neutral-400 font-semibold">
            <td className="px-2 py-1.5 text-left"><span className="pl-5">Всего</span></td>
            {cells(s.total)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function SalesBlockView({ b }: { b: SalesBlock }) {
  const { mode } = useVatDisplay();
  const v = mode === "incl" ? "in" : "ex";
  const vatNote = v === "in" ? "с НДС" : "без НДС";
  const href = b.href[v];
  const seasonKeys = b.seasons.map((s) => s.key);
  // Сезон общий с панелью «Сезон» (она начинается с раздела «Производство» и закреплена); вне панели — свой выбор.
  const scope = useSeasonScope();
  const [ownSeason, setOwnSeason] = useState("all");
  /** НДС в окне плитки «Продано» (по умолчанию с НДС); сама плитка и остальной блок — по переключателю шапки сайта. */
  const [mVat, setMVat] = useState<"in" | "ex">("in");
  /** Строка таблицы под курсором: график «Приход · Продажи · Остаток» показывает её ряд (тип меха, категория). */
  const [hotRow, setHotRow] = useState<SalesRow | null>(null);
  const season = scope ? scope.season : ownSeason;
  /** Продажи по: товару сезона (как пришёл) или календарному сезону (по дате продажи: SSN / non-SSN). */
  const [salesBy, setSalesBy] = useState<"goods" | "cal">("goods");
  /** Категория (Тотал / Одежда / Аксессуары): общая для трёх плиток, графика и таблицы. */
  const [cls, setCls] = useState<SalesCls>("all");
  const [hier, setHier] = useState<Hier>("fur");
  useEffect(() => { setHotRow(null); }, [season, hier, cls]);
  const [open, setOpen] = useState<{ tile: Tile; cls: SalesCls } | null>(null);
  const [mSeason, setMSeason] = useState("all");
  const [mHier, setMHier] = useState<Hier>("fur");

  if (!b.hasData) {
    return (
      <section aria-label="Продажи и остатки" className="space-y-2" data-testid="dash-sales">
        <WidgetRow id="sales" title="Продажи и остатки" headerEnd={<Link href="/sales" className="text-xs text-blue-700 hover:underline print:hidden">→ Продажи и остатки</Link>}>
          <p className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">Нет данных о продажах: выгрузка поступлений и продаж ещё не загружена.</p>
        </WidgetRow>
      </section>
    );
  }

  const slice = b.slices[season] ?? b.slices.all;
  /** Заказ и приход выбранного сезона: «Все» — итог, иначе строка сезона (нет такой строки — null). */
  const orderLineOf = (c: SalesCls, sk: string = season) => { const o = b.orderSummary[c]; return o ? (sk === "all" ? o.total : o.lines.find((l) => l.key === sk) ?? null) : null; };
  const showOrdered = false; // плитка «Заказано» убрана (заказ и приход по сезонам — в «Производстве» и в таблице по сезонам)
  const itemsOf = (t: Tile, c: SalesCls): TileItem[] => {
    if (t === "ordered") { const l = orderLineOf(c); return l ? [{ k: "Заказано по прайсу", v: money(l.orderedRub[v]) }, { k: "Ждём по прайсу", v: l.awaiting > 0 ? money(l.awaitingRub[v]) : "–" }] : []; }
    const h = slice.head[c], m = h.money[v];
    if (t === "received") return [{ k: "По себестоимости ТЗ", v: money(m.recvCost) }, { k: "По прайсу", v: money(m.recvList) }];
    if (t === "sold" && salesBy === "cal") {
      const k = calOf(c), share = k.total.pcs !== 0 ? k.ssn.pcs / k.total.pcs : null;
      return [
        { k: `Выручка, ${vatNote}`, v: money(k.total.rub[v]) },
        { k: "SSN-товар (этого сезона)", v: `${qty(k.ssn.pcs)} · ${money(k.ssn.rub[v])}` },
        { k: "non-SSN-товар (прошлых сезонов)", v: `${qty(k.non.pcs)} · ${money(k.non.rub[v])}` },
        { k: "Доля SSN", v: pct(share, 0) },
      ];
    }
    if (t === "sold") {
      const sm = h.money[v], sw = vatNote;
      return [
        { k: "По себестоимости ТЗ", v: money(sm.soldCost) },
        { k: `Выручка, ${sw}`, v: money(sm.revenue) },
        { k: "Gross (до скидки)", v: money(sm.grossRev) },
        { k: "Скидка", v: money(sm.discount), share: sm.grossRev > 0.5 && sm.discount > 0.5 ? sm.discount / sm.grossRev : null, shareFirst: true },
        { k: "Ср. цена, ₽/шт.", v: moneyK(sm.avgPrice) },
        { k: "Маркап продаж", v: x2(sm.markupSold) },
        ...(slice.soAsEnd !== null ? [{ k: "SO AS (до конца сезона)", v: pct(h.soAs, 1) }] : []),
        { k: season === "all" ? "SO" : "SO STD (на сегодня)", v: pct(h.sellThrough, 1) },
      ];
    }
    return [{ k: "По себестоимости ТЗ", v: money(m.stockCost) }, { k: "По прайсу", v: money(m.stockList) }, { k: "Маркап остатка", v: x2(m.markupStock) },
      ...(season === "all" ? [] : [{ k: "Сток тотал", v: qty(h.stockCum) }, { k: "Сток тотал в рознице", v: money(h.stockListCum[v]) }, { k: "Маркап стока тотал", v: x2(h.markupStockCum[v]) }, { k: "Доля сезона", v: h.stockCum > 0 ? pct(h.stock / h.stockCum, 0) : "–" }])];
  };
  const zeroPart = { pcs: 0, rub: { in: 0, ex: 0 } };
  const calOf = (c: SalesCls) => {
    const rows = b.ssn[c].rows.filter((r) => season === "all" || r.key === season);
    const add = (f: (r: (typeof rows)[number]) => { pcs: number; rub: { in: number; ex: number } }) => rows.reduce((a, r) => ({ pcs: a.pcs + f(r).pcs, rub: { in: a.rub.in + f(r).rub.in, ex: a.rub.ex + f(r).rub.ex } }), zeroPart);
    return { total: add((r) => r.total), ssn: add((r) => r.ssn), non: add((r) => r.non) };
  };
  const valueOf = (t: Tile, c: SalesCls, s = slice, sk: string = season) => { if (t === "sold" && salesBy === "cal") return calOf(c).total.pcs; if (t === "ordered") return orderLineOf(c, sk)?.ordered ?? 0; const h = s.head[c]; return t === "received" ? h.received : t === "sold" ? h.sold : h.stock; };
  const captionOf = (t: Tile, c: SalesCls) => { if (t === "sold" && salesBy === "cal") { const k = calOf(c); return `SSN ${n0(k.ssn.pcs)} · non-SSN ${n0(k.non.pcs)}`; } if (t === "ordered") { const l = orderLineOf(c); return l ? `пришло ${n0(l.delivered)} · ждём ${n0(l.awaiting)}` : ""; } const h = slice.head[c]; return t === "received" ? `приход 2025–2026 · ${h.articles} артикулов` : t === "sold" ? `возвраты ${n0(h.returns)}` : "приход − продано"; };
  const hintOf = (t: Tile) => t === "ordered" ? <p>Заказ: пришло + ждём. По FW 25/26 и SS 2026 больше ничего не ждём (заказано = пришло); по FW 26/27 ждём Conf − поступило (отчёт по товарам). Нажмите — таблица по сезонам со штуками и деньгами.</p>
    : t === "received" ? <p>Приход товара: штуки по строкам прихода выгрузки. Суммы — по себестоимости ТЗ и по прайсу; штуки без цены в сумму не входят.</p>
    : t === "sold" ? <p>Нетто: продажи минус возвраты. Цена — выручка ({vatNote}) ÷ нетто-штуки.</p>
    : <p>Остаток = приход − продано. SO = продано ÷ получено.</p>;

  const tile = (t: Tile) => (
    <Carousel key={t} label={TILE_TITLE[t]} index={SALES_CLS.indexOf(cls)} onIndex={(k) => setCls(SALES_CLS[k] ?? "all")} onOpen={(k) => { setMSeason(season); setMHier("fur"); setMVat("in"); setOpen({ tile: t, cls: SALES_CLS.find((c) => CLS_LABEL[c] === k) ?? "all" }); }}
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
    if (open.tile === "ordered" && b.orderSummary[open.cls]) {
      const os = b.orderSummary[open.cls]!;
      return (
        <SalesModal wide title={`Заказ и приход · ${CLS_LABEL[open.cls]}, шт.`} subtitle={`все сезоны · деньги по прайсу · ${vatNote}`} onClose={() => setOpen(null)}>
          <HierSwitch value={mHier} onChange={setMHier} />
          <OrdersTable key={mHier + open.cls} s={os} v={v} hier={mHier} />
          <p className="text-xs text-neutral-600">По FW 25/26 и SS 2026 больше ничего не ждём: заказано = пришло. По FW 26/27 заказано = пришло + ждём, где ждём = Conf − поступило (отчёт по товарам). Conf отчёта целиком: {n0(os.confReport)} шт. Штуки без цены в прайсе в рубли не входят. Сезон разворачивается стрелкой ›.</p>
          <Link href={href} className="inline-flex min-h-11 items-center text-sm text-blue-700 hover:underline">Продажи и остатки ›</Link>
        </SalesModal>
      );
    }
    // В окне плитки «Продано» свой переключатель НДС (по умолчанию с НДС); в остальных окнах — НДС шапки сайта.
    const soldWin = open.tile === "sold";
    const wv: "in" | "ex" = soldWin ? mVat : v, wNote = wv === "in" ? "с НДС" : "без НДС";
    const sub = `${CLS_LABEL[open.cls]} · ${mSeason === "all" ? "все сезоны" : mSeason} · ${b.periodNote} · ${wNote}`;
    return (
      <SalesModal wide title={`${TILE_TITLE[open.tile]}: ${qty(valueOf(open.tile, open.cls, sl))}`} subtitle={sub} onClose={() => setOpen(null)}>
        <div className="flex flex-wrap items-center gap-2">
          <HierSwitch value={mHier} onChange={setMHier} />
          <SeasonSwitch keys={seasonKeys} value={mSeason} onChange={setMSeason} />
          {soldWin ? (
            <div role="group" aria-label="НДС в таблице «Продано»" className={segGroup}>
              {([["in", "С НДС"], ["ex", "Без НДС"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={mVat === k} onClick={() => setMVat(k)} className={seg(mVat === k)}>{l}</button>)}
            </div>
          ) : null}
        </div>
        <SalesTable key={mSeason + mHier + open.cls + wv} view={sl.views[open.cls][mHier]} v={wv} vatNote={wNote} cumCol={mSeason !== "all"} soAs={sl.soAsEnd !== null} />
        <Link href={href} className="inline-flex min-h-11 items-center text-sm text-blue-700 hover:underline">Продажи и остатки ›</Link>
      </SalesModal>
    );
  })() : null;

  return (
    <section aria-label="Продажи и остатки" className="space-y-3" data-testid="dash-sales">
      {scope ? null : (
        <div data-testid="dash-sales-season-bar" className="sticky top-0 z-30 -mx-1 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur print:hidden">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Сезон</span>
          <SeasonSwitch keys={seasonKeys} value={season} onChange={setOwnSeason} />
        </div>
      )}
      <WidgetRow id="sales" title="Продажи и остатки"
        headerExtra={
          <InfoHint label="Как считаются продажи и остатки на Главной" wide>
            <p>Год и НДС — из шапки; сезон — переключатель ниже. Фильтры меха, цвета, партии и источника здесь не действуют.</p>
            <p className="mt-1">Числа те же, что в разделе «Продажи и остатки».</p>
          </InfoHint>
        }
        headerEnd={<Link href={href} data-testid="dash-sales-link" className="text-xs text-blue-700 hover:underline print:hidden">→ Продажи и остатки</Link>}>
        <div className="mb-2 flex flex-wrap items-center gap-2 print:hidden">
          <span className="text-xs text-neutral-600">Продажи по:</span>
          <div role="group" aria-label="Продажи по товару сезона или календарному сезону" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
            {([["goods", "Товару сезона"], ["cal", "Календарному сезону"]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={salesBy === k} onClick={() => setSalesBy(k)} className={"min-h-9 rounded-md px-3 text-sm " + (salesBy === k ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")}>{t}</button>)}
          </div>
          <span className="text-xs text-neutral-500">{salesBy === "goods" ? "SO AS — продажи в сезоне ÷ приход сезона; SO STD — на сегодня (в идущем сезоне только STD)" : "в календарном сезоне: SSN — товар этого сезона, non-SSN — товар прошлых сезонов"}</span>
        </div>
        <div className={"grid grid-cols-1 items-stretch gap-3 print:grid-cols-3 " + (showOrdered ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3")}>
          {(showOrdered ? (["ordered", "received", "sold", "stock"] as const) : (["received", "sold", "stock"] as const)).map(tile)}
        </div>
      </WidgetRow>

      <SsnTable data={b.ssn[cls]} v={v} vatNote={vatNote} active={season === "all" ? undefined : season} />

      <FlowChart
        points={hotRow?.series ? slice.months[cls].map((m, i) => ({ key: m.key, label: m.label, received: hotRow.series!.r[i] ?? 0, sold: hotRow.series!.s[i] ?? 0, stock: hotRow.series!.st[i] ?? 0, soldBySeason: Object.fromEntries(Object.entries(hotRow.series!.ss).map(([k, a]) => [k, a[i] ?? 0])) })) : slice.months[cls]}
        labelSold={!!hotRow?.series}
        note={hotRow?.series ? `${CLS_LABEL[cls]} · ${hotRow.label}` : CLS_LABEL[cls]} />

      <PinSection id="sales-table" title={`Продажи и остатки по типам меха · ${CLS_LABEL[cls]}`} value={[hier]} onRestore={(x) => { if (x[0] === "fur" || x[0] === "cls") setHier(x[0]); }}>
        <div className="mb-2 flex justify-end print:hidden"><HierSwitch value={hier} onChange={setHier} /></div>
        <SalesTable key={season + hier + cls} view={slice.views[cls][hier]} v={v} vatNote={vatNote} testId="dash-sales-table" ordCol={slice.views[cls][hier].total.ordered !== undefined && (season === "all" || season === ORDERS_OPEN)} onHover={setHotRow} cumCol={season !== "all"} soAs={slice.soAsEnd !== null} />
      </PinSection>
      {modal}
    </section>
  );
}
