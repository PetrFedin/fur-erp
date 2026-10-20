"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/utils";
import { toCsv } from "@/lib/csv";
import { InfoHint } from "@/components/info-hint";
import { CAT_LABEL, type CatClass } from "@/lib/sales-receipts-core";
import { DUE_LABEL, dueHint, payDue } from "@/lib/pay-display";
import { ExpTable, PriceDetail, RecvDetail, SpendDetail } from "./drill";
import { PROJECT_START_MONTH, workMonthIdx, cashflowYears } from "@/lib/cashflow";
import { PAY_TYPE_LABEL, spendByType, workKindsByMonth, type PayType, flowPoints, workWindowStats, groupSales, type PayLite } from "@/lib/cashflow-detail";
import type { SalesAggLine } from "@/lib/sales-receipts-core";
import { cumWorkPerUnit, goodsHeadline, headline, seriesOf, type WorkByClass, sliceData, sliceSales, stockSeries, visibleMonths, type CashflowData, type CashflowPeriod, type SalesMonthly } from "@/lib/cashflow";

type ServicePart = { number: string; what: string; invoice: string | null; date: string; paid: number };
type Cat = "all" | "clothes" | "acc";
type Props = { incl: CashflowData; ex: CashflowData; salesBy: Record<CatClass | "all", SalesMonthly>; workBy: WorkByClass; pays: PayLite[]; saleLines: SalesAggLine[]; left: { raw: number; prod: number; advance: number }; nowMonth: string; initialGroup?: "period" | "category"; vat: { vat: number; unknown: number; total: number }; services: ServicePart[]; initialPeriod: CashflowPeriod; /** Для проверок вёрстки. */ initialCat?: Cat; /** Для проверок вёрстки: таблица открыта сразу. */ initialDetail?: boolean };

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
};

function Chart({ kind, months, d, s, ser, stock, active, setActive, hot, setHot, yearHot, filtered, colW }: ChartProps) {
  const n = months.length;
  const left = 58, right = kind === "cum" ? 84 : kind === "goods" ? 44 : 12, top = 12, bottom = 40, H = 250;
  const bw = Math.max(10, Math.min(40, Math.round(colW * 0.7)));
  const W = left + right + n * colW;
  const x = (i: number) => left + i * colW + colW / 2;
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
        let acc = 0;
        const sel = active === i || (yearHot !== null && m.startsWith(yearHot));
        return (
          <g key={m}>
            {d.articles.map((a) => {
              const v = a.byMonth[i];
              if (v <= 0.5) return null;
              const y0 = y(-acc), y1 = y(-(acc + v));
              acc += v;
              const dim = hot ? hot !== a.key : (active !== null || yearHot !== null) && !sel;
              return <rect key={a.key} x={x(i) - bw / 2} width={bw} y={y0} height={Math.max(0, y1 - y0)} fill={COLORS[a.key]} opacity={dim ? 0.25 : 1} stroke={hot === a.key ? "#111" : "none"}
                onMouseEnter={() => setHot(a.key)} onMouseLeave={() => setHot(null)}><title>{`${a.label}, ${full(m)}: ${formatMoney(v)}`}</title></rect>;
            })}
            {ser.revenue[i] > 0.5 && <rect x={x(i) - bw / 2} width={bw} y={y(ser.revenue[i])} height={Math.max(0, y(0) - y(ser.revenue[i]))} fill={GET} opacity={hot || ((active !== null || yearHot !== null) && !sel) ? 0.25 : 1} />}
          </g>
        );
      })}
      {kind === "money" && s.available && !filtered && <path d={lineOf(ser.net)} fill="none" stroke="#111" strokeWidth={2} />}
      {kind === "cum" && (
        <>
          <path d={lineOf(ser.cumSpend)} fill="none" stroke={SPEND} strokeWidth={2.5} />
          {s.available && <path d={lineOf(ser.cumRevenue)} fill="none" stroke={GET} strokeWidth={2.5} />}
          {s.available && !filtered && <path d={lineOf(ser.cumNet)} fill="none" stroke={NAVY} strokeWidth={2.5} strokeDasharray="6 4" />}
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
          kind === "money" ? [["Траты", dash(ser.spend[active]), SPEND], ["Получено", dash(ser.revenue[active]), GET], ["Чистый поток", dash(ser.net[active]), "#111"]]
          : kind === "cum" ? [["Потрачено", dash(ser.cumSpend[active]), SPEND], ["Получено", dash(ser.cumRevenue[active]), GET], ["Чистый итог", dash(ser.cumNet[active]), NAVY]]
          : kind === "goods" ? [["Приход", `${pcs(s.recPcs[active])} шт.`, NAVY], ["Продано", `${pcs(s.salePcs[active])} шт.`, GET], ["Остаток", `${stock[active]} шт.`, STOCK]]
          : [["Работа на единицу", dash(ser.cumWorkPerUnit[active]), SPEND]];
        const bw = 214, bh = 24 + lines.length * 17;
        const bx = x(active) + 12 + bw > W - 2 ? x(active) - 12 - bw : x(active) + 12;
        return (
          <g pointerEvents="none" role="presentation">
            <rect x={bx} y={top + 2} width={bw} height={bh} rx={6} fill="#111" opacity={0.94} />
            <text x={bx + 10} y={top + 19} fontSize={12} fontWeight={700} fill="#fff">{full(m)}</text>
            {lines.map(([k, v, c], j) => (
              <g key={k}>
                <rect x={bx + 10} y={top + 30 + j * 17} width={8} height={8} rx={2} fill={c === "#111" ? "#fff" : c} />
                <text x={bx + 24} y={top + 38 + j * 17} fontSize={12} fill="#fff">{k}</text>
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
function WorkMonthsChart({ months, kinds, units, active, setActive, colW }: { months: string[]; kinds: Record<PayType, number[]>; units: number[]; active: number | null; setActive: (i: number | null) => void; colW: number }) {
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
          <text x={W - right + 6} y={yu(t * maxU) + 4} fontSize={11} fill={NAVY}>{Math.round(t * maxU)}</text>
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
              return <rect key={k} x={x(i) - bw / 2} width={bw} y={y1} height={Math.max(0, y0 - y1)} fill={k === "PARTIAL" ? "url(#hatch-partial)" : k === "FINAL" ? "url(#dots-final)" : KIND_COLOR[k]} opacity={active !== null && active !== i ? 0.35 : 1}><title>{`${PAY_TYPE_LABEL[k]}: ${formatMoney(v)}`}</title></rect>;
            })}
          </g>
        );
      })}
      <path d={line} fill="none" stroke={NAVY} strokeWidth={2} />
      {units.map((v, i) => <circle key={i} cx={x(i)} cy={yu(v)} r={active === i ? 5 : 3} fill={NAVY} />)}
      {active !== null && <line x1={x(active)} x2={x(active)} y1={top} y2={H - bottom} stroke="#111" opacity={0.35} />}
      {months.map((m, i) => (
        <rect key={m} x={left + i * colW} y={top} width={colW} height={H - top - bottom} fill="transparent" tabIndex={0} aria-label={tip(i)}
          onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onClick={() => setActive(i)} />
      ))}
    </svg>
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
  const seg = (on: boolean) => "inline-flex min-h-11 items-center rounded-md px-3 text-sm " + (on ? "bg-neutral-900 text-white" : "text-neutral-700 hover:text-neutral-900");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Категория" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
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
          <div className="text-xs text-neutral-600">Работа на единицу (всего ÷ единиц)</div>
          <div className="text-lg font-semibold tabular-nums">{rubOrDash(st.perUnit)}</div>
          <div className="text-xs text-neutral-600">{rubOrDash(st.total)} ÷ {st.unitsTotal || "—"} шт.</div>
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
  const seg = (on: boolean) => "inline-flex min-h-11 items-center rounded-md px-2 text-xs " + (on ? "bg-neutral-900 text-white" : "text-neutral-700 hover:text-neutral-900");
  return (
    <div role="group" aria-label="НДС плитки" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
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


export function CashflowView({ incl, ex, salesBy, workBy, pays, saleLines, left, nowMonth, initialGroup, vat, services, initialPeriod, initialDetail, initialCat }: Props) {
  const [period, setPeriod] = useState<CashflowPeriod>(initialPeriod);
  const [exVat, setExVat] = useState(false);
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
    const idx = workMonthIdx(incl.months, nowMonth, period);
    const pick = (a: number[]) => idx.map((i) => a[i]);
    const workAllSeries = incl.articles.find((a) => a.key === "work")?.byMonth ?? incl.months.map(() => 0);
    const by = { all: { work: pick(workAllSeries), units: pick(salesBy.all.recPcs) }, clothes: { work: pick(workBy.clothes), units: pick(salesBy.clothes.recPcs) }, acc: { work: pick(workBy.acc), units: pick(salesBy.acc.recPcs) } };
    return { months: idx.map((i) => incl.months[i]), by, st: { all: workWindowStats(by.all.work, by.all.units, [], "all"), clothes: workWindowStats(by.clothes.work, by.clothes.units, [], "all"), acc: workWindowStats(by.acc.work, by.acc.units, [], "all") } };
  }, [incl, nowMonth, period, salesBy, workBy]);
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
  const gKinds = useMemo(() => workKindsByMonth(pays, gMonths, cat), [pays, gMonths, cat]);
  const gWu = { work: m.wu.work.slice(gOff), units: m.wu.units.slice(gOff), avg: m.wu.avg };
  const shownText = `${CAT_LABEL[cat]} · ${period === "all" ? "2025–2026" : period} · ${vatNote}`;
  const monthLabel = (mo: string) => `${["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"][Number(mo.slice(5, 7)) - 1]} ${mo.slice(0, 4)}`;
  const catArg = cat === "all" ? "all" : cat;
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

  const seg = (on: boolean) => "inline-flex min-h-11 items-center rounded-md px-3 text-sm " + (on ? "bg-neutral-900 text-white" : "text-neutral-700 hover:text-neutral-900");
  const th = "px-2 py-2 text-right text-xs font-semibold whitespace-nowrap";
  const td = "min-w-[6.5rem] px-2 py-1.5 text-right text-sm tabular-nums whitespace-nowrap";
  const sticky = "sticky left-0 z-[1] text-left";
  const noSalesNote = "Нет данных о продажах: выгрузка поступлений и продаж ещё не загружена.";
  /** Нулевые суммы — прочерк; исключение — результат расчёта «К доплате» (formatMoney напрямую). */
  const money = (v: number) => (Math.abs(v) < 0.5 ? "—" : formatMoney(v));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Cashflow</h1>
        <InfoHint label="Что такое Cashflow" align="right" wide>
          <p><b>Потрачено</b> — все проведённые оплаты («Оплачено» в разделе «Оплаты») по статьям и по дате платежа. Запланированные и неподтверждённые платежи не входят. Итог за 2025–2026 равен «Оплачено всего» (с НДС).</p>
          <p className="mt-1">На странице «Оплаты» годы для закупок вне аукциона считаются по году закупки, а здесь — по дате платежа, поэтому по годам суммы могут отличаться, итог и месяцы те же.</p>
          <p className="mt-1"><b>Получено</b> — розничная выручка из выгрузки продаж по дате продажи (чистая, после скидок, возвраты вычтены), а не движение по расчётному счёту.</p>
          <p className="mt-1">«Без НДС»: у платежей за сырьё НДС берётся из закупок (ставка позиций, 20% или 22%); у оплаты работы подрядчику и авансов без привязки к закупке НДС в данных нет — эти суммы остаются как есть
            {exVat && vat.unknown > 0.5 ? ` (${money(vat.unknown)} из ${money(vat.total)})` : ""}. У продаж НДС взят из выгрузки (столбцы «с НДС» и «без НДС»).</p>
        </InfoHint>
      </div>

      <div id="cf-filters" className="sticky top-0 z-20 -mx-3 border-b border-neutral-300 bg-white/95 px-3 py-1 backdrop-blur print:hidden md:-mx-4 md:px-4">
        <button type="button" aria-expanded={fOpen} aria-controls="cf-filters-panel" onClick={() => setFOpen((v) => !v)} className="flex min-h-11 w-full items-center justify-between text-left text-sm md:hidden">
          <span><b>Фильтры:</b> {CAT_LABEL[cat]} · {period === "all" ? "2025–2026" : period} · {vatNote}</span><span aria-hidden>{fOpen ? "▴" : "▾"}</span>
        </button>
        <div id="cf-filters-panel" className={(fOpen ? "flex" : "hidden") + " flex-wrap items-center gap-2 pb-1 md:flex md:pb-0"}>
          <nav aria-label="Период" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
            {([["all", "Все"], ...cashflowYears().map((y) => [String(y), String(y)])] as [CashflowPeriod, string][]).map(([k, t]) => <button key={k} type="button" aria-pressed={period === k} onClick={() => { setPeriod(k); clearHot(); }} className={seg(period === k)}>{t}</button>)}
          </nav>
          <div role="group" aria-label="НДС" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
            <button type="button" aria-pressed={!exVat} onClick={() => setExVat(false)} className={seg(!exVat)}>С НДС</button>
            <button type="button" aria-pressed={exVat} onClick={() => setExVat(true)} className={seg(exVat)}>Без НДС</button>
          </div>
          <div role="group" aria-label="Категория" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
            {(["all", "clothes", "acc"] as const).map((k) => <button key={k} type="button" aria-pressed={cat === k} onClick={() => { setCat(k); clearHot(); }} className={seg(cat === k)}>{CAT_LABEL[k]}</button>)}
          </div>
          <button type="button" onClick={csv} className="ml-auto inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-xs">Скачать CSV</button>
        </div>
      </div>
      {exVat && vat.unknown > 0.5 && <p className="text-xs text-neutral-700">Без НДС остаются авансы без привязки к закупке и счёту ({money(vat.unknown)}): ставка по документам не определена, суммы показаны как есть. НДС работы подрядчика берётся по счёту (20 % до 2026 года, 22 % с 2026).</p>}

      {filtered && (
        <div role="note" className="rounded-lg border border-neutral-300 bg-white p-3 text-xs text-neutral-800">
          <p><b>Категория: {CAT_LABEL[cat]}.</b> Траты не делятся по категориям, показаны все{hasSales ? "; чистый поток и накопленный итог при фильтре не считаются" : ""}. Единицы, выручка, остаток, маржа и маркапы — только по {CAT_LABEL[cat].toLowerCase()}; работа подрядчика — по ТЗ → модель → группа категории.</p>
          <p className="mt-1">Охват классификации: единицы прихода — одежда {unitsBy.clothes} шт., аксессуары {unitsBy.acc} шт., без категории {unitsBy.other} шт. (категория берётся из Level 02 выгрузки). Работа: привязана к ТЗ {pctOf(workLinked, workTotalAll)}% суммы, из неё с категорией {pctOf(workClassified, workTotalAll)}% (всего {formatMoney(workTotalAll)}); неразнесённый аванс и ТЗ без группы в категориях не показаны, только в «Всё».</p>
        </div>
      )}

      <section aria-label="Ключевые показатели" className="grid grid-cols-1 items-stretch gap-2 min-[480px]:grid-cols-2 md:grid-cols-4">
        <Tile label="Потрачено" value={money(h.spent)} sub={filtered ? "все траты, не по категории" : `${label}, ${vatNote}`} spark={ser.spend} mini={spendKinds.map((r) => [r.short, money(r.total)] as [string, string])} expandId="spend" openId={openTile} onToggle={toggleTile}
          hint={<p>Все проведённые оплаты периода по дате платежа ({vatNote}).</p>} />
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
          label: `Работа в месяц · ${c === "all" ? "Тотал" : CAT_LABEL[c]}`,
          value: st.avgUnits === null || st.avgUnits === 0 ? "—" : `${st.avgUnits.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} шт./мес.`,
          sub: st.n ? `средневзвешенно за ${st.n} мес. проекта, получено ${pcs(st.unitsTotal)} шт.` : undefined,
          rows: [["Работа в месяц, ₽", rubOrDash(st.avgMonth)]] as [string, string][],
          hint: <p>Штук в месяц = единицы, полученные за период, ÷ число календарных месяцев проекта (общее число единиц, не среднее средних). Работа в месяц = вся работа подрядчику ÷ те же месяцы; по категориям — работа по ТЗ категории и приход категории ÷ N (работа без привязки к ТЗ — только в «Тотал»). Месяцы: от августа 2025 (первая оплата работы) до текущего включительно, в границах периода: {st.n} мес.; в расчёт входят и месяцы без работы и поставок, текущий месяц неполный.</p>,
        }; })} />
        <CarouselTile label="Работа на единицу" initial={pageOf[cat]} onOpen={(k) => openFor("workUnit", k)} pages={catPages.map((c) => { const st = wm.st[c]; return {
          label: `Работа на единицу · ${c === "all" ? "Тотал" : CAT_LABEL[c]}`,
          value: rubOrDash(st.perUnit),
          sub: hasSales ? `${rubOrDash(st.total)} ÷ ${st.unitsTotal || "—"} шт.` : "нет данных о приходе",
          rows: [["Единиц всего", st.unitsTotal ? String(st.unitsTotal) : "—"], ["Работа всего", rubOrDash(st.total)]] as [string, string][],
          hint: <p>Вся работа подрядчику за период ÷ все единицы, полученные за период (без привязки к месяцам). Это оценка: оплата и поступление могут приходиться на разные месяцы (аванс за будущее). По категориям — работа по ТЗ категории ÷ приход категории.</p>,
        }; })} />
        {hasSales ? (
          <CarouselTile label="Средняя цена продажи" initial={pageOf[cat]} onOpen={(k) => openFor("price", k)} pages={catPages.map((c) => { const g = groupSales(saleLines, months, exVat, () => "x", c)[0]; return {
            label: `Средняя цена продажи · ${c === "all" ? "Тотал" : CAT_LABEL[c]}`,
            value: g && g.pcs > 0 ? formatMoney(g.rev / g.pcs) : "—",
            sub: g && g.pcs > 0 ? `${pcs(g.pcs)} шт. продано, ${vatNote}` : "нет продаж",
            rows: [["Выручка", g ? money(g.rev) : "—"]] as [string, string][],
            hint: <p>Выручка ({vatNote}) ÷ проданные единицы (возвраты минус) за выбранный период и категорию; режим НДС — как в панели (в окне его можно переключить только для окна).</p>,
          }; })} />
        ) : <Tile label="Средняя цена продажи" value="—" sub="нет данных о продажах" />}
        <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-neutral-300 bg-white p-3 md:col-span-2 min-[480px]:col-span-2">
          <div className="flex items-center gap-1 text-xs text-neutral-600">{DUE_LABEL}<InfoHint label={`Как считается: ${DUE_LABEL}`} wide><p>{DUE_LABEL} = сырьё + работа по заведённым ТЗ − аванс подрядчику, не меньше нуля. Долг до зачёта аванса: {money(due.gross)}.</p><p className="mt-1">{dueHint(money(due.gross), money(left.prod))}</p></InfoHint></div>
          <div className={"text-lg font-semibold tabular-nums " + (due.net > 0 ? "text-amber-700" : "text-neutral-900")}>{formatMoney(due.net)}</div>
          {due.net <= 0 && due.creditLeft > 0 ? <div className="text-xs text-neutral-600">К доплате 0 ₽, аванс остаётся в зачёте {money(due.creditLeft)}</div> : null}
          <dl className="mt-1 flex flex-col gap-0.5 border-t border-neutral-200 pt-1 text-xs">
            <div className="flex items-baseline justify-between gap-2"><dt className="text-neutral-600">Сырьё (Веллмех)</dt><dd className="font-semibold tabular-nums">{money(left.raw)}</dd></div>
            <div className="flex items-baseline justify-between gap-2"><dt className="text-neutral-600">Работа по заведённым ТЗ</dt><dd className="font-semibold tabular-nums">{money(left.prod)}</dd></div>
            <div className="flex items-baseline justify-between gap-2"><dt className="text-neutral-600">Аванс подрядчику (оплачен, ТЗ ещё не привязаны)</dt><dd className="font-semibold tabular-nums">−{money(left.advance)}</dd></div>
          </dl>
          <Link href="/payments" className="mt-1 inline-flex min-h-11 items-center self-start text-xs underline">Открыть «Оплаты»</Link>
        </div>
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

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button type="button" aria-expanded={detail} onClick={() => setDetail((v) => !v)} className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm">{detail ? "Скрыть таблицу" : "Показать таблицу"}</button>
        {detail && (
          <div role="group" aria-label="Группировка строк" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
            <button type="button" aria-pressed={group === "period"} onClick={() => setGroup("period")} className={"inline-flex min-h-11 items-center rounded-md px-3 text-sm " + (group === "period" ? "bg-neutral-900 text-white" : "text-neutral-700")}>Период → Категория</button>
            <button type="button" aria-pressed={group === "category"} onClick={() => setGroup("category")} className={"inline-flex min-h-11 items-center rounded-md px-3 text-sm " + (group === "category" ? "bg-neutral-900 text-white" : "text-neutral-700")}>Категория → Период</button>
          </div>
        )}
        {detail && group === "period" && <button type="button" onClick={() => setOpen(open.length < years.length ? years : [])} className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-xs">{open.length < years.length ? "Развернуть все" : "Свернуть все"}</button>}
        {detail && group === "category" && <button type="button" onClick={() => { const ids = d.articles.flatMap((a) => [`a:${a.key}`, ...years.map((y) => `y:${a.key}:${y}`)]); setCatOpen(catOpen.length < ids.length ? ids : []); }} className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-xs">{catOpen.length < d.articles.length * (1 + years.length) ? "Развернуть все" : "Свернуть все"}</button>}
      </div>

      {detail && (
        <div className="max-h-[75vh] overflow-auto rounded-lg border border-neutral-300 bg-white" tabIndex={0} role="region" aria-label="Таблица Cashflow: строки — годы и месяцы, столбцы — статьи трат, деньги, единицы">
          <table className="table-keep border-collapse" style={{ tableLayout: "fixed", width: 150 + 104 * (artCols.length + (group === "period" ? 3 : 1)) }} onMouseLeave={clearHot}>
            <colgroup><col style={{ width: 150 }} />{Array.from({ length: artCols.length + (group === "period" ? 3 : 1) }, (_, i) => <col key={i} style={{ width: 104 }} />)}</colgroup>
            <thead>
              <tr className="border-b border-neutral-200">
                <th scope="col" rowSpan={2} className={th.replace("text-right", "text-left") + " " + sticky + " top-0 z-[2] min-w-[8rem] bg-white"}>Период</th>
                {d.articles.map((a) => (
                  <th key={a.key} scope="colgroup" tabIndex={0} onMouseEnter={() => setHot(a.key)} onFocus={() => setHot(a.key)} onBlur={clearHot} onClick={() => setHot(a.key)} colSpan={artCols.filter((c) => c.art === a.key).length} className="border-b border-l border-neutral-300 px-2 py-2 text-center text-xs font-semibold">
                    <span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[a.key] }} /><span title={a.label}>{SHORT[a.key] ?? a.label}</span>
                    <InfoHint label={`За что платили: ${a.label}`} wide>
                      <p>{a.hint}</p>
                      {a.key === "services" && services.length > 0 && (
                        <ul className="mt-1 list-disc pl-4">
                          {services.map((p) => <li key={p.number}>{p.number}{p.invoice ? `, счёт и УПД №${p.invoice}` : ""} от {p.date.split("-").reverse().join(".")}: {p.what}, оплачено {formatMoney(p.paid)}</li>)}
                        </ul>
                      )}
                    </InfoHint>
                  </th>
                ))}
                <th scope="col" rowSpan={2} className={th + " border-l border-neutral-300 font-bold"}>Потрачено</th>
                {group === "period" && <th scope="col" rowSpan={2} className={th + " border-l border-neutral-300 font-bold"}>Получено</th>}
                {group === "period" && <th scope="col" rowSpan={2} className={th + " font-bold"}>Чистый поток</th>}
              </tr>
              <tr className="border-b border-neutral-300">
                {artCols.map((c) => <th key={c.id} scope="col" className={th.replace("whitespace-nowrap", "whitespace-normal") + blk(c) + " font-normal text-neutral-600 " + (c.strong ? "font-semibold" : "")}>{c.sub}</th>)}
              </tr>
            </thead>
            {group === "category" ? (
            <tbody>
              {d.articles.map((a) => {
                const aid = "a:" + a.key, aOpen = catOpen.includes(aid);
                const mk = (idx: number[]): Row => ({ id: "x", label: "", kind: "month", idx });
                const cellsFor = (idx: number[], first: React.ReactNode, cls2: string, bg2: string, key: string) => (
                  <tr key={key} className={cls2}>
                    <th scope="row" className={"px-2 py-1 text-sm " + sticky + " " + bg2}>{first}</th>
                    {artCols.map((c) => <td key={c.id} className={td + blk(c) + (c.strong ? " font-semibold" : "")}>{c.art === a.key ? dash(c.get(mk(idx))) : "—"}</td>)}
                    <td className={td + " border-l border-neutral-300 font-semibold"}>{dash(sum(mk(idx), (i) => a.byMonth[i]))}</td>
                  </tr>
                );
                const allIdx = months.map((_, i) => i);
                return (
                  <Fragment key={a.key}>
                    {cellsFor(allIdx, <button type="button" aria-expanded={aOpen} aria-label={`${aOpen ? "Свернуть" : "Развернуть"}: ${a.label}`} onClick={() => setCatOpen(aOpen ? catOpen.filter((x) => x !== aid) : [...catOpen, aid])} className="inline-flex min-h-11 items-center gap-1.5 text-left font-semibold"><span aria-hidden>{aOpen ? "▾" : "▸"}</span><span title={a.label}>{SHORT[a.key] ?? a.label}</span></button>, "border-b border-neutral-300 bg-neutral-100 font-semibold", "bg-neutral-100", aid)}
                    {aOpen && years.map((y) => {
                      const yid = `y:${a.key}:${y}`, yOpen = catOpen.includes(yid);
                      const yidx = months.map((mo, i) => (mo.startsWith(y) ? i : -1)).filter((i) => i >= 0);
                      return (
                        <Fragment key={yid}>
                          {cellsFor(yidx, <button type="button" aria-expanded={yOpen} aria-label={`${yOpen ? "Свернуть" : "Развернуть"}: ${a.label} ${y}`} onClick={() => setCatOpen(yOpen ? catOpen.filter((x) => x !== yid) : [...catOpen, yid])} className="inline-flex min-h-11 items-center gap-1.5 pl-3 text-left font-medium"><span aria-hidden>{yOpen ? "▾" : "▸"}</span>{y}</button>, "border-b border-neutral-200", "bg-white", yid)}
                          {yOpen && yidx.filter((i) => Math.abs(a.byMonth[i]) > 0.005).map((i) => cellsFor([i], <span className="pl-9 font-normal">{full(months[i])}</span>, "border-b border-neutral-100 text-sm", "bg-white", yid + i))}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
              <tr className="row-total border-t-2 border-neutral-400 font-bold">
                <th scope="row" className={"px-2 py-1.5 text-sm " + sticky + " bg-white"}>Итого</th>
                {artCols.map((c) => <td key={c.id} className={td + blk(c) + (c.strong ? " font-semibold" : "")}>{dash(c.get({ id: "all", label: "", kind: "total", idx: months.map((_, i) => i) }))}</td>)}
                <td className={td + " border-l border-neutral-300 font-semibold"}>{dash(sum({ id: "all", label: "", kind: "total", idx: months.map((_, i) => i) }, (i) => ser.spend[i]))}</td>
              </tr>
            </tbody>
            ) : (
            <tbody>
              {rows.filter((r) => r.kind !== "month" || open.includes(r.id.slice(0, 4))).map((r) => {
                const cls = r.kind === "month" ? "border-b border-neutral-200" : r.kind === "year" ? "border-b border-neutral-300 bg-neutral-100 font-semibold" : "row-total border-t-2 border-neutral-400 font-bold";
                const bg = r.kind === "year" ? "bg-neutral-100" : "bg-white";
                const aim = (art: string | null) => { setHot(art); if (r.kind === "month") { setActive(r.idx[0]); setYearHot(null); } else if (r.kind === "year") { setActive(null); setYearHot(r.id.slice(1)); } else { setActive(null); setYearHot(null); } };
                const net = sum(r, (i) => ser.net[i]);
                const mOpen = r.kind === "month" && openMonths.includes(r.id);
                const gi = r.kind === "month" ? m.keep[r.idx[0]] : -1;
                return (
                  <Fragment key={r.id}>
                  <tr className={cls} onMouseEnter={() => aim(null)}>
                    <th scope="row" className={"px-2 py-1.5 text-sm " + (r.kind === "month" ? "font-normal " : "") + sticky + " " + bg}>
                      {r.kind === "year" ? (
                        <button type="button" aria-expanded={open.includes(r.id.slice(1))} className="inline-flex min-h-11 items-center gap-1.5 text-left font-semibold"
                          onClick={() => setOpen(open.includes(r.id.slice(1)) ? open.filter((y) => y !== r.id.slice(1)) : [...open, r.id.slice(1)])}>
                          <span aria-hidden>{open.includes(r.id.slice(1)) ? "▾" : "▸"}</span>{r.label}
                        </button>
                      ) : r.kind === "month" && hasSales ? (
                        <span className="flex items-center justify-between gap-2">{r.label}
                          <button type="button" aria-expanded={mOpen} aria-label={`${mOpen ? "Свернуть" : "Показать"} по категориям: ${r.label}`} onClick={() => setOpenMonths(mOpen ? openMonths.filter((x) => x !== r.id) : [...openMonths, r.id])} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md">{mOpen ? "▴" : "▾"}</button>
                        </span>
                      ) : r.label}
                    </th>
                    {artCols.map((c) => <td key={c.id} onMouseEnter={() => aim(c.art!)} onClick={() => aim(c.art!)} className={td + blk(c) + (c.strong ? " font-semibold" : "") + (hot === c.art && ((active !== null && r.idx.includes(active)) || (yearHot !== null && r.id === "y" + yearHot)) ? " bg-[var(--ui-soft)]" : "")}>{dash(c.get(r))}</td>)}
                    <td className={td + " border-l border-neutral-300 font-semibold"}>{dash(sum(r, (i) => ser.spend[i]))}</td>
                    <td className={td}>{hasSales ? dash(sum(r, (i) => ser.revenue[i])) : "—"}</td>
                    <td className={td + (hasSales && !filtered && net < -0.5 ? " text-[#b4310b]" : "")}>{hasSales && !filtered ? dash(net) : "—"}</td>
                  </tr>
                  {mOpen && (["clothes", "acc", "other"] as const).map((c) => {
                    const x = clsMonth(c, gi);
                    if (c === "other" && !x.rev && !x.rec && !x.sale && Math.abs(x.work) < 0.5) return null;
                    const no = <span title="Траты не делятся по категориям">—</span>;
                    return (
                      <tr key={r.id + c} className="border-b border-neutral-100 bg-neutral-50 text-xs">
                        <th scope="row" className={"py-1.5 pl-8 pr-2 text-left font-normal " + sticky + " bg-neutral-50"}>{CAT_LABEL[c]}</th>
                        {artCols.map((ac) => <td key={ac.id} className={td + blk(ac)}>{ac.art === "work" && ac.id.endsWith("T") ? dash(x.work) : no}</td>)}
                        <td className={td + " border-l border-neutral-300"}>{no}</td>
                        <td className={td}>{dash(x.rev)}</td><td className={td}>{no}</td>
                      </tr>
                    );
                  })}
                  </Fragment>
                );
              })}
            </tbody>
            )}
          </table>
        </div>
      )}

      <section aria-label="Деньги" className="rounded-lg border border-neutral-300 bg-white p-3">
        <div className="mb-2 min-h-[2.5rem] text-xs text-neutral-700" aria-live="polite">
          {active === null ? (
            null
          ) : (
            <span><b>{full(months[active])}</b>: потрачено {dash(ser.spend[active])}{hasSales ? <>, получено {dash(ser.revenue[active])}{filtered ? null : `, чистый ${dash(ser.net[active])}`}</> : null}, накопительно потрачено {dash(ser.cumSpend[active])}{hasSales ? <>, получено {dash(ser.cumRevenue[active])}{filtered ? null : `, чистый ${dash(ser.cumNet[active])}`}</> : null}
              {d.articles.filter((a) => Math.abs(a.byMonth[active]) >= 0.5).map((a) => <span key={a.key}> · {a.label} {formatMoney(a.byMonth[active])}</span>)}</span>
          )}
        </div>
        <h2 className="mb-1 text-sm font-semibold">Траты и полученные деньги по месяцам</h2>
        <ChartBox n={months.length}>{(colW) => <Chart kind="money" months={months} d={d} s={s} ser={ser} stock={m.stock} active={active} setActive={setActive} hot={hot} setHot={setHot} yearHot={yearHot} filtered={filtered} colW={colW} />}</ChartBox>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
          {d.articles.map((a) => (
            <li key={a.key}>
              <button type="button" aria-pressed={hot === a.key} aria-label={`${a.label}: ${formatMoney(a.total)} за период`} onMouseEnter={() => setHot(a.key)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(a.key)} onBlur={() => setHot(null)} onClick={() => setHot(hot === a.key ? null : a.key)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: COLORS[a.key] }} />{a.label}</button>
            </li>
          ))}
          <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: GET }} />Получено (вверх)</li>
          <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-0.5 w-4 bg-neutral-900" />Чистый поток</li>
        </ul>
      </section>

      <section aria-label="Накопительно" className="rounded-lg border border-neutral-300 bg-white p-3">
        <h2 className="mb-1 flex items-center gap-1 text-sm font-semibold">Накопительно: потрачено и получено
          <InfoHint label="Как читать накопительный график" wide><p>Две линии растут с первого месяца данных: оранжевая — сколько потрачено, зелёная — сколько получено. Пунктир — разрыв между ними: ниже нуля «в минусе», выше — «в плюсе».</p></InfoHint>
        </h2>
        <ChartBox n={months.length} extra={142}>{(colW) => <Chart kind="cum" months={months} d={d} s={s} ser={ser} stock={m.stock} active={active} setActive={setActive} hot={hot} setHot={setHot} yearHot={yearHot} filtered={filtered} colW={colW} />}</ChartBox>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
          <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-0.5 w-4" style={{ background: SPEND }} />Потрачено нарастающим итогом</li>
          {hasSales && <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-0.5 w-4" style={{ background: GET }} />Получено нарастающим итогом</li>}
          {hasSales && <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: NAVY }} />Чистый итог (получено − потрачено)</li>}
        </ul>
      </section>

      <section aria-label="Товар" className="flex flex-col gap-4 rounded-lg border border-neutral-300 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Работа подрядчика</h2>
          <Link href="/sales" data-testid="cf-sales-link" className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium text-blue-700 hover:bg-neutral-50 print:hidden">Приход, продано и остаток: Продажи и остатки →</Link>
        </div>
        {hasSales ? (
          <>
            <div>
              <h3 className="text-sm font-semibold">Работа подрядчика по месяцам, ₽</h3>
              <div className="min-h-[1.5rem] text-xs text-neutral-700" aria-live="polite">{gActive !== null ? <span><b>{full(gMonths[gActive])}</b>: работа {dash(gWu.work[gActive])}{KIND_ORDER.filter((k) => Math.abs(gKinds[k][gActive]) > 0.5).map((k) => `, ${PAY_TYPE_LABEL[k].toLowerCase()} ${dash(gKinds[k][gActive])}`).join("")}, получено {pcs(gWu.units[gActive])} шт.</span> : null}</div>
              <ChartBox n={gMonths.length} extra={102}>{(colW) => <WorkMonthsChart months={gMonths} kinds={gKinds} units={gWu.units} active={gActive} setActive={setGActive} colW={colW} />}</ChartBox>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
                {KIND_ORDER.filter((k) => Math.abs(gKinds[k].reduce((a2, b2) => a2 + b2, 0)) > 0.5).map((k) => <li key={k} className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: k === "ADVANCE" || k === "OTHER" ? KIND_COLOR[k] : `repeating-linear-gradient(${k === "PARTIAL" ? "45deg" : "0deg"}, ${KIND_COLOR[k]} 0 3px, #fff 3px 5px)` }} />{PAY_TYPE_LABEL[k]} {dash(gKinds[k].reduce((a2, b2) => a2 + b2, 0))}</li>)}
                <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ background: NAVY }} />Получено единиц, шт. (справа)</li>
              </ul>
            </div>

          </>
        ) : <p className="text-sm text-neutral-700">{noSalesNote}</p>}
      </section>


    </div>
  );
}
