"use client";

import { Fragment, createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatPercent, formatQty, formatShare, formatNum, formatDec1, formatInt } from "@/lib/utils";
import { alignColumn, alignFlowMoney, alignRows, type Trio } from "@/lib/money-round";
import { alignRaw } from "@/lib/raw-display";
import { TotalLabel } from "@/components/total-label";
import { TH, THGroup } from "@/components/table-head";
import { UNIT } from "@/lib/units";
import { InfoHint } from "@/components/info-hint";
import type { FlowFigures } from "@/lib/fur-table";
import type { RawTableRow, VatTriple } from "@/lib/dashboard-data";
import { VatLine } from "./vat-line";
import { shortMaterialName } from "@/lib/material-name";
import { WidgetRow } from "@/components/widget-row";
import { TILE_BOX, TileHead } from "./tile";
import { BridgeHint, type ModeInfo } from "./mode-line";
import { useSlideWindow, useActiveSlideHeight } from "@/components/slide-window";
import { useClientSort } from "@/lib/use-client-sort";
import { useFurScope } from "@/components/fur-scope";
import { ALL_TYPES_LABEL, FUR_SRC_KEYS, FUR_SRC_LABEL, SegmentSwitch, TypeDots, useSrcTypeNav, type FurSrc } from "@/components/fur-source-nav";

type Pair = { incl: FlowFigures; excl: FlowFigures };

const usd = (v: number) => `$${formatNum(v, 1)}`;
const rub = (v: number) => formatMoney(v.toFixed(2));


function Card({ title, children, hint, onOpen, block }: { block?: string; title: string; children: React.ReactNode; hint?: React.ReactNode; onOpen?: () => void }) {
  return (
    <div data-hover-block={block} className={TILE_BOX + (onOpen ? " tile-click" : "")} onClick={onOpen} role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} onKeyDown={onOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } } : undefined} aria-haspopup={onOpen ? "dialog" : undefined} title={onOpen ? "Показать цены по видам сырья" : undefined}>
      <TileHead>{title}</TileHead>
      {hint ? <div className="absolute right-3 top-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{hint}</div> : null}
      {children}
    </div>
  );
}

const CompactCtx = createContext(false);
/** Зарезервированные строки пояснения под цифрой: высота одинакова во всех плитках общего ряда. */
function SubLines({ n, lines = [] }: { n: number; lines?: string[] }) {
  return <div className="subl" style={{ minHeight: `${n}rem` }}>{lines.map((l, i) => <div key={i} className="whitespace-nowrap">{l}</div>)}</div>;
}

/** Строка плитки: подпись, цифра, пояснение — высоты зарезервированы, чтобы строки трёх плиток стояли на одном уровне. */
function Row({ k, v, sub, strong, onClick }: { k: React.ReactNode; v: React.ReactNode; sub?: React.ReactNode; strong?: boolean; onClick?: () => void }) {
  const compact = useContext(CompactCtx);
  if (compact) {
    return (
      <div className="mt-2 first:mt-1">
        <div className="min-h-4 whitespace-nowrap text-[11px] leading-4 text-neutral-500">{k}</div>
        <div className={(strong ? "text-base font-semibold " : "text-sm font-medium ") + "min-h-6 whitespace-nowrap leading-6 tabular-nums text-neutral-900"}>{v}</div>
        {sub ? <div className="text-[11px] leading-4 text-neutral-500">{sub}</div> : null}
      </div>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-haspopup="dialog" title="Показать по видам сырья" className="mt-2 block w-full rounded text-left first:mt-1 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">
        <div className="min-h-4 text-[11px] leading-4 text-neutral-500">{k}</div>
        <div className={(strong ? "text-base font-semibold " : "text-sm font-medium ") + "min-h-6 break-words leading-6 tabular-nums text-neutral-900 underline decoration-dotted decoration-neutral-300 underline-offset-4"}>{v}</div>
        {sub ? <div className="text-[11px] leading-4 text-neutral-500">{sub}</div> : null}
      </button>
    );
  }
  return (
    <div className="mt-2 first:mt-1">
      <div className="min-h-4 text-[11px] leading-4 text-neutral-500">{k}</div>
      <div className={(strong ? "text-base font-semibold " : "text-sm font-medium ") + "min-h-6 break-words leading-6 tabular-nums text-neutral-900"}>{v}</div>
      {sub ? <div className="text-[11px] leading-4 text-neutral-500">{sub}</div> : null}
    </div>
  );
}

/** Две строки плитки рядом (штуки и деньги, цены в ₽ и в $). */
function Duo({ children }: { children: React.ReactNode }) {
  if (useContext(CompactCtx)) return <div className="mt-2 first:mt-1">{children}</div>;
  return <div className="mt-2 grid grid-cols-1 gap-x-2 first:mt-1 xl:grid-cols-2 [&>*]:!mt-2 xl:[&>*]:!mt-0 [&_.tabular-nums]:whitespace-nowrap">{children}</div>;
}

/** Слайд ряда «Сырьё | Оплаты»: плитки одного вида меха (или «Вся закупка») + то, что под ними (разбивка «Куплено»). */
export type RawSlide = { key: string; label: string; fur: Pair; lining: Pair; pay: React.ReactNode; below?: React.ReactNode; /** Строка под цифрами «Куплено» (доля от «Вся закупка» на слайдах источников и доля вида в источнике). */ recvNote?: React.ReactNode };

/** Ряд плиток «Куплено / Использовано / Остаток» по меху или подкладке (Главная и страница «Сырьё»).
 *  Если передан pay (три плитки оплат), они встают в ТОТ ЖЕ ряд: «Сырьё | Оплаты» — шесть плиток в одну строку на мониторе, тонкая линия между группами. */
export function RawCards({ view, rows, fur, lining, c4, vatRates, pay, headerEnd, titleSuffix, headerExtra, slides, slideWindow }: { /** Слайды ряда: плитки всех слайдов лежат в одной ленте с прокруткой вправо-влево (колесо, тачпад, свайп, перетаскивание), заголовок ряда остаётся на месте. rows/fur/lining — текущего слайда (для окна цен). */ slides?: RawSlide[]; slideWindow?: ReturnType<typeof useSlideWindow>; /** Подпись текущего слайда в заголовке ряда («· Лиса»). */ titleSuffix?: string; /** Элементы рядом с заголовком (стрелки и точки слайдов). */ headerExtra?: React.ReactNode; view: "fur" | "lining"; rows: RawTableRow[]; fur: Pair; lining: Pair; c4: "on" | "off"; vatRates?: VatTriple; /** Плитки оплат (PayTiles bare) — вторая группа ряда. */ pay?: React.ReactNode; /** Ссылка «→ Раздел» над кнопками «Свернуть/Закрепить». */ headerEnd?: React.ReactNode; /** Устарело: заголовок ряда теперь всегда в WidgetRow. */ hideLabel?: boolean }) {
  const { mode: vat } = useVatDisplay();
  const [priceCol, setPriceCol] = useState<null | "recv" | "used" | "rem">(null);
  const noScroller = useRef<HTMLDivElement>(null);
  useActiveSlideHeight(slideWindow?.scroller ?? noScroller, slideWindow?.cur ?? 0);
  const modal = priceCol ? <PriceModal col={priceCol} rows={rows.filter((r) => r.kind === view)} vat={vat} fur={view === "lining" ? null : fur[vat]} lining={view === "fur" ? null : lining[vat]} c4={c4} onClose={() => setPriceCol(null)} /> : null;
  if (slides && slideWindow) {
    const { scroller, onScroll, dragProps, cur, step } = slideWindow;
    return (
      <WidgetRow id={`raw-${view}`} title={(view === "fur" ? "Сырьё и оплаты — мех" : "Сырьё и оплаты — подкладка") + (titleSuffix ? ` · ${titleSuffix}` : "")} headerEnd={headerEnd}>
        {/* Управление слайдами (источник, типы) — отдельной строкой над плитками: в шапке ряда на телефоне ему не хватает места. */}
        {headerExtra ? <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-1">{headerExtra}</div> : null}
        <div ref={scroller} onScroll={onScroll} {...dragProps} tabIndex={0} data-testid="raw-slides" role="group" aria-roledescription="карусель" aria-label="Сырьё и оплаты: слайды по видам"
          onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "ArrowRight") { e.preventDefault(); step(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); } }}
          className="-mx-1 flex snap-x snap-mandatory items-start overflow-x-auto overscroll-x-contain motion-safe:scroll-smooth [scrollbar-width:none] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 [&::-webkit-scrollbar]:hidden">
          {slides.map((s, i) => (
            <div key={s.key || "all"} data-slide={s.key || "all"} role="group" aria-roledescription="слайд" aria-label={`${s.label}, ${i + 1} из ${slides.length}`} aria-hidden={i !== cur} className="min-w-full max-w-full snap-start px-1">
              <div className="raw-row raw-row-pay">
                <div className="raw-group" role="group" aria-label="Сырьё">
                  <div className="raw-group-label">Сырьё</div>
                  <div className="raw-tiles">
                    <RawTriple view={view} fur={s.fur} lining={s.lining} c4={c4} compact onOpen={setPriceCol} vatRates={i === cur ? vatRates : undefined} recvNote={s.recvNote} />
                  </div>
                </div>
                <div className="raw-divider" aria-hidden />
                <div className="raw-group" role="group" aria-label="Оплаты">
                  <div className="raw-group-label">Оплаты</div>
                  <div className="raw-tiles raw-pay">{s.pay}</div>
                </div>
              </div>
              {s.below}
            </div>
          ))}
        </div>
        {modal}
      </WidgetRow>
    );
  }
  if (pay) {
    return (
      <WidgetRow id={`raw-${view}`} title={(view === "fur" ? "Сырьё и оплаты — мех" : "Сырьё и оплаты — подкладка") + (titleSuffix ? ` · ${titleSuffix}` : "")} headerExtra={headerExtra} headerEnd={headerEnd}>
        <div className="raw-row raw-row-pay">
          <div className="raw-group" role="group" aria-label="Сырьё">
            <div className="raw-group-label">Сырьё</div>
            <div className="raw-tiles">
              <RawTriple view={view} fur={fur} lining={lining} c4={c4} compact onOpen={setPriceCol} vatRates={vatRates} />
            </div>
          </div>
          <div className="raw-divider" aria-hidden />
          <div className="raw-group" role="group" aria-label="Оплаты">
            <div className="raw-group-label">Оплаты</div>
            <div className="raw-tiles raw-pay">{pay}</div>
          </div>
        </div>
        {modal}
      </WidgetRow>
    );
  }
  return (
    <WidgetRow id={`raw-${view}`} title={(view === "fur" ? "Сырьё — мех" : "Сырьё — подкладка") + (titleSuffix ? ` · ${titleSuffix}` : "")} headerExtra={headerExtra} headerEnd={headerEnd}>
      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-3 print:grid-cols-3">
        <RawTriple view={view} fur={fur} lining={lining} c4={c4} onOpen={setPriceCol} vatRates={vatRates} />
      </div>
      {modal}
    </WidgetRow>
  );
}

/** Три плитки «Куплено / Использовано / Остаток» по меху или подкладке. compact — узкая раскладка для общего ряда из шести плиток:
 *  поля стоят в столбик с зарезервированной высотой, поэтому одинаковые строки лежат на одной горизонтали во всех шести плитках. */
function RawTriple({ view, fur, lining, c4, onOpen: setPriceCol, compact = false, vatRates, recvNote, noOpen = false }: { /** Слайды-источники: окно цен по видам считается по всему меху, поэтому плитки не открывают его. */ noOpen?: boolean; recvNote?: React.ReactNode; view: "fur" | "lining"; fur: Pair; lining: Pair; c4: "on" | "off"; onOpen: (c: "recv" | "used" | "rem") => void; compact?: boolean; vatRates?: VatTriple }) {
  const { mode: vat } = useVatDisplay();
  // Деньги показываем целыми рублями так, чтобы куплено = использовано + остаток (правило округления: src/lib/money-round.ts).
  const F = alignFlowMoney(fur[vat], c4 === "on");
  const L = alignFlowMoney(lining[vat], c4 === "on");
  const unit = view === "lining" ? "м" : "шт.";
  // Шкуры — целые числа; подкладка в метрах — с одним знаком.
  const qtyF = (v: number | null | undefined) => (view === "lining" ? formatDec1(v) : formatInt(v));
  const cur = view === "lining" ? L : F;
  const all = false as boolean; // «Всё» убрано: мех и подкладка — отдельными рядами плиток
  const usdTile = view === "fur";

  const usdBought = (() => {
    if (view === "lining") return { main: <span title="Подкладка закупается без цены в долларах">–</span>, note: "подкладка закупается без цены в долларах" };
    if (F.usdQty <= 0 || F.usdAvg == null) return { main: <span title="Нет лотов с ценой в USD">–</span>, note: "в выбранном срезе нет лотов с ценой в USD" };
    const share = F.recvQty > 0 ? (F.usdQty / F.recvQty) * 100 : 0;
    const b = F.usdBySource;
    const parts = [
      b.direct > 0 ? `в долларах в расчёте лота — ${formatQty(b.direct)}` : null,
      b.eur > 0 ? `евро × курс EUR→USD из расчёта — ${formatQty(b.eur)}` : null,
      b.rub > 0 ? `молоток ₽ ÷ курс USD/RUB из расчёта — ${formatQty(b.rub)}` : null,
      b.calc > 0 ? `цена $ из расчётного листа — ${formatQty(b.calc)}` : null,
    ].filter(Boolean).join("; ");
    return {
      main: usd(F.usdAvg),
      note: `по ${qtyF(F.usdQty)} из ${qtyF(F.recvQty)} шт. с ценой в USD (${formatPercent(share)})`,
      hint: `Источники цены, шт.: ${parts || "–"}. Остальные лоты — без цены в USD (только рубли или нет курса в документах).`,
    };
  })();

  /** Под ценой в $: по скольким штукам из скольких посчитана средняя (у остальных нет цены в $ в расчёте лота). */
  const usdSub = (have: number | null | undefined, of: number) => (of > 0 ? <span className="text-[11px] font-normal text-neutral-500">по {formatQty(have ?? 0)} из {formatQty(of)} шт.</span> : undefined);
  const px = (q: number | null | undefined, of: number) => (q != null && q > 0 ? `по ${formatQty(q)} из ${formatQty(of)} шт.` : "");
  const sumNow = (k: "recvValue" | "remValue" | "usedValue" | "usedValueOther") => (all ? F[k] + L[k] : cur[k]);
  // «Использовано»: сумма без 4% и под ней с 4% — независимо от режима шапки.
  const usedNo4 = c4 === "on" ? sumNow("usedValueOther") : sumNow("usedValue");
  const usedWith4 = c4 === "on" ? sumNow("usedValue") : sumNow("usedValueOther");
  const usedQtyNow = all ? 0 : cur.usedQty;

  const priceUnit = unit === "м" ? "м" : "шт.";
  // Невидимая строка высотой с «с 4%» в «Использовано»: цены во всех трёх плитках стоят на одном уровне.
  const ghost = <span aria-hidden className="invisible">{`с 4%: ${rub(usedWith4)} · надбавка ${rub(usedWith4 - usedNo4)}`}</span>;
  // Доля от купленного: сколько ушло в ТЗ и сколько лежит на складе.
  const share = (part: number, whole: number) => (whole > 0 ? formatShare(part / whole) : null);
  const lab = (base: string, part: number, whole: number) => (compact && whole > 0 ? `${base} · ${share(part, whole)}` : base);
  const withShare = (part: number, whole: number, text: string) => compact ? text : (
    <>
      {whole > 0 ? <span className="mr-1 text-xs font-medium text-neutral-500">{share(part, whole)} ·</span> : null}
      {text}
    </>
  );

  return (
    <CompactCtx.Provider value={compact}>
        <Card block={view} title="Куплено" onOpen={noOpen ? undefined : () => setPriceCol("recv")} hint={all ? undefined : (
          <InfoHint label="О «Куплено»" align="right">
            <p>Сумма — всегда без 4%. Цена — средневзвешенная.</p>
            {usdTile && usdBought ? <p className="mt-1">Цена $: {usdBought.note}.</p> : null}
            {view === "lining" ? <p className="mt-1">Подкладка закупается без цены в долларах.</p> : null}
          </InfoHint>
        )}>
          {all ? (
            <Row k="Сумма, ₽ (мех + подкладка)" v={rub(F.recvValue + L.recvValue)} strong />
          ) : (
            <>
              <Duo>
                <Row k={compact ? "Количество" : <>Количество<span aria-hidden className="invisible"> (доля от купленного)</span></>} v={`${qtyF(cur.recvQty)} ${unit}`} strong />
                <Row k="Сумма" v={rub(cur.recvValue)} strong sub={compact ? <SubLines n={2} /> : ghost} />
              </Duo>
              <Duo>
                <Row k={`Цена, ₽/${priceUnit}`} sub={compact ? <SubLines n={1} /> : undefined} v={cur.recvAvg != null ? rub(cur.recvAvg) : "–"} />
                {usdTile && usdBought ? <Row k="Цена, $/шт." v={usdBought.main} sub={usdSub(F.usdQty, F.recvQty)} /> : null}
              </Duo>
              {recvNote ? <div className="mt-2 text-[11px] leading-4 text-neutral-500" data-testid="recv-share">{recvNote}</div> : null}
              {vatRates ? <VatLine v={vatRates.recv} minRem={compact ? 3 : 1} className="mt-auto pt-2" /> : null}
            </>
          )}
        </Card>

        <Card block={view} title="Использовано" onOpen={noOpen ? undefined : () => setPriceCol("used")} hint={
          <InfoHint label="О «Использовано»" align="right">
            <p>Показаны обе суммы: без 4% и под ней с 4% (надбавка начисляется при списании в ТЗ). Режим шапки на эти две строки не влияет.</p>
            {usdTile && F.usdUsedAvg != null ? <p className="mt-1">Цена $ — {px(F.usdUsedQty, F.usedQty)} с ценой в USD.</p> : null}
          </InfoHint>
        }>
          {all ? (
            <>
              <Row k="Сумма без 4%, ₽ (мех + подкладка)" v={rub(usedNo4)} strong sub={`с 4%: ${rub(usedWith4)} · надбавка ${rub(usedWith4 - usedNo4)}`} />
            </>
          ) : (
            <>
              <Duo>
                <Row k={compact ? lab("Количество", cur.usedQty, cur.recvQty) : "Количество (доля от купленного)"} v={withShare(cur.usedQty, cur.recvQty, `${qtyF(cur.usedQty)} ${unit}`)} strong />
                <Row k={lab("Сумма", usedNo4, cur.recvValue)} v={withShare(usedNo4, cur.recvValue, rub(usedNo4))} strong sub={compact ? <SubLines n={2} lines={[`с 4%: ${rub(usedWith4)}`, `надбавка ${rub(usedWith4 - usedNo4)}`]} /> : `с 4%: ${rub(usedWith4)} · надбавка ${rub(usedWith4 - usedNo4)}`} />
              </Duo>
              <Duo>
                <Row k={`Цена, ₽/${priceUnit}`} v={usedQtyNow > 0 ? rub(usedNo4 / usedQtyNow) : "–"} sub={compact ? <SubLines n={1} lines={usedQtyNow > 0 ? [`с 4%: ${rub(usedWith4 / usedQtyNow)}`] : []} /> : usedQtyNow > 0 ? `с 4%: ${rub(usedWith4 / usedQtyNow)}` : undefined} />
                {usdTile ? <Row k="Цена, $/шт." v={F.usdUsedAvg != null ? usd(F.usdUsedAvg) : <span title="Нет лотов с ценой в USD">–</span>} sub={usdSub(F.usdUsedQty, F.usedQty)} /> : null}
              </Duo>
              {vatRates ? <VatLine v={vatRates.used} minRem={compact ? 3 : 1} className="mt-auto pt-2" /> : null}
            </>
          )}
        </Card>

        <Card block={view} title="Остаток" onOpen={noOpen ? undefined : () => setPriceCol("rem")} hint={all ? undefined : (
          <InfoHint label="Об «Остатке»" align="right">
            <p>На складе по цене закупки лотов; всегда без 4%.</p>
            {usdTile && F.usdRemAvg != null ? <p className="mt-1">Цена $ — {px(F.usdRemQty, F.remQty)} с ценой в USD.</p> : null}
          </InfoHint>
        )}>
          {all ? (
            <Row k="Сумма, ₽ (мех + подкладка)" v={rub(F.remValue + L.remValue)} strong />
          ) : (
            <>
              <Duo>
                <Row k={compact ? lab("Количество", cur.remQty, cur.recvQty) : "Количество (доля от купленного)"} v={withShare(cur.remQty, cur.recvQty, `${qtyF(cur.remQty)} ${unit}`)} strong />
                <Row k={lab("Сумма", cur.remValue, cur.recvValue)} v={withShare(cur.remValue, cur.recvValue, rub(cur.remValue))} strong sub={compact ? <SubLines n={2} /> : ghost} />
              </Duo>
              <Duo>
                <Row k={`Цена, ₽/${priceUnit}`} sub={compact ? <SubLines n={1} /> : undefined} v={cur.remAvg != null ? rub(cur.remAvg) : "–"} />
                {usdTile ? <Row k="Цена, $/шт." v={F.usdRemAvg != null ? usd(F.usdRemAvg) : <span title="Нет лотов с ценой в USD">–</span>} sub={usdSub(F.usdRemQty, F.remQty)} /> : null}
              </Duo>
              {vatRates ? <VatLine v={vatRates.rem} minRem={compact ? 3 : 1} className="mt-auto pt-2" /> : null}
            </>
          )}
        </Card>
    </CompactCtx.Provider>
  );
}

const MAIN_FUR_TILES = ["Соболь", "Норка", "Рысь", "Свакара", "Лиса"];
const OTHER_FUR_LABEL = "Остальной мех";
const sumFlow = (list: FlowFigures[]): FlowFigures => list.reduce((a, f) => ({ ...a, recvQty: a.recvQty + f.recvQty, recvValue: a.recvValue + f.recvValue, usedQty: a.usedQty + f.usedQty, usedValue: a.usedValue + f.usedValue, usedValueOther: a.usedValueOther + f.usedValueOther, remQty: a.remQty + f.remQty, remValue: a.remValue + f.remValue }), { ...list[0], recvQty: 0, recvValue: 0, usedQty: 0, usedValue: 0, usedValueOther: 0, remQty: 0, remValue: 0 });
/** Плитки меха: виды вне основных сворачиваются в «Остальной мех» (какие именно — видно в таблице). */
function collapseFurTypes<T extends { name: string; pair: Pair }>(types: T[]): { name: string; pair: Pair }[] {
  const main = types.filter((t) => MAIN_FUR_TILES.includes(t.name));
  const rest = types.filter((t) => !MAIN_FUR_TILES.includes(t.name));
  if (rest.length === 0) return main;
  if (rest.length === 1 && main.length === 0) return types;
  return [...main, { name: OTHER_FUR_LABEL, pair: { incl: sumFlow(rest.map((t) => t.pair.incl)), excl: sumFlow(rest.map((t) => t.pair.excl)) } }];
}

export function RawBlock({ href = "/lots", rows, fur: furIn, lining: liningIn, c4, lots, info, orderFilters, vat: vatRates, furSrc: furSrcIn }: { /** Мех по источнику × типу (готовые числа с сервера, с теми же фильтрами Главной). */ furSrc: Record<FurSrc, { total: Pair; types: { name: string; pair: Pair }[] }>; rows: RawTableRow[]; fur: Pair; lining: Pair; c4: "on" | "off"; lots: number; info: ModeInfo; orderFilters: boolean; vat?: { fur: VatTriple; lining: VatTriple }; /** «→ Сырьё» с фильтрами Главной. */ href?: string }) {
  void info;
  const { mode: vat } = useVatDisplay();
  // Деньги — целые рубли, складывающиеся везде: мех + подкладка = всего, виды = источник, куплено = использовано + остаток (src/lib/money-round.ts).
  const { fur, lining, furSrc } = alignRaw(furIn, liningIn, furSrcIn, c4);
  const vatW = vat === "incl" ? "с НДС" : "без НДС";
  const c4W = c4 === "on" ? "с 4%" : "без 4%";
  const [pc, setPc] = useState<null | { view: "fur" | "lining"; col: "recv" | "used" | "rem" }>(null);
  const [srcOpen, setSrcOpen] = useState(false);
  const extra = (
    <>
      <InfoHint label="Как считаются плитки сырья" wide>
        <p><b>Цена</b> — средневзвешенная: Σ ₽ ÷ Σ шт. (подкладка — ÷ Σ м), как в таблице «Сырьё». Нажмите на плитку — цены по видам.</p>
        <p className="mt-1"><b>Режимы.</b> Цены {vatW}, «Использовано» — {c4W}. 4% начисляется при списании в ТЗ, поэтому «Куплено» и «Остаток» всегда без 4%. «в т.ч. НДС» — по ставке каждого лота (20% или 22%); при «Без НДС» эта сумма в цену не входит.</p>
        <p className="mt-1"><b>Сходится:</b> куплено = использовано (без 4%) + остаток, отдельно для меха и подкладки.</p>
        <p className="mt-1"><b>Цена в долларах</b> — молоток за шкуру из документов лота: доллары, евро по курсу EUR→USD, рубли по курсу USD/RUB или цена $ из расчётного листа. Лоты без таких данных в среднюю $ не входят. У подкладки цены в долларах нет.</p>
        <p className="mt-1">Бобр подрядчика (без лотов закупки) смотрите в «Производство» и «Изделия».</p>
      </InfoHint>
      {orderFilters ? (
        <BridgeHint label="Фильтр по ТЗ" warn>
          <p>Выбран фильтр по ТЗ: «Использовано» — только в выбранных ТЗ, остальное списание в «Остаток» не попадает, поэтому куплено − использовано ≠ остаток.</p>
        </BridgeHint>
      ) : null}
    </>
  );
  const groups: { view: "fur" | "lining"; label: string }[] = [{ view: "fur", label: "Мех" }, { view: "lining", label: "Подкладка" }];
  // Группа «Мех»: сверху источник («Вся закупка | На аукционах | У поставщика»), под ним слайды по типам меха внутри источника: «Все типы» → Лиса → Норка → …
  const scope = useFurScope();
  const tileTypes = { all: collapseFurTypes(furSrc.all.types), auction: collapseFurTypes(furSrc.auction.types), supplier: collapseFurTypes(furSrc.supplier.types) };
  const nav = useSrcTypeNav({ all: tileTypes.all.map((t) => t.name), auction: tileTypes.auction.map((t) => t.name), supplier: tileTypes.supplier.map((t) => t.name) }, "all", scope ?? undefined);
  const { scroller, onScroll, dragProps, cur, step, goTo, maxStart } = nav.sw;
  useActiveSlideHeight(scroller, cur);
  const block = furSrc[nav.src];
  const slidesF = [{ key: "", label: ALL_TYPES_LABEL, fur: block.total }, ...tileTypes[nav.src].map((t) => ({ key: t.name, label: t.name, fur: t.pair }))];
  const slideNow = slidesF[Math.min(cur, slidesF.length - 1)];
  const pct = (a: number, b: number) => (b > 0 ? formatPercent((a / b) * 100) : "–");
  const share = (p: Pair, of: Pair, what: string, from: string) => <span title={`${what} в «${from}» по количеству и по сумме`}>{what}: {pct(p[vat].recvQty, of[vat].recvQty)} шт. · {pct(p[vat].recvValue, of[vat].recvValue)} ₽</span>;
  const noteOf = (key: string, p: Pair) => {
    if (!key) return nav.src === "all" ? undefined : share(p, furSrc.all.total, "Доля", FUR_SRC_LABEL.all);
    return share(p, block.total, "Доля вида", FUR_SRC_LABEL[nav.src]);
  };
  const emptyVat = { recv: {}, used: {}, rem: {} } as VatTriple;
  const used$ = (f: FlowFigures) => (c4 === "on" ? f.usedValueOther : f.usedValue);
  const same = (a: FlowFigures, b: FlowFigures, g: (f: FlowFigures) => number) => Math.abs(g(a) - g(b)) < 0.5;
  const eqAll = (a: FlowFigures, b: FlowFigures) => [(f: FlowFigures) => f.recvQty, (f: FlowFigures) => f.recvValue, (f: FlowFigures) => f.usedQty, used$, (f: FlowFigures) => f.remQty, (f: FlowFigures) => f.remValue].every((g) => same(a, b, g));
  const sumFig = (list: FlowFigures[]): FlowFigures => list.reduce((a, f) => ({ ...a, recvQty: a.recvQty + f.recvQty, recvValue: a.recvValue + f.recvValue, usedQty: a.usedQty + f.usedQty, usedValue: a.usedValue + f.usedValue, usedValueOther: a.usedValueOther + f.usedValueOther, remQty: a.remQty + f.remQty, remValue: a.remValue + f.remValue }), { ...list[0], recvQty: 0, recvValue: 0, usedQty: 0, usedValue: 0, usedValueOther: 0, remQty: 0, remValue: 0 });
  const sumOk = FUR_SRC_KEYS.every((k) => furSrc[k].types.length === 0 || eqAll(furSrc[k].total[vat], sumFig(furSrc[k].types.map((t) => t.pair[vat]))))
    && eqAll(furSrc.all.total[vat], sumFig([furSrc.auction.total[vat], furSrc.supplier.total[vat]]));
  const slideCtl = (
    <>
      {scope ? null : <SegmentSwitch label="Источник закупки меха" value={nav.src} onChange={nav.pick} options={FUR_SRC_KEYS.map((k) => ({ key: k, label: FUR_SRC_LABEL[k] }))} />}
      <TypeDots accent labels={slidesF.map((x) => x.label)} cur={cur} goTo={goTo} step={step} last={maxStart} />
    </>
  );
  const srcHint = (
    <InfoHint label="Что такое источник закупки и типы меха" align="left" wide>
      <p><b>На аукционах</b> — закупки, привязанные к аукциону справочника (SAGA, Kopenhagen, Fur Harvesters, AME, Союзпушнина, Русьпушнина), включая заказанное, но не полученное: лотов по нему нет, остаток = заказанное количество.</p>
      <p className="mt-1"><b>У поставщика</b> — закупки напрямую у поставщика или фермы и шкуры подрядчика (сырьё Веллмех в счетах за пошив; учтены как «Свакара»).</p>
      <p className="mt-1">«На аукционах» + «У поставщика» = «Вся закупка»{sumOk ? "" : " (с разницей округления)"}; сумма типов = «Все типы» источника. Внутри источника листаются типы меха. НДС, 4% и фильтры применяются так же, как во всей закупке.</p>
    </InfoHint>
  );
  return (
    <section aria-labelledby="dash-raw">
      <h2 id="dash-raw" className="sr-only">Сырьё</h2>
      <WidgetRow id="raw" title="Сырьё" titleClass="text-sm font-semibold" headerExtra={extra}
        headerEnd={<Link href={href} title={`${lots} лотов`} className="text-xs text-blue-700 hover:underline print:hidden">→ Сырьё</Link>}>
        <div className="raw-row raw-row-fl">
          {groups.map((g, i) => (
            <Fragment key={g.view}>
              {i > 0 ? <div className="raw-divider" aria-hidden /> : null}
              <div className="raw-group" role="group" aria-label={g.label}>
                {g.view === "fur" ? (
                  <>
                    <div className="raw-group-label flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="fur-slide-label">
                      <span>{g.label} · {FUR_SRC_LABEL[nav.src]}{slideNow?.key ? <> · <span className="font-semibold text-orange-700" data-testid="fur-type-now">{slideNow.label}</span></> : ""}</span>{slideCtl}{srcHint}
                    </div>
                    <div ref={scroller} onScroll={onScroll} {...dragProps} tabIndex={0} data-testid="fur-slides" role="group" aria-roledescription="карусель" aria-label={`Мех · ${FUR_SRC_LABEL[nav.src]}: слайды по типам меха`}
                      onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "ArrowRight") { e.preventDefault(); step(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); } }}
                      className="-mx-1 flex snap-x snap-mandatory items-start md:items-stretch overflow-x-auto overscroll-x-contain motion-safe:scroll-smooth [scrollbar-width:none] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 [&::-webkit-scrollbar]:hidden">
                      {slidesF.map((x, i) => (
                        <div key={`${nav.src}:${x.key || "all"}`} data-slide={`${nav.src}:${x.key || "all"}`} role="group" aria-roledescription="слайд" aria-label={`${x.label}, ${i + 1} из ${slidesF.length}`} aria-hidden={i !== cur} className="min-w-full max-w-full snap-start px-1 md:h-full">
                          <div className="raw-tiles md:h-full">
                            <RawTriple view="fur" fur={x.fur} lining={lining} c4={c4} compact onOpen={nav.src !== "all" || i > 0 ? () => setSrcOpen(true) : (col) => setPc({ view: "fur", col })} vatRates={nav.src === "all" && i === 0 ? vatRates?.fur : vatRates ? emptyVat : undefined} recvNote={noteOf(x.key, x.fur)} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="raw-group-label">{g.label}</div>
                    <div className="raw-tiles">
                      <RawTriple view={g.view} fur={fur} lining={lining} c4={c4} compact onOpen={(col) => setPc({ view: g.view, col })} vatRates={vatRates?.[g.view]} />
                    </div>
                  </>
                )}
              </div>
            </Fragment>
          ))}
        </div>
        {srcOpen ? <SrcModal src={nav.src} active={slideNow?.key ?? ""} types={block.types} total={block.total} vat={vat} c4={c4} onClose={() => setSrcOpen(false)} /> : null}
        {pc ? <PriceModal col={pc.col} rows={rows.filter((r) => r.kind === pc.view)} vat={vat} fur={pc.view === "lining" ? null : fur[vat]} lining={pc.view === "fur" ? null : lining[vat]} c4={c4} onClose={() => setPc(null)} /> : null}
      </WidgetRow>
    </section>
  );
}

/** Мех одного источника («На аукционах» / «У поставщика» / «Вся закупка» на слайде типа): по видам меха — куплено, использовано, остаток. Итог = сумма видов; активный тип подсвечен оранжевым. */
function SrcModal({ src, active, types, total, vat, c4, onClose }: { src: FurSrc; active: string; types: { name: string; pair: Pair }[]; total: Pair; vat: "incl" | "excl"; c4: "on" | "off"; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const used = (f: FlowFigures) => (c4 === "on" ? f.usedValueOther : f.usedValue);
  const tot = total[vat];
  const cs = useClientSort<{ name: string; pair: Pair }>({
    name: (t) => t.name, rq: (t) => t.pair[vat].recvQty, rv: (t) => t.pair[vat].recvValue, uq: (t) => t.pair[vat].usedQty, uv: (t) => used(t.pair[vat]), mq: (t) => t.pair[vat].remQty, mv: (t) => t.pair[vat].remValue,
  });
  const qtyF = formatInt;
  const num = "whitespace-nowrap px-2 py-1.5 text-right tabular-nums";
  const cells = (f: FlowFigures) => (
    <>
      <td className={num + " border-l border-neutral-200"}>{qtyF(f.recvQty)} шт.</td><td className={num}>{rub(f.recvValue)}</td>
      <td className={num + " border-l border-neutral-200"}>{qtyF(f.usedQty)} шт.</td><td className={num}>{rub(used(f))}</td>
      <td className={num + " border-l border-neutral-200"}>{formatQty(f.remQty)} шт.</td><td className={num}>{rub(f.remValue)}</td>
    </>
  );
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }} className="m-auto w-[calc(100vw-2rem)] max-w-4xl rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40">
      <div className="max-h-[88vh] overflow-auto p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Мех по видам · куплено, использовано, остаток</div>
            <div className="text-lg font-semibold">{FUR_SRC_LABEL[src]}</div>
          </div>
          <button type="button" onClick={() => ref.current?.close()} className="min-h-11 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">✕ Закрыть</button>
        </div>
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr>
              <THGroup sep={false} colSpan={1}>{" "}</THGroup>
              <THGroup colSpan={2}>Куплено</THGroup><THGroup colSpan={2}>Использовано (без 4%)</THGroup><THGroup colSpan={2}>Остаток</THGroup>
            </tr>
            <tr className="border-b border-neutral-200">
              <TH align="left" label="Вид" {...cs.th("name")} />
              {[0, 1, 2].flatMap((g) => [<TH key={`q${g}`} sep label="Кол-во" unit="шт." {...cs.th(["rq", "uq", "mq"][g])} />, <TH key={`v${g}`} label="Сумма" unit={UNIT.rub} {...cs.th(["rv", "uv", "mv"][g])} />])}
            </tr>
          </thead>
          <tbody>
            {cs.sort(types).map((t) => {
              const on = t.name === active;
              return (
                <tr key={t.name} data-active={on || undefined} className={"border-b border-neutral-100 " + (on ? "bg-orange-50" : "")}>
                  <td className={"px-2 py-1.5 " + (on ? "border-l-4 border-orange-500 font-semibold text-orange-800" : "")}>
                    {<Link href={`/lots/fur/${encodeURIComponent(t.name)}`} className="hover:underline focus-visible:underline">{shortMaterialName(t.name)}<span aria-hidden className="ml-1 text-[11px] text-neutral-400">↗</span></Link>}
                  </td>
                  {cells(t.pair[vat])}
                </tr>
              );
            })}
            <tr className={"row-total"}>
              <td className="px-2 py-1.5"><TotalLabel /></td>
              {cells(tot)}
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-[11px] leading-4 text-neutral-500">Куплено = использовано (без 4%) + остаток. В «У поставщика» к «Свакаре» добавлены шкуры подрядчика; заказанное, но не полученное входит в «На аукционах».</p>
      </div>
    </dialog>
  );
}

const COL_TITLE = { recv: "Куплено", used: "Использовано", rem: "Остаток" } as const;

/** Цены по видам сырья для выбранной колонки (куплено / использовано / остаток): количество, сумма, средняя цена ₽ и $. */
function PriceModal({ col, rows, vat, fur, lining, c4, onClose }: { col: "recv" | "used" | "rem"; rows: RawTableRow[]; vat: "incl" | "excl"; fur: FlowFigures | null; lining: FlowFigures | null; c4: "on" | "off"; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  // Суммы по видам — целые рубли, складывающиеся в итог (src/lib/money-round.ts): строки выравниваются под итог вида сырья.
  const al = (() => {
    const byKey = new Map<string, Trio>();
    const tot: Partial<Record<"fur" | "lining", Trio>> = {};
    for (const [kind, f] of [["fur", fur], ["lining", lining]] as const) {
      const rs = rows.filter((r) => r.kind === kind);
      if (rs.length === 0 || !f) continue;
      const a = alignRows(rs.map((r) => ({ r: r.cells[vat].rv, u: r.cells[vat].uv, m: r.cells[vat].mv })), { r: f.recvValue, u: c4 === "on" ? f.usedValueOther : f.usedValue, m: f.remValue });
      rs.forEach((r, i) => byKey.set(r.key, a.rows[i]));
      tot[kind] = a.total;
    }
    return { byKey, tot };
  })();
  const pickV = (t: Trio | undefined, raw: number) => (t ? (col === "recv" ? t.r : col === "used" ? t.u : t.m) : raw);
  const pick = (r: RawTableRow) => {
    const c = r.cells[vat];
    const u = r.usd;
    const base = col === "recv" ? { q: c.rq, v: pickV(al.byKey.get(r.key), c.rv), a: c.ra, d: u.bought } : col === "used" ? { q: c.uq, v: pickV(al.byKey.get(r.key), c.uv), a: c.ua, d: u.used } : { q: c.mq, v: pickV(al.byKey.get(r.key), c.mv), a: c.ma, d: u.rem };
    return { ...base, rq: c.rq };
  };
  const list = rows.map((r) => ({ r, ...pick(r) })).filter((x) => x.q > 0);
  const kinds: ("fur" | "lining")[] = ["fur", "lining"];
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [restOpen, setRestOpen] = useState(false);
  const pcs = useClientSort<{ r: RawTableRow; q: number; v: number; a: number | null; d: number | null; rq: number }>({ name: (x) => x.r.label, share: (x) => (x.rq > 0 ? x.q / x.rq : null), q: (x) => x.q, v: (x) => x.v, a: (x) => x.a, d: (x) => x.d });
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const pickYear = (c: RawTableRow["years"][number]["cells"], u: RawTableRow["usd"]) => { const x = c[vat]; const b = col === "recv" ? { q: x.rq, v: x.rv, a: x.ra, d: u.bought } : col === "used" ? { q: x.uq, v: x.uv, a: x.ua, d: u.used } : { q: x.mq, v: x.mv, a: x.ma, d: u.rem }; return { ...b, rq: x.rq }; };
  // Цена в долларах есть только у меха: в окне «Подкладка» колонки $ нет.
  const showUsd = rows.some((r) => r.kind === "fur");
  const showShare = col !== "recv";
  const cols = (showUsd ? 5 : 4) + (showShare ? 1 : 0);
  // Тонкие вертикальные линии между блоками колонок: «Количество» | «Сумма» | «Цена».
  const BL = " border-l border-neutral-200";
  const shareCell = (q: number, rq: number, cls = "px-2 py-1.5") => showShare ? <td className={`whitespace-nowrap ${cls} text-right tabular-nums text-neutral-500${BL}`}>{rq > 0 ? formatShare(q / rq) : "–"}</td> : null;
  // Итого по виду: количество, сумма, средневзвешенная цена ₽ и $ (как в карточке).
  const total = (f: FlowFigures | null, kind: "fur" | "lining") =>
    !f ? null : col === "recv" ? { q: f.recvQty, v: pickV(al.tot[kind], f.recvValue), a: f.recvAvg, d: f.usdAvg, rq: f.recvQty } : col === "used" ? { q: f.usedQty, v: pickV(al.tot[kind], c4 === "on" ? f.usedValueOther : f.usedValue), a: f.usedAvg, d: f.usdUsedAvg, rq: f.recvQty } : { q: f.remQty, v: pickV(al.tot[kind], f.remValue), a: f.remAvg, d: f.usdRemAvg, rq: f.recvQty };
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }} className="m-auto w-[calc(100vw-2rem)] max-w-3xl rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40">
      <div className="max-h-[88vh] overflow-y-auto p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Цена по видам сырья</div>
            <div className="text-lg font-semibold">{COL_TITLE[col]}</div>
          </div>
          <button type="button" onClick={() => ref.current?.close()} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">✕ Закрыть</button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <THGroup sep={false} colSpan={1}>{" "}</THGroup>
              <THGroup colSpan={showShare ? 2 : 1}>Количество</THGroup>
              <THGroup>Сумма</THGroup>
              <THGroup colSpan={showUsd ? 2 : 1}>Цена</THGroup>
            </tr>
            <tr className="border-b border-neutral-200">
              <TH align="left" label="Вид" {...pcs.th("name")} />
              {showShare ? <TH sep label="Доля от купленного" unit={UNIT.pct} {...pcs.th("share")} /> : null}
              <TH sep={!showShare} label="Кол-во" unit="шт. · м" {...pcs.th("q")} />
              <TH sep label="Сумма" unit={UNIT.rub} {...pcs.th("v")} />
              <TH sep label="Цена" unit="₽/шт. · ₽/м" {...pcs.th("a")} />
              {showUsd ? <TH label="Цена" unit={UNIT.usdPerPcs} {...pcs.th("d")} /> : null}
            </tr>
          </thead>
          <tbody>
            {kinds.map((k) => {
              const part = pcs.sort(list.filter((x) => x.r.kind === k).sort((a, b) => b.v - a.v));
              if (part.length === 0) return null;
              const unit = k === "lining" ? "м" : "шт.";
              // Основной мех — строками; остальное сырьё свёрнуто одной строкой, разворачивается по желанию.
              const isMain = (x: (typeof part)[number]) => k === "lining" || MAIN_FUR_TILES.includes(x.r.label);
              const mainPart = part.filter(isMain), restPart = part.filter((x) => !isMain(x));
              const restSum = restPart.reduce((t, x) => ({ q: t.q + x.q, v: t.v + x.v, rq: t.rq + x.rq }), { q: 0, v: 0, rq: 0 });
              const shown: ((typeof part)[number] | "rest")[] = restPart.length ? [...mainPart, "rest", ...(restOpen ? restPart : [])] : mainPart;
              return (
                <Fragment key={k}>
                  <tr data-hover-block={k} data-block={k} className="bg-neutral-100 text-xs font-semibold uppercase tracking-wide text-neutral-600"><td colSpan={cols} className="px-2 py-1">{k === "fur" ? "Мех" : "Подкладка"}</td></tr>
                  {k === "lining" ? (() => {
                    // Подкладка: сначала по годам и итого, потом — по видам ткани.
                    const byYear = new Map<number, { q: number; v: number; rq: number }>();
                    for (const x of part) for (const y of x.r.years) { const p = pickYear(y.cells, y.usd); if (p.q > 0) { const c = byYear.get(y.year) ?? { q: 0, v: 0, rq: 0 }; c.q += p.q; c.v += p.v; c.rq += p.rq; byYear.set(y.year, c); } }
                    {
                      // Годы подкладки складываются в итог подкладки (целые рубли, наибольшие остатки).
                      const ys = Array.from(byYear.entries()).sort((a, b) => a[0] - b[0]);
                      const ex = lining ? (col === "recv" ? lining.recvValue : col === "used" ? (c4 === "on" ? lining.usedValueOther : lining.usedValue) : lining.remValue) : undefined;
                      const a = alignColumn(ys.map(([, c]) => c.v), ex);
                      ys.forEach(([, c], i) => { c.v = a.values[i]; });
                    }
                    const t = total(lining, "lining");
                    return (
                      <>
                        {Array.from(byYear.entries()).sort((a, b) => a[0] - b[0]).map(([yr, c]) => (
                          <tr key={`y${yr}`} data-block={k} className="border-b border-neutral-100">
                            <td className="py-1.5 pr-2 font-medium">{yr}</td>
                            {shareCell(c.q, c.rq)}
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(c.q)} {unit}</td>
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{rub(c.v)}</td>
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums" + BL}>{c.q > 0 ? rub(c.v / c.q) : "–"}</td>
                          </tr>
                        ))}
                        {t ? (
                          <tr data-block={k} className="row-total">
                            <td className="py-1.5 pr-2"><TotalLabel avg /></td>
                            {shareCell(t.q, t.rq)}
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(t.q)} {unit}</td>
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{rub(t.v)}</td>
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{t.a != null ? rub(t.a) : "–"}</td>
                          </tr>
                        ) : null}
                        <tr className="text-xs text-neutral-500"><td colSpan={cols} className="px-2 pb-1 pt-2">По видам ткани (нажмите — разбивка по годам)</td></tr>
                      </>
                    );
                  })() : null}
                  {shown.map((x) => x === "rest" ? (
                    <tr key="rest" data-block={k} className="cursor-pointer border-b border-neutral-100 bg-neutral-50 hover:bg-neutral-100" onClick={() => setRestOpen((v) => !v)} aria-expanded={restOpen}>
                      <td className="py-1.5 pr-2 text-neutral-700"><span aria-hidden className="mr-1 inline-block w-3 text-neutral-400">{restOpen ? "▾" : "▸"}</span>Остальное сырьё ({restPart.length})</td>
                      {shareCell(restSum.q, restSum.rq)}
                      <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(restSum.q)} {unit}</td>
                      <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{rub(restSum.v)}</td>
                      <td className={"whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums" + BL}>{restSum.q > 0 ? rub(restSum.v / restSum.q) : "–"}</td>
                      {showUsd ? <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-neutral-700">–</td> : null}
                    </tr>
                  ) : (
                    <Fragment key={x.r.key}>
                    <tr data-block={k} className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50" onClick={() => toggle(x.r.key)} aria-expanded={open.has(x.r.key)}>
                      <td className="py-1.5 pr-2"><span aria-hidden className="mr-1 inline-block w-3 text-neutral-400">{open.has(x.r.key) ? "▾" : "▸"}</span>{k === "fur" && (x.r.lots > 0 || x.q > 0) ? <Link href={`/lots/fur/${encodeURIComponent(x.r.label)}`} onClick={(e) => e.stopPropagation()} className="hover:underline focus-visible:underline" title={`Страница вида меха «${x.r.label}»`}>{shortMaterialName(x.r.label)}<span aria-hidden className="ml-1 text-[11px] text-neutral-400">↗</span></Link> : shortMaterialName(x.r.label)}</td>
                      {shareCell(x.q, x.rq)}
                      <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(x.q)} {unit}</td>
                      <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{rub(x.v)}</td>
                      <td className={"whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums" + BL}>{x.a != null ? rub(x.a) : "–"}</td>
                      {showUsd ? <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-neutral-700">{x.d != null ? usd(x.d) : "–"}</td> : null}
                    </tr>
                    {open.has(x.r.key) ? (() => {
                      const kids = x.r.years.map((y) => ({ y, p: pickYear(y.cells, y.usd) })).filter((z) => z.p.q > 0);
                      const kv = alignColumn(kids.map((z) => z.p.v), x.v).values; // годы вида складываются в показанную сумму вида
                      return kids.map((z, i) => ({ y: z.y, p: { ...z.p, v: kv[i] } }));
                    })().map(({ y, p }) => (
                      <tr key={y.year} data-block={k} className="border-b border-neutral-100 bg-neutral-50/70 text-[13px] text-neutral-700">
                        <td className="py-1 pl-7 pr-2">{y.year}</td>
                        {shareCell(p.q, p.rq, "px-2 py-1")}
                        <td className={"whitespace-nowrap px-2 py-1 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(p.q)} {unit}</td>
                        <td className={"whitespace-nowrap px-2 py-1 text-right tabular-nums" + BL}>{rub(p.v)}</td>
                        <td className={"whitespace-nowrap px-2 py-1 text-right tabular-nums" + BL}>{p.a != null ? rub(p.a) : "–"}</td>
                        {showUsd ? <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{p.d != null ? usd(p.d) : "–"}</td> : null}
                      </tr>
                    )) : null}
                    </Fragment>
                  ))}
                  {(() => {
                    const t = k === "fur" ? total(fur, "fur") : null;
                    return t ? (
                      <tr className="row-total">
                        <td className="py-1.5 pr-2"><TotalLabel avg /></td>
                        {shareCell(t.q, t.rq)}
                        <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(t.q)} {unit}</td>
                        <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{rub(t.v)}</td>
                        <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{t.a != null ? rub(t.a) : "–"}</td>
                        {showUsd ? <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{t.d != null ? usd(t.d) : "–"}</td> : null}
                      </tr>
                    ) : null;
                  })()}
                </Fragment>
              );
            })}
            {list.length === 0 ? <tr><td colSpan={cols} className="px-2 py-6 text-center text-neutral-500">По выбранным фильтрам нет данных.</td></tr> : null}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] leading-4 text-neutral-500">Бобр: закупленные лоты не списаны в ТЗ (остаток = куплено); бобр подрядчика без лотов закупки — см. <Link href="/lots/fur/%D0%91%D0%BE%D0%B1%D1%80" className="text-blue-700 hover:underline">Сырьё › Мех › Бобр</Link>.</p>
      </div>
    </dialog>
  );
}
