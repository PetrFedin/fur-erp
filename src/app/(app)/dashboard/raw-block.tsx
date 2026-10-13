"use client";

import { Fragment, createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatPercent, formatQty, formatShare } from "@/lib/utils";
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

type Pair = { incl: FlowFigures; excl: FlowFigures };

const usd = (v: number) => `$${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  return <div style={{ minHeight: `${n}rem` }}>{lines.map((l, i) => <div key={i} className="whitespace-nowrap">{l}</div>)}</div>;
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

/** Ряд плиток «Куплено / Использовано / Остаток» по меху или подкладке (Главная и страница «Сырьё»).
 *  Если передан pay (три плитки оплат), они встают в ТОТ ЖЕ ряд: «Сырьё | Оплаты» — шесть плиток в одну строку на мониторе, тонкая линия между группами. */
export function RawCards({ view, rows, fur, lining, c4, vatRates, pay, headerEnd, titleSuffix, headerExtra }: { /** Подпись текущего слайда в заголовке ряда («· Лиса»). */ titleSuffix?: string; /** Элементы рядом с заголовком (стрелки и точки слайдов). */ headerExtra?: React.ReactNode; view: "fur" | "lining"; rows: RawTableRow[]; fur: Pair; lining: Pair; c4: "on" | "off"; vatRates?: VatTriple; /** Плитки оплат (PayTiles bare) — вторая группа ряда. */ pay?: React.ReactNode; /** Ссылка «→ Раздел» над кнопками «Свернуть/Закрепить». */ headerEnd?: React.ReactNode; /** Устарело: заголовок ряда теперь всегда в WidgetRow. */ hideLabel?: boolean }) {
  const { mode: vat } = useVatDisplay();
  const [priceCol, setPriceCol] = useState<null | "recv" | "used" | "rem">(null);
  const modal = priceCol ? <PriceModal col={priceCol} rows={rows.filter((r) => r.kind === view)} vat={vat} fur={view === "lining" ? null : fur[vat]} lining={view === "fur" ? null : lining[vat]} onClose={() => setPriceCol(null)} /> : null;
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
function RawTriple({ view, fur, lining, c4, onOpen: setPriceCol, compact = false, vatRates }: { view: "fur" | "lining"; fur: Pair; lining: Pair; c4: "on" | "off"; onOpen: (c: "recv" | "used" | "rem") => void; compact?: boolean; vatRates?: VatTriple }) {
  const { mode: vat } = useVatDisplay();
  const F = fur[vat];
  const L = lining[vat];
  const unit = view === "lining" ? "м" : "шт.";
  const cur = view === "lining" ? L : F;
  const all = false as boolean; // «Всё» убрано: мех и подкладка — отдельными рядами плиток
  const usdTile = view === "fur";

  const usdBought = (() => {
    if (view === "lining") return { main: "нет данных в USD", note: "подкладка закупается без цены в долларах" };
    if (F.usdQty <= 0 || F.usdAvg == null) return { main: "нет данных в USD", note: "в выбранном срезе нет лотов с закупочной ценой в USD" };
    const share = F.recvQty > 0 ? (F.usdQty / F.recvQty) * 100 : 0;
    const b = F.usdBySource;
    const parts = [
      b.direct > 0 ? `в долларах в расчёте лота — ${formatQty(b.direct)}` : null,
      b.eur > 0 ? `евро × курс EUR→USD из расчёта — ${formatQty(b.eur)}` : null,
      b.rub > 0 ? `молоток ₽ ÷ курс USD/RUB из расчёта — ${formatQty(b.rub)}` : null,
      b.calc > 0 ? `цена $ из расчётного листа — ${formatQty(b.calc)}` : null,
    ].filter(Boolean).join("; ");
    return {
      main: `${usd(F.usdAvg)} / шт.`,
      note: `по ${formatQty(F.usdQty)} из ${formatQty(F.recvQty)} шт. с ценой в USD (${formatPercent(share)})`,
      hint: `Источники цены, шт.: ${parts || "—"}. Остальные лоты — без цены в USD (только рубли или нет курса в документах).`,
    };
  })();

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
        <Card block={view} title="Куплено" onOpen={() => setPriceCol("recv")} hint={all ? undefined : (
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
                <Row k={compact ? "Количество" : <>Количество<span aria-hidden className="invisible"> (доля от купленного)</span></>} v={`${formatQty(cur.recvQty)} ${unit}`} strong />
                <Row k="Сумма" v={rub(cur.recvValue)} strong sub={compact ? <SubLines n={2} /> : ghost} />
              </Duo>
              <Duo>
                <Row k={`Цена, ₽/${priceUnit}`} sub={compact ? <SubLines n={1} /> : undefined} v={cur.recvAvg != null ? rub(cur.recvAvg) : "—"} />
                {usdTile && usdBought ? <Row k="Цена, $/шт." v={usdBought.main} /> : null}
              </Duo>
              {vatRates ? <VatLine v={vatRates.recv} minRem={compact ? 3 : 1} className="mt-auto pt-2" /> : null}
            </>
          )}
        </Card>

        <Card block={view} title="Использовано" onOpen={() => setPriceCol("used")} hint={
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
                <Row k={compact ? lab("Количество", cur.usedQty, cur.recvQty) : "Количество (доля от купленного)"} v={withShare(cur.usedQty, cur.recvQty, `${formatQty(cur.usedQty)} ${unit}`)} strong />
                <Row k={lab("Сумма", usedNo4, cur.recvValue)} v={withShare(usedNo4, cur.recvValue, rub(usedNo4))} strong sub={compact ? <SubLines n={2} lines={[`с 4%: ${rub(usedWith4)}`, `надбавка ${rub(usedWith4 - usedNo4)}`]} /> : `с 4%: ${rub(usedWith4)} · надбавка ${rub(usedWith4 - usedNo4)}`} />
              </Duo>
              <Duo>
                <Row k={`Цена, ₽/${priceUnit}`} v={usedQtyNow > 0 ? rub(usedNo4 / usedQtyNow) : "—"} sub={compact ? <SubLines n={1} lines={usedQtyNow > 0 ? [`с 4%: ${rub(usedWith4 / usedQtyNow)}`] : []} /> : usedQtyNow > 0 ? `с 4%: ${rub(usedWith4 / usedQtyNow)}` : undefined} />
                {usdTile ? <Row k="Цена, $/шт." v={F.usdUsedAvg != null ? usd(F.usdUsedAvg) : "нет данных в USD"} /> : null}
              </Duo>
              {vatRates ? <VatLine v={vatRates.used} minRem={compact ? 3 : 1} className="mt-auto pt-2" /> : null}
            </>
          )}
        </Card>

        <Card block={view} title="Остаток" onOpen={() => setPriceCol("rem")} hint={all ? undefined : (
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
                <Row k={compact ? lab("Количество", cur.remQty, cur.recvQty) : "Количество (доля от купленного)"} v={withShare(cur.remQty, cur.recvQty, `${formatQty(cur.remQty)} ${unit}`)} strong />
                <Row k={lab("Сумма", cur.remValue, cur.recvValue)} v={withShare(cur.remValue, cur.recvValue, rub(cur.remValue))} strong sub={compact ? <SubLines n={2} /> : ghost} />
              </Duo>
              <Duo>
                <Row k={`Цена, ₽/${priceUnit}`} sub={compact ? <SubLines n={1} /> : undefined} v={cur.remAvg != null ? rub(cur.remAvg) : "—"} />
                {usdTile ? <Row k="Цена, $/шт." v={F.usdRemAvg != null ? usd(F.usdRemAvg) : "нет данных в USD"} /> : null}
              </Duo>
              {vatRates ? <VatLine v={vatRates.rem} minRem={compact ? 3 : 1} className="mt-auto pt-2" /> : null}
            </>
          )}
        </Card>
    </CompactCtx.Provider>
  );
}

export function RawBlock({ href = "/lots", rows, fur, lining, c4, lots, info, orderFilters, vat: vatRates }: { rows: RawTableRow[]; fur: Pair; lining: Pair; c4: "on" | "off"; lots: number; info: ModeInfo; orderFilters: boolean; vat?: { fur: VatTriple; lining: VatTriple }; /** «→ Сырьё» с фильтрами Главной. */ href?: string }) {
  void info;
  const { mode: vat } = useVatDisplay();
  const vatW = vat === "incl" ? "с НДС" : "без НДС";
  const c4W = c4 === "on" ? "с 4%" : "без 4%";
  const [pc, setPc] = useState<null | { view: "fur" | "lining"; col: "recv" | "used" | "rem" }>(null);
  const extra = (
    <>
      <InfoHint label="Как считаются плитки сырья" wide>
        <p><b>Цена</b> — средневзвешенная: Σ ₽ ÷ Σ шт. (подкладка — ÷ Σ м), а не среднее цен лотов. Совпадает с таблицей «Сырьё». Нажмите на плитку — цены по видам сырья.</p>
        <p className="mt-1"><b>Режимы.</b> Цены {vatW}; «Использовано» — {c4W}. 4% начисляется только при списании в ТЗ, поэтому «Куплено» и «Остаток» всегда без 4%. НДС берётся по ставке каждого лота (20% или 22%); под суммой каждой плитки — «в т.ч. НДС» по ставкам (при режиме «Без НДС» — НДС, который в сумму не входит). Бобр — сырьё подрядчика, лотов закупки нет; изделия из бобра смотрите в «Производство» и «Изделия».</p>
        <p className="mt-1"><b>Как сходится.</b> Куплено = использовано (без 4%) + остаток — отдельно для меха (шт.) и для подкладки (м).</p>
        <p className="mt-1"><b>Цена в долларах</b> — молоток за шкуру (до сборов), только из документов лота: строка в долларах; евро × записанный курс EUR→USD; молоток в ₽ ÷ записанный курс USD/RUB; цена $ из расчётного листа. У подкладки цен в долларах нет. Остальные лоты в среднюю $ не входят и по курсу ЦБ не пересчитываются.</p>
      </InfoHint>
      {orderFilters ? (
        <BridgeHint label="Фильтр по ТЗ" warn>
          <p>Выбран фильтр по ТЗ: «Использовано» — только в выбранных ТЗ, остальное списание в «Остаток» не попадает, поэтому куплено − использовано ≠ остаток.</p>
        </BridgeHint>
      ) : null}
    </>
  );
  const groups: { view: "fur" | "lining"; label: string }[] = [{ view: "fur", label: "Мех" }, { view: "lining", label: "Подкладка" }];
  return (
    <section aria-labelledby="dash-raw">
      <h2 id="dash-raw" className="sr-only">Сырьё</h2>
      <WidgetRow id="raw" defaultCollapsed title="Сырьё" titleClass="text-sm font-semibold" headerExtra={extra}
        headerEnd={<Link href={href} title={`${lots} лотов`} className="text-xs text-blue-700 hover:underline print:hidden">→ Сырьё</Link>}>
        <div className="raw-row">
          {groups.map((g, i) => (
            <Fragment key={g.view}>
              {i > 0 ? <div className="raw-divider" aria-hidden /> : null}
              <div className="raw-group" role="group" aria-label={g.label}>
                <div className="raw-group-label">{g.label}</div>
                <div className="raw-tiles">
                  <RawTriple view={g.view} fur={fur} lining={lining} c4={c4} compact onOpen={(col) => setPc({ view: g.view, col })} vatRates={vatRates?.[g.view]} />
                </div>
              </div>
            </Fragment>
          ))}
        </div>
        {pc ? <PriceModal col={pc.col} rows={rows.filter((r) => r.kind === pc.view)} vat={vat} fur={pc.view === "lining" ? null : fur[vat]} lining={pc.view === "fur" ? null : lining[vat]} onClose={() => setPc(null)} /> : null}
      </WidgetRow>
    </section>
  );
}

const COL_TITLE = { recv: "Куплено", used: "Использовано", rem: "Остаток" } as const;

/** Цены по видам сырья для выбранной колонки (куплено / использовано / остаток): количество, сумма, средняя цена ₽ и $. */
function PriceModal({ col, rows, vat, fur, lining, onClose }: { col: "recv" | "used" | "rem"; rows: RawTableRow[]; vat: "incl" | "excl"; fur: FlowFigures | null; lining: FlowFigures | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const pick = (r: RawTableRow) => {
    const c = r.cells[vat];
    const u = r.usd;
    const base = col === "recv" ? { q: c.rq, v: c.rv, a: c.ra, d: u.bought } : col === "used" ? { q: c.uq, v: c.uv, a: c.ua, d: u.used } : { q: c.mq, v: c.mv, a: c.ma, d: u.rem };
    return { ...base, rq: c.rq };
  };
  const list = rows.map((r) => ({ r, ...pick(r) })).filter((x) => x.q > 0);
  const kinds: ("fur" | "lining")[] = ["fur", "lining"];
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const pickYear = (c: RawTableRow["years"][number]["cells"], u: RawTableRow["usd"]) => { const x = c[vat]; const b = col === "recv" ? { q: x.rq, v: x.rv, a: x.ra, d: u.bought } : col === "used" ? { q: x.uq, v: x.uv, a: x.ua, d: u.used } : { q: x.mq, v: x.mv, a: x.ma, d: u.rem }; return { ...b, rq: x.rq }; };
  // Цена в долларах есть только у меха: в окне «Подкладка» колонки $ нет.
  const showUsd = rows.some((r) => r.kind === "fur");
  const showShare = col !== "recv";
  const cols = (showUsd ? 5 : 4) + (showShare ? 1 : 0);
  // Тонкие вертикальные линии между блоками колонок: «Количество» | «Сумма» | «Цена».
  const BL = " border-l border-neutral-200";
  const shareCell = (q: number, rq: number, cls = "px-2 py-1.5") => showShare ? <td className={`whitespace-nowrap ${cls} text-right tabular-nums text-neutral-500${BL}`}>{rq > 0 ? formatShare(q / rq) : "—"}</td> : null;
  // Итого по виду: количество, сумма, средневзвешенная цена ₽ и $ (как в карточке).
  const total = (f: FlowFigures | null) =>
    !f ? null : col === "recv" ? { q: f.recvQty, v: f.recvValue, a: f.recvAvg, d: f.usdAvg, rq: f.recvQty } : col === "used" ? { q: f.usedQty, v: f.usedValue, a: f.usedAvg, d: f.usdUsedAvg, rq: f.recvQty } : { q: f.remQty, v: f.remValue, a: f.remAvg, d: f.usdRemAvg, rq: f.recvQty };
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
              <TH align="left" label="Вид" />
              {showShare ? <TH sep label="Доля от купленного" unit={UNIT.pct} /> : null}
              <TH sep={!showShare} label="Кол-во" unit="шт. · м" />
              <TH sep label="Сумма" unit={UNIT.rub} />
              <TH sep label="Цена" unit="₽/шт. · ₽/м" />
              {showUsd ? <TH label="Цена" unit={UNIT.usdPerPcs} /> : null}
            </tr>
          </thead>
          <tbody>
            {kinds.map((k) => {
              const part = list.filter((x) => x.r.kind === k).sort((a, b) => b.v - a.v);
              if (part.length === 0) return null;
              const unit = k === "lining" ? "м" : "шт.";
              return (
                <Fragment key={k}>
                  <tr data-hover-block={k} data-block={k} className="bg-neutral-100 text-xs font-semibold uppercase tracking-wide text-neutral-600"><td colSpan={cols} className="px-2 py-1">{k === "fur" ? "Мех" : "Подкладка"}</td></tr>
                  {k === "lining" ? (() => {
                    // Подкладка: сначала по годам и итого, потом — по видам ткани.
                    const byYear = new Map<number, { q: number; v: number; rq: number }>();
                    for (const x of part) for (const y of x.r.years) { const p = pickYear(y.cells, y.usd); if (p.q > 0) { const c = byYear.get(y.year) ?? { q: 0, v: 0, rq: 0 }; c.q += p.q; c.v += p.v; c.rq += p.rq; byYear.set(y.year, c); } }
                    const t = total(lining);
                    return (
                      <>
                        {Array.from(byYear.entries()).sort((a, b) => a[0] - b[0]).map(([yr, c]) => (
                          <tr key={`y${yr}`} data-block={k} className="border-b border-neutral-100">
                            <td className="py-1.5 pr-2 font-medium">{yr}</td>
                            {shareCell(c.q, c.rq)}
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(c.q)} {unit}</td>
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{rub(c.v)}</td>
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums" + BL}>{c.q > 0 ? rub(c.v / c.q) : "—"}</td>
                          </tr>
                        ))}
                        {t ? (
                          <tr data-block={k} className="row-total">
                            <td className="py-1.5 pr-2"><TotalLabel avg /></td>
                            {shareCell(t.q, t.rq)}
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(t.q)} {unit}</td>
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{rub(t.v)}</td>
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{t.a != null ? rub(t.a) : "—"}</td>
                          </tr>
                        ) : null}
                        <tr className="text-xs text-neutral-500"><td colSpan={cols} className="px-2 pb-1 pt-2">По видам ткани (нажмите — разбивка по годам)</td></tr>
                      </>
                    );
                  })() : null}
                  {part.map((x) => (
                    <Fragment key={x.r.key}>
                    <tr data-block={k} className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50" onClick={() => toggle(x.r.key)} aria-expanded={open.has(x.r.key)}>
                      <td className="py-1.5 pr-2"><span aria-hidden className="mr-1 inline-block w-3 text-neutral-400">{open.has(x.r.key) ? "▾" : "▸"}</span>{k === "fur" && (x.r.lots > 0 || x.q > 0) ? <Link href={`/lots/fur/${encodeURIComponent(x.r.label)}`} onClick={(e) => e.stopPropagation()} className="hover:underline focus-visible:underline" title={`Страница вида меха «${x.r.label}»`}>{shortMaterialName(x.r.label)}<span aria-hidden className="ml-1 text-[10px] text-neutral-400">↗</span></Link> : shortMaterialName(x.r.label)}</td>
                      {shareCell(x.q, x.rq)}
                      <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(x.q)} {unit}</td>
                      <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{rub(x.v)}</td>
                      <td className={"whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums" + BL}>{x.a != null ? rub(x.a) : "—"}</td>
                      {showUsd ? <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-neutral-700">{x.d != null ? usd(x.d) : "—"}</td> : null}
                    </tr>
                    {open.has(x.r.key) ? x.r.years.map((y) => ({ y, p: pickYear(y.cells, y.usd) })).filter((z) => z.p.q > 0).map(({ y, p }) => (
                      <tr key={y.year} data-block={k} className="border-b border-neutral-100 bg-neutral-50/70 text-[13px] text-neutral-700">
                        <td className="py-1 pl-7 pr-2">{y.year}</td>
                        {shareCell(p.q, p.rq, "px-2 py-1")}
                        <td className={"whitespace-nowrap px-2 py-1 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(p.q)} {unit}</td>
                        <td className={"whitespace-nowrap px-2 py-1 text-right tabular-nums" + BL}>{rub(p.v)}</td>
                        <td className={"whitespace-nowrap px-2 py-1 text-right tabular-nums" + BL}>{p.a != null ? rub(p.a) : "—"}</td>
                        {showUsd ? <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{p.d != null ? usd(p.d) : "—"}</td> : null}
                      </tr>
                    )) : null}
                    </Fragment>
                  ))}
                  {(() => {
                    const t = k === "fur" ? total(fur) : null;
                    return t ? (
                      <tr className="row-total">
                        <td className="py-1.5 pr-2"><TotalLabel avg /></td>
                        {shareCell(t.q, t.rq)}
                        <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(t.q)} {unit}</td>
                        <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{rub(t.v)}</td>
                        <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{t.a != null ? rub(t.a) : "—"}</td>
                        {showUsd ? <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{t.d != null ? usd(t.d) : "—"}</td> : null}
                      </tr>
                    ) : null;
                  })()}
                </Fragment>
              );
            })}
            {list.length === 0 ? <tr><td colSpan={cols} className="px-2 py-6 text-center text-neutral-500">По выбранным фильтрам нет данных.</td></tr> : null}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] leading-4 text-neutral-500">Бобр — сырьё подрядчика: лотов закупки нет, см. <Link href="/lots/fur/%D0%91%D0%BE%D0%B1%D1%80" className="text-blue-700 hover:underline">Сырьё › Мех › Бобр</Link>.</p>
      </div>
    </dialog>
  );
}
