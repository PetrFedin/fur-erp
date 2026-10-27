"use client";

import { TERMS } from "@/lib/terms";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";
import { SEG_GROUP, segCls } from "@/components/segmented";
import { toCsv } from "@/lib/csv";
import { saveBase64Xlsx } from "@/lib/download-xlsx";
import { exportCashflowXlsx, exportCashflowReportXlsx } from "./actions";
import { InfoHint } from "@/components/info-hint";
import { CAT_LABEL, type CatClass } from "@/lib/sales-receipts-core";
import { DUE_LABEL, dueHint, payDue } from "@/lib/pay-display";
import { ExpTable, PriceDetail, RecvDetail, SpendDetail } from "./drill";
import { PROJECT_START_MONTH, workMonthIdx, cashflowYears } from "@/lib/cashflow";
import { PAY_TYPE_LABEL, spendByType, workKindsByMonth, type PayType, flowPoints, workWindowStats, groupSales, type PayLite } from "@/lib/cashflow-detail";
import type { SalesAggLine } from "@/lib/sales-receipts-core";
import { cumWorkPerUnit, goodsHeadline, headline, seriesOf, type WorkByClass, sliceData, sliceSales, stockSeries, visibleMonths, type CashflowData, type CashflowPeriod, type SalesMonthly, type PrepaidItem } from "@/lib/cashflow";

type ServicePart = { number: string; what: string; invoice: string | null; date: string; paid: number };
type Cat = "all" | "clothes" | "acc";
type Props = { prepaid: number; prepaidBy: Record<string, number>; prepaidList: PrepaidItem[]; incl: CashflowData; ex: CashflowData; salesBy: Record<CatClass | "all", SalesMonthly>; workBy: WorkByClass; workByEx: WorkByClass; pays: PayLite[]; saleLines: SalesAggLine[]; left: { raw: number; prod: number; advance: number }; nowMonth: string; initialGroup?: "period" | "category"; vat: { vat: number; unknown: number; total: number }; services: ServicePart[]; initialPeriod: CashflowPeriod; /** Для проверок вёрстки. */ initialCat?: Cat; /** Для проверок вёрстки: таблица открыта сразу. */ initialDetail?: boolean };

const SPEND = "#d93a0e", GET = "#1f7a4d", NAVY = "#1b2a5c", STOCK = "#8a6d1d";
// Цвета статей трат: различимы между собой и без цвета (подписи в легенде, таблица рядом — текстовая альтернатива).
const COLORS: Record<string, string> = { furAuction: "#1b2a5c", furPurchase: "#4f6bb5", lining: "#2f7f8f", services: "#8a6d1d", work: "#d93a0e", hides: "#7a4a8c" };
/** Короткие названия статей для шапки таблицы (полное — в title и «i»). */
const SHORT: Record<string, string> = { furAuction: "Мех: аукционы", furPurchase: "Мех: закупка", lining: "Подкладка", services: "Услуги УПД", work: "Работа подрядчику", hides: "Шкуры подрядчика" };
const MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const mon = (m: string) => MON[Number(m.slice(5, 7)) - 1];
const full = (m: string) => `${mon(m)} ${m.slice(0, 4)}`;
const dash = (v: number | null) => (v === null || Math.abs(v) < 0.5 ? "—" : formatMoney(v));
const pcs = (v: number) => (v === 0 ? "—" : v.toLocaleString("ru-RU"));
const mln = (v: number) => (v / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " млн";

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}

type Ser = ReturnType<typeof seriesOf>;
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
};

function Chart({ kind, months, d, s, ser, stock, active, setActive, hot, setHot, yearHot, filtered, colW, hotLine = null }: ChartProps) {
  const n = months.length;
  const left = 58, right = kind === "cum" ? 84 : kind === "goods" ? 44 : 12, top = 12, bottom = 40, H = 250;
  const bw = Math.max(10, Math.min(40, Math.round(colW * 0.7)));
  const W = left + right + n * colW;
  const x = (i: number) => left + i * colW + colW / 2;
  // Подписи значений ряда под курсором в легенде: через столько месяцев, чтобы числа не слипались.
  const labEvery = Math.max(1, Math.ceil(44 / Math.max(1, colW)));
  // Диапазон оси Y по виду графика.
  let lo = 0, hi = 1;
  if (kind === "money") { hi = Math.max(...ser.revenue, 0); lo = -Math.max(...ser.spend, 0); }
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
  const label = { money: "Траты и поступления денег по месяцам", cum: "Накопительно: траты, полученные деньги, чистый итог", goods: "Приход, продажи и остаток в штуках по месяцам", work: "Работа подрядчику на одну единицу нарастающим итогом" }[kind];
  const aria = (i: number) => {
    const m = full(months[i]);
    if (kind === "money") return `${m}: траты ${dash(ser.spend[i])}, получено ${dash(ser.revenue[i])}, чистый поток ${dash(ser.net[i])}`;
    if (kind === "cum") return `${m}: накопленные траты ${dash(ser.cumSpend[i])}, получено ${dash(ser.cumRevenue[i])}, чистый ${dash(ser.cumNet[i])}`;
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
            {kind === "cum" && (
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
            ["Потрачено", dash(ser.spend[active]), SPEND],
            ...d.articles.filter((a) => a.byMonth[active] >= 0.5).map((a): [string, string, string] => ["   " + a.label, formatMoney(a.byMonth[active]), COLORS[a.key]]),
            ["Получено", dash(ser.revenue[active]), GET],
            ...(filtered || !s.available ? [] : [["Чистый поток", dash(ser.net[active]), NAVY] as [string, string, string]]),
          ]
          : kind === "cum" ? [["Потрачено", dash(ser.cumSpend[active]), SPEND], ["Получено", dash(ser.cumRevenue[active]), GET], ["Чистый итог", dash(ser.cumNet[active]), NAVY]]
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

const KIND_COLOR: Record<PayType, string> = { ADVANCE: "#d93a0e", PARTIAL: "#2f7f8f", FINAL: "#7a4a8c", OTHER: "#71717a" };
const KIND_ORDER: PayType[] = ["ADVANCE", "PARTIAL", "FINAL", "OTHER"];

/** «Работа подрядчика по месяцам»: стековые столбцы по видам платежа (аванс / доплата / окончательный / прочее; разные цвета и штриховка) — левая ось, ₽; линия с точками — получено единиц (правая ось). */
function WorkMonthsChart({ months, kinds, units, active, setActive, colW, hotKind = null, showUnits = true }: { months: string[]; kinds: Record<PayType, number[]>; units: number[]; active: number | null; setActive: (i: number | null) => void; colW: number; hotKind?: string | null; showUnits?: boolean }) {
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


const KIND_BG = (k: PayType) => (k === "ADVANCE" || k === "OTHER" ? KIND_COLOR[k] : `repeating-linear-gradient(${k === "PARTIAL" ? "45deg" : "0deg"}, ${KIND_COLOR[k]} 0 3px, #fff 3px 5px)`);
function KindLi({ k, hotKind, setHotKind }: { k: PayType; hotKind: string | null; setHotKind: (v: string | null) => void }) {
  return (
    <li><button type="button" aria-pressed={hotKind === k} onMouseEnter={() => setHotKind(k)} onMouseLeave={() => setHotKind(null)} onFocus={() => setHotKind(k)} onBlur={() => setHotKind(null)} onClick={() => setHotKind(hotKind === k ? null : k)} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: KIND_BG(k) }} />{PAY_TYPE_LABEL[k]}</button></li>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-neutral-300 p-3">
      <div className="text-xs text-neutral-600">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-neutral-600">{sub}</div> : null}
    </div>
  );
}

const rubOrDash = (v: number | null) => (v === null || Math.abs(v) < 0.5 ? "—" : formatMoney(v));

type WorkBy = Record<"all" | "clothes" | "acc", { work: number[]; units: number[] }>;

/** Сегмент «Все · Одежда · Аксессуары» внутри окна: по умолчанию = глобальный фильтр, переопределяется локально. «Прочее / без привязки к ТЗ» входит только в «Все». */
function CatSwitch({ cat, setCat }: { cat: "all" | "clothes" | "acc"; setCat: (c: "all" | "clothes" | "acc") => void }) {
  const seg = (on: boolean) => segCls(on);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Категория" className={SEG_GROUP}>
        {(["all", "clothes", "acc"] as const).map((k) => <button key={k} type="button" aria-pressed={cat === k} onClick={() => setCat(k)} className={seg(cat === k)}>{CAT_LABEL[k]}</button>)}
      </div>
      <span className="text-xs text-neutral-600">Работа без привязки к ТЗ и ТЗ без категории входят только в «Все».</span>
    </div>
  );
}

/** Таблица по месяцам проекта: все N месяцев подряд, нули — прочерк. */
function MonthRows({ months, work, units, st }: { months: string[]; work: number[]; units: number[]; st: ReturnType<typeof workWindowStats> }) {
  const n1 = (v: number | null) => (v === null || v === 0 ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 1 }));
  return (
    <div className="w-full min-w-0 overflow-x-auto rounded-lg border border-neutral-300" data-keep-scroll tabIndex={0}>
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-b border-neutral-300">{["Месяц", "Работа, ₽", "Единиц получено", "Работа на единицу, ₽"].map((h, k) => <th key={h} scope="col" className={"px-2 py-2 text-xs font-semibold " + (k === 0 ? "text-left" : "text-right")}>{h}</th>)}</tr></thead>
        <tbody>
          {months.map((mo, i) => (
            <tr key={mo} className="border-b border-neutral-200">
              <td className="px-2 py-1.5">{mo}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{rubOrDash(work[i])}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{units[i] || "—"}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{units[i] > 0 ? rubOrDash(work[i] / units[i]) : "—"}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-neutral-400 font-semibold"><td className="px-2 py-1.5">Итого</td><td className="px-2 py-1.5 text-right tabular-nums">{rubOrDash(st.total)}</td><td className="px-2 py-1.5 text-right tabular-nums">{st.unitsTotal || "—"}</td><td className="px-2 py-1.5 text-right tabular-nums">{rubOrDash(st.perUnit)}</td></tr>
          <tr className="font-semibold"><td className="px-2 py-1.5">Среднее в месяц ({st.n} мес.)</td><td className="px-2 py-1.5 text-right tabular-nums">{rubOrDash(st.avgMonth)}</td><td className="px-2 py-1.5 text-right tabular-nums">{n1(st.avgUnits)}</td><td /></tr>
        </tbody>
      </table>
    </div>
  );
}

/** Окно «Работа в месяц»: сначала количества (единицы, штук в месяц), затем деньги; месяцы проекта (с августа 2025 по текущий); сегмент категории внутри. */
function WorkMonthWindow({ months, by, initialCat }: { months: string[]; by: WorkBy; initialCat: "all" | "clothes" | "acc" }) {
  const [cat, setCat] = useState(initialCat);
  const st = workWindowStats(by[cat].work, by[cat].units, [], "all");
  const n1 = (v: number | null) => (v === null || v === 0 ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 1 }));
  return (
    <div className="flex flex-col gap-4">
      <CatSwitch cat={cat} setCat={setCat} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Stat label="Единиц получено, шт." value={st.unitsTotal ? String(st.unitsTotal) : "—"} />
        <Stat label="Месяцев проекта" value={String(st.n)} sub="с августа 2025 по текущий; текущий месяц неполный" />
        <Stat label="Штук в месяц (единицы ÷ месяцы)" value={n1(st.avgUnits)} />
        <Stat label="Работа всего, ₽" value={rubOrDash(st.total)} />
        <Stat label="Работа в месяц, ₽" value={rubOrDash(st.avgMonth)} />
        <Stat label="Работа на единицу, ₽" value={rubOrDash(st.perUnit)} />
      </div>
      <MonthRows months={months} work={by[cat].work} units={by[cat].units} st={st} />
    </div>
  );
}

/** Окно «Работа на единицу»: плитки (₽/шт. всего ÷ единиц, простое среднее месяцев, минимум, максимум, единицы, работа), мини-строки категорий; сегмент категории; таблица свёрнута. */
function WorkUnitWindow({ months, by, initialCat }: { months: string[]; by: WorkBy; initialCat: "all" | "clothes" | "acc" }) {
  const [cat, setCat] = useState(initialCat);
  const [table, setTable] = useState(false);
  const st = workWindowStats(by[cat].work, by[cat].units, [], "all");
  const c1 = workWindowStats(by.clothes.work, by.clothes.units, [], "all"), c2 = workWindowStats(by.acc.work, by.acc.units, [], "all");
  const catLine = (c: ReturnType<typeof workWindowStats>) => (c.perUnit === null ? "—" : `${rubOrDash(c.perUnit)} · ${c.unitsTotal} шт.`);
  return (
    <div className="flex flex-col gap-4">
      <CatSwitch cat={cat} setCat={setCat} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <div className="col-span-2 rounded-lg border border-neutral-300 p-3 md:col-span-1">
          <div className="text-xs text-neutral-600">Работа на единицу (оплачено ÷ получено)</div>
          <div className="text-lg font-semibold tabular-nums">{rubOrDash(st.perUnit)}</div>
          <div className="text-xs text-neutral-600">оплачено {rubOrDash(st.total)} ÷ получено {st.unitsTotal || "—"} шт.</div>
          <dl className="mt-1 flex flex-col gap-0.5 border-t border-neutral-200 pt-1 text-xs">
            <div className="flex justify-between gap-2"><dt className="text-neutral-600">Одежда</dt><dd className="font-semibold tabular-nums">{catLine(c1)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-neutral-600">Аксессуары</dt><dd className="font-semibold tabular-nums">{catLine(c2)}</dd></div>
          </dl>
        </div>
        <Stat label="Единиц всего" value={st.unitsTotal ? String(st.unitsTotal) : "—"} sub={`месяцев проекта ${st.n}`} />
        <Stat label="Работа всего" value={rubOrDash(st.total)} />
      </div>
      <div>
        <button type="button" aria-expanded={table} onClick={() => setTable((v) => !v)} className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm">{table ? "Скрыть таблицу по месяцам" : "Таблица по месяцам"}</button>
      </div>
      {table && <MonthRows months={months} work={by[cat].work} units={by[cat].units} st={st} />}
    </div>
  );
}

/** Контейнер графика: измеряет свою ширину и отдаёт ширину колонки месяца, чтобы график занимал всю ширину; на узком экране — не уже 26 px на месяц с прокруткой внутри блока. */
function ChartBox({ n, extra = 70, children }: { n: number; extra?: number; children: (colW: number) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const colW = w > 0 ? Math.max(26, Math.min(80, Math.floor((w - extra) / Math.max(1, n)))) : 26;
  return <div ref={ref} className="w-full overflow-x-auto" data-keep-scroll>{children(colW)}</div>;
}

/** Спарклайн плитки. «bars» — месячные значения столбиками со знаком; «area» — накопительная линия с нулевой осью и заливкой (плюс зелёным, минус красным), последняя точка отмечена; иначе обычная линия. */
function Spark({ values, kind = "line" }: { values: number[]; kind?: "line" | "bars" | "area" }) {
  const id = useId();
  if (values.length < 2) return null;
  const W = 100, H = 28;
  const lo = Math.min(...values, kind === "line" ? Infinity : 0), hi = Math.max(...values, kind === "line" ? -Infinity : 0);
  const y = (v: number) => (hi === lo ? H / 2 : 2 + ((hi - v) / (hi - lo)) * (H - 4));
  const x = (i: number) => (i / (values.length - 1)) * W;
  if (kind === "bars") {
    const bw = Math.max(1, W / values.length - 1);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-7 w-full" role="img" aria-label="Месячные значения">
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="#a1a1aa" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        {values.map((v, i) => <rect key={i} x={x(i) - bw / 2} width={bw} y={Math.min(y(v), y(0))} height={Math.abs(y(v) - y(0))} fill={v < 0 ? "#b4310b" : "#17613c"} />)}
      </svg>
    );
  }
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  if (kind === "area") {
    const z = y(0);
    const poly = `0,${z} ${pts} ${W},${z}`;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-7 w-full" role="img" aria-label="Накопленный итог по месяцам">
        <defs>
          <clipPath id={id + "up"}><rect x={0} y={0} width={W} height={z} /></clipPath>
          <clipPath id={id + "dn"}><rect x={0} y={z} width={W} height={H - z} /></clipPath>
        </defs>
        <polygon points={poly} fill="#17613c" opacity={0.25} clipPath={`url(#${id}up)`} />
        <polygon points={poly} fill="#b4310b" opacity={0.25} clipPath={`url(#${id}dn)`} />
        <line x1={0} x2={W} y1={z} y2={z} stroke="#a1a1aa" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        <polyline points={pts} fill="none" stroke="#1b2a5c" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={1.6} fill="#1b2a5c" />
      </svg>
    );
  }
  return <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-6 w-full" aria-hidden><polyline points={pts} fill="none" stroke="#5a6a94" strokeWidth={1.5} vectorEffect="non-scaling-stroke" /></svg>;
}

/** Окно с деталями поверх страницы — тот же паттерн, что у плиток Главной (ProductionModal): затемнение, role=dialog, Esc, ✕, клик по фону, фокус-ловушка, возврат фокуса; на телефоне во весь экран. */
function TileModal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const f = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])")).filter((el) => !el.hasAttribute("disabled"));
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/45 sm:items-center sm:p-4 print:hidden" onMouseDown={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="cf-modal-title" className="flex h-dvh max-h-dvh w-full max-w-4xl flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[94vh] sm:rounded-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 p-4">
          <div className="min-w-0">
            <h2 id="cf-modal-title" className="text-lg font-semibold">{title}</h2>
            <div className="mt-0.5 text-xs text-neutral-500">{subtitle}</div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Закрыть окно" className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-neutral-300 px-3 text-sm hover:bg-neutral-50">✕ Закрыть</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}


type Page = { label: string; value: string; sub?: string; tone?: "bad" | "good"; spark?: number[]; sparkKind?: "line" | "bars" | "area"; hint?: React.ReactNode; /** Строки «подпись — значение» под значением (например деньги после количеств). */ rows?: [string, string][]; /** Подпись ряда под строками. */ foot?: string };

/** Плитка-карусель: страницы листаются горизонтальным скроллом/свайпом (scroll-snap), стрелками ‹ › и точками (≥44px), клавишами ← →; клик по странице или «Подробнее» открывает окно. */
function CarouselTile({ pages, onOpen, label = "Чистый поток и накопленный итог", initial = 0, controls }: { pages: Page[]; onOpen: (page: number) => void; label?: string; /** Страница по умолчанию (например по общему фильтру категории); меняется — карусель переходит на неё. */ initial?: number; controls?: React.ReactNode }) {
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
            <div className="flex items-center gap-1 text-xs text-neutral-600">{p.label}{p.hint ? <span onClick={(e) => e.stopPropagation()}><InfoHint label={`Как считается: ${p.label}`} wide>{p.hint}</InfoHint></span> : null}</div>
            <div className={"text-lg font-semibold tabular-nums " + (p.tone === "bad" ? "text-[#b4310b]" : p.tone === "good" ? "text-[#17613c]" : "text-neutral-900")}>{p.value}</div>
            {p.sub ? <div className="text-xs text-neutral-600">{p.sub}</div> : null}
            {p.spark ? <Spark values={p.spark} kind={p.sparkKind} /> : null}
            {p.rows?.length ? (
              <dl className="mt-1 flex flex-col gap-0.5 border-t border-neutral-200 pt-1 text-xs">
                {p.rows.map(([k2, v2]) => <div key={k2} className="flex items-baseline justify-between gap-2"><dt className="text-neutral-600">{k2}</dt><dd className="font-semibold tabular-nums text-neutral-900">{v2}</dd></div>)}
              </dl>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between px-1 pb-1 print:hidden">
        <button type="button" aria-label="Предыдущая страница" onClick={() => go(i - 1)} className={btn}>‹</button>
        <div className="flex items-center">
          {pages.map((p, k) => <button key={p.label} type="button" aria-label={`Страница ${k + 1}: ${p.label}`} aria-current={i === k} onClick={() => go(k)} className="inline-flex min-h-11 min-w-8 items-center justify-center"><span className={"block size-2 rounded-full " + (i === k ? "bg-neutral-900" : "bg-neutral-300")} /></button>)}
        </div>
        <button type="button" aria-label="Следующая страница" onClick={() => go(i + 1)} className={btn}>›</button>
      </div>
    </div>
  );
}

type VatChoice = "global" | "in" | "ex";
/** «С НДС | Без НДС» внутри плитки: по умолчанию = общая панель, локально переопределяется (один компонент для «Получено» и «Средней цены»). */
function VatSeg({ choice, setChoice, globalEx }: { choice: VatChoice; setChoice: (c: VatChoice) => void; globalEx: boolean }) {
  const ex = choice === "global" ? globalEx : choice === "ex";
  const seg = (on: boolean) => segCls(on, "sm");
  return (
    <div role="group" aria-label="НДС плитки" className={SEG_GROUP}>
      <button type="button" aria-pressed={!ex} onClick={() => setChoice("in")} className={seg(!ex)}>С НДС</button>
      <button type="button" aria-pressed={ex} onClick={() => setChoice("ex")} className={seg(ex)}>Без НДС</button>
    </div>
  );
}

function Tile({ label, value, sub, hint, tone, mini, spark, extra, after, controls, expandId, onToggle }: { /** Свои элементы управления внутри плитки (например «С НДС | Без НДС»). */ controls?: React.ReactNode; /** Второй блок под мини-строками: подпись, значение, мини-строки (деньги после количеств). */ after?: { label: string; value: string; mini?: [string, string][] }; label: string; value: string; sub?: string; hint?: React.ReactNode; tone?: "bad" | "good"; /** Две мини-строки «Одежда … / Аксессуары …» со своими значениями. */ mini?: [string, string][]; spark?: number[]; extra?: string; expandId?: string; /** устарело, не используется */ openId?: string | null; onToggle?: (id: string) => void }) {
  const clickable = !!expandId && !!onToggle;
  return (
    <div className={"relative flex min-w-0 flex-col rounded-lg border border-neutral-300 bg-white" + (clickable ? " tile-click" : "")}>
      {/* Вся плитка — кнопка: клик открывает окно с деталями поверх страницы (как плитки на Главной); значок «i» и ссылки остаются отдельными. */}
      {clickable ? <button type="button" aria-haspopup="dialog" aria-label={`Подробнее: ${label}`} onClick={() => onToggle!(expandId!)} className="absolute inset-0 rounded-lg print:hidden" /> : null}
      <div className="pointer-events-none relative flex flex-col gap-0.5 p-3">
        <div className="flex items-center gap-1 text-xs text-neutral-600">{label}{hint ? <span className="pointer-events-auto"><InfoHint label={`Как считается: ${label}`} wide>{hint}</InfoHint></span> : null}{clickable ? <span aria-hidden className="ml-auto text-neutral-500">›</span> : null}</div>
        {controls ? <div className="pointer-events-auto relative my-0.5">{controls}</div> : null}
        <div className={"text-lg font-semibold tabular-nums " + (tone === "bad" ? "text-[#b4310b]" : tone === "good" ? "text-[#17613c]" : "text-neutral-900")}>{value}</div>
        {sub ? <div className="text-xs text-neutral-600">{sub}</div> : null}
        {extra ? <div className="text-xs text-neutral-600">{extra}</div> : null}
        {spark ? <Spark values={spark} /> : null}
        {mini ? (
          <dl className="mt-1 flex flex-col gap-0.5 border-t border-neutral-200 pt-1 text-xs">
            {mini.map(([k, v]) => <div key={k} className="flex items-baseline justify-between gap-2"><dt className="text-neutral-600">{k}</dt><dd className="font-semibold tabular-nums whitespace-nowrap text-neutral-900">{v}</dd></div>)}
          </dl>
        ) : null}
        {after ? (
          <div className="mt-1 flex flex-col gap-0.5 border-t border-neutral-200 pt-1 text-xs">
            <div className="text-neutral-600">{after.label}</div>
            <div className="text-base font-semibold tabular-nums text-neutral-900">{after.value}</div>
            {after.mini?.map(([k, v]) => <div key={k} className="flex items-baseline justify-between gap-2"><span className="text-neutral-600">{k}</span><span className="font-semibold tabular-nums">{v}</span></div>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}


export function CashflowView({ prepaid, prepaidBy, prepaidList, incl, ex, salesBy, workBy: workByIncl, workByEx, pays, saleLines, left, nowMonth, initialGroup, vat, services, initialPeriod, initialDetail, initialCat }: Props) {
  const [period, setPeriod] = useState<CashflowPeriod>(initialPeriod);
  const [exVat, setExVat] = useState(false);
  const workBy = exVat ? workByEx : workByIncl;
  const [cat, setCat] = useState<Cat>(initialCat ?? "all");
  const [gTable, setGTable] = useState(false);
  const [detail, setDetail] = useState(initialDetail ?? true);
  const [fOpen, setFOpen] = useState(false);
  const [gActive, setGActive] = useState<number | null>(null);
  /** НДС внутри окна «Получено» / «Средняя цена»: действует только в окне, при закрытии возврат к общей панели. */
  const [modalEx, setModalEx] = useState<boolean | null>(null);
  const [openMonths, setOpenMonths] = useState<string[]>([]);
  const [openTile, setOpenTile] = useState<string | null>(null);
  const toggleTile = (id: string) => { setModalEx(null); setOpenTile(id); };
  const [open, setOpen] = useState<string[]>([]);
  const [group, setGroupState] = useState<"period" | "category">(initialGroup ?? "period");
  const [catOpen, setCatOpen] = useState<string[]>([]);
  const setGroup = (g: "period" | "category") => { setGroupState(g); const u = new URL(window.location.href); if (g === "period") u.searchParams.delete("group"); else u.searchParams.set("group", g); window.history.replaceState(null, "", u.toString()); };
  const [active, setActive] = useState<number | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [yearHot, setYearHot] = useState<string | null>(null);
  const [hotLine, setHotLine] = useState<string | null>(null);
  const [hotMoney, setHotMoney] = useState<string | null>(null);
  const [hotKind, setHotKind] = useState<string | null>(null);
  const [hotKind2, setHotKind2] = useState<string | null>(null);
  const [kindGroup, setKindGroup] = useState<"all" | "raw" | "work">("all");
  const [kActive, setKActive] = useState<number | null>(null);
  const [chartView, setChartView] = useState<"money" | "kinds">("money");
  const sales = salesBy[cat];
  const filtered = cat !== "all";

  const m = useMemo(() => {
    const all = exVat ? ex : incl;
    const revAll = exVat ? sales.revEx : sales.revIncl;
    const keep = visibleMonths(all, salesBy.all, period);
    const d = sliceData(all, keep, period);
    const s = sliceSales(sales, keep);
    const revenue = keep.map((i) => revAll[i]);
    const serAll = seriesOf(all, sales, revAll);
    const stAll = stockSeries(sales);
    const pick = <T,>(a: T[]) => keep.map((i) => a[i]);
    // Работа по категории — по ТЗ → модель → группа; «Всё» — вся статья «Работа подрядчику».
    const workAll = cat === "all" ? serAll.work : workBy[cat];
    const cumRec = stAll.cumRec;
    const cumWpu = cumWorkPerUnit(workAll, cumRec, sales.available);
    const ser: Ser = { spend: pick(serAll.spend), revenue, net: pick(serAll.net), cumSpend: pick(serAll.cumSpend), cumRevenue: pick(serAll.cumRevenue), cumNet: pick(serAll.cumNet), work: pick(workAll), cumWorkPerUnit: pick(cumWpu) };
    const h = headline(d, s, revenue, ser.work, "all");
    const g = goodsHeadline(sales, all.months, period);
    const last = keep.length ? keep[keep.length - 1] : -1;
    const wTot = ser.work.reduce((a, b) => a + b, 0), uTot = s.recPcs.reduce((a, b) => a + b, 0);
    const wu = { work: ser.work, units: s.recPcs, avg: sales.available && uTot > 0 && Math.abs(wTot) > 0.005 ? wTot / uTot : null };
    const per = (c: "clothes" | "acc") => {
      const sc = sliceSales(salesBy[c], keep);
      const rv = keep.map((i) => (exVat ? salesBy[c].revEx : salesBy[c].revIncl)[i]);
      return { h: headline(d, sc, rv, keep.map((i) => workBy[c][i]), "all"), g: goodsHeadline(salesBy[c], all.months, period) };
    };
    return { all, keep, d, s, revenue, ser, stock: pick(stAll.stock), h, g, wu, per: { clothes: per("clothes"), acc: per("acc") }, cumNetEnd: last >= 0 ? serAll.cumNet[last] : 0 };
  }, [exVat, period, cat, incl, ex, sales, salesBy, workBy]);
  const { d, s, ser, h, g } = m;
  const months = d.months;
  const hasSales = sales.available;
  const mini = (f: (c: "clothes" | "acc") => string): [string, string][] => [["Одежда", hasSales ? f("clothes") : "—"], ["Аксессуары", hasSales ? f("acc") : "—"]];
  const soText = (x: { cumReceived: number; cumSold: number; sellThrough: number | null }) => (x.sellThrough === null ? "—" : x.sellThrough.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " %" + (x.cumSold > x.cumReceived ? "*" : x.cumReceived < 10 ? "†" : ""));
  const stockEnd = stockSeries(sales).stock.at(-1) ?? 0;
  const label = period === "all" ? "2025–2026" : period;
  const vatNote = exVat ? "без НДС" : "с НДС";
  const stockBy = useMemo(() => ({ clothes: stockSeries(salesBy.clothes).stock, acc: stockSeries(salesBy.acc).stock, other: stockSeries(salesBy.other).stock }), [salesBy]);
  /** Месяц по категориям: выручка выбранного режима НДС, единицы прихода и продажи, остаток, работа подрядчика по ТЗ; траты по категориям не делятся. */
  const clsMonth = (c: "clothes" | "acc" | "other", gi: number) => ({ rev: (exVat ? salesBy[c].revEx : salesBy[c].revIncl)[gi], rec: salesBy[c].recPcs[gi], sale: salesBy[c].salePcs[gi], stock: stockBy[c][gi], work: workBy[c][gi] });
  const due = payDue(left.raw + left.prod, left.advance);
  /** Виды платежей на плитке «Потрачено»: аванс / доплата / окончательный расчёт / прочее; Σ = главное число. */
  const spendKinds = useMemo(() => (Object.keys(PAY_TYPE_LABEL) as PayType[]).filter((t) => Math.abs(spendByType(pays, months, exVat).find((r) => r.type === t)?.total ?? 0) > 0.5).map((t) => ({ type: t, short: t === "ADVANCE" ? "Авансы" : t === "PARTIAL" ? "Доплаты" : t === "FINAL" ? "Окончательный расчёт" : "Прочее / без вида", total: spendByType(pays, months, exVat).find((r) => r.type === t)?.total ?? 0 })), [pays, months, exVat]);
  /** Метрики работы: месяцы от PROJECT_START_MONTH до текущего включительно (в границах периода); по категориям — работа по ТЗ и приход категории. */
  const wm = useMemo(() => {
    const cf = exVat ? ex : incl; // «Без НДС»: работа без НДС, как в таблице и как выручка
    const idx = workMonthIdx(cf.months, nowMonth, period);
    const pick = (a: number[]) => idx.map((i) => a[i]);
    const workAllSeries = cf.articles.find((a) => a.key === "work")?.byMonth ?? cf.months.map(() => 0);
    const by = { all: { work: pick(workAllSeries), units: pick(salesBy.all.recPcs) }, clothes: { work: pick(workBy.clothes), units: pick(salesBy.clothes.recPcs) }, acc: { work: pick(workBy.acc), units: pick(salesBy.acc.recPcs) } };
    return { months: idx.map((i) => cf.months[i]), by, st: { all: workWindowStats(by.all.work, by.all.units, [], "all"), clothes: workWindowStats(by.clothes.work, by.clothes.units, [], "all"), acc: workWindowStats(by.acc.work, by.acc.units, [], "all") } };
  }, [incl, ex, exVat, nowMonth, period, salesBy, workBy]);
  const modalExEff = modalEx ?? exVat;
  const modalChoice: VatChoice = modalEx === null ? "global" : modalEx ? "ex" : "in";
  const recvSum = (c: "all" | "clothes" | "acc", ex: boolean) => m.keep.reduce((t, i) => t + (ex ? salesBy[c].revEx[i] : salesBy[c].revIncl[i]), 0);
  const catPages = ["all", "clothes", "acc"] as const;
  const pageOf = { all: 0, clothes: 1, acc: 2 } as const;
  const [winCat, setWinCat] = useState<"all" | "clothes" | "acc">("all");
  const openFor = (id: string, page: number) => { setWinCat(catPages[page]); toggleTile(id); };
  // Блок «Товар и работа»: ось месяцев начинается с PROJECT_START_MONTH (до него нет ни товара, ни работы); значения остатка нарастающим итогом не меняются.
  const gOff = (() => { const k = months.findIndex((mo) => mo >= PROJECT_START_MONTH); return k < 0 ? months.length : k; })();
  const gMonths = months.slice(gOff);
  const gS = { ...s, recPcs: s.recPcs.slice(gOff), salePcs: s.salePcs.slice(gOff), revIncl: s.revIncl.slice(gOff), revEx: s.revEx.slice(gOff), discIncl: s.discIncl.slice(gOff) };
  const gSer = { ...ser, spend: ser.spend.slice(gOff), revenue: ser.revenue.slice(gOff), net: ser.net.slice(gOff), cumSpend: ser.cumSpend.slice(gOff), cumRevenue: ser.cumRevenue.slice(gOff), cumNet: ser.cumNet.slice(gOff), work: ser.work.slice(gOff), cumWorkPerUnit: ser.cumWorkPerUnit.slice(gOff) };
  const gStock = m.stock.slice(gOff);
  /** Платежи по видам (аванс / доплата / окончательный / прочее) за сырьё и за работу; «Сырьё» = мех, подкладка и шкуры подрядчика, «Работа» = работа подрядчику и услуги по УПД (как в таблице). */
  const kg = useMemo(() => {
    const raw = ["furAuction", "furPurchase", "hides", "lining"] as const, wrk = ["work", "services"] as const;
    const out: Record<PayType, number[]> = { ADVANCE: months.map(() => 0), PARTIAL: months.map(() => 0), FINAL: months.map(() => 0), OTHER: months.map(() => 0) };
    const idx = new Map(months.map((mo, i) => [mo, i]));
    const keys = kindGroup === "raw" ? raw : kindGroup === "work" ? wrk : [...raw, ...wrk];
    for (const p of pays) {
      const i = idx.get(p.iso.slice(0, 7));
      if (i === undefined) continue;
      const k = p.amount ? (exVat ? p.ex / p.amount : 1) : 0;
      const v = keys.reduce((t, key) => t + (p.art[key] ?? 0), 0) * k;
      out[(p.type in out ? p.type : "OTHER") as PayType][i] += v;
    }
    const used = months.map((_, i) => KIND_ORDER.some((kk) => Math.abs(out[kk][i]) > 0.5));
    const a0 = used.indexOf(true), b0 = used.lastIndexOf(true);
    const sel = a0 < 0 ? [] : months.map((_, i) => i).filter((i) => i >= a0 && i <= b0);
    return { months: sel.map((i) => months[i]), kinds: Object.fromEntries(KIND_ORDER.map((kk) => [kk, sel.map((i) => out[kk][i])])) as Record<PayType, number[]> };
  }, [pays, months, exVat, kindGroup]);
  const gKinds = useMemo(() => workKindsByMonth(exVat ? pays.map((p) => ({ ...p, art: { ...p.art, work: p.amount ? (p.art.work ?? 0) * (p.ex / p.amount) : 0 } })) : pays, gMonths, cat), [pays, gMonths, cat, exVat]);
  const gWu = { work: m.wu.work.slice(gOff), units: m.wu.units.slice(gOff), avg: m.wu.avg };
  const shownText = `${CAT_LABEL[cat]} · ${period === "all" ? "2025–2026" : period} · ${vatNote}`;
  const monthLabel = (mo: string) => `${["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"][Number(mo.slice(5, 7)) - 1]} ${mo.slice(0, 4)}`;
  const catArg = cat === "all" ? "all" : cat;
  /** НДС справочно за период: в платежах = с НДС − без НДС по тем же месяцам, в выручке = с НДС − без НДС. */
  const vatPay = m.keep.map((i) => incl.monthTotals[i] - ex.monthTotals[i]);
  const vatRev = m.keep.map((i) => salesBy.all.revIncl[i] - salesBy.all.revEx[i]);
  const artSum = (...keys: string[]) => d.articles.filter((a) => keys.includes(a.key)).reduce((t, a) => t + a.total, 0);
  const rawSpend = artSum("furAuction", "furPurchase", "hides", "lining"), workSpend = artSum("work", "services");
  const fp = useMemo(() => flowPoints(months, ser.net, ser.cumNet), [months, ser]);
  const sum0 = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const workTotalAll = sum0(workBy.clothes) + sum0(workBy.acc) + sum0(workBy.other);
  const workClassified = sum0(workBy.clothes) + sum0(workBy.acc);
  const workLinked = workTotalAll - sum0(workBy.unlinked);
  const unitsBy = { clothes: sum0(salesBy.clothes.recPcs), acc: sum0(salesBy.acc.recPcs), other: sum0(salesBy.other.recPcs) };
  const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

  const clearHot = () => { setHot(null); setActive(null); setYearHot(null); };
  const years = [...new Set(months.map((x) => x.slice(0, 4)))];
  type Row = { id: string; label: string; kind: "month" | "year" | "total"; idx: number[] };
  const rows: Row[] = [
    ...years.flatMap((y): Row[] => {
      const idx = months.map((mm, i) => (mm.startsWith(y) ? i : -1)).filter((i) => i >= 0);
      return [...idx.map((i): Row => ({ id: months[i], label: full(months[i]), kind: "month", idx: [i] })), { id: "y" + y, label: `Итого ${y}`, kind: "year", idx }];
    }),
    ...(years.length > 1 ? [{ id: "all", label: "Итого", kind: "total" as const, idx: months.map((_, i) => i) }] : []),
  ];
  const sum = (r: Row, f: (i: number) => number) => r.idx.reduce((t, i) => t + f(i), 0);
  const lastOf = (r: Row, a: number[]) => a[r.idx[r.idx.length - 1]];
  const workOf = (i: number) => ser.work[i];
  const perUnit = (w: number, u: number) => (u > 0 && hasSales ? w / u : null);

  type Col = { id: string; head: string; sub: string; strong?: boolean; art?: string; get: (r: Row) => number };
  const artCols: Col[] = d.articles.flatMap((a): Col[] => [
    ...(a.types.length > 1 ? a.types.map((t): Col => ({ id: a.key + t.type, art: a.key, head: a.label, sub: t.label, get: (r) => sum(r, (i) => t.byMonth[i]) })) : []),
    { id: a.key + "T", art: a.key, head: a.label, sub: a.types.length > 1 ? "Итого по статье" : a.types[0]?.label ?? "Итого", strong: a.types.length > 1, get: (r) => sum(r, (i) => a.byMonth[i]) },
  ]);

  /** Тонкая вертикальная граница слева у первого подстолбца блока статьи (блоки статей и видов платежа отделены друг от друга). */
  const blk = (c: Col) => { const k = artCols.findIndex((x) => x.id === c.id); return k === 0 || artCols[k - 1].art !== c.art ? " border-l border-neutral-300" : ""; };
  const csv = () => {
    const head = ["Период", ...artCols.map((c) => `${c.head}: ${c.sub}`), "Потрачено", "Получено", "Чистый поток", "Накопительно потрачено", "Накопительно получено", "Накопительно чистый", "Единиц получено", "Единиц продано", "Остаток, шт.", "Работа за период", "Работа на единицу"];
    const nf = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","));
    const body = rows.map((r) => {
      const u = sum(r, (i) => s.recPcs[i]), w = sum(r, workOf);
      return [r.label, ...artCols.map((c) => nf(c.get(r))), nf(sum(r, (i) => ser.spend[i])), nf(sum(r, (i) => ser.revenue[i])), filtered ? "" : nf(sum(r, (i) => ser.net[i])), nf(lastOf(r, ser.cumSpend)), nf(lastOf(r, ser.cumRevenue)), filtered ? "" : nf(lastOf(r, ser.cumNet)),
        String(u), String(sum(r, (i) => s.salePcs[i])), String(lastOf(r, m.stock)), nf(w), nf(perUnit(w, u))];
    });
    const blob = new Blob([toCsv(head, body)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cashflow-${label.replace(/[^0-9a-zа-я]+/gi, "-")}-${exVat ? "bez-nds" : "s-nds"}-${cat}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const [xlsxBusy, setXlsxBusy] = useState(false);
  const xlsx = async () => {
    setXlsxBusy(true);
    try {
      const head = ["Период", ...artCols.map((c) => `${c.head}: ${c.sub}`), "Потрачено", "Получено", "Чистый поток", "Накопительно потрачено", "Накопительно получено", "Накопительно чистый", "Единиц получено", "Единиц продано", "Остаток, шт.", "Работа за период", "Работа на единицу"];
      const body = rows.map((r) => {
        const u = sum(r, (i) => s.recPcs[i]), w = sum(r, workOf);
        return { label: r.label, kind: r.kind, cells: [...artCols.map((c) => c.get(r)), sum(r, (i) => ser.spend[i]), sum(r, (i) => ser.revenue[i]), filtered ? null : sum(r, (i) => ser.net[i]), lastOf(r, ser.cumSpend), lastOf(r, ser.cumRevenue), filtered ? null : lastOf(r, ser.cumNet), u, sum(r, (i) => s.salePcs[i]), lastOf(r, m.stock), w, perUnit(w, u)] };
      });
      const res = await exportCashflowXlsx({ title: `Cashflow · ${label}`, subtitle: `${exVat ? "Без НДС" : "С НДС"} · ${CAT_LABEL[cat]}`, head, rows: body, file: `Cashflow ${label} ${exVat ? "без НДС" : "с НДС"} ${cat}` });
      if (res.ok) saveBase64Xlsx(res.name, res.base64);
    } finally { setXlsxBusy(false); }
  };

  const seg = (on: boolean) => segCls(on);
  const th = "px-2 py-2 text-right text-xs font-semibold whitespace-nowrap";
  const td = "min-w-[6.5rem] px-2 py-1.5 text-right text-sm tabular-nums whitespace-nowrap";
  const sticky = "sticky left-0 z-[1] text-left";
  const noSalesNote = "Нет данных о продажах: выгрузка поступлений и продаж ещё не загружена.";
  /** Нулевые суммы — прочерк; исключение — результат расчёта «К доплате» (formatMoney напрямую). */
  const money = (v: number) => (Math.abs(v) < 0.5 ? "—" : formatMoney(v));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3">
        <h1 className="text-xl font-semibold">Cashflow</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-3 text-xs print:hidden"><Link href="/payments" className="text-blue-700 hover:underline">→ Оплаты</Link><Link href="/sales" className="text-blue-700 hover:underline">→ Продажи</Link></span>
          <InfoHint label="Что такое Cashflow" align="right" wide>
            <p><b>Потрачено</b> — все проведённые оплаты («Оплачено» в разделе «Оплаты») по статьям и по дате платежа. Запланированные и неподтверждённые платежи не входят. Итог за 2025–2026 равен «Оплачено всего» (с НДС).</p>
            <p className="mt-1">На странице «Оплаты» годы для закупок вне аукциона считаются по году закупки, а здесь — по дате платежа, поэтому по годам суммы могут отличаться, итог и месяцы те же.</p>
            <p className="mt-1"><b>Получено</b> — розничная выручка из выгрузки продаж по дате продажи (чистая, после скидок, возвраты вычтены), а не движение по расчётному счёту.</p>
            <p className="mt-1">«Без НДС»: у платежей за сырьё НДС берётся из закупок (ставка позиций, 20% или 22%); у оплаты работы подрядчику и авансов без привязки к закупке НДС в данных нет — эти суммы остаются как есть
              {exVat && vat.unknown > 0.5 ? ` (${money(vat.unknown)} из ${money(vat.total)})` : ""}. У продаж НДС взят из выгрузки (столбцы «с НДС» и «без НДС»).</p>
          </InfoHint>
        </div>
      </div>

      <div id="cf-filters" className="sticky top-0 z-20 -mx-3 border-b border-neutral-300 bg-white/95 px-3 py-1 backdrop-blur print:hidden md:-mx-4 md:px-4">
        <button type="button" aria-expanded={fOpen} aria-controls="cf-filters-panel" onClick={() => setFOpen((v) => !v)} className="flex min-h-11 w-full items-center justify-between text-left text-sm md:hidden">
          <span><b>Фильтры:</b> {CAT_LABEL[cat]} · {period === "all" ? "2025–2026" : period} · {vatNote}</span><span aria-hidden>{fOpen ? "▴" : "▾"}</span>
        </button>
        <div id="cf-filters-panel" className={(fOpen ? "flex" : "hidden") + " flex-wrap items-center gap-2 pb-1 md:flex md:pb-0"}>
          <nav aria-label="Период" className={SEG_GROUP}>
            {([["all", "Все"], ...cashflowYears().map((y) => [String(y), String(y)])] as [CashflowPeriod, string][]).map(([k, t]) => <button key={k} type="button" aria-pressed={period === k} onClick={() => { setPeriod(k); clearHot(); }} className={seg(period === k)}>{t}</button>)}
          </nav>
          <div role="group" aria-label="НДС" className={SEG_GROUP}>
            <button type="button" aria-pressed={!exVat} onClick={() => setExVat(false)} className={seg(!exVat)}>С НДС</button>
            <button type="button" aria-pressed={exVat} onClick={() => setExVat(true)} className={seg(exVat)}>Без НДС</button>
          </div>
        </div>
      </div>
      {exVat && vat.unknown > 0.5 && <p className="text-xs text-neutral-700">Без НДС остаются авансы без привязки к закупке и счёту ({money(vat.unknown)}): ставка по документам не определена, суммы показаны как есть. НДС работы подрядчика берётся по счёту (20 % до 2026 года, 22 % с 2026).</p>}


      <section aria-label="Ключевые показатели" className="grid grid-cols-1 items-stretch gap-2 min-[480px]:grid-cols-2 md:grid-cols-4">
        <CarouselTile label="Потрачено" onOpen={() => toggleTile("spend")} pages={[
          { label: "Потрачено", value: money(h.spent), sub: filtered ? "все траты, не по категории" : `${label}, ${vatNote}`, spark: ser.spend, rows: spendKinds.map((r) => [r.short, `${money(r.total)} · ${h.spent ? Math.round((r.total / h.spent) * 100) : 0} %`] as [string, string]), hint: <p>Все проведённые оплаты периода по дате платежа ({vatNote}).</p> },
          { label: "Сырьё и работа", value: money(rawSpend + workSpend), sub: `куда ушли деньги, ${vatNote}`, rows: [["Сырьё", `${money(rawSpend)} · ${rawSpend + workSpend ? Math.round((rawSpend / (rawSpend + workSpend)) * 100) : 0} %`], ["Работа и услуги", `${money(workSpend)} · ${rawSpend + workSpend ? Math.round((workSpend / (rawSpend + workSpend)) * 100) : 0} %`]] as [string, string][], hint: <p>Сырьё — мех (аукционы и поставщик, включая шкуры подрядчика) и подкладка; работа и услуги — пошив подрядчику и услуги по УПД.</p> },
        ]} />
        <Tile label="Получено" value={hasSales ? money(recvSum(cat, exVat)) : "—"} sub={hasSales ? `выручка, ${vatNote}` : "нет данных о продажах"} spark={hasSales ? m.keep.map((i) => (exVat ? salesBy[cat].revEx[i] : salesBy[cat].revIncl[i])) : undefined}
          mini={mini((c) => `${money(recvSum(c, exVat))} · ${recvSum(cat, exVat) ? Math.round((recvSum(c, exVat) / recvSum(cat, exVat)) * 100) : 0} %`)} expandId={hasSales ? "recv" : undefined} onToggle={toggleTile}
          hint={<p>Розничная выручка из выгрузки продаж: чистые продажи после скидок, возвраты вычтены; по дате продажи; режим НДС — как в панели фильтров (внутри окна его можно переключить только для окна). Доля — от выручки всех категорий. {noSalesNote}</p>} />
        {hasSales && !filtered ? (
          <CarouselTile onOpen={() => toggleTile("flow")} pages={[
            { label: "Чистый денежный поток", value: money(h.net), tone: h.net < 0 ? "bad" : "good", spark: ser.net, sparkKind: "bars", sub: `${h.net < 0 ? "в минусе за период" : "в плюсе за период"}, ${vatNote}`, hint: <p>Получено минус потрачено за период, на одной базе НДС — как в панели фильтров ({vatNote}): «с НДС» — движение денег, «без НДС» — экономика.</p> },
            { label: "Накопленный итог", value: money(m.cumNetEnd), tone: m.cumNetEnd < 0 ? "bad" : "good", spark: ser.cumNet, sparkKind: "area", sub: `с начала данных на конец периода, ${vatNote}`, hint: <p>Получено минус потрачено нарастающим итогом с первого месяца данных до конца выбранного периода.</p> },
          ]} />
        ) : (
          <Tile label="Чистый поток / накопленный итог" value="—" sub={filtered ? "траты не делятся по категориям" : "нет данных о продажах"} hint={<p>Чистый денежный поток = получено − потрачено; накопленный итог — то же нарастающим итогом. При фильтре по категории траты не делятся, поэтому не считаются.</p>} />
        )}
        <CarouselTile label="Работа в месяц" initial={pageOf[cat]} onOpen={(k) => openFor("workMonth", k)} pages={catPages.map((c) => { const st = wm.st[c]; return {
          label: `Работа в месяц · ${c === "all" ? "Всего" : CAT_LABEL[c]}`,
          value: st.avgUnits === null || st.avgUnits === 0 ? "—" : `${st.avgUnits.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} шт./мес.`,
          sub: st.n ? `средневзвешенно за ${st.n} мес. проекта, получено ${pcs(st.unitsTotal)} шт.` : undefined,
          rows: [["Работа в месяц, ₽", rubOrDash(st.avgMonth)]] as [string, string][],
          hint: <p>Штук в месяц = единицы, полученные за период, ÷ число календарных месяцев проекта (общее число единиц, не среднее средних). Работа в месяц = вся работа подрядчику ÷ те же месяцы; по категориям — работа по ТЗ категории и приход категории ÷ N (работа без привязки к ТЗ — только в «Тотал»). Месяцы: от августа 2025 (первая оплата работы) до текущего включительно, в границах периода: {st.n} мес.; в расчёт входят и месяцы без работы и поставок, текущий месяц неполный.</p>,
        }; })} />
        <CarouselTile label="Работа на единицу" initial={pageOf[cat]} onOpen={(k) => openFor("workUnit", k)} pages={catPages.map((c) => { const st = wm.st[c]; return {
          label: `Работа на единицу · ${c === "all" ? "Всего" : CAT_LABEL[c]}`,
          value: rubOrDash(st.perUnit),
          sub: hasSales ? `оплачено ${rubOrDash(st.total)} ÷ получено ${st.unitsTotal || "—"} шт.` : "нет данных о приходе",
          rows: [["Единиц всего", st.unitsTotal ? String(st.unitsTotal) : "—"], ["Работа всего", rubOrDash(st.total)]] as [string, string][],
          hint: <p>Вся работа подрядчику за период ÷ все единицы, полученные за период (без привязки к месяцам). Это оценка: оплата и поступление могут приходиться на разные месяцы (аванс за будущее). По категориям — работа по ТЗ категории ÷ приход категории.</p>,
        }; })} />
        {hasSales ? (
          <CarouselTile label="Средняя цена продажи" initial={pageOf[cat]} onOpen={(k) => openFor("price", k)} pages={catPages.map((c) => { const g = groupSales(saleLines, months, exVat, () => "x", c)[0]; return {
            label: `Средняя цена продажи · ${c === "all" ? "Всего" : CAT_LABEL[c]}`,
            value: g && g.pcs > 0 ? formatMoney(g.rev / g.pcs) : "—",
            sub: g && g.pcs > 0 ? `${pcs(g.pcs)} шт. продано, ${vatNote}` : "нет продаж",
            rows: [["Выручка", g ? money(g.rev) : "—"], ["Выручка в среднем в месяц", g ? money(g.rev / Math.max(1, m.keep.filter((i) => (exVat ? salesBy[c].revEx[i] : salesBy[c].revIncl[i]) > 0.5).length)) : "—"]] as [string, string][],
            hint: <p>Выручка ({vatNote}) ÷ проданные единицы (возвраты минус) за выбранный период и категорию; режим НДС — как в панели (в окне его можно переключить только для окна).</p>,
          }; })} />
        ) : <Tile label="Средняя цена продажи" value="—" sub="нет данных о продажах" />}
      </section>

      {openTile && (
        <TileModal title={{ spend: "Потрачено", recv: "Получено", flow: "Денежный поток по месяцам", workMonth: "Работа в месяц", workUnit: "Работа на единицу", price: "Средняя цена продажи" }[openTile] ?? ""} subtitle={openTile === "recv" || openTile === "price" ? shownText.replace(/с НДС|без НДС/, modalExEff ? "без НДС" : "с НДС") : shownText} onClose={() => { setOpenTile(null); setModalEx(null); }}>
          {openTile === "spend" && <SpendDetail pays={pays} months={months} exVat={exVat} d={d} total={h.spent} />}
          {openTile === "recv" && <RecvDetail lines={saleLines} months={months} exVat={modalExEff} cat={catArg} total={recvSum(cat, modalExEff)} controls={<VatSeg choice={modalChoice} setChoice={(c) => setModalEx(c === "ex")} globalEx={exVat} />} />}
          {openTile === "flow" && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-neutral-800">
                {fp.firstPositive ? `Первый месяц с положительным потоком: ${monthLabel(fp.firstPositive)}. ` : "Месяцев с положительным потоком нет. "}
                Самый глубокий накопленный минус: {money(fp.deepest.cum)} ({monthLabel(fp.deepest.month)}). Максимальная просадка накопленного итога от пика: {money(fp.drawdown)}.
              </p>
              <ExpTable head={["Месяц", "Потрачено", "Получено", "Чистый", "Накопленный"]} rows={months.map((mo, i) => ({ id: mo, cells: [monthLabel(mo), money(ser.spend[i]), money(ser.revenue[i]), money(ser.net[i]), money(ser.cumNet[i])], sub: (["clothes", "acc", "other"] as const).map((c) => [CAT_LABEL[c], "—", money(clsMonth(c, m.keep[i]).rev), "—", "—"]).filter((r) => r[2] !== "—") }))} total={["Итого", money(h.spent), money(h.received), money(h.net), money(m.cumNetEnd)]} />
            </div>
          )}
          {openTile === "workMonth" && <WorkMonthWindow months={wm.months} by={wm.by} initialCat={winCat} />}
          {openTile === "workUnit" && <WorkUnitWindow months={wm.months} by={wm.by} initialCat={winCat} />}
          {openTile === "price" && <PriceDetail lines={saleLines} months={months} exVat={modalExEff} cat={winCat} controls={<VatSeg choice={modalChoice} setChoice={(c) => setModalEx(c === "ex")} globalEx={exVat} />} />}
        </TileModal>
      )}

      <ClassicTable period={period} title={`Cash Flow · ${period === "all" ? "2025–2026" : period} · ${vatNote}, ₽`} months={months} d={d} ser={ser} hasSales={hasSales} filtered={filtered} detail={detail} setDetail={setDetail} hot={hot} setHot={setHot} active={active} setActive={setActive} yearHot={yearHot} setYearHot={setYearHot} vatPay={vatPay} vatRev={vatRev} prepaid={months.map((mo) => prepaidBy[mo] ?? 0)} prepaidList={prepaidList} hasVat={hasSales} />

      <section aria-label="Деньги и траты" className="rounded-lg border border-neutral-300 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{chartView === "money" ? "Траты и полученные деньги по месяцам" : "Траты по видам оплаты"}</h2>
          <div role="group" aria-label="График" className={SEG_GROUP + " print:hidden"}>
            {([["money", "Траты и получено"], ["kinds", "Виды оплаты"]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={chartView === k} onClick={() => setChartView(k)} className={seg(chartView === k)}>{t}</button>)}
          </div>
        </div>
        {chartView === "money" ? (
          <>
        <ChartBox n={months.length}>{(colW) => <Chart kind="money" hotLine={hotMoney} months={months} d={d} s={s} ser={ser} stock={m.stock} active={active} setActive={setActive} hot={hot} setHot={setHot} yearHot={yearHot} filtered={filtered} colW={colW} />}</ChartBox>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
          <li><button type="button" aria-pressed={hotMoney === "spend"} onMouseEnter={() => setHotMoney("spend")} onMouseLeave={() => setHotMoney(null)} onFocus={() => setHotMoney("spend")} onBlur={() => setHotMoney(null)} onClick={() => setHotMoney(hotMoney === "spend" ? null : "spend")} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: SPEND }} />Потрачено за месяц (вниз)</button></li>
          <li><button type="button" aria-pressed={hotMoney === "get"} onMouseEnter={() => setHotMoney("get")} onMouseLeave={() => setHotMoney(null)} onFocus={() => setHotMoney("get")} onBlur={() => setHotMoney(null)} onClick={() => setHotMoney(hotMoney === "get" ? null : "get")} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: GET }} />Получено за месяц (вверх)</button></li>
        </ul>
          </>
        ) : (
          <>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="Что показать" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5 print:hidden">
            {([["all", "Всё"], ["raw", "Сырьё"], ["work", "Работа и услуги"]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={kindGroup === k} onClick={() => setKindGroup(k)} className={seg(kindGroup === k)}>{t}</button>)}
          </div>
        </div>
        <div className="min-h-[1.5rem] text-xs text-neutral-700" aria-live="polite">{kActive !== null && kg.months[kActive] ? <span><b>{full(kg.months[kActive])}</b>{KIND_ORDER.filter((k) => Math.abs(kg.kinds[k][kActive]) > 0.5).map((k) => `, ${PAY_TYPE_LABEL[k].toLowerCase()} ${dash(kg.kinds[k][kActive])}`).join("")}</span> : null}</div>
        <ChartBox n={kg.months.length} extra={102}>{(colW) => <WorkMonthsChart months={kg.months} kinds={kg.kinds} units={kg.months.map(() => 0)} active={kActive} setActive={setKActive} colW={colW} hotKind={hotKind2} showUnits={false} />}</ChartBox>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
          {KIND_ORDER.filter((k) => Math.abs(kg.kinds[k].reduce((a2, b2) => a2 + b2, 0)) > 0.5).map((k) => <KindLi key={k} k={k} hotKind={hotKind2} setHotKind={setHotKind2} />)}
        </ul>
          </>
        )}
      </section>

      <section aria-label="Накопительно" className="rounded-lg border border-neutral-300 bg-white p-3">
        <h2 className="mb-1 flex items-center gap-1 text-sm font-semibold">Накопительно: потрачено и получено
          <InfoHint label="Как читать накопительный график" wide><p>Две линии растут с первого месяца данных: оранжевая — сколько потрачено, зелёная — сколько получено. Пунктир — разрыв между ними: ниже нуля «в минусе», выше — «в плюсе».</p></InfoHint>
        </h2>
        <ChartBox n={months.length} extra={142}>{(colW) => <Chart kind="cum" hotLine={hotLine} months={months} d={d} s={s} ser={ser} stock={m.stock} active={active} setActive={setActive} hot={hot} setHot={setHot} yearHot={yearHot} filtered={filtered} colW={colW} />}</ChartBox>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
          {([["spend", SPEND, "Потрачено нарастающим итогом", false], ["get", GET, "Получено нарастающим итогом", true], ["net", NAVY, "Чистый итог (получено − потрачено)", true]] as const).filter((x) => x[0] === "spend" || (hasSales && (x[0] === "get" || !filtered))).map(([k, c, t]) => (
            <li key={k}><button type="button" aria-pressed={hotLine === k} onMouseEnter={() => setHotLine(k)} onMouseLeave={() => setHotLine(null)} onFocus={() => setHotLine(k)} onBlur={() => setHotLine(null)} onClick={() => setHotLine(hotLine === k ? null : k)} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2"><span aria-hidden className={"inline-block h-0.5 w-4 " + (k === "net" ? "border-t-2 border-dashed" : "")} style={k === "net" ? { borderColor: c } : { background: c }} />{t}</button></li>
          ))}
        </ul>
      </section>

      <section aria-label="Товар" className="flex flex-col gap-4 rounded-lg border border-neutral-300 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Работа подрядчика по месяцам, ₽</h2>
        </div>
        {hasSales ? (
          <>
            <div>
              <div className="min-h-[1.5rem] text-xs text-neutral-700" aria-live="polite">{gActive !== null ? <span><b>{full(gMonths[gActive])}</b>: работа {dash(gWu.work[gActive])}{KIND_ORDER.filter((k) => Math.abs(gKinds[k][gActive]) > 0.5).map((k) => `, ${PAY_TYPE_LABEL[k].toLowerCase()} ${dash(gKinds[k][gActive])}`).join("")}, получено {pcs(gWu.units[gActive])} шт.</span> : null}</div>
              <ChartBox n={gMonths.length} extra={102}>{(colW) => <WorkMonthsChart months={gMonths} kinds={gKinds} units={gWu.units} active={gActive} setActive={setGActive} colW={colW} hotKind={hotKind} />}</ChartBox>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
                {KIND_ORDER.filter((k) => Math.abs(gKinds[k].reduce((a2, b2) => a2 + b2, 0)) > 0.5).map((k) => <KindLi key={k} k={k} hotKind={hotKind} setHotKind={setHotKind} />)}
                <li><button type="button" aria-pressed={hotKind === "units"} onMouseEnter={() => setHotKind("units")} onMouseLeave={() => setHotKind(null)} onFocus={() => setHotKind("units")} onBlur={() => setHotKind(null)} onClick={() => setHotKind(hotKind === "units" ? null : "units")} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ background: NAVY }} />Получено единиц, шт.</button></li>
              </ul>
            </div>

          </>
        ) : <p className="text-sm text-neutral-700">{noSalesNote}</p>}
      </section>


    </div>
  );
}

/** Классический Cash Flow: статьи в строках, месяцы в столбцах, после декабря — итог года, в конце «Всего». Платежи со знаком минус. */
function ClassicTable({ period, vatPay, vatRev, prepaid, prepaidList, hasVat, title, months, d, ser, hasSales, filtered, detail, setDetail, hot, setHot, active, setActive, yearHot, setYearHot }: { period: CashflowPeriod; vatPay: number[]; vatRev: number[]; prepaid: number[]; prepaidList: PrepaidItem[]; hasVat: boolean; title: string; hot: string | null; setHot: (k: string | null) => void; active: number | null; setActive: (i: number | null) => void; yearHot: string | null; setYearHot: (y: string | null) => void; months: string[]; d: CashflowData; ser: { spend: number[]; revenue: number[]; net: number[]; cumNet: number[] }; hasSales: boolean; filtered: boolean; detail: boolean; setDetail: (v: boolean) => void }) {
  const art = (k: string) => d.articles.find((a) => a.key === k)?.byMonth ?? months.map(() => 0);
  const add = (...xs: number[][]) => months.map((_, i) => xs.reduce((s, x) => s + (x[i] ?? 0), 0));
  const neg = (x: number[]) => x.map((v) => -v);
  const auction = neg(art("furAuction")), purchase = neg(add(art("furPurchase"), art("hides"))), lining = neg(art("lining"));
  const work = neg(art("work")), services = neg(art("services"));
  const raw = add(auction, purchase, lining), workAll = add(work, services);
  const pay = neg(ser.spend);
  const first = months.findIndex((_, i) => Math.abs(ser.spend[i]) > 0.5 || Math.abs(ser.revenue[i]) > 0.5);
  const last = months.length - 1 - [...months].reverse().findIndex((_, i) => Math.abs(ser.spend[months.length - 1 - i]) > 0.5 || Math.abs(ser.revenue[months.length - 1 - i]) > 0.5);
  const shown = first < 0 ? [] : months.map((_, i) => i).filter((i) => i >= first && i <= last);
  const years = Array.from(new Set(shown.map((i) => months[i].slice(0, 4))));
  type Col = { key: string; label: string; idx: number[]; total: boolean };
  const cols: Col[] = [];
  for (const y of years) {
    const ys = shown.filter((i) => months[i].startsWith(y));
    for (const i of ys) cols.push({ key: months[i], label: months[i].slice(5, 7) + "." + months[i].slice(2, 4), idx: [i], total: false });
    cols.push({ key: "y" + y, label: "Итого " + y, idx: ys, total: true });
  }
  cols.push({ key: "all", label: "Всего", idx: shown, total: true });
  const [gran, setGran] = useState<"months" | "years">("months");
  const colsShown = gran === "years" ? cols.filter((c) => c.total) : cols;
  const sum = (x: number[], c: Col) => c.idx.reduce((s, i) => s + (x[i] ?? 0), 0);
  type R = { label: string; x: number[] | null; lvl: 0 | 1 | 2; cum?: boolean; art?: string };
  const rows: R[] = [
    ...(hasSales ? [{ label: "ПОСТУПЛЕНИЯ", x: ser.revenue, lvl: 0 as const }, { label: "Выручка от продаж", x: ser.revenue, lvl: 1 as const }] : []),
    { label: "ПЛАТЕЖИ", x: pay, lvl: 0 },
    { label: "Сырьё и материалы", x: raw, lvl: 1 },
    { art: "furAuction", label: "Мех: аукционы", x: auction, lvl: 2 },
    { art: "furPurchase", label: "Мех: закупка у поставщика", x: purchase, lvl: 2 },
    { art: "lining", label: "Подкладка", x: lining, lvl: 2 },
    { label: "Работа и услуги", x: workAll, lvl: 1 },
    { art: "work", label: "Работа подрядчику", x: work, lvl: 2 },
    { art: "services", label: "Услуги по УПД", x: services, lvl: 2 },
    ...(hasSales && !filtered ? [{ label: "ЧИСТЫЙ ДЕНЕЖНЫЙ ПОТОК", x: ser.net, lvl: 0 as const }, { label: "Накопленный чистый поток", x: ser.cumNet, lvl: 1 as const, cum: true }] : []),
  ];
  const aimCol = (c: Col) => { if (c.total) { setActive(null); setYearHot(c.key.startsWith("y") ? c.key.slice(1) : null); } else { setYearHot(null); setActive(c.idx[0]); } };
  const stick = "sticky left-0 z-[1] text-left";
  const [refOpen, setRefOpen] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);
  const [repBusy, setRepBusy] = useState(false);
  const downloadReport = async () => {
    setRepBusy(true);
    try { const res = await exportCashflowReportXlsx(period); if (res.ok) saveBase64Xlsx(res.name, res.base64); } finally { setRepBusy(false); }
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="basis-full text-xs text-neutral-600">Оплаты поставщикам и подрядчику и выручка; без зарплат, аренды, налогов и остатков на счетах.</p>
        <button type="button" aria-expanded={detail} onClick={() => setDetail(!detail)} className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm md:min-h-9">{detail ? "Скрыть таблицу" : "Показать таблицу"}</button>
        {detail ? (
          <div role="group" aria-label="Столбцы" className={SEG_GROUP}>
            {([["months", "По месяцам"], ["years", "По годам"]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={gran === k} onClick={() => setGran(k)} className={segCls(gran === k)}>{t}</button>)}
          </div>
        ) : null}
        <button type="button" onClick={downloadReport} disabled={repBusy} title="Excel на три листа: «Данные» (откуда собрано), «Сводная» и «Отчёт» (месяцы в столбцах, НДС отдельно снизу)" className="ml-auto inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium disabled:opacity-60 md:min-h-9">{repBusy ? "Готовлю Excel…" : "Скачать Excel"}</button>
      </div>
      {detail && (
        <div className="max-h-[75vh] overflow-auto rounded-lg border border-neutral-300 bg-white" tabIndex={0} role="region" aria-label="Cash Flow: статьи в строках, месяцы и итоги года в столбцах">
          <table className="table-keep border-collapse text-sm" onMouseLeave={() => { setHot(null); setActive(null); setYearHot(null); }}>
            <thead>
              <tr className="border-b border-neutral-300">
                <th scope="col" className={"min-w-[14rem] bg-white px-2 py-2 text-xs font-semibold " + stick + " top-0 z-[2]"}>Статья, ₽</th>
                {colsShown.map((c) => <th key={c.key} scope="col" onMouseEnter={() => aimCol(c)} className={"px-2 py-2 text-right text-xs font-semibold whitespace-nowrap " + (c.total ? "border-l border-neutral-300 bg-neutral-100" : "") + (!c.total && active === c.idx[0] ? " bg-[var(--ui-soft)]" : "")}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} onMouseEnter={() => setHot(r.art ?? null)} className={(r.art && hot === r.art ? "bg-[var(--ui-soft)] " : "") + (r.lvl === 0 ? "border-y border-neutral-300 bg-neutral-100 font-bold" : r.lvl === 1 ? "border-b border-neutral-200 font-semibold" : "border-b border-neutral-100")}>
                  <th scope="row" className={"px-2 py-1.5 " + stick + " " + (r.lvl === 0 ? "bg-neutral-100" : r.art && hot === r.art ? "bg-[var(--ui-soft)]" : "bg-white") + (r.lvl === 2 ? " pl-6 font-normal" : r.lvl === 1 ? " pl-4" : "")}>{r.label}</th>
                  {colsShown.map((c) => {
                    const v = r.cum ? (c.idx.length ? (r.x as number[])[c.idx[c.idx.length - 1]] : 0) : sum(r.x as number[], c);
                    return <td key={c.key} onMouseEnter={() => aimCol(c)} className={"min-w-[6.5rem] px-2 py-1.5 text-right tabular-nums whitespace-nowrap " + (c.total ? "border-l border-neutral-300 font-semibold" : "")}>{dash(v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail && (
        <div className="rounded-lg border border-neutral-300 bg-white">
          <button type="button" aria-expanded={refOpen} onClick={() => setRefOpen((v) => !v)} className="flex min-h-11 w-full items-center gap-1.5 px-3 text-left text-sm font-semibold"><span aria-hidden>{refOpen ? "▾" : "▸"}</span>Справочно: НДС и предоплата</button>
          {refOpen && <div className="overflow-auto border-t border-neutral-200" tabIndex={0} role="region" aria-label="Справочно по месяцам">
            <table className="table-keep border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-300">
                  <th scope="col" className={"min-w-[14rem] bg-white px-2 py-2 text-xs font-semibold " + stick}>Статья, ₽</th>
                  {colsShown.map((c) => <th key={c.key} scope="col" className={"px-2 py-2 text-right text-xs font-semibold whitespace-nowrap " + (c.total ? "border-l border-neutral-300 bg-neutral-100" : "")}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {([["НДС в составе платежей", vatPay], ...(hasVat ? [["НДС в составе выручки", vatRev], ["Разница НДС", vatRev.map((v, i) => v - (vatPay[i] ?? 0))]] : []), ["Предоплата за непринятые заказы", prepaid]] as [string, number[]][]).map(([lab, arr]) => {
                  const isPre = lab.startsWith("Предоплата");
                  const amtIn = (items: PrepaidItem[], c: Col) => items.filter((it) => c.idx.some((i) => months[i] === it.iso.slice(0, 7))).reduce((t, it) => t + it.amount, 0);
                  const groups = isPre && prepOpen ? [...new Set(prepaidList.map((it) => it.label))].map((name) => ({ name, items: prepaidList.filter((it) => it.label === name) })) : [];
                  const cellCls = (c: Col, bold?: boolean) => "min-w-[6.5rem] px-2 py-1.5 text-right tabular-nums whitespace-nowrap " + (c.total ? "border-l border-neutral-300 font-semibold" : bold ? "font-semibold" : "");
                  return (
                    <Fragment key={lab}>
                      <tr className="border-b border-neutral-100">
                        <th scope="row" title={isPre ? "Деньги ушли, товара пока нет: запасы, а не расход" : undefined} className={"bg-white px-2 py-1.5 font-normal " + stick}>
                          {isPre && prepaidList.length > 0 ? <button type="button" aria-expanded={prepOpen} onClick={() => setPrepOpen((v) => !v)} className="inline-flex min-h-11 items-center gap-1.5 text-left font-normal underline decoration-dotted underline-offset-2"><span aria-hidden>{prepOpen ? "▾" : "▸"}</span>{lab}</button> : lab}
                        </th>
                        {colsShown.map((c) => <td key={c.key} className={cellCls(c)}>{dash(sum(arr, c))}</td>)}
                      </tr>
                      {groups.map((g) => (
                        <Fragment key={g.name}>
                          <tr className="border-b border-neutral-100 bg-neutral-50">
                            <th scope="row" className={"bg-neutral-50 px-2 py-1.5 pl-6 text-left font-semibold " + stick}>{g.name}</th>
                            {colsShown.map((c) => <td key={c.key} className={cellCls(c, true)}>{dash(amtIn(g.items, c))}</td>)}
                          </tr>
                          {g.items.map((it) => (
                            <tr key={it.id} className="border-b border-neutral-100">
                              <th scope="row" className={"bg-white px-2 py-1.5 pl-10 text-left text-xs font-normal text-neutral-700 " + stick}>
                                <Link href={it.href} className="underline decoration-neutral-400 underline-offset-2">{it.iso.split("-").reverse().join(".")} · {it.what}{it.doc ? ` · ${it.doc}` : ""}</Link>
                              </th>
                              {colsShown.map((c) => <td key={c.key} className={cellCls(c) + " text-xs"}>{dash(amtIn([it], c))}</td>)}
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>}
        </div>
      )}
    </>
  );
}

/**
 * Блок Cashflow для Главной: накопительный график «потрачено и получено» и под ним свёрнутая таблица Cash Flow.
 * Год — из шапки Главной (period), НДС — из переключателя шапки; цифры те же, что в разделе Cashflow.
 */
export function CashflowOverview({ incl, ex, salesAll, period, prepaidBy, prepaidList }: { incl: CashflowData; ex: CashflowData; salesAll: SalesMonthly; period: CashflowPeriod; prepaidBy: Record<string, number>; prepaidList: PrepaidItem[] }) {
  const { mode } = useVatDisplay();
  const exVat = mode === "excl";
  const vatNote = exVat ? "без НДС" : "с НДС";
  const [detail, setDetail] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [yearHot, setYearHot] = useState<string | null>(null);
  const [hotLine, setHotLine] = useState<string | null>(null);
  const [hotMoney, setHotMoney] = useState<string | null>(null);
  const seg = (on: boolean) => segCls(on);
  const [slide, setSlide] = useState(0);
  const slider = useRef<HTMLDivElement>(null);
  const onSlide = () => { const el = slider.current; if (el && el.clientWidth > 0) setSlide(Math.round(el.scrollLeft / el.clientWidth)); };
  const goSlide = (k: number) => {
    const el = slider.current; if (!el) return;
    const calm = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: k * el.clientWidth, behavior: calm ? "auto" : "smooth" }); setSlide(k);
  };
  const hasSales = salesAll.available;
  const c = useMemo(() => {
    const all = exVat ? ex : incl;
    const revAll = exVat ? salesAll.revEx : salesAll.revIncl;
    const keep = visibleMonths(all, salesAll, period);
    const d = sliceData(all, keep, period);
    const s = sliceSales(salesAll, keep);
    const serAll = seriesOf(all, salesAll, revAll);
    const pick = <T,>(a: T[]) => keep.map((i) => a[i]);
    const ser: Ser = { spend: pick(serAll.spend), revenue: keep.map((i) => revAll[i]), net: pick(serAll.net), cumSpend: pick(serAll.cumSpend), cumRevenue: pick(serAll.cumRevenue), cumNet: pick(serAll.cumNet), work: pick(serAll.work), cumWorkPerUnit: keep.map(() => null) };
    const vatPay = keep.map((i) => incl.monthTotals[i] - ex.monthTotals[i]);
    const vatRev = keep.map((i) => salesAll.revIncl[i] - salesAll.revEx[i]);
    return { d, s, ser, vatPay, vatRev };
  }, [exVat, period, incl, ex, salesAll]);
  const months = c.d.months;
  if (months.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <section aria-label="Траты и полученные деньги" className="rounded-lg border border-neutral-300 bg-white p-3">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1 text-sm font-semibold">{slide === 0 ? "Траты и полученные деньги по месяцам" : "Накопительно: потрачено и получено"}
            <InfoHint label="Как читать накопительный график" wide><p>Линии растут с первого месяца данных: оранжевая — потрачено, зелёная — получено, пунктир — разрыв между ними.</p></InfoHint>
          </h2>
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Вид графика" className={SEG_GROUP + " print:hidden"}>
              {(["По месяцам", "Накопительно"] as const).map((t, k) => <button key={t} type="button" aria-pressed={slide === k} onClick={() => goSlide(k)} className={seg(slide === k)}>{t}</button>)}
            </div>
            <Link href="/cashflow" className="text-xs text-blue-700 hover:underline print:hidden">→ Cashflow</Link>
          </div>
        </div>
        <div ref={slider} onScroll={onSlide} tabIndex={0} role="group" aria-roledescription="карусель" aria-label="Графики: по месяцам и накопительно (листайте вправо-влево)" className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-900 [&::-webkit-scrollbar]:hidden">
          <div className="w-full flex-none snap-start" aria-hidden={slide !== 0}>
            <ChartBox n={months.length} extra={142}>{(colW) => <Chart kind="money" hotLine={hotMoney} months={months} d={c.d} s={c.s} ser={c.ser} stock={c.ser.spend.map(() => 0)} active={active} setActive={setActive} hot={hot} setHot={setHot} yearHot={yearHot} filtered={false} colW={colW} />}</ChartBox>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
          <li><button type="button" aria-pressed={hotMoney === "spend"} onMouseEnter={() => setHotMoney("spend")} onMouseLeave={() => setHotMoney(null)} onFocus={() => setHotMoney("spend")} onBlur={() => setHotMoney(null)} onClick={() => setHotMoney(hotMoney === "spend" ? null : "spend")} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SPEND }} />Потрачено за месяц</button></li>
              {hasSales ? (<li><button type="button" aria-pressed={hotMoney === "get"} onMouseEnter={() => setHotMoney("get")} onMouseLeave={() => setHotMoney(null)} onFocus={() => setHotMoney("get")} onBlur={() => setHotMoney(null)} onClick={() => setHotMoney(hotMoney === "get" ? null : "get")} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: GET }} />Получено за месяц</button></li>) : null}
            </ul>
          </div>
          <div className="w-full flex-none snap-start" aria-hidden={slide !== 1}>
            <ChartBox n={months.length} extra={142}>{(colW) => <Chart kind="cum" hotLine={hotLine} months={months} d={c.d} s={c.s} ser={c.ser} stock={c.ser.spend.map(() => 0)} active={active} setActive={setActive} hot={hot} setHot={setHot} yearHot={yearHot} filtered={false} colW={colW} />}</ChartBox>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
          {([["spend", SPEND, "Потрачено нарастающим итогом"], ["get", GET, "Получено нарастающим итогом"], ["net", NAVY, "Чистый итог (получено − потрачено)"]] as const).filter((x) => x[0] === "spend" || hasSales).map(([k, col, t]) => (
            <li key={k}><button type="button" aria-pressed={hotLine === k} onMouseEnter={() => setHotLine(k)} onMouseLeave={() => setHotLine(null)} onFocus={() => setHotLine(k)} onBlur={() => setHotLine(null)} onClick={() => setHotLine(hotLine === k ? null : k)} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2"><span aria-hidden className={"inline-block h-0.5 w-4 " + (k === "net" ? "border-t-2 border-dashed" : "")} style={k === "net" ? { borderColor: col } : { background: col }} />{t}</button></li>
          ))}
        </ul>
          </div>
        </div>
      </section>
      <ClassicTable period={period} title={`Cash Flow · ${period === "all" ? "2025–2026" : period} · ${vatNote}, ₽`} months={months} d={c.d} ser={c.ser} hasSales={hasSales} filtered={false} detail={detail} setDetail={setDetail} hot={hot} setHot={setHot} active={active} setActive={setActive} yearHot={yearHot} setYearHot={setYearHot} vatPay={c.vatPay} vatRev={c.vatRev} prepaid={months.map((mo) => prepaidBy[mo] ?? 0)} prepaidList={prepaidList} hasVat={hasSales} />
    </div>
  );
}
