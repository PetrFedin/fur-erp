"use client";

import { useId, useState, type ReactNode } from "react";
import { formatMoney, formatPercent, formatQty } from "@/lib/utils";
import { sliceList, type CompCat, type CompSlice } from "@/lib/price-composition";
import { useVatDisplay } from "@/lib/vat-display";
import { InfoHint } from "@/components/info-hint";

// Состав цены: кольцевая диаграмма + горизонтальная составная полоса + таблица-легенда (она же текстовая альтернатива графику).
// Наведение на сектор/полосу подсвечивает строку легенды (оранжевая граница, подложка #FFF1EB) и наоборот; клик по сектору/строке — onSelect.

const R_OUT = 56, R_IN = 34, C = 60;

function polar(r: number, a: number): [number, number] {
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

/** Дуга кольца от угла a0 до a1 (радианы, от 12 часов по часовой). */
function ringPath(a0: number, a1: number): string {
  const full = a1 - a0 >= Math.PI * 2 - 1e-6;
  const s = a0 - Math.PI / 2;
  const e = (full ? a0 + Math.PI * 2 - 0.0001 : a1) - Math.PI / 2;
  const large = e - s > Math.PI ? 1 : 0;
  const [x1, y1] = polar(R_OUT, s), [x2, y2] = polar(R_OUT, e), [x3, y3] = polar(R_IN, e), [x4, y4] = polar(R_IN, s);
  return `M${x1.toFixed(3)} ${y1.toFixed(3)}A${R_OUT} ${R_OUT} 0 ${large} 1 ${x2.toFixed(3)} ${y2.toFixed(3)}L${x3.toFixed(3)} ${y3.toFixed(3)}A${R_IN} ${R_IN} 0 ${large} 0 ${x4.toFixed(3)} ${y4.toFixed(3)}Z`;
}

const HOVER_ROW = "bg-[#FFF1EB] shadow-[inset_3px_0_0_var(--ui-accent,#ff4a1c)]";

export function PriceCompositionChart({ slices, total, qty, qtyVals, unitName = "шкуру", totalLabel, caption, onSelect, selectTitle, ariaLabel, countLabel, compact = false, stacked = false }: {
  slices: CompSlice[];
  /** Итог для центра и строки «Всего»: сумма секторов, ₽. */
  total: number;
  /** Шкур в лоте/выборке — для колонки «₽ на шкуру». */
  qty: number;
  /** Сколько шкур приходится на каждую составляющую (по ключу сектора; шкуры лотов, где она есть). Есть — в таблице показывается колонка «Шкур»; итог — qty. */
  qtyVals?: Record<string, number>;
  unitName?: string;
  totalLabel: string;
  /** Мелкая подпись под центром кольца. */
  caption?: string;
  onSelect?: (key: string) => void;
  selectTitle?: string;
  ariaLabel: string;
  /** Подпись справа от названия строки (например, «по 12 лотам»). */
  countLabel?: (key: string) => ReactNode;
  compact?: boolean;
  /** Раскладка виджета Главной: компактное кольцо и полоса по центру (до ~360px), таблица-легенда ниже на всю ширину. */
  stacked?: boolean;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [unfolded, setFolded] = useState<Set<string>>(new Set());
  const uid = useId();
  const pos = slices.filter((s) => s.value > 0);
  const posTotal = pos.reduce((a, s) => a + s.value, 0);
  const share = (v: number) => (total !== 0 ? (v / total) * 100 : 0);
  const arcs = pos.map((s, i) => {
    const frac = posTotal > 0 ? s.value / posTotal : 0;
    const before = pos.slice(0, i).reduce((a, x) => a + (posTotal > 0 ? x.value / posTotal : 0), 0);
    return { s, d: ringPath(before * Math.PI * 2, (before + frac) * Math.PI * 2), frac };
  });
  const drawn = [...arcs.filter((a) => a.s.key !== hover), ...arcs.filter((a) => a.s.key === hover)];
  const perUnit = (v: number) => (qty > 0 ? formatMoney((v / qty).toFixed(2)) : "—");
  const money = (v: number) => formatMoney(v.toFixed(2));
  const interactive = !!onSelect;
  const enter = (k: string) => () => setHover(k);
  const leave = () => setHover(null);
  const vQty = stacked ? "hidden @[32rem]:table-cell" : "hidden sm:table-cell";
  const vAvg = stacked ? "hidden @[26rem]:table-cell" : "hidden sm:table-cell";
  const toggleFold = (k: string) => setFolded((f) => { const n = new Set(f); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  /** Строка легенды: сектор (parent = null) или его подстрока. Подсветка и клик подстроки — по сектору-родителю. */
  const row = (s: CompSlice, parent: CompSlice | null) => {
    const sel = parent ?? s;
    const hot = hover === sel.key;
    const isSub = parent != null;
    const hasSub = !isSub && (s.sub?.length ?? 0) > 0;
    const isOpen = hasSub && unfolded.has(s.key);
    const swatchAndText = (
      <>
        <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-sm border border-neutral-300" style={{ background: s.color }} />
        <span title={s.label} className={"min-w-0 " + (stacked ? "leading-tight @[26rem]/c:truncate" : "truncate") + " " + (isSub ? "text-neutral-700" : "")}>{s.label}</span>
      </>
    );
    // «i» и счётчик стоят РЯДОМ с кнопкой выбора, а не внутри неё (button в button недопустим).
    const hint = s.note ? <span onClick={(e) => e.stopPropagation()}><InfoHint label={`Пояснение: ${s.label}`} wide><p>{s.note}</p></InfoHint></span> : null;
    const count = countLabel && !isSub ? <span className={"shrink-0 text-[11px] text-neutral-500 " + (stacked ? "hidden @[40rem]:inline" : "hidden sm:inline")}>{countLabel(s.key)}</span> : null;
    return (
      <tr key={(parent ? parent.key + ">" : "") + s.key} title={s.hint} onMouseEnter={enter(sel.key)} onMouseLeave={leave}
        className={"h-9 border-b border-neutral-100 transition-colors " + (hot ? HOVER_ROW : "") + (interactive ? " cursor-pointer" : "")}
        onClick={interactive ? () => onSelect?.(sel.key) : undefined}>
        <td className="py-1.5 pr-2">
          <div className="flex min-w-0 items-center" style={isSub ? { paddingLeft: 14 } : undefined}>
            <span className="inline-flex w-4 shrink-0 items-center">
              {hasSub ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); toggleFold(s.key); }} aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Раскрыть"} детализацию: ${s.label}`} data-touch-ok
                  className="rounded text-neutral-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600"><span aria-hidden className={"inline-block w-4 transition-transform " + (isOpen ? "rotate-90" : "")}>›</span></button>
              ) : null}
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {interactive ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); onSelect?.(sel.key); }} onFocus={enter(sel.key)} onBlur={leave} aria-haspopup="dialog" title={selectTitle}
                  className="flex min-w-0 items-center gap-2 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600">{swatchAndText}</button>
              ) : <span className="flex min-w-0 items-center gap-2">{swatchAndText}</span>}
              {hint}
              {count}
            </div>
          </div>
        </td>
        {qtyVals ? <td className={"whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums " + vQty}>{(qtyVals[s.key] ?? 0) > 0 ? formatQty(qtyVals[s.key]) : "—"}</td> : null}
        <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{money(s.value)}</td>
        <td className={"whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums " + vAvg}>{perUnit(s.value)}</td>
        <td className="whitespace-nowrap px-1.5 py-1.5 text-right text-neutral-500 tabular-nums">{formatPercent(share(s.value))}</td>
      </tr>
    );
  };

  const ring = (
    <svg viewBox="0 0 120 120" className={stacked ? "h-36 w-36 @[26rem]/c:h-24 @[26rem]/c:w-24 @[40rem]/c:h-36 @[40rem]/c:w-36" : "h-44 w-44 sm:h-60 sm:w-60"} role="img" aria-label={ariaLabel} aria-describedby={`${uid}-legend`}>
      <title>{ariaLabel}</title>
      {arcs.length === 0 ? <circle cx={C} cy={C} r={(R_OUT + R_IN) / 2} fill="none" stroke="#e5e5e5" strokeWidth={R_OUT - R_IN} /> : null}
      {drawn.map(({ s, d, frac }) => {
        const hot = hover === s.key;
        return (
          <path key={s.key} d={d} fill={s.color}
            stroke={hot ? "var(--ui-accent, #ff4a1c)" : "#ffffff"} strokeWidth={hot ? 2.2 : 1.2} strokeLinejoin="round"
            className={interactive ? "cursor-pointer" : undefined}
            onMouseEnter={enter(s.key)} onMouseLeave={leave}
            onClick={interactive ? () => onSelect?.(s.key) : undefined}>
            <title>{`${s.label}: ${money(s.value)} · ${formatPercent(frac * 100)}${qty > 0 ? ` · ${perUnit(s.value)} за ${unitName}` : ""}`}</title>
          </path>
        );
      })}
      <text x={C} y={C - 3} textAnchor="middle" className="fill-neutral-900 text-[9px] font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{qty > 0 ? perUnit(total) : money(total)}</text>
      <text x={C} y={C + 8} textAnchor="middle" className="fill-neutral-500 text-[5.5px]">{qty > 0 ? `за ${unitName}` : "всего"}</text>
      {caption ? <text x={C} y={C + 16} textAnchor="middle" className="fill-neutral-500 text-[5px]">{caption}</text> : null}
    </svg>
  );

  const bar = pos.length > 0 ? (
    <div className="flex h-3.5 w-full overflow-hidden rounded-md border border-neutral-200" role="presentation" aria-hidden>
      {arcs.map(({ s, frac }) => (
        <div key={s.key} style={{ width: `${frac * 100}%`, background: s.color, boxShadow: hover === s.key ? "inset 0 0 0 2px var(--ui-accent, #ff4a1c)" : undefined }}
          title={`${s.label}: ${formatPercent(frac * 100)}`} className={interactive ? "cursor-pointer" : undefined}
          onMouseEnter={enter(s.key)} onMouseLeave={leave} onClick={interactive ? () => onSelect?.(s.key) : undefined} />
      ))}
    </div>
  ) : null;

  const legend = (
    <div id={`${uid}-legend`} className={stacked ? "@container w-full min-w-0 flex-1 @[26rem]/c:w-auto" : "w-full min-w-0 sm:min-w-[17rem] sm:flex-1 sm:basis-0"}>
      <table className={"w-full table-fixed text-left " + (stacked ? "text-[11px] @[40rem]:text-xs" : "text-xs sm:text-sm")}>
        <caption className="sr-only">{ariaLabel}: составляющие, {qtyVals ? "количество шкур, " : ""}рубли всего, рубли за {unitName} и доля</caption>
        <colgroup>
          <col />
          {qtyVals ? <col className={"" + (stacked ? "hidden @[32rem]:table-column @[32rem]:w-14" : "hidden sm:table-column w-[4.75rem]")} /> : null}
          <col className={stacked ? "w-[5.25rem]" : "w-[5.5rem] sm:w-[6.75rem]"} />
          <col className={stacked ? "hidden @[26rem]:table-column @[26rem]:w-[5.5rem]" : "hidden sm:table-column w-[6rem]"} />
          <col className={stacked ? "w-12" : "w-[3.5rem] sm:w-[4.5rem]"} />
        </colgroup>
        <thead>
          <tr className="border-b border-neutral-200 text-xs font-medium text-neutral-500">
            <th scope="col" className="whitespace-nowrap py-1.5 pl-5 pr-2">Составляющая</th>
            {qtyVals ? <th scope="col" className={"whitespace-nowrap px-1.5 py-1.5 text-right " + vQty}>Шкур, шт.</th> : null}
            <th scope="col" className="whitespace-nowrap px-1.5 py-1.5 text-right">Всего, ₽</th>
            <th scope="col" className={"whitespace-nowrap px-1.5 py-1.5 text-right " + vAvg}>
              {qty > 0 ? <>{stacked ? "Ср. цена, ₽" : "Ср. цена, ₽/шт."}<InfoHint label="Что такое ср. цена" align="right"><p>Средневзвешенное значение: сумма ÷ количество по лотам.</p></InfoHint></> : "Всего, ₽"}
            </th>
            <th scope="col" className="whitespace-nowrap px-1.5 py-1.5 text-right">Доля, %</th>
          </tr>
        </thead>
        <tbody>
          {slices.flatMap((s) => [row(s, null), ...(s.sub && unfolded.has(s.key) ? s.sub.map((c) => row(c, s)) : [])])}
          <tr className="row-total h-9">
            <td className="py-1.5 pl-5 pr-2 text-sm font-semibold">{totalLabel}</td>
            {qtyVals ? <td className={"whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums " + vQty}>{qty > 0 ? formatQty(qty) : "—"}</td> : null}
            <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{money(total)}</td>
            <td className={"whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums " + vAvg}>{perUnit(total)}</td>
            <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{total !== 0 ? "100,0%" : "—"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  if (stacked) {
    return (
      <div className="@container/c w-full">
        <div className="flex flex-col items-center gap-3 @[26rem]/c:flex-row @[26rem]/c:items-center @[26rem]/c:gap-2">
          <div className="shrink-0">{ring}</div>
          {legend}
        </div>
      </div>
    );
  }
  return (
    <div className="flex max-w-[56rem] flex-col gap-3">
      <div className={"flex flex-wrap items-start gap-x-6 gap-y-3 " + (compact ? "" : "")}>
        <div className="mx-auto shrink-0 sm:mx-0 sm:self-center">{ring}</div>
        {legend}
      </div>
      {bar}
    </div>
  );
}

/** Переключатель «без НДС | с НДС» (по умолчанию — режим шапки сайта). */
export function useChartVat(): { withVat: boolean; toggle: ReactNode } {
  const { mode } = useVatDisplay();
  const [own, setOwn] = useState<boolean | null>(null);
  const withVat = own ?? mode === "incl";
  const seg = (on: boolean, label: string) => (
    <button type="button" aria-pressed={withVat === on} onClick={() => setOwn(on)}
      className={"px-2.5 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 " + (withVat === on ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50")}>{label}</button>
  );
  const toggle = (
    <div role="group" aria-label="Состав цены: без НДС или с НДС" className="inline-flex self-start overflow-hidden rounded-md border border-neutral-300 text-xs">
      {seg(false, "без НДС")}{seg(true, "с НДС")}
    </div>
  );
  return { withVat, toggle };
}

/** График состава цены одного лота: суммы за весь лот без НДС, НДС и режим. unallocated — часть цены лота без назначенной категории (без НДС). */
export function LotPriceComposition({ cats, vat, qty, unitName, ariaLabel, unallocated = 0 }: { cats: Record<CompCat, number>; vat: number; qty: number; unitName: string; ariaLabel: string; unallocated?: number }) {
  const { withVat, toggle } = useChartVat();
  const slices = sliceList(cats, { nobd: unallocated, vat, withVat }).map((s) =>
    s.key === "nobd" ? { ...s, label: "Не распределено", hint: "Часть цены лота, строкам которой в таблице расчёта не назначена категория (в том числе НДС молотка и округления). Назначьте категории строкам — доли появятся." } : s);
  const exclTotal = Object.values(cats).reduce((a, v) => a + v, 0) + unallocated;
  const total = withVat ? exclTotal + vat : exclTotal;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {toggle}
        <span className="text-xs text-neutral-500">{withVat ? "НДС лота — отдельным сектором" : `НДС лота ${formatMoney(vat.toFixed(2))} не показан`}</span>
      </div>
      <PriceCompositionChart stacked slices={slices} total={total} qty={qty} unitName={unitName} totalLabel={withVat ? "Цена лота, с НДС" : "Цена лота, без НДС"} ariaLabel={ariaLabel + (withVat ? ", с НДС" : ", без НДС")} />
    </div>
  );
}
