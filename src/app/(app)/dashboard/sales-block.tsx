"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { InfoHint } from "@/components/info-hint";
import { PinSection } from "@/components/pin-section";
import { TH, THGroup } from "@/components/table-head";
import { UNIT } from "@/lib/units";
import { WidgetRow } from "@/components/widget-row";
import { MiniTable, SalesModal } from "../sales/sales-modal";
import { DASH, money, n0, pct } from "../sales/sales-fmt";
import { FlowChart, SeasonChart } from "./sales-block-charts";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue, type TileItem } from "./tile";
import type { SalesBlock, SalesRow } from "./sales-block-data";

// Блок «Продажи и остатки» на Главной: три плитки (Получено / Продано / Остаток), два графика и таблица по типам меха.
// Числа берутся из тех же функций, что раздел /sales (sales-block-data.ts), и должны с ним совпадать.

type Tile = "received" | "sold" | "stock";

const qty = (v: number) => (v === 0 ? DASH : n0(v) + " шт.");
const perUnit = (sum: number, q: number) => (q > 0 && Math.abs(sum) >= 0.5 ? money(sum / q) : DASH);
const cover = (part: number, whole: number) => (whole > 0 && part !== whole ? `по ${n0(part)} из ${n0(whole)} шт.` : null);

const td = "whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums";
const GB = " border-l border-neutral-100";

export function SalesBlockView({ b }: { b: SalesBlock }) {
  const { mode } = useVatDisplay();
  const v = mode === "incl" ? "in" : "ex";
  const vatNote = v === "in" ? "с НДС" : "без НДС";
  const m = b.money[v];
  const href = b.href[v];
  const [open, setOpen] = useState<Tile | null>(null);
  const [rowsOpen, setRowsOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setRowsOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  if (!b.hasData) {
    return (
      <section aria-label="Продажи и остатки" className="space-y-2" data-testid="dash-sales">
        <WidgetRow id="sales" title="Продажи и остатки" headerEnd={<Link href="/sales" className="text-xs text-blue-700 hover:underline print:hidden">→ Продажи и остатки</Link>}>
          <p className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">Нет данных о продажах: выгрузка поступлений и продаж ещё не загружена.</p>
        </WidgetRow>
      </section>
    );
  }

  const recvCover = cover(m.recvCostPcs, b.received);
  const recvListCover = cover(m.recvListPcs, b.received);
  const stockCover = cover(m.stockCostPcs, b.stock);
  const stockListCover = cover(m.stockListPcs, b.stock);
  const items: Record<Tile, TileItem[]> = {
    received: [
      { k: "По себестоимости ТЗ", v: money(m.recvCost) },
      ...(recvCover ? [{ k: recvCover, v: "", sub: true }] : []),
      { k: "По прайсу 19.10", v: money(m.recvList) },
      ...(recvListCover ? [{ k: recvListCover, v: "", sub: true }] : []),
      { k: "Цена по прайсу, ₽/шт.", v: perUnit(m.recvList, m.recvListPcs) },
    ],
    sold: [
      { k: `Выручка, ${vatNote}`, v: money(m.revenue) },
      { k: "Gross (до скидки)", v: money(m.grossRev) },
      { k: "Скидка", v: money(m.discount), share: m.grossRev > 0.5 && m.discount > 0.5 ? m.discount / m.grossRev : null },
      { k: "Средняя цена продажи, ₽/шт.", v: money(m.avgPrice) },
    ],
    stock: [
      { k: "По себестоимости ТЗ", v: money(m.stockCost) },
      ...(stockCover ? [{ k: stockCover, v: "", sub: true }] : []),
      { k: "По прайсу 19.10", v: money(m.stockList) },
      ...(stockListCover ? [{ k: stockListCover, v: "", sub: true }] : []),
      { k: "Sell-through", v: pct(b.sellThrough, 1) },
    ],
  };

  const card = (id: Tile, title: string, value: string, caption: string, hint: React.ReactNode) => (
    <div key={id} data-hover-block={`sales-${id}`} data-testid={`dash-sales-${id}`} className={TILE_BOX + " tile-click"} role="button" tabIndex={0} aria-haspopup="dialog"
      title="Показать по сезонам и перейти в «Продажи и остатки»" onClick={() => setOpen(id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(id); } }}>
      <TileHead>{title}</TileHead>
      <div className="absolute right-3 top-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <InfoHint label={`Что такое «${title}»`} align="right">{hint}</InfoHint>
      </div>
      <TileValue>{value}</TileValue>
      <TileCaption>{caption}</TileCaption>
      <TileList items={items[id]} />
    </div>
  );

  // Окно деталей плитки: по сезонам, возвраты, основа сумм и переход в раздел.
  const seasonRows = (cols: (s: SalesBlock["seasons"][number]) => string[]) => b.seasons.map((s) => [s.key, ...cols(s)]);
  const modal = (() => {
    if (!open) return null;
    const sub = `${b.periodNote} · ${vatNote}`;
    const to = <Link href={href} className="inline-flex min-h-11 items-center text-sm text-blue-700 hover:underline">Открыть в «Продажи и остатки» →</Link>;
    if (open === "received") {
      return (
        <SalesModal title={`Получено (приход): ${qty(b.received)}`} subtitle={sub} onClose={() => setOpen(null)}>
          <MiniTable head={["Сезон", "Получено, шт.", "Доля"]} rows={seasonRows((s) => [n0(s.received), b.received > 0 ? pct(s.received / b.received, 0) : DASH])} total={["Всего", n0(b.received), b.received > 0 ? "100 %" : DASH]} />
          <p className="text-sm text-neutral-700">{b.orders} заказов, {b.articles} артикулов{b.firstReceipt ? `; первая поставка ${b.firstReceipt.split("-").reverse().join(".")}` : ""}. Корректировки прихода с минусом уже вычтены.</p>
          <p className="text-sm text-neutral-700">Суммы: по себестоимости ТЗ — {money(m.recvCost)}{recvCover ? ` (${recvCover})` : ""}; по прайсу 19.10 — {money(m.recvList)}{recvListCover ? ` (${recvListCover})` : ""}. Штуки без себестоимости или цены в сумму не входят. Закупочной цены прихода в выгрузке нет.</p>
          {to}
        </SalesModal>
      );
    }
    if (open === "sold") {
      return (
        <SalesModal title={`Продано: ${qty(b.sold)} (нетто)`} subtitle={sub} onClose={() => setOpen(null)}>
          <p className="text-sm text-neutral-800">Валовое {n0(b.gross)} шт. − возвраты {n0(b.returns)} шт. = нетто {n0(b.sold)} шт. Выручка {money(m.revenue)} ({vatNote}); скидка {money(m.discount)} от розницы до скидки {money(m.grossRev)}.</p>
          <MiniTable head={["Сезон", "Нетто, шт.", "Валовое", "Возвраты", "Выручка, ₽", "Ср. цена, ₽"]}
            rows={seasonRows((s) => [n0(s.sold), n0(s.gross), n0(s.returns), money(s.revenue[v]), money(s.avgPrice[v])])}
            total={["Всего", n0(b.sold), n0(b.gross), n0(b.returns), money(m.revenue), money(m.avgPrice)]} />
          {to}
        </SalesModal>
      );
    }
    return (
      <SalesModal title={`Остаток: ${qty(b.stock)}`} subtitle={sub} onClose={() => setOpen(null)}>
        <p className="text-sm text-neutral-800">Расчётный остаток = приход − продано нарастающим итогом{b.opening ? ` (на начало периода ${n0(b.opening)} шт.)` : ""}. Sell-through = продано ÷ получено за период: {pct(b.sellThrough, 1)}.</p>
        <MiniTable head={["Сезон", "Получено", "Продано", "Остаток нарастающим", "Sell-through"]}
          rows={seasonRows((s) => [n0(s.received), n0(s.sold), n0(s.stock), pct(s.sellThrough, 0)])}
          total={["Всего", n0(b.received), n0(b.sold), n0(b.stock), pct(b.sellThrough, 1)]} />
        <p className="text-sm text-neutral-700">Суммы остатка: по себестоимости ТЗ — {money(m.stockCost)}{stockCover ? ` (${stockCover})` : ""}; по прайсу 19.10 — {money(m.stockList)}{stockListCover ? ` (${stockListCover})` : ""}. Остаток считается по артикулу и цвету; без себестоимости или цены в сумму не входит.</p>
        {to}
      </SalesModal>
    );
  })();

  const rowTds = (r: SalesRow) => (
    <>
      <td className={td + GB}>{n0(r.received)}</td>
      <td className={td}>{n0(r.sold)}</td>
      <td className={td}>{n0(r.stock)}</td>
      <td className={td + GB}>{money(r.revenue[v])}</td>
      <td className={td}>{money(r.avgPrice[v])}</td>
      <td className={td + GB}>{pct(r.sellThrough, 1)}</td>
    </>
  );
  const renderRow = (r: SalesRow): React.ReactNode => {
    const isOpen = rowsOpen.has(r.id);
    const kids = r.children.filter((c) => c.received !== 0 || c.sold !== 0 || c.stock !== 0);
    return (
      <Fragment key={r.id}>
        <tr data-depth={r.depth} className={"border-b border-neutral-100 " + (r.depth === 0 ? "bg-white font-medium" : r.depth === 1 ? "bg-neutral-50 text-[13px] text-neutral-700" : "bg-white text-[12px] text-neutral-600")}>
          <td className="sticky left-0 z-[1] bg-inherit px-2 py-1.5 text-left">
            <div className="flex min-w-0 items-center" style={{ paddingLeft: r.depth * 18 }}>
              <span className="inline-flex w-5 shrink-0 items-center">
                {kids.length > 0 ? <button type="button" onClick={() => toggle(r.id)} aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Раскрыть"}: ${r.label}`} className="inline-flex size-6 items-center justify-center text-neutral-500"><span aria-hidden className={"inline-block transition-transform " + (isOpen ? "rotate-90" : "")}>›</span></button> : null}
              </span>
              <span className="min-w-0 break-words leading-tight">{r.label}{r.sub ? <span className="ml-1.5 text-[11px] font-normal text-neutral-500">{r.sub}</span> : null}</span>
            </div>
          </td>
          {rowTds(r)}
        </tr>
        {isOpen ? kids.map(renderRow) : null}
      </Fragment>
    );
  };

  const chartNote = `${b.periodNote} · ${vatNote}`;
  return (
    <section aria-label="Продажи и остатки" className="space-y-3" data-testid="dash-sales">
      <WidgetRow id="sales" title="Продажи и остатки"
        headerExtra={
          <InfoHint label="Как считаются продажи и остатки на Главной" wide>
            <p><b>Получено</b> — приход товара (штуки по строкам прихода выгрузки «поступления и продажи»), <b>Продано</b> — нетто (валовое минус возвраты), <b>Остаток</b> — приход минус продано нарастающим итогом. Числа те же, что в разделе «Продажи и остатки».</p>
            <p className="mt-1">Деньги: выручка и скидка — {vatNote} (НДС 20 % до 2026, 22 % с 2026; режим — в шапке). Сумма прихода и остатка «по себестоимости ТЗ» — себестоимость изделия с работой из ТЗ, «по прайсу 19.10» — розничная цена прайса; там, где цены или себестоимости нет, штуки в сумму не входят (охват указан под суммой).</p>
            <p className="mt-1"><b>Что действует:</b> год и НДС из шапки. Фильтры меха, цвета, партии и аукциона, источник меха и 4% к продажам не применяются: у продаж нет лотов и партий.</p>
          </InfoHint>
        }
        headerEnd={<Link href={href} data-testid="dash-sales-link" className="text-xs text-blue-700 hover:underline print:hidden">→ Продажи и остатки</Link>}>
        <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-3 print:grid-cols-3">
          {card("received", "Получено (приход)", qty(b.received), `${b.orders} заказов · ${b.articles} артикулов`, <p>Приход (Delivery): штуки строк прихода выгрузки за период, корректировки с минусом вычтены. Суммы — справочные: закупочной цены прихода в выгрузке нет.</p>)}
          {card("sold", "Продано", qty(b.sold), `нетто · валовое ${n0(b.gross)}, возвраты ${n0(b.returns)}`, <p>Нетто = валовое {n0(b.gross)} − возвраты {n0(b.returns)}. Выручка и скидка — {vatNote}. Gross — розница до скидки. Средняя цена = выручка ÷ нетто-штуки.</p>)}
          {card("stock", "Остаток", qty(b.stock), "приход − продано", <p>Расчётный остаток на конец периода{b.opening ? ` (на начало ${n0(b.opening)} шт.)` : ""}. Sell-through = продано ÷ получено за период.</p>)}
        </div>
        <p className="mt-2 text-[11px] leading-4 text-neutral-500" data-testid="dash-sales-scope">Действуют год и НДС из шапки ({chartNote}). Фильтры меха, цвета, партии, аукциона и источника на продажи не действуют.</p>
      </WidgetRow>

      <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
        <FlowChart points={b.months} />
        <SeasonChart points={b.seasons.map((s) => ({ key: s.key, sold: s.sold, revenue: s.revenue[v] }))} vatNote={vatNote} />
      </div>

      <PinSection id="sales-table" title="Продажи и остатки по типам меха" value={Array.from(rowsOpen)} onRestore={(x) => setRowsOpen(new Set(x))}
        headerExtra={
          <InfoHint label="Как читать таблицу продаж по типам меха" wide>
            <p>Строка — тип меха; «›» раскрывает до категории 1 (одежда, аксессуары), затем до категории 2. Получено, продано, выручка, цена продажи и sell-through — за выбранный год; <b>остаток</b> — на конец периода (приход минус продано нарастающим итогом).</p>
            <p className="mt-1">Цена продажи = выручка ({vatNote}) ÷ нетто-штуки. Итог «Всего» равен плиткам выше и разделу «Продажи и остатки».</p>
          </InfoHint>
        }>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white" data-keep-scroll tabIndex={0}>
          <table suppressHydrationWarning className="table-keep w-full min-w-[820px] table-fixed text-sm" data-testid="dash-sales-table">
            <colgroup><col style={{ width: 210 }} />{Array.from({ length: 6 }, (_, i) => <col key={i} />)}</colgroup>
            <thead>
              <tr className="border-b border-neutral-200">
                <TH rowSpan={2} align="left" className="sticky left-0 z-[2] bg-white px-2" label="Тип меха / категория" />
                <THGroup colSpan={3}>Штуки</THGroup>
                <THGroup colSpan={2}>Продажи, {vatNote}</THGroup>
                <TH rowSpan={2} sep label="Sell-through" unit={UNIT.pct} />
              </tr>
              <tr className="border-b border-neutral-200">
                <TH sep label="Получено" unit={UNIT.pcs} />
                <TH label="Продано" unit={UNIT.pcs} />
                <TH label="Остаток" unit={UNIT.pcs} />
                <TH sep label="Выручка" unit={UNIT.rub} />
                <TH label="Цена продажи" unit={UNIT.rubPerPcs} />
              </tr>
            </thead>
            <tbody>
              {b.rows.map(renderRow)}
              <tr className="row-total">
                <td className="sticky left-0 z-[1] bg-inherit px-2 py-1.5 text-left font-semibold"><span className="pl-5">Всего</span></td>
                {rowTds(b.total)}
              </tr>
            </tbody>
          </table>
        </div>
      </PinSection>
      <div className="print:hidden"><Link href={href} className="inline-flex min-h-11 items-center text-sm text-blue-700 hover:underline">Подробнее: Продажи и остатки →</Link></div>
      {modal}
    </section>
  );
}
