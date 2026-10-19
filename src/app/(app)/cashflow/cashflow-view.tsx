"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/utils";
import { toCsv } from "@/lib/csv";
import { InfoHint } from "@/components/info-hint";
import { MarginBlock } from "./margin-block";
import type { MarginData } from "@/lib/margin";
import { goodsHeadline, headline, seriesOf, sliceData, sliceSales, stockSeries, visibleMonths, type CashflowData, type CashflowPeriod, type SalesMonthly } from "@/lib/cashflow";

type ServicePart = { number: string; what: string; invoice: string | null; date: string; paid: number };
type Props = { incl: CashflowData; ex: CashflowData; sales: SalesMonthly; vat: { vat: number; unknown: number; total: number }; services: ServicePart[]; initialPeriod: CashflowPeriod; margin: MarginData | null };

const SPEND = "#d93a0e", GET = "#1f7a4d", NAVY = "#1b2a5c", STOCK = "#8a6d1d";
// Цвета статей трат: различимы между собой и без цвета (подписи в легенде, таблица рядом — текстовая альтернатива).
const COLORS: Record<string, string> = { furAuction: "#1b2a5c", furPurchase: "#4f6bb5", lining: "#2f7f8f", services: "#8a6d1d", work: "#d93a0e", hides: "#7a4a8c" };
const MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const mon = (m: string) => MON[Number(m.slice(5, 7)) - 1];
const full = (m: string) => `${mon(m)} ${m.slice(0, 4)}`;
const dash = (v: number | null) => (v === null || Math.abs(v) < 0.5 ? "—" : formatMoney(v));
const pcs = (v: number) => (v === 0 ? "—" : v.toLocaleString("ru-RU"));
const mln = (v: number) => (v / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " млн";
/** Остаток «TTL Stock, PCS» из отчёта «отчет по товарам фото и цены» на 19.10.2026 (Report, строка Total). */
const REPORT_STOCK = 379;
const PERIODS: [CashflowPeriod, string][] = [["all", "Все"], ["2025", "2025"], ["2026", "2026"]];

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
};

function Chart({ kind, months, d, s, ser, stock, active, setActive, hot, setHot, yearHot }: ChartProps) {
  const n = months.length;
  const colW = 26, left = 58, right = 12, top = 12, bottom = 40, H = 250;
  const W = left + right + n * colW;
  const x = (i: number) => left + i * colW + colW / 2;
  // Диапазон оси Y по виду графика.
  let lo = 0, hi = 1;
  if (kind === "money") { hi = Math.max(...ser.revenue, 0); lo = -Math.max(...ser.spend, 0); }
  else if (kind === "cum") { hi = Math.max(...ser.cumSpend, ...ser.cumRevenue, 0); lo = Math.min(...ser.cumNet, 0); }
  else if (kind === "goods") { hi = Math.max(...s.recPcs, ...s.salePcs, ...stock, 0); lo = Math.min(...stock, 0); }
  else { hi = Math.max(...ser.cumWorkPerUnit.map((v) => v ?? 0), 0); lo = 0; }
  const top2 = niceMax(hi || 1), bot2 = lo < 0 ? -niceMax(-lo) : 0;
  const y = (v: number) => top + (H - top - bottom) * (1 - (v - bot2) / (top2 - bot2));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => bot2 + t * (top2 - bot2));
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
              return <rect key={a.key} x={x(i) - 9} width={18} y={y0} height={Math.max(0, y1 - y0)} fill={COLORS[a.key]} opacity={dim ? 0.25 : 1} stroke={hot === a.key ? "#111" : "none"}
                onMouseEnter={() => setHot(a.key)} onMouseLeave={() => setHot(null)}><title>{`${a.label}, ${full(m)}: ${formatMoney(v)}`}</title></rect>;
            })}
            {ser.revenue[i] > 0.5 && <rect x={x(i) - 9} width={18} y={y(ser.revenue[i])} height={Math.max(0, y(0) - y(ser.revenue[i]))} fill={GET} opacity={hot || ((active !== null || yearHot !== null) && !sel) ? 0.25 : 1} />}
          </g>
        );
      })}
      {kind === "money" && s.available && <path d={lineOf(ser.net)} fill="none" stroke="#111" strokeWidth={2} />}
      {kind === "cum" && (
        <>
          <path d={lineOf(ser.cumSpend)} fill="none" stroke={SPEND} strokeWidth={2.5} />
          {s.available && <path d={lineOf(ser.cumRevenue)} fill="none" stroke={GET} strokeWidth={2.5} />}
          {s.available && <path d={lineOf(ser.cumNet)} fill="none" stroke={NAVY} strokeWidth={2.5} strokeDasharray="6 4" />}
          {active !== null && <circle cx={x(active)} cy={y(ser.cumSpend[active])} r={5} fill={SPEND} />}
        </>
      )}
      {kind === "goods" && (
        <>
          {months.map((m, i) => (
            <g key={m}>
              {s.recPcs[i] > 0 && <rect x={x(i) - 11} width={10} y={y(s.recPcs[i])} height={Math.max(0, y(0) - y(s.recPcs[i]))} fill={NAVY} opacity={active !== null && active !== i ? 0.35 : 1} />}
              {s.salePcs[i] > 0 && <rect x={x(i) + 1} width={10} y={y(s.salePcs[i])} height={Math.max(0, y(0) - y(s.salePcs[i]))} fill={GET} opacity={active !== null && active !== i ? 0.35 : 1} />}
            </g>
          ))}
          <path d={lineOf(stock)} fill="none" stroke={STOCK} strokeWidth={2.5} />
        </>
      )}
      {kind === "work" && <path d={lineOf(ser.cumWorkPerUnit)} fill="none" stroke={SPEND} strokeWidth={2.5} />}
      {active !== null && <line x1={x(active)} x2={x(active)} y1={top} y2={H - bottom} stroke="#111" strokeWidth={1} opacity={0.35} />}
      {months.map((m, i) => (
        <rect key={m} x={left + i * colW} y={top} width={colW} height={H - top - bottom} fill="transparent" tabIndex={0} aria-label={aria(i)}
          onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onClick={() => setActive(i)} />
      ))}
    </svg>
  );
}

function Tile({ label, value, sub, hint, tone }: { label: string; value: string; sub?: string; hint?: React.ReactNode; tone?: "bad" | "good" }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-neutral-300 bg-white p-3">
      <div className="flex items-center gap-1 text-xs text-neutral-600">{label}{hint ? <InfoHint label={`Как считается: ${label}`} wide>{hint}</InfoHint> : null}</div>
      <div className={"text-lg font-semibold tabular-nums " + (tone === "bad" ? "text-[#b4310b]" : tone === "good" ? "text-[#17613c]" : "text-neutral-900")}>{value}</div>
      {sub ? <div className="text-xs text-neutral-600">{sub}</div> : null}
    </div>
  );
}

export function CashflowView({ incl, ex, sales, vat, services, initialPeriod, margin }: Props) {
  const [period, setPeriod] = useState<CashflowPeriod>(initialPeriod);
  const [exVat, setExVat] = useState(false);
  const [second, setSecond] = useState<"goods" | "work">("goods");
  const [detail, setDetail] = useState(false);
  const [open, setOpen] = useState<string[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [yearHot, setYearHot] = useState<string | null>(null);

  const m = useMemo(() => {
    const all = exVat ? ex : incl;
    const revAll = exVat ? sales.revEx : sales.revIncl;
    const keep = visibleMonths(all, sales, period);
    const d = sliceData(all, keep, period);
    const s = sliceSales(sales, keep);
    const revenue = keep.map((i) => revAll[i]);
    const serAll = seriesOf(all, sales, revAll);
    const stAll = stockSeries(sales);
    const pick = <T,>(a: T[]) => keep.map((i) => a[i]);
    const ser: Ser = { spend: pick(serAll.spend), revenue, net: pick(serAll.net), cumSpend: pick(serAll.cumSpend), cumRevenue: pick(serAll.cumRevenue), cumNet: pick(serAll.cumNet), work: pick(serAll.work), cumWorkPerUnit: pick(serAll.cumWorkPerUnit) };
    const h = headline(d, s, revenue);
    const g = goodsHeadline(sales, all.months, period);
    const last = keep.length ? keep[keep.length - 1] : -1;
    return { all, keep, d, s, revenue, ser, stock: pick(stAll.stock), h, g, cumNetEnd: last >= 0 ? serAll.cumNet[last] : 0 };
  }, [exVat, period, incl, ex, sales]);
  const { d, s, ser, h, g } = m;
  const months = d.months;
  const hasSales = sales.available;
  const stockEnd = stockSeries(sales).stock.at(-1) ?? 0;
  const label = period === "all" ? "2025–2026" : period;

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

  const csv = () => {
    const head = ["Период", ...artCols.map((c) => `${c.head}: ${c.sub}`), "Потрачено", "Получено", "Чистый поток", "Накопительно потрачено", "Накопительно получено", "Накопительно чистый", "Единиц получено", "Единиц продано", "Остаток, шт.", "Работа за период", "Работа на единицу"];
    const nf = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","));
    const body = rows.map((r) => {
      const u = sum(r, (i) => s.recPcs[i]), w = sum(r, workOf);
      return [r.label, ...artCols.map((c) => nf(c.get(r))), nf(sum(r, (i) => ser.spend[i])), nf(sum(r, (i) => ser.revenue[i])), nf(sum(r, (i) => ser.net[i])), nf(lastOf(r, ser.cumSpend)), nf(lastOf(r, ser.cumRevenue)), nf(lastOf(r, ser.cumNet)),
        String(u), String(sum(r, (i) => s.salePcs[i])), String(lastOf(r, m.stock)), nf(w), nf(perUnit(w, u))];
    });
    const blob = new Blob([toCsv(head, body)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cashflow-${label.replace(/[^0-9a-zа-я]+/gi, "-")}-${exVat ? "bez-nds" : "s-nds"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const seg = (on: boolean) => "inline-flex min-h-11 items-center rounded-md px-3 text-sm " + (on ? "bg-neutral-900 text-white" : "text-neutral-700 hover:text-neutral-900");
  const th = "px-2 py-2 text-right text-xs font-semibold whitespace-nowrap";
  const td = "px-2 py-1.5 text-right text-sm tabular-nums whitespace-nowrap";
  const sticky = "sticky left-0 z-[1] text-left";
  const vatNote = exVat ? "без НДС" : "с НДС";
  const noSalesNote = "Нет данных о продажах: выгрузка поступлений и продаж ещё не загружена.";
  const money = (v: number) => formatMoney(v);

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

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <nav aria-label="Период" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
          {PERIODS.map(([k, t]) => <button key={k} type="button" aria-pressed={period === k} onClick={() => { setPeriod(k); clearHot(); }} className={seg(period === k)}>{t}</button>)}
        </nav>
        <div role="group" aria-label="НДС" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
          <button type="button" aria-pressed={!exVat} onClick={() => setExVat(false)} className={seg(!exVat)}>С НДС</button>
          <button type="button" aria-pressed={exVat} onClick={() => setExVat(true)} className={seg(exVat)}>Без НДС</button>
        </div>
        <button type="button" onClick={csv} className="ml-auto inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-xs">Скачать CSV</button>
      </div>
      {exVat && vat.unknown > 0.5 && <p className="text-xs text-neutral-700">НДС нет в данных по {money(vat.unknown)} оплат (работа подрядчику, авансы без привязки к закупке): в режиме «Без НДС» они показаны как есть.</p>}

      <section aria-label="Ключевые показатели" className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Потрачено" value={money(h.spent)} sub={`${label}, ${vatNote}`} hint={<p>Все проведённые оплаты периода по дате платежа ({vatNote}).</p>} />
        <Tile label="Получено" value={hasSales ? money(h.received) : "—"} sub={hasSales ? `выручка, ${vatNote}` : "нет данных о продажах"}
          hint={<p>Розничная выручка из выгрузки продаж: чистые продажи после скидок, возвраты вычтены; по дате продажи. {noSalesNote}</p>} />
        <Tile label="Чистый денежный поток" value={hasSales ? money(h.net) : "—"} tone={hasSales ? (h.net < 0 ? "bad" : "good") : undefined} sub={hasSales ? (h.net < 0 ? "в минусе за период" : "в плюсе за период") : "нет данных о продажах"}
          hint={<p>Получено минус потрачено за период.</p>} />
        <Tile label="Накопленный итог" value={hasSales ? money(m.cumNetEnd) : "—"} tone={hasSales ? (m.cumNetEnd < 0 ? "bad" : "good") : undefined} sub={hasSales ? "с начала данных на конец периода" : "нет данных о продажах"}
          hint={<p>Получено минус потрачено нарастающим итогом с первого месяца данных до конца выбранного периода.</p>} />
        <Tile label="Работа в месяц" value={h.workPerMonth === null ? "—" : money(h.workPerMonth)} sub={h.workMonths ? `в среднем за ${h.workMonths} мес.` : undefined}
          hint={<p>Оплаты статьи «Работа подрядчику» за период ÷ число месяцев от первой до последней оплаты периода (месяцы без оплат входят).</p>} />
        <Tile label="Работа на единицу" value={h.workPerUnit === null ? "—" : money(h.workPerUnit)} sub={hasSales ? `${pcs(h.unitsReceived)} шт. получено` : "нет данных о приходе"}
          hint={<p>Оплаты «Работа подрядчику» за период ÷ единиц, полученных за период. Это оценка: оплата и поступление могут приходиться на разные месяцы (аванс за будущее).</p>} />
        <Tile label="Средняя цена продажи" value={h.avgPrice === null ? "—" : money(h.avgPrice)} sub={hasSales ? `${pcs(h.unitsSold)} шт. продано, ${vatNote}` : "нет данных о продажах"}
          hint={<p>Выручка ({vatNote}) ÷ проданные единицы (возвраты минус).</p>} />
        <Tile label="Скидка" value={h.discountPct === null ? "—" : h.discountPct.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " %"} sub={hasSales ? "от цены до скидки" : "нет данных о продажах"}
          hint={<p>Скидка ÷ (выручка + скидка), по данным выгрузки продаж, с НДС.</p>} />
      </section>

      <section aria-label="Деньги" className="rounded-lg border border-neutral-300 bg-white p-3">
        <div className="mb-2 min-h-[2.5rem] text-xs text-neutral-700" aria-live="polite">
          {active === null ? (
            <span>Наведите курсор или коснитесь месяца. Вверх — полученные деньги, вниз — траты по статьям, чёрная линия — чистый поток{hasSales ? "" : " (нет данных о продажах)"}.</span>
          ) : (
            <span><b>{full(months[active])}</b>: потрачено {dash(ser.spend[active])}{hasSales ? <>, получено {dash(ser.revenue[active])}, чистый {dash(ser.net[active])}</> : null}, накопительно потрачено {dash(ser.cumSpend[active])}{hasSales ? <>, получено {dash(ser.cumRevenue[active])}, чистый {dash(ser.cumNet[active])}</> : null}
              {d.articles.filter((a) => Math.abs(a.byMonth[active]) >= 0.5).map((a) => <span key={a.key}> · {a.label} {formatMoney(a.byMonth[active])}</span>)}</span>
          )}
        </div>
        <h2 className="mb-1 text-sm font-semibold">Траты и полученные деньги по месяцам</h2>
        <div className="overflow-x-auto"><Chart kind="money" months={months} d={d} s={s} ser={ser} stock={m.stock} active={active} setActive={setActive} hot={hot} setHot={setHot} yearHot={yearHot} /></div>
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
        <div className="overflow-x-auto"><Chart kind="cum" months={months} d={d} s={s} ser={ser} stock={m.stock} active={active} setActive={setActive} hot={hot} setHot={setHot} yearHot={yearHot} /></div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
          <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-0.5 w-4" style={{ background: SPEND }} />Потрачено нарастающим итогом</li>
          {hasSales && <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-0.5 w-4" style={{ background: GET }} />Получено нарастающим итогом</li>}
          {hasSales && <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: NAVY }} />Чистый итог (получено − потрачено)</li>}
        </ul>
      </section>

      <section aria-label="Товар" className="rounded-lg border border-neutral-300 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Товар и работа подрядчика</h2>
          <div role="group" aria-label="График" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5 print:hidden">
            <button type="button" aria-pressed={second === "goods"} onClick={() => setSecond("goods")} className={seg(second === "goods")}>Приход, продажи, остаток</button>
            <button type="button" aria-pressed={second === "work"} onClick={() => setSecond("work")} className={seg(second === "work")}>Работа на единицу</button>
          </div>
        </div>
        {hasSales ? (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
              <Tile label="Приход, шт." value={pcs(g.received)} sub={`за ${label}`} hint={<p>Единицы, поступившие за период (выгрузка «поступления»; корректировки с минусом учтены).</p>} />
              <Tile label="Продано, шт." value={pcs(g.sold)} sub={`за ${label}`} hint={<p>Единицы проданные за период, возвраты вычтены.</p>} />
              <Tile label="Остаток, шт." value={pcs(g.stock)} sub="на конец периода" hint={<p>Накопленный приход минус накопленные продажи с начала данных. Фактический остаток по отчёту о товарах на 19.10.2026 — {REPORT_STOCK} шт.; расчётный на конец данных — {stockEnd} шт.{stockEnd !== REPORT_STOCK ? ` Разница ${stockEnd - REPORT_STOCK} шт. — списания и перемещения, которых нет в выгрузке поступлений и продаж.` : ""}</p>} />
              <Tile label="Sell-through" value={g.sellThrough === null ? "—" : g.sellThrough.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " %"} sub="продано / получено" hint={<p>Накопленные продажи ÷ накопленный приход с начала данных до конца периода.</p>} />
              <Tile label="Покрытие остатка" value={g.coverMonths === null ? "—" : g.coverMonths.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " мес."} sub="остаток / продажи в месяц" hint={<p>Остаток на конец периода ÷ средние продажи в месяц (от первого до последнего месяца с продажами в периоде). Сезонность не учитывается.</p>} />
            </div>
            <div className="overflow-x-auto"><Chart kind={second} months={months} d={d} s={s} ser={ser} stock={m.stock} active={active} setActive={setActive} hot={hot} setHot={setHot} yearHot={yearHot} /></div>
            {second === "goods" ? (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
                <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: NAVY }} />Приход, шт.</li>
                <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: GET }} />Продано, шт.</li>
                <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-0.5 w-4" style={{ background: STOCK }} />Остаток нарастающим итогом, шт.</li>
              </ul>
            ) : <p className="mt-2 text-xs text-neutral-700">Накопленная оплата работы ÷ накопленные полученные единицы, ₽ ({vatNote}). До первого прихода линии нет.</p>}
          </>
        ) : <p className="text-sm text-neutral-700">{noSalesNote}</p>}
      </section>

      <MarginBlock data={margin} />

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button type="button" aria-expanded={detail} onClick={() => setDetail((v) => !v)} className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm">{detail ? "Скрыть таблицу по месяцам" : "Показать таблицу по месяцам"}</button>
        {detail && <button type="button" onClick={() => setOpen(open.length < years.length ? years : [])} className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-xs">{open.length < years.length ? "Развернуть годы" : "Свернуть годы"}</button>}
      </div>

      {detail && (
        <div className="max-h-[75vh] overflow-auto rounded-lg border border-neutral-300 bg-white" tabIndex={0} role="region" aria-label="Таблица Cashflow: строки — годы и месяцы, столбцы — статьи трат, деньги, единицы">
          <table className="w-full border-collapse" onMouseLeave={clearHot}>
            <thead>
              <tr className="border-b border-neutral-200">
                <th scope="col" rowSpan={2} className={th.replace("text-right", "text-left") + " " + sticky + " top-0 z-[2] min-w-[8rem] bg-white"}>Период</th>
                {d.articles.map((a) => (
                  <th key={a.key} scope="colgroup" tabIndex={0} onMouseEnter={() => setHot(a.key)} onFocus={() => setHot(a.key)} onBlur={clearHot} onClick={() => setHot(a.key)} colSpan={artCols.filter((c) => c.art === a.key).length} className="border-l border-neutral-200 px-2 py-2 text-center text-xs font-semibold">
                    <span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[a.key] }} />{a.label}
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
                <th scope="col" rowSpan={2} className={th + " font-bold"}>Получено</th>
                <th scope="col" rowSpan={2} className={th + " font-bold"}>Чистый поток</th>
                <th scope="colgroup" colSpan={3} className="border-l border-neutral-300 px-2 py-2 text-center text-xs font-semibold">Накопительно</th>
                <th scope="col" rowSpan={2} className={th + " border-l border-neutral-300"}>Единиц получено</th>
                <th scope="col" rowSpan={2} className={th}>Единиц продано</th>
                <th scope="col" rowSpan={2} className={th}>Остаток, шт.</th>
                <th scope="col" rowSpan={2} className={th + " border-l border-neutral-300"}>Работа за период</th>
                <th scope="col" rowSpan={2} className={th}>Работа на единицу</th>
              </tr>
              <tr className="border-b border-neutral-300">
                {artCols.map((c) => <th key={c.id} scope="col" className={th + " font-normal text-neutral-600 " + (c.strong ? "font-semibold" : "")}>{c.sub}</th>)}
                <th scope="col" className={th + " border-l border-neutral-300 font-normal text-neutral-600"}>потрачено</th>
                <th scope="col" className={th + " font-normal text-neutral-600"}>получено</th>
                <th scope="col" className={th + " font-normal text-neutral-600"}>чистый</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter((r) => r.kind !== "month" || open.includes(r.id.slice(0, 4))).map((r) => {
                const cls = r.kind === "month" ? "border-b border-neutral-200" : r.kind === "year" ? "border-b border-neutral-300 bg-neutral-100 font-semibold" : "row-total border-t-2 border-neutral-400 font-bold";
                const bg = r.kind === "year" ? "bg-neutral-100" : "bg-white";
                const aim = (art: string | null) => { setHot(art); if (r.kind === "month") { setActive(r.idx[0]); setYearHot(null); } else if (r.kind === "year") { setActive(null); setYearHot(r.id.slice(1)); } else { setActive(null); setYearHot(null); } };
                const u = sum(r, (i) => s.recPcs[i]), w = sum(r, workOf);
                const net = sum(r, (i) => ser.net[i]);
                return (
                  <tr key={r.id} className={cls} onMouseEnter={() => aim(null)}>
                    <th scope="row" className={"px-2 py-1.5 text-sm " + (r.kind === "month" ? "font-normal " : "") + sticky + " " + bg}>
                      {r.kind === "year" ? (
                        <button type="button" aria-expanded={open.includes(r.id.slice(1))} className="inline-flex min-h-11 items-center gap-1.5 text-left font-semibold"
                          onClick={() => setOpen(open.includes(r.id.slice(1)) ? open.filter((y) => y !== r.id.slice(1)) : [...open, r.id.slice(1)])}>
                          <span aria-hidden>{open.includes(r.id.slice(1)) ? "▾" : "▸"}</span>{r.label}
                        </button>
                      ) : r.label}
                    </th>
                    {artCols.map((c) => <td key={c.id} onMouseEnter={() => aim(c.art!)} onClick={() => aim(c.art!)} className={td + (c.strong ? " font-semibold" : "") + (hot === c.art && ((active !== null && r.idx.includes(active)) || (yearHot !== null && r.id === "y" + yearHot)) ? " bg-[var(--ui-soft)]" : "")}>{dash(c.get(r))}</td>)}
                    <td className={td + " border-l border-neutral-300 font-semibold"}>{dash(sum(r, (i) => ser.spend[i]))}</td>
                    <td className={td}>{hasSales ? dash(sum(r, (i) => ser.revenue[i])) : "—"}</td>
                    <td className={td + (hasSales && net < -0.5 ? " text-[#b4310b]" : "")}>{hasSales ? dash(net) : "—"}</td>
                    <td className={td + " border-l border-neutral-300"}>{dash(lastOf(r, ser.cumSpend))}</td>
                    <td className={td}>{hasSales ? dash(lastOf(r, ser.cumRevenue)) : "—"}</td>
                    <td className={td}>{hasSales ? dash(lastOf(r, ser.cumNet)) : "—"}</td>
                    <td className={td + " border-l border-neutral-300"}>{hasSales ? pcs(u) : "—"}</td>
                    <td className={td}>{hasSales ? pcs(sum(r, (i) => s.salePcs[i])) : "—"}</td>
                    <td className={td}>{hasSales ? pcs(lastOf(r, m.stock)) : "—"}</td>
                    <td className={td + " border-l border-neutral-300"}>{dash(w)}</td>
                    <td className={td}>{dash(perUnit(w, u))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-neutral-600 print:hidden">Оплаты по статьям и документам — в разделе <Link href="/payments" className="underline">«Оплаты»</Link>.</p>
    </div>
  );
}
