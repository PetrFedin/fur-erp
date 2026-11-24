"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { PAY_TYPE_LABEL, type PayType } from "@/lib/cashflow-detail";
import { type CashflowData, type SalesMonthly } from "@/lib/cashflow";
import { SPEND, GET, NAVY, STOCK, mon, full, dash, pcs, type Ser, type CumStyle, KIND_COLOR, KIND_ORDER, Spark, type Page } from "./shared";

// Цвета статей трат: различимы между собой и без цвета (подписи в легенде, таблица рядом — текстовая альтернатива).
const COLORS: Record<string, string> = { furAuction: "#1b2a5c", furPurchase: "#4f6bb5", lining: "#2f7f8f", services: "#8a6d1d", work: "#d93a0e", hides: "#7a4a8c" };

const mln = (v: number) => (v / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " млн";

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}

type ChartKind = "money" | "cum" | "goods" | "work";

type ChartProps = {
  kind: ChartKind; months: string[]; d: CashflowData; s: SalesMonthly; ser: Ser; stock: number[];
  active: number | null; setActive: (i: number | null) => void; hot: string | null; setHot: (k: string | null) => void; yearHot: string | null;
  /** Фильтр по категории: траты не делятся, поэтому чистый итог не рисуем. */
  filtered: boolean;
  /** Ширина колонки месяца: считается по ширине контейнера, чтобы график занимал всю ширину карточки. */
  colW: number;
  /** Линия накопительного графика под курсором в легенде: spend / get / net. */
  hotLine?: string | null;
  /** Накопительный график: столбцы (по умолчанию) или линии. */
  cumStyle?: CumStyle;
};

export function Chart({ kind, months, d, s, ser, stock, active, setActive, hot, setHot, yearHot, filtered, colW, hotLine = null, cumStyle = "bars" }: ChartProps) {
  const n = months.length;
  const cumLines = kind === "cum" && cumStyle === "lines", cumBars = kind === "cum" && cumStyle === "bars";
  const left = 58, right = cumLines ? 84 : kind === "goods" ? 44 : 12, top = 12, bottom = 40, H = 250;
  const bw = Math.max(10, Math.min(40, Math.round(colW * 0.7)));
  const W = left + right + n * colW;
  const x = (i: number) => left + i * colW + colW / 2;
  // Подписи значений ряда под курсором в легенде: через столько месяцев, чтобы числа не слипались.
  const labEvery = Math.max(1, Math.ceil(44 / Math.max(1, colW)));
  // Подписи чистого итога над столбцами короче («−272,2»): шаг по ширине колонки, отсчёт от последнего месяца.
  const netStep = Math.max(1, Math.ceil(40 / Math.max(1, colW)));
  // Диапазон оси Y по виду графика.
  let lo = 0, hi = 1;
  if (kind === "money") { hi = Math.max(...ser.revenue, 0); lo = -Math.max(...ser.spend, 0); }
  else if (cumBars) { hi = Math.max(...(s.available ? ser.cumRevenue : [0]), 0); lo = -Math.max(...ser.cumSpend, 0); }
  else if (kind === "cum") { hi = Math.max(...ser.cumSpend, ...ser.cumRevenue, 0); lo = filtered ? 0 : Math.min(...ser.cumNet, 0); }
  else if (kind === "goods") { hi = Math.max(...s.recPcs, ...s.salePcs, ...stock, 0); lo = Math.min(...stock, 0); }
  else { hi = Math.max(...ser.cumWorkPerUnit.map((v) => v ?? 0), 0); lo = 0; }
  // Ось: шаг «круглый», ноль всегда на сетке (между тиками целое число шагов).
  const span = (hi || 1) - Math.min(lo, 0);
  const step = niceMax(span / 4);
  const top2 = Math.ceil((hi || 1) / step) * step, bot2 = Math.floor(Math.min(lo, 0) / step) * step;
  const y = (v: number) => top + (H - top - bottom) * (1 - (v - bot2) / (top2 - bot2));
  const ticks = Array.from({ length: Math.round((top2 - bot2) / step) + 1 }, (_, i) => bot2 + i * step);
  const fmt = kind === "goods" ? (v: number) => String(Math.round(v)) : mln;
  const lineOf = (a: (number | null)[]) => a.map((v, i) => (v === null ? "" : `${i === 0 || a[i - 1] === null ? "M" : "L"}${x(i)},${y(v)}`)).join(" ");
  const label = { money: "Оплаты и поступления денег по месяцам", cum: "Накопительно: оплачено, выручка, чистый итог", goods: "Приход, продажи и остаток в штуках по месяцам", work: "Работа подрядчику на одну единицу нарастающим итогом" }[kind];
  const aria = (i: number) => {
    const m = full(months[i]);
    if (kind === "money") return `${m}: оплачено ${dash(ser.spend[i])}, выручка ${dash(ser.revenue[i])}, чистый поток ${dash(ser.net[i])}`;
    if (kind === "cum") return `${m}: накопленные оплаты ${dash(ser.cumSpend[i])}, выручка ${dash(ser.cumRevenue[i])}, чистый ${dash(ser.cumNet[i])}`;
    if (kind === "goods") return `${m}: приход ${s.recPcs[i]} шт., продано ${s.salePcs[i]} шт., остаток ${stock[i]} шт.`;
    return `${m}: работа на единицу ${dash(ser.cumWorkPerUnit[i])}`;
  };
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke={Math.abs(t) < 1e-9 ? "#52525b" : "#d4d4d8"} strokeWidth={Math.abs(t) < 1e-9 ? 1.5 : 1} />
          <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#5a6a94">{fmt(t)}</text>
        </g>
      ))}
      {months.map((m, i) => (
        <g key={m}>
          <text x={x(i)} y={H - bottom + 16} textAnchor="middle" fontSize={11} fill="#5a6a94">{mon(m)}</text>
          {(i === 0 || m.endsWith("-01")) && <text x={x(i)} y={H - bottom + 30} textAnchor="middle" fontSize={11} fontWeight={700} fill={NAVY}>{m.slice(0, 4)}</text>}
        </g>
      ))}
      {kind === "money" && months.map((m, i) => {
        const sel = active === i || (yearHot !== null && m.startsWith(yearHot));
        const dim = (active !== null || yearHot !== null) && !sel;
        return (
          <g key={m} opacity={dim ? 0.3 : 1}>
            {ser.spend[i] > 0.5 && <rect x={x(i) - bw / 2} width={bw} y={y(0)} height={Math.max(0, y(-ser.spend[i]) - y(0))} fill={SPEND} opacity={hotLine && hotLine !== "spend" ? 0.2 : 1} />}
            {ser.revenue[i] > 0.5 && <rect x={x(i) - bw / 2} width={bw} y={y(ser.revenue[i])} height={Math.max(0, y(0) - y(ser.revenue[i]))} fill={GET} opacity={hotLine && hotLine !== "get" ? 0.2 : 1} />}
            {hotLine === "spend" && ser.spend[i] > 0.5 && i % labEvery === 0 && <text x={x(i)} y={y(-ser.spend[i]) + 13} textAnchor="middle" fontSize={11} fontWeight={700} fill="#171717" stroke="#fff" strokeWidth={3} paintOrder="stroke">{Math.abs(ser.spend[i]) < 0.5 ? "–" : mln(ser.spend[i])}</text>}
            {hotLine === "get" && ser.revenue[i] > 0.5 && i % labEvery === 0 && <text x={x(i)} y={y(ser.revenue[i]) - 5} textAnchor="middle" fontSize={11} fontWeight={700} fill="#171717" stroke="#fff" strokeWidth={3} paintOrder="stroke">{Math.abs(ser.revenue[i]) < 0.5 ? "–" : mln(ser.revenue[i])}</text>}
          </g>
        );
      })}
      {cumBars && (
        <>
          {months.map((m, i) => {
            const dim = active !== null && active !== i;
            const showGet = s.available;
            const net = ser.cumNet[i];
            const showNet = showGet && !filtered && (hotLine === "net" || (n - 1 - i) % netStep === 0);
            const topY = showGet && ser.cumRevenue[i] > 0.5 ? y(ser.cumRevenue[i]) : y(0);
            const signed = (v: number) => (Math.abs(v) < 0.5 ? "0" : (v > 0 ? "+" : "−") + (Math.abs(v) / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 }));
            return (
              <g key={m} opacity={dim ? 0.35 : 1}>
                {ser.cumSpend[i] > 0.5 && <rect x={x(i) - bw / 2} width={bw} y={y(0)} height={Math.max(0, y(-ser.cumSpend[i]) - y(0))} fill={SPEND} opacity={hotLine && hotLine !== "spend" ? 0.2 : 1} />}
                {showGet && ser.cumRevenue[i] > 0.5 && <rect x={x(i) - bw / 2} width={bw} y={y(ser.cumRevenue[i])} height={Math.max(0, y(0) - y(ser.cumRevenue[i]))} fill={GET} opacity={hotLine && hotLine !== "get" ? 0.2 : 1} />}
                {showNet && <text x={x(i)} y={topY - 5} textAnchor="middle" fontSize={11} fontWeight={700} fill={net < -0.5 ? "#b4310b" : net > 0.5 ? "#17613c" : "#52525b"} stroke="#fff" strokeWidth={3} paintOrder="stroke" opacity={hotLine && hotLine !== "net" ? 0.35 : 1}>{signed(net)}</text>}
              </g>
            );
          })}
        </>
      )}
      {cumLines && (
        <>
          <path d={lineOf(ser.cumSpend)} fill="none" stroke={SPEND} strokeWidth={hotLine === "spend" ? 4 : 2.5} opacity={hotLine && hotLine !== "spend" ? 0.2 : 1} />
          {s.available && <path d={lineOf(ser.cumRevenue)} fill="none" stroke={GET} strokeWidth={hotLine === "get" ? 4 : 2.5} opacity={hotLine && hotLine !== "get" ? 0.2 : 1} />}
          {s.available && !filtered && <path d={lineOf(ser.cumNet)} fill="none" stroke={NAVY} strokeWidth={hotLine === "net" ? 4 : 2.5} strokeDasharray="6 4" opacity={hotLine && hotLine !== "net" ? 0.2 : 1} />}
          {(["spend", "get", "net"] as const).filter((k) => hotLine === k).map((k) => {
            const arr = k === "spend" ? ser.cumSpend : k === "get" ? ser.cumRevenue : ser.cumNet, col = k === "spend" ? SPEND : k === "get" ? GET : NAVY;
            return <g key={"lab" + k}>{arr.map((v, i) => (i % labEvery !== 0 && i !== n - 1 ? null : <g key={i}><circle cx={x(i)} cy={y(v)} r={3.5} fill={col} /><text x={x(i)} y={y(v) - 8} textAnchor="middle" fontSize={11} fontWeight={700} fill="#171717" stroke="#fff" strokeWidth={3} paintOrder="stroke">{Math.abs(v) < 0.5 ? "–" : mln(v)}</text></g>))}</g>;
          })}
          {active !== null && <circle cx={x(active)} cy={y(ser.cumSpend[active])} r={5} fill={SPEND} />}
          {n > 0 && <text x={x(n - 1) + 8} y={y(ser.cumSpend[n - 1]) + 4} fontSize={11} fontWeight={700} fill={SPEND}>{mln(ser.cumSpend[n - 1])}</text>}
          {n > 0 && s.available && <text x={x(n - 1) + 8} y={y(ser.cumRevenue[n - 1]) + 4} fontSize={11} fontWeight={700} fill={GET}>{mln(ser.cumRevenue[n - 1])}</text>}
          {n > 0 && s.available && !filtered && <text x={x(n - 1) + 8} y={y(ser.cumNet[n - 1]) + 4} fontSize={11} fontWeight={700} fill={NAVY}>{mln(ser.cumNet[n - 1])}</text>}
        </>
      )}
      {kind === "goods" && (
        <>
          {months.map((m, i) => (
            <g key={m}>
              {s.recPcs[i] > 0 && <rect x={x(i) - bw / 2} width={bw / 2 - 1} y={y(s.recPcs[i])} height={Math.max(0, y(0) - y(s.recPcs[i]))} fill={NAVY} opacity={active !== null && active !== i ? 0.35 : 1} />}
              {s.salePcs[i] > 0 && <rect x={x(i) + 1} width={bw / 2 - 1} y={y(s.salePcs[i])} height={Math.max(0, y(0) - y(s.salePcs[i]))} fill={GET} opacity={active !== null && active !== i ? 0.35 : 1} />}
            </g>
          ))}
          <path d={lineOf(stock)} fill="none" stroke={STOCK} strokeWidth={2.5} />
          {n > 0 && <text x={x(n - 1) + 8} y={y(stock[n - 1]) + 4} fontSize={11} fontWeight={700} fill={STOCK}>{stock[n - 1]}</text>}
        </>
      )}
      {kind === "work" && <path d={lineOf(ser.cumWorkPerUnit)} fill="none" stroke={SPEND} strokeWidth={2.5} />}
      {active !== null && <line x1={x(active)} x2={x(active)} y1={top} y2={H - bottom} stroke="#111" strokeWidth={1} opacity={0.35} />}
      {months.map((m, i) => (
        <rect key={m} x={left + i * colW} y={top} width={colW} height={H - top - bottom} fill="transparent" tabIndex={0} aria-label={aria(i)}
          onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onClick={() => setActive(i)} />
      ))}
      {active !== null && (() => {
        const m = months[active];
        const lines: [string, string, string][] =
          kind === "money" ? [
            ["Оплачено", dash(ser.spend[active]), SPEND],
            ...d.articles.filter((a) => a.byMonth[active] >= 0.5).map((a): [string, string, string] => ["   " + a.label, formatMoney(a.byMonth[active]), COLORS[a.key]]),
            ["Выручка", dash(ser.revenue[active]), GET],
            ...(filtered || !s.available ? [] : [["Чистый поток", dash(ser.net[active]), NAVY] as [string, string, string]]),
          ]
          : kind === "cum" ? [["Оплачено", dash(ser.cumSpend[active]), SPEND], ["Выручка", dash(ser.cumRevenue[active]), GET], ["Чистый итог", dash(ser.cumNet[active]), NAVY], ["За месяц", dash(ser.net[active]), NAVY]]
          : kind === "goods" ? [["Приход", `${pcs(s.recPcs[active])} шт.`, NAVY], ["Продано", `${pcs(s.salePcs[active])} шт.`, GET], ["Остаток", `${stock[active]} шт.`, STOCK]]
          : [["Работа на единицу", dash(ser.cumWorkPerUnit[active]), SPEND]];
        const bw = kind === "money" ? 270 : 214, bh = 24 + lines.length * 17;
        const bx = x(active) + 12 + bw > W - 2 ? x(active) - 12 - bw : x(active) + 12;
        return (
          <g pointerEvents="none" role="presentation">
            <rect x={bx} y={top + 2} width={bw} height={bh} rx={6} fill="#111" opacity={0.94} />
            <text x={bx + 10} y={top + 19} fontSize={12} fontWeight={700} fill="#fff">{full(m)}</text>
            {lines.map(([k, v, c], j) => (
              <g key={k}>
                <rect x={bx + 10} y={top + 30 + j * 17} width={8} height={8} rx={2} fill={c === "#111" ? "#fff" : c} />
                <text x={bx + 24} y={top + 38 + j * 17} fontSize={12} fill="#fff" xmlSpace="preserve">{k.trim()}</text>
                <text x={bx + bw - 10} y={top + 38 + j * 17} fontSize={12} fontWeight={600} textAnchor="end" fill="#fff">{v}</text>
              </g>
            ))}
          </g>
        );
      })()}
    </svg>
  );
}

/** «Работа подрядчика по месяцам»: стековые столбцы по видам платежа (аванс / доплата / окончательный / прочее; разные цвета и штриховка) — левая ось, ₽; линия с точками — получено единиц (правая ось). */
export function WorkMonthsChart({ months, kinds, units, active, setActive, colW, hotKind = null, showUnits = true }: { months: string[]; kinds: Record<PayType, number[]>; units: number[]; active: number | null; setActive: (i: number | null) => void; colW: number; hotKind?: string | null; showUnits?: boolean }) {
  const n = months.length;
  const left = 58, right = 44, top = 12, bottom = 40, H = 230;
  const W = left + right + n * colW;
  const bw = Math.max(10, Math.min(40, Math.round(colW * 0.7)));
  const x = (i: number) => left + i * colW + colW / 2;
  const total = (i: number) => KIND_ORDER.reduce((t, k) => t + kinds[k][i], 0);
  const maxW = niceMax(Math.max(...months.map((_, i) => total(i)), 1)), maxU = niceMax(Math.max(...units, 1));
  const yw = (v: number) => top + (H - top - bottom) * (1 - v / maxW);
  const yu = (v: number) => top + (H - top - bottom) * (1 - v / maxU);
  const line = units.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${yu(v)}`).join(" ");
  const tip = (i: number) => `${full(months[i])}: работа ${dash(total(i))}${KIND_ORDER.filter((k) => Math.abs(kinds[k][i]) > 0.5).map((k) => `, ${PAY_TYPE_LABEL[k].toLowerCase()} ${dash(kinds[k][i])}`).join("")}; получено ${units[i]} шт.`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Оплата работы подрядчика по месяцам по видам платежа и единицы товара, полученные в эти месяцы" className="block">
      <defs>
        <pattern id="hatch-partial" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill={KIND_COLOR.PARTIAL} /><line x1="0" y1="0" x2="0" y2="6" stroke="#fff" strokeWidth="2" /></pattern>
        <pattern id="dots-final" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill={KIND_COLOR.FINAL} /><circle cx="3" cy="3" r="1.2" fill="#fff" /></pattern>
      </defs>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={yw(t * maxW)} y2={yw(t * maxW)} stroke="#d4d4d8" />
          <text x={left - 6} y={yw(t * maxW) + 4} textAnchor="end" fontSize={11} fill="#5a6a94">{t === 0 ? "0" : mln(t * maxW)}</text>
          {showUnits && <text x={W - right + 6} y={yu(t * maxU) + 4} fontSize={11} fill={NAVY}>{Math.round(t * maxU)}</text>}
        </g>
      ))}
      {months.map((m, i) => {
        let acc = 0;
        return (
          <g key={m}>
            <text x={x(i)} y={H - bottom + 16} textAnchor="middle" fontSize={11} fill="#5a6a94">{mon(m)}</text>
            {(i === 0 || m.endsWith("-01")) && <text x={x(i)} y={H - bottom + 30} textAnchor="middle" fontSize={11} fontWeight={700} fill={NAVY}>{m.slice(0, 4)}</text>}
            {KIND_ORDER.map((k) => {
              const v = kinds[k][i];
              if (v <= 0.5) return null;
              const y0 = yw(acc), y1 = yw(acc + v);
              acc += v;
              return <g key={k}><rect x={x(i) - bw / 2} width={bw} y={y1} height={Math.max(0, y0 - y1)} fill={k === "PARTIAL" ? "url(#hatch-partial)" : k === "FINAL" ? "url(#dots-final)" : KIND_COLOR[k]} opacity={(hotKind !== null && hotKind !== k) ? 0.2 : active !== null && active !== i ? 0.35 : 1} stroke={hotKind === k ? "#111" : "none"}><title>{`${PAY_TYPE_LABEL[k]}: ${formatMoney(v)}`}</title></rect>{hotKind === k && i % Math.max(1, Math.ceil(44 / Math.max(1, colW))) === 0 && <text x={x(i)} y={y1 - 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#171717" stroke="#fff" strokeWidth={3} paintOrder="stroke">{Math.abs(v) < 0.5 ? "–" : mln(v)}</text>}</g>;
            })}
          </g>
        );
      })}
      {showUnits && <g opacity={hotKind !== null && hotKind !== "units" ? 0.2 : 1}><path d={line} fill="none" stroke={NAVY} strokeWidth={hotKind === "units" ? 3 : 2} />
      {units.map((v, i) => <circle key={i} cx={x(i)} cy={yu(v)} r={active === i || hotKind === "units" ? 5 : 3} fill={NAVY} />)}
      {hotKind === "units" && units.map((v, i) => (i % Math.max(1, Math.ceil(44 / Math.max(1, colW))) === 0 ? <text key={"u" + i} x={x(i)} y={yu(v) - 9} textAnchor="middle" fontSize={11} fontWeight={700} fill="#171717" stroke="#fff" strokeWidth={3} paintOrder="stroke">{v === 0 ? "–" : v}</text> : null))}</g>}
      {active !== null && <line x1={x(active)} x2={x(active)} y1={top} y2={H - bottom} stroke="#111" opacity={0.35} />}
      {months.map((m, i) => (
        <rect key={m} x={left + i * colW} y={top} width={colW} height={H - top - bottom} fill="transparent" tabIndex={0} aria-label={tip(i)}
          onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onClick={() => setActive(i)} />
      ))}
      {active !== null && (() => {
        const lines: [string, string, string][] = [["Всего работа", dash(total(active)), NAVY], ...KIND_ORDER.filter((k) => Math.abs(kinds[k][active]) > 0.5).map((k): [string, string, string] => [PAY_TYPE_LABEL[k], dash(kinds[k][active]), KIND_COLOR[k]]), ...(showUnits ? [["Получено", `${units[active]} шт.`, NAVY] as [string, string, string]] : [])];
        const bw2 = 230, bh = 24 + lines.length * 17;
        const bx = x(active) + 12 + bw2 > W - 2 ? x(active) - 12 - bw2 : x(active) + 12;
        return (
          <g pointerEvents="none" role="presentation">
            <rect x={bx} y={top + 2} width={bw2} height={bh} rx={6} fill="#111" opacity={0.94} />
            <text x={bx + 10} y={top + 19} fontSize={12} fontWeight={700} fill="#fff">{full(months[active])}</text>
            {lines.map(([k, v, c], j) => (
              <g key={k}>
                <rect x={bx + 10} y={top + 30 + j * 17} width={8} height={8} rx={2} fill={c} />
                <text x={bx + 24} y={top + 38 + j * 17} fontSize={12} fill="#fff">{k}</text>
                <text x={bx + bw2 - 10} y={top + 38 + j * 17} fontSize={12} fontWeight={600} textAnchor="end" fill="#fff">{v}</text>
              </g>
            ))}
          </g>
        );
      })()}
    </svg>
  );
}

/** Плитка-карусель: страницы листаются горизонтальным скроллом/свайпом (scroll-snap), стрелками ‹ › и точками (≥44px), клавишами ← →; клик по странице или «Подробнее» открывает окно. */
export function CarouselTile({ pages, onOpen, label = "Чистый поток и накопленный итог", initial = 0, controls }: { pages: Page[]; onOpen: (page: number) => void; label?: string; /** Страница по умолчанию (например по общему фильтру категории); меняется — карусель переходит на неё. */ initial?: number; controls?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const go = (n: number) => {
    const el = ref.current;
    if (!el) return;
    const k = (n + pages.length) % pages.length;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: k * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
    setI(k);
  };
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ left: initial * el.clientWidth, behavior: "auto" });
  }, [initial]);
  const btn = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-neutral-700 hover:bg-neutral-100";
  return (
    <div role="group" aria-roledescription="carousel" aria-label={label} className="tile-click relative flex h-full min-w-0 flex-col rounded-lg border border-neutral-300 bg-white">
      {controls ? <div className="relative px-3 pt-2">{controls}</div> : null}
      <div ref={ref} tabIndex={0} onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); go(i + 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); } }}
        onScroll={(e) => { const el = e.currentTarget; setI(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto motion-safe:scroll-smooth [scrollbar-width:none]" data-keep-scroll>
        {pages.map((p, k) => (
          <div key={p.label} role="group" aria-roledescription="slide" aria-label={`${k + 1} из ${pages.length}: ${p.label}`} onClick={() => onOpen(k)} className="flex w-full shrink-0 cursor-pointer snap-start flex-col gap-0.5 p-3">
            <div className="flex items-center gap-1 pr-6 text-xs text-neutral-600">{p.label}{p.hint ? <span onClick={(e) => e.stopPropagation()}><InfoHint label={`Как считается: ${p.label}`} wide>{p.hint}</InfoHint></span> : null}</div>
            <div className={"text-lg font-semibold tabular-nums " + (p.tone === "bad" ? "text-[#b4310b]" : p.tone === "good" ? "text-[#17613c]" : "text-neutral-900")}>{p.value}</div>
            {p.sub ? <div className="text-xs text-neutral-600">{p.sub}</div> : null}
            {p.spark ? <Spark values={p.spark} kind={p.sparkKind} /> : null}
            {p.rows?.length ? (
              <dl className="mt-1 flex flex-col gap-0.5 border-t border-neutral-200 pt-1 text-xs">
                {p.rows.map(([k2, v2]) => <div key={k2} className="flex flex-wrap items-baseline justify-between gap-x-2"><dt className="min-w-0 text-neutral-600">{k2}</dt><dd className="ml-auto font-semibold tabular-nums text-neutral-900">{v2}</dd></div>)}
              </dl>
            ) : null}
          </div>
        ))}
      </div>
      {pages.length > 1 ? <div className="mt-auto flex items-center justify-between px-1 pb-1 print:hidden">
        <button type="button" aria-label="Предыдущая страница" onClick={() => go(i - 1)} className={btn}>‹</button>
        <div className="flex items-center">
          {pages.map((p, k) => <button key={p.label} type="button" aria-label={`Страница ${k + 1}: ${p.label}`} aria-current={i === k} onClick={() => go(k)} className="inline-flex min-h-11 min-w-8 items-center justify-center"><span className={"block size-2 rounded-full " + (i === k ? "bg-neutral-900" : "bg-neutral-300")} /></button>)}
        </div>
        <button type="button" aria-label="Следующая страница" onClick={() => go(i + 1)} className={btn}>›</button>
      </div> : null}
    </div>
  );
}
