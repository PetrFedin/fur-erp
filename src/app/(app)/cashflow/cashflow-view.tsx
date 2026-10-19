"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/utils";
import { toCsv } from "@/lib/csv";
import { InfoHint } from "@/components/info-hint";
import { CAT_LABEL, type CatClass } from "@/lib/sales-receipts-core";
import { cumWorkPerUnit, goodsHeadline, headline, seriesOf, type WorkByClass, sliceData, sliceSales, stockSeries, visibleMonths, type CashflowData, type CashflowPeriod, type SalesMonthly } from "@/lib/cashflow";

type ServicePart = { number: string; what: string; invoice: string | null; date: string; paid: number };
type Cat = "all" | "clothes" | "acc";
type Props = { incl: CashflowData; ex: CashflowData; salesBy: Record<CatClass | "all", SalesMonthly>; workBy: WorkByClass; vat: { vat: number; unknown: number; total: number }; services: ServicePart[]; initialPeriod: CashflowPeriod; /** Для проверок вёрстки. */ initialCat?: Cat; initialSecond?: "goods" | "workunit" | "work"; /** Для проверок вёрстки: таблица открыта сразу. */ initialDetail?: boolean };

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
  /** Фильтр по категории: траты не делятся, поэтому чистый итог не рисуем. */
  filtered: boolean;
  /** Ширина колонки месяца: считается по ширине контейнера, чтобы график занимал всю ширину карточки. */
  colW: number;
};

function Chart({ kind, months, d, s, ser, stock, active, setActive, hot, setHot, yearHot, filtered, colW }: ChartProps) {
  const n = months.length;
  const left = 58, right = 12, top = 12, bottom = 40, H = 250;
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

/** «Работа на единицу» по месяцам: три полосы с общей осью месяцев — единицы получено (столбцы), работа за месяц (линия), работа на единицу за месяц (маркеры) и пунктир среднего за период. */
function WorkUnitChart({ months, wu, active, setActive, colW }: { colW: number; months: string[]; wu: { work: number[]; units: number[]; avg: number | null }; active: number | null; setActive: (i: number | null) => void }) {
  const n = months.length;
  const left = 58, right = 12, W = left + right + n * colW;
  const bw = Math.max(10, Math.min(40, Math.round(colW * 0.7)));
  const bands = [{ top: 14, h: 70 }, { top: 112, h: 70 }, { top: 210, h: 90 }];
  const H = 340;
  const x = (i: number) => left + i * colW + colW / 2;
  const perUnit = wu.work.map((w, i) => (wu.units[i] > 0 ? w / wu.units[i] : null));
  const maxU = niceMax(Math.max(...wu.units, 1)), maxW = niceMax(Math.max(...wu.work, 1)), maxP = niceMax(Math.max(...perUnit.map((v) => v ?? 0), wu.avg ?? 0, 1));
  const yb = (b: number, v: number, max: number) => bands[b].top + bands[b].h * (1 - v / max);
  const line = (b: number, a: (number | null)[], max: number) => a.map((v, i) => (v === null ? "" : `${i === 0 || a[i - 1] === null ? "M" : "L"}${x(i)},${yb(b, v, max)}`)).join(" ");
  const k = (v: number) => (v / 1e3).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " тыс";
  const lab = ["Единиц получено, шт.", "Работа за месяц, ₽", "Работа на единицу за месяц, ₽"];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Работа на единицу: единицы получено, работа за месяц, работа на единицу и среднее за период" className="block">
      {bands.map((b, bi) => {
        const max = [maxU, maxW, maxP][bi];
        return (
          <g key={bi}>
            <text x={left} y={b.top - 3} fontSize={11} fill="#1b2a5c" fontWeight={600}>{lab[bi]}</text>
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line x1={left} x2={W - right} y1={yb(bi, t * max, max)} y2={yb(bi, t * max, max)} stroke="#d4d4d8" />
                <text x={left - 6} y={yb(bi, t * max, max) + 4} textAnchor="end" fontSize={11} fill="#5a6a94">{bi === 0 ? Math.round(t * max) : bi === 1 ? mln(t * max) : k(t * max)}</text>
              </g>
            ))}
          </g>
        );
      })}
      {months.map((m, i) => (
        <g key={m}>
          <text x={x(i)} y={H - 22} textAnchor="middle" fontSize={11} fill="#5a6a94">{mon(m)}</text>
          {(i === 0 || m.endsWith("-01")) && <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fontWeight={700} fill={NAVY}>{m.slice(0, 4)}</text>}
          {wu.units[i] > 0 && <rect x={x(i) - bw / 2} width={bw} y={yb(0, wu.units[i], maxU)} height={bands[0].top + bands[0].h - yb(0, wu.units[i], maxU)} fill={NAVY} opacity={active !== null && active !== i ? 0.35 : 1} />}
        </g>
      ))}
      <path d={line(1, wu.work, maxW)} fill="none" stroke={SPEND} strokeWidth={2.5} />
      {wu.work.map((w, i) => <circle key={i} cx={x(i)} cy={yb(1, w, maxW)} r={active === i ? 5 : 3} fill={SPEND} />)}
      {wu.avg !== null && (
        <>
          <line x1={left} x2={W - right} y1={yb(2, wu.avg, maxP)} y2={yb(2, wu.avg, maxP)} stroke="#111" strokeWidth={1.5} strokeDasharray="6 4" />
          <text x={W - right} y={yb(2, wu.avg, maxP) - 4} textAnchor="end" fontSize={11} fontWeight={700} fill="#111">среднее за период {Math.round(wu.avg).toLocaleString("ru-RU")} ₽</text>
        </>
      )}
      <path d={line(2, perUnit, maxP)} fill="none" stroke={STOCK} strokeWidth={1.5} opacity={0.6} />
      {perUnit.map((v, i) => (v === null ? null : <circle key={i} cx={x(i)} cy={yb(2, v, maxP)} r={active === i ? 6 : 4} fill={STOCK} />))}
      {active !== null && <line x1={x(active)} x2={x(active)} y1={10} y2={H - 38} stroke="#111" strokeWidth={1} opacity={0.35} />}
      {months.map((m, i) => (
        <rect key={m} x={left + i * colW} y={10} width={colW} height={H - 48} fill="transparent" tabIndex={0}
          aria-label={`${full(m)}: получено ${wu.units[i]} шт., работа за месяц ${dash(wu.work[i])}, на единицу ${dash(perUnit[i])}${wu.avg !== null ? `, среднее за период ${dash(wu.avg)}` : ""}`}
          onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onClick={() => setActive(i)} />
      ))}
    </svg>
  );
}

/** «Показано: …» у блока: текущий выбор общих фильтров и кнопка смены (открывает закреплённую панель). Состояние общее, не отдельное. */
function Shown({ text, onChange }: { text: string; onChange: () => void }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-700 print:hidden">
      <span>Показано: {text}</span>
      <button type="button" onClick={onChange} className="inline-flex min-h-11 items-center rounded-md px-2 underline">Изменить</button>
    </p>
  );
}

/** Контейнер графика: измеряет свою ширину и отдаёт ширину колонки месяца, чтобы график занимал всю ширину; на узком экране — не уже 26 px на месяц с прокруткой внутри блока. */
function ChartBox({ n, children }: { n: number; children: (colW: number) => React.ReactNode }) {
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
  const colW = w > 0 ? Math.max(26, Math.min(80, Math.floor((w - 70) / Math.max(1, n)))) : 26;
  return <div ref={ref} className="w-full overflow-x-auto" data-keep-scroll>{children(colW)}</div>;
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

export function CashflowView({ incl, ex, salesBy, workBy, vat, services, initialPeriod, initialDetail, initialCat, initialSecond }: Props) {
  const [period, setPeriod] = useState<CashflowPeriod>(initialPeriod);
  const [exVat, setExVat] = useState(false);
  const [cat, setCat] = useState<Cat>(initialCat ?? "all");
  const [second, setSecond] = useState<"goods" | "workunit" | "work">(initialSecond ?? "goods");
  const [detail, setDetail] = useState(initialDetail ?? true);
  const [fOpen, setFOpen] = useState(false);
  const [open, setOpen] = useState<string[]>([]);
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
    const h = headline(d, s, revenue, cat === "all" ? undefined : ser.work);
    const g = goodsHeadline(sales, all.months, period);
    const last = keep.length ? keep[keep.length - 1] : -1;
    const wTot = ser.work.reduce((a, b) => a + b, 0), uTot = s.recPcs.reduce((a, b) => a + b, 0);
    const wu = { work: ser.work, units: s.recPcs, avg: sales.available && uTot > 0 && Math.abs(wTot) > 0.005 ? wTot / uTot : null };
    return { all, keep, d, s, revenue, ser, stock: pick(stAll.stock), h, g, wu, cumNetEnd: last >= 0 ? serAll.cumNet[last] : 0 };
  }, [exVat, period, cat, incl, ex, sales, salesBy.all, workBy]);
  const { d, s, ser, h, g } = m;
  const months = d.months;
  const hasSales = sales.available;
  const stockEnd = stockSeries(sales).stock.at(-1) ?? 0;
  const label = period === "all" ? "2025–2026" : period;
  const vatNote = exVat ? "без НДС" : "с НДС";
  const shownText = `${CAT_LABEL[cat]} · ${period === "all" ? "2025–2026" : period} · ${vatNote}`;
  const openFilters = () => { setFOpen(true); document.getElementById("cf-filters")?.scrollIntoView({ block: "start" }); };
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
  const td = "px-2 py-1.5 text-right text-sm tabular-nums whitespace-nowrap";
  const sticky = "sticky left-0 z-[1] text-left";
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

      <div id="cf-filters" className="sticky top-0 z-20 -mx-3 border-b border-neutral-300 bg-white/95 px-3 py-1 backdrop-blur print:hidden md:-mx-4 md:px-4">
        <button type="button" aria-expanded={fOpen} aria-controls="cf-filters-panel" onClick={() => setFOpen((v) => !v)} className="flex min-h-11 w-full items-center justify-between text-left text-sm md:hidden">
          <span><b>Фильтры:</b> {CAT_LABEL[cat]} · {period === "all" ? "2025–2026" : period} · {vatNote}</span><span aria-hidden>{fOpen ? "▴" : "▾"}</span>
        </button>
        <div id="cf-filters-panel" className={(fOpen ? "flex" : "hidden") + " flex-wrap items-center gap-2 pb-1 md:flex md:pb-0"}>
          <nav aria-label="Период" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
            {PERIODS.map(([k, t]) => <button key={k} type="button" aria-pressed={period === k} onClick={() => { setPeriod(k); clearHot(); }} className={seg(period === k)}>{t}</button>)}
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
      {exVat && vat.unknown > 0.5 && <p className="text-xs text-neutral-700">НДС нет в данных по {money(vat.unknown)} оплат (работа подрядчику, авансы без привязки к закупке): в режиме «Без НДС» они показаны как есть.</p>}

      {filtered && (
        <div role="note" className="rounded-lg border border-neutral-300 bg-white p-3 text-xs text-neutral-800">
          <p><b>Категория: {CAT_LABEL[cat]}.</b> Траты не делятся по категориям, показаны все{hasSales ? "; чистый поток и накопленный итог при фильтре не считаются" : ""}. Единицы, выручка, остаток, маржа и маркапы — только по {CAT_LABEL[cat].toLowerCase()}; работа подрядчика — по ТЗ → модель → группа категории.</p>
          <p className="mt-1">Охват классификации: единицы прихода — одежда {unitsBy.clothes} шт., аксессуары {unitsBy.acc} шт., без категории {unitsBy.other} шт. (категория берётся из Level 02 выгрузки). Работа: привязана к ТЗ {pctOf(workLinked, workTotalAll)}% суммы, из неё с категорией {pctOf(workClassified, workTotalAll)}% (всего {formatMoney(workTotalAll)}); неразнесённый аванс и ТЗ без группы в категориях не показаны, только в «Всё».</p>
        </div>
      )}

      <section aria-label="Ключевые показатели" className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Потрачено" value={money(h.spent)} sub={filtered ? "все траты, не по категории" : `${label}, ${vatNote}`} hint={<p>Все проведённые оплаты периода по дате платежа ({vatNote}).</p>} />
        <Tile label="Получено" value={hasSales ? money(h.received) : "—"} sub={hasSales ? `выручка, ${vatNote}` : "нет данных о продажах"}
          hint={<p>Розничная выручка из выгрузки продаж: чистые продажи после скидок, возвраты вычтены; по дате продажи. {noSalesNote}</p>} />
        <Tile label="Чистый денежный поток" value={hasSales && !filtered ? money(h.net) : "—"} tone={hasSales && !filtered ? (h.net < 0 ? "bad" : "good") : undefined} sub={filtered ? "траты не делятся по категориям" : hasSales ? (h.net < 0 ? "в минусе за период" : "в плюсе за период") : "нет данных о продажах"}
          hint={<p>Получено минус потрачено за период.</p>} />
        <Tile label="Накопленный итог" value={hasSales && !filtered ? money(m.cumNetEnd) : "—"} tone={hasSales && !filtered ? (m.cumNetEnd < 0 ? "bad" : "good") : undefined} sub={filtered ? "траты не делятся по категориям" : hasSales ? "с начала данных на конец периода" : "нет данных о продажах"}
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

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button type="button" aria-expanded={detail} onClick={() => setDetail((v) => !v)} className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm">{detail ? "Скрыть таблицу" : "Показать таблицу"}</button>
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
                    <td className={td + (hasSales && !filtered && net < -0.5 ? " text-[#b4310b]" : "")}>{hasSales && !filtered ? dash(net) : "—"}</td>
                    <td className={td + " border-l border-neutral-300"}>{dash(lastOf(r, ser.cumSpend))}</td>
                    <td className={td}>{hasSales ? dash(lastOf(r, ser.cumRevenue)) : "—"}</td>
                    <td className={td}>{hasSales && !filtered ? dash(lastOf(r, ser.cumNet)) : "—"}</td>
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

      <section aria-label="Деньги" className="rounded-lg border border-neutral-300 bg-white p-3">
        <div className="mb-2 min-h-[2.5rem] text-xs text-neutral-700" aria-live="polite">
          {active === null ? (
            <span>Наведите курсор или коснитесь месяца. Вверх — полученные деньги, вниз — траты по статьям, чёрная линия — чистый поток{hasSales ? "" : " (нет данных о продажах)"}.</span>
          ) : (
            <span><b>{full(months[active])}</b>: потрачено {dash(ser.spend[active])}{hasSales ? <>, получено {dash(ser.revenue[active])}{filtered ? null : `, чистый ${dash(ser.net[active])}`}</> : null}, накопительно потрачено {dash(ser.cumSpend[active])}{hasSales ? <>, получено {dash(ser.cumRevenue[active])}{filtered ? null : `, чистый ${dash(ser.cumNet[active])}`}</> : null}
              {d.articles.filter((a) => Math.abs(a.byMonth[active]) >= 0.5).map((a) => <span key={a.key}> · {a.label} {formatMoney(a.byMonth[active])}</span>)}</span>
          )}
        </div>
        <h2 className="mb-1 text-sm font-semibold">Траты и полученные деньги по месяцам</h2>
        <Shown text={shownText} onChange={openFilters} />
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
        <Shown text={shownText} onChange={openFilters} />
        <ChartBox n={months.length}>{(colW) => <Chart kind="cum" months={months} d={d} s={s} ser={ser} stock={m.stock} active={active} setActive={setActive} hot={hot} setHot={setHot} yearHot={yearHot} filtered={filtered} colW={colW} />}</ChartBox>
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
            <button type="button" aria-pressed={second === "workunit"} onClick={() => setSecond("workunit")} className={seg(second === "workunit")}>Работа на единицу</button>
            <button type="button" aria-pressed={second === "work"} onClick={() => setSecond("work")} className={seg(second === "work")}>Работа нарастающим итогом</button>
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
            {second === "workunit" && (
              <div className="mb-2 min-h-[2.5rem] text-xs text-neutral-700" aria-live="polite">
                {active === null ? (
                  <span>Наведите курсор или коснитесь месяца: появятся единицы, работа за месяц, работа на единицу и среднее за период. {m.wu.avg === null ? "Нет прихода или оплат работы за период." : `Среднее за период: ${formatMoney(m.wu.avg)} на единицу.`}</span>
                ) : (
                  <span><b>{full(months[active])}</b>: получено {m.wu.units[active]} шт., работа за месяц {dash(m.wu.work[active])}, на единицу {m.wu.units[active] > 0 ? dash(m.wu.work[active] / m.wu.units[active]) : "— (нет прихода)"}, среднее за период {dash(m.wu.avg)}</span>
                )}
              </div>
            )}
            <ChartBox n={months.length}>
              {(colW) => second === "workunit" ? <WorkUnitChart months={months} wu={m.wu} active={active} setActive={setActive} colW={colW} /> : <Chart kind={second} months={months} d={d} s={s} ser={ser} stock={m.stock} active={active} setActive={setActive} hot={hot} setHot={setHot} yearHot={yearHot} filtered={filtered} colW={colW} />}
            </ChartBox>
            {second === "goods" ? (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
                <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: NAVY }} />Приход, шт.</li>
                <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: GET }} />Продано, шт.</li>
                <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-0.5 w-4" style={{ background: STOCK }} />Остаток нарастающим итогом, шт.</li>
              </ul>
            ) : second === "workunit" ? (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
                <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: NAVY }} />Единиц получено</li>
                <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-0.5 w-4" style={{ background: SPEND }} />Работа за месяц</li>
                <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ background: STOCK }} />Работа на единицу за месяц</li>
                <li className="inline-flex min-h-11 items-center gap-1.5 px-2"><span aria-hidden className="inline-block h-0.5 w-4 border-t-2 border-dashed border-neutral-900" />Среднее за период</li>
                <li className="inline-flex min-h-11 items-center px-2"><InfoHint label="Как читать" wide><p>Работа на единицу за месяц = оплаты подрядчику за месяц ÷ единицы, полученные в этом месяце. Оплата и поступление могут приходиться на разные месяцы (аванс за будущую партию), поэтому месяцы шумные; среднее за период = вся оплаченная работа ÷ все полученные единицы.{filtered ? " При фильтре работа берётся только по ТЗ выбранной категории." : ""}</p></InfoHint></li>
              </ul>
            ) : <p className="mt-2 text-xs text-neutral-700">Накопленная оплата работы ÷ накопленные полученные единицы, ₽ ({vatNote}). До первого прихода линии нет.</p>}
          </>
        ) : <p className="text-sm text-neutral-700">{noSalesNote}</p>}
      </section>

      <p className="text-sm"><Link href="/analytics/margin" className="inline-flex min-h-11 items-center underline">Маржа и наценка → в Изделиях</Link></p>

      <p className="text-xs text-neutral-600 print:hidden">Оплаты по статьям и документам — в разделе <Link href="/payments" className="underline">«Оплаты»</Link>.</p>
    </div>
  );
}
