"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";
import { SEG_GROUP, segCls } from "@/components/segmented";
import { toCsv } from "@/lib/csv";
import { saveBase64Xlsx } from "@/lib/download-xlsx";
import { alignColumn } from "@/lib/money-round";
import { exportCashflowXlsx } from "../actions";
import { InfoHint } from "@/components/info-hint";
import { CAT_LABEL, type CatClass } from "@/lib/sales-receipts-core";
import { ExpTable, PriceDetail, RecvDetail, SpendDetail } from "../drill";
import { PROJECT_START_MONTH, workMonthIdx, cashflowYears } from "@/lib/cashflow";
import { PAY_TYPE_LABEL, spendByType, workKindsByMonth, type PayType, flowPoints, workWindowStats, groupSales, type PayLite } from "@/lib/cashflow-detail";
import type { SalesAggLine } from "@/lib/sales-receipts-core";
import { cumWorkPerUnit, goodsHeadline, headline, seriesOf, type WorkByClass, sliceData, sliceSales, stockSeries, visibleMonths, type CashflowData, type CashflowPeriod, type SalesMonthly, type PrepaidItem } from "@/lib/cashflow";
import { SPEND, GET, NAVY, full, dash, pcs, type Ser, type CumStyle, KIND_COLOR, KIND_ORDER, Spark, type Page } from "./shared";
import { Chart, WorkMonthsChart, CarouselTile } from "./chart";
import { ClassicTable } from "./classic-table";

type Cat = "all" | "clothes" | "acc";

type Props = { prepaid: number; prepaidBy: Record<string, number>; prepaidList: PrepaidItem[]; incl: CashflowData; ex: CashflowData; salesBy: Record<CatClass | "all", SalesMonthly>; workBy: WorkByClass; workByEx: WorkByClass; pays: PayLite[]; saleLines: SalesAggLine[]; nowMonth: string; initialGroup?: "period" | "category"; vat: { vat: number; unknown: number; total: number }; initialPeriod: CashflowPeriod; /** Для проверок вёрстки. */ initialCat?: Cat; /** Для проверок вёрстки: таблица открыта сразу. */ initialDetail?: boolean };

/** Переключатель вида накопительного графика: столбцы (основной) / линии. */
function CumStyleSwitch({ value, onChange, seg }: { value: CumStyle; onChange: (v: CumStyle) => void; seg: (on: boolean) => string }) {
  return (
    <div role="group" aria-label="Вид накопительного графика" className={SEG_GROUP + " print:hidden"}>
      {([["bars", "Столбцы"], ["lines", "Линии"]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className={seg(value === k)}>{t}</button>)}
    </div>
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

const rubOrDash = (v: number | null) => (v === null || Math.abs(v) < 0.5 ? "–" : formatMoney(v));

type WorkBy = Record<"all" | "clothes" | "acc", { work: number[]; units: number[] }>;

/** Сегмент «Все · Одежда · Аксессуары» внутри окна: по умолчанию = глобальный фильтр, переопределяется локально. «Прочее / без привязки к ТЗ» входит только в «Все». */
function CatSwitch({ cat, setCat }: { cat: "all" | "clothes" | "acc"; setCat: (c: "all" | "clothes" | "acc") => void }) {
  const seg = (on: boolean) => segCls(on);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Категория" className={SEG_GROUP}>
        {(["all", "clothes", "acc"] as const).map((k) => <button key={k} type="button" aria-pressed={cat === k} onClick={() => setCat(k)} className={seg(cat === k)}>{CAT_LABEL[k]}</button>)}
      </div>
    </div>
  );
}

/** Таблица по месяцам проекта: все N месяцев подряд, нули — прочерк. */
function MonthRows({ months, work, units, st }: { months: string[]; work: number[]; units: number[]; st: ReturnType<typeof workWindowStats> }) {
  const n1 = (v: number | null) => (v === null || v === 0 ? "–" : v.toLocaleString("ru-RU", { maximumFractionDigits: 1 }));
  return (
    <div className="w-full min-w-0 overflow-x-auto rounded-lg border border-neutral-300" data-keep-scroll tabIndex={0}>
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-b border-neutral-300">{["Месяц", "Работа, ₽", "Единиц получено", "Работа на единицу, ₽"].map((h, k) => <th key={h} scope="col" className={"px-2 py-2 text-xs font-semibold " + (k === 0 ? "text-left" : "text-right")}>{h}</th>)}</tr></thead>
        <tbody>
          {months.map((mo, i) => (
            <tr key={mo} className="border-b border-neutral-200">
              <td className="px-2 py-1.5">{mo}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{rubOrDash(work[i])}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{units[i] || "–"}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{units[i] > 0 ? rubOrDash(work[i] / units[i]) : "–"}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-neutral-400 font-semibold"><td className="px-2 py-1.5">Итого</td><td className="px-2 py-1.5 text-right tabular-nums">{rubOrDash(st.total)}</td><td className="px-2 py-1.5 text-right tabular-nums">{st.unitsTotal || "–"}</td><td className="px-2 py-1.5 text-right tabular-nums">{rubOrDash(st.perUnit)}</td></tr>
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
  const n1 = (v: number | null) => (v === null || v === 0 ? "–" : v.toLocaleString("ru-RU", { maximumFractionDigits: 1 }));
  return (
    <div className="flex flex-col gap-4">
      <CatSwitch cat={cat} setCat={setCat} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Stat label="Единиц получено, шт." value={st.unitsTotal ? String(st.unitsTotal) : "–"} />
        <Stat label="Месяцев проекта" value={String(st.n)} />
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
  const catLine = (c: ReturnType<typeof workWindowStats>) => (c.perUnit === null ? "–" : `${rubOrDash(c.perUnit)} · ${c.unitsTotal} шт.`);
  return (
    <div className="flex flex-col gap-4">
      <CatSwitch cat={cat} setCat={setCat} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <div className="col-span-2 rounded-lg border border-neutral-300 p-3 md:col-span-1">
          <div className="text-xs text-neutral-600">Работа на единицу (оплачено ÷ получено)</div>
          <div className="text-lg font-semibold tabular-nums">{rubOrDash(st.perUnit)}</div>
          <dl className="mt-1 flex flex-col gap-0.5 border-t border-neutral-200 pt-1 text-xs">
            <div className="flex justify-between gap-2"><dt className="text-neutral-600">Одежда</dt><dd className="font-semibold tabular-nums">{catLine(c1)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-neutral-600">Аксессуары</dt><dd className="font-semibold tabular-nums">{catLine(c2)}</dd></div>
          </dl>
        </div>
        <Stat label="Единиц всего" value={st.unitsTotal ? String(st.unitsTotal) : "–"} sub={`месяцев проекта ${st.n}`} />
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

function Tile({ label, value, sub, hint, tone, mini, spark, extra, after, controls, expandId, onToggle }: { /** Свои элементы управления внутри плитки (например «С НДС | Без НДС»). */ controls?: React.ReactNode; /** Второй блок под мини-строками: подпись, значение, мини-строки (деньги после количеств). */ after?: { label: string; value: string; mini?: [string, string][] }; label: string; value: string; sub?: string; hint?: React.ReactNode; tone?: "bad" | "good"; /** Две мини-строки «Одежда … / Аксессуары …» со своими значениями. */ mini?: [string, string][]; spark?: number[]; extra?: string; expandId?: string; /** устарело, не используется */ openId?: string | null; onToggle?: (id: string) => void }) {
  const clickable = !!expandId && !!onToggle;
  return (
    <div className={"relative flex min-w-0 flex-col rounded-lg border border-neutral-300 bg-white" + (clickable ? " tile-click [&::after]:!bottom-auto [&::after]:!right-[1.7rem] [&::after]:!top-[0.65rem]" : "")}>
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
            {mini.map(([k, v]) => <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-2"><dt className="min-w-0 text-neutral-600">{k}</dt><dd className="ml-auto font-semibold tabular-nums whitespace-nowrap text-neutral-900">{v}</dd></div>)}
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

export function CashflowView({ prepaid, prepaidBy, prepaidList, incl, ex, salesBy, workBy: workByIncl, workByEx, pays, saleLines, nowMonth, initialGroup, vat, initialPeriod, initialDetail, initialCat }: Props) {
  const [period, setPeriod] = useState<CashflowPeriod>(initialPeriod);
  // НДС — один, общий (шапка): отдельных переключателей на странице нет
  const { mode: vatMode } = useVatDisplay();
  const exVat = vatMode === "excl";
  const workBy = exVat ? workByEx : workByIncl;
  const [cat, setCat] = useState<Cat>(initialCat ?? "all");
  const [gTable, setGTable] = useState(false);
  const [detail, setDetail] = useState(initialDetail ?? true);
  const [fOpen, setFOpen] = useState(false);
  const [gActive, setGActive] = useState<number | null>(null);
  const [openMonths, setOpenMonths] = useState<string[]>([]);
  const [openTile, setOpenTile] = useState<string | null>(null);
  const toggleTile = (id: string) => { setOpenTile(id); };
  const [open, setOpen] = useState<string[]>([]);
  const [group, setGroupState] = useState<"period" | "category">(initialGroup ?? "period");
  const [catOpen, setCatOpen] = useState<string[]>([]);
  const setGroup = (g: "period" | "category") => { setGroupState(g); const u = new URL(window.location.href); if (g === "period") u.searchParams.delete("group"); else u.searchParams.set("group", g); window.history.replaceState(null, "", u.toString()); };
  const [active, setActive] = useState<number | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [yearHot, setYearHot] = useState<string | null>(null);
  const [hotLine, setHotLine] = useState<string | null>(null);
  const [cumStyle, setCumStyle] = useState<CumStyle>("bars");
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
  const mini = (f: (c: "clothes" | "acc") => string): [string, string][] => [["Одежда", hasSales ? f("clothes") : "–"], ["Аксессуары", hasSales ? f("acc") : "–"]];
  const soText = (x: { cumReceived: number; cumSold: number; sellThrough: number | null }) => (x.sellThrough === null ? "–" : x.sellThrough.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " %" + (x.cumSold > x.cumReceived ? "*" : x.cumReceived < 10 ? "†" : ""));
  const stockEnd = stockSeries(sales).stock.at(-1) ?? 0;
  const label = period === "all" ? "2025–2026" : period;
  const vatNote = exVat ? "без НДС" : "с НДС";
  const stockBy = useMemo(() => ({ clothes: stockSeries(salesBy.clothes).stock, acc: stockSeries(salesBy.acc).stock, other: stockSeries(salesBy.other).stock }), [salesBy]);
  /** Месяц по категориям: выручка выбранного режима НДС, единицы прихода и продажи, остаток, работа подрядчика по ТЗ; траты по категориям не делятся. */
  const clsMonth = (c: "clothes" | "acc" | "other", gi: number) => ({ rev: (exVat ? salesBy[c].revEx : salesBy[c].revIncl)[gi], rec: salesBy[c].recPcs[gi], sale: salesBy[c].salePcs[gi], stock: stockBy[c][gi], work: workBy[c][gi] });
  /** Виды платежей на плитке «Оплачено»: аванс / доплата / окончательный расчёт / прочее; Σ = главное число. */
  const spendKinds = useMemo(() => (Object.keys(PAY_TYPE_LABEL) as PayType[]).filter((t) => Math.abs(spendByType(pays, months, exVat).find((r) => r.type === t)?.total ?? 0) > 0.5).map((t) => ({ type: t, short: t === "ADVANCE" ? "Авансы" : t === "PARTIAL" ? "Доплаты" : t === "FINAL" ? "Окончательный расчёт" : "Прочее / без вида", total: spendByType(pays, months, exVat).find((r) => r.type === t)?.total ?? 0 })), [pays, months, exVat]);
  // Части сходятся с итогом «Оплачено» до рубля, а доли — ровно в 100 % (наибольшие остатки), как в плитках Главной.
  const pctSplit = (vals: number[]) => { const tot = vals.reduce((a, v) => a + v, 0); const raw = vals.map((v) => (tot > 0.5 ? (v / tot) * 100 : 0)); const fl = raw.map(Math.floor); let left = Math.round(raw.reduce((a, v) => a + v, 0)) - fl.reduce((a, v) => a + v, 0); raw.map((v, k) => [v - Math.floor(v), k] as const).sort((x, y) => y[0] - x[0]).forEach(([, k]) => { if (left > 0) { fl[k] += 1; left -= 1; } }); return fl; };
  const spendAl = alignColumn(spendKinds.map((r) => r.total), h.spent);
  const spendPct = pctSplit(spendAl.values);
  /** Метрики работы: месяцы от PROJECT_START_MONTH до текущего включительно (в границах периода); по категориям — работа по ТЗ и приход категории. */
  const wm = useMemo(() => {
    const cf = exVat ? ex : incl; // «Без НДС»: работа без НДС, как в таблице и как выручка
    const idx = workMonthIdx(cf.months, nowMonth, period);
    const pick = (a: number[]) => idx.map((i) => a[i]);
    const workAllSeries = cf.articles.find((a) => a.key === "work")?.byMonth ?? cf.months.map(() => 0);
    const by = { all: { work: pick(workAllSeries), units: pick(salesBy.all.recPcs) }, clothes: { work: pick(workBy.clothes), units: pick(salesBy.clothes.recPcs) }, acc: { work: pick(workBy.acc), units: pick(salesBy.acc.recPcs) } };
    return { months: idx.map((i) => cf.months[i]), by, st: { all: workWindowStats(by.all.work, by.all.units, [], "all"), clothes: workWindowStats(by.clothes.work, by.clothes.units, [], "all"), acc: workWindowStats(by.acc.work, by.acc.units, [], "all") } };
  }, [incl, ex, exVat, nowMonth, period, salesBy, workBy]);
  const modalExEff = exVat;
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
    const head = ["Период", ...artCols.map((c) => `${c.head}: ${c.sub}`), "Оплачено", "Выручка", "Чистый поток", "Накопительно оплачено", "Накопительно получено", "Накопительно чистый", "Единиц получено", "Единиц продано", "Остаток, шт.", "Работа за период", "Работа на единицу"];
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
      const head = ["Период", ...artCols.map((c) => `${c.head}: ${c.sub}`), "Оплачено", "Выручка", "Чистый поток", "Накопительно оплачено", "Накопительно получено", "Накопительно чистый", "Единиц получено", "Единиц продано", "Остаток, шт.", "Работа за период", "Работа на единицу"];
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
  const money = (v: number) => (Math.abs(v) < 0.5 ? "–" : formatMoney(v));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3">
        <h1 className="text-xl font-semibold">Cashflow</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-3 text-xs print:hidden"><Link href="/payments" className="text-blue-700 hover:underline">→ Оплаты</Link><Link href="/sales" className="text-blue-700 hover:underline">→ Продажи</Link></span>
          <InfoHint label="Что такое Cashflow" align="right" wide>
            <p><b>Оплачено</b> — все проведённые оплаты («Оплачено» в разделе «Оплаты») по статьям и по дате платежа. Запланированные и неподтверждённые платежи не входят. Итог за 2025–2026 равен «Оплачено всего» (с НДС).</p>
            <p className="mt-1">На странице «Оплаты» годы для закупок вне аукциона считаются по году закупки, а здесь — по дате платежа, поэтому по годам суммы могут отличаться, итог и месяцы те же.</p>
            <p className="mt-1"><b>Выручка</b> — розничная выручка из выгрузки продаж по дате продажи (чистая, после скидок, возвраты вычтены), а не движение по расчётному счёту.</p>
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
        </div>
      </div>

      <section aria-label="Ключевые показатели" className="grid grid-cols-1 items-stretch gap-2 min-[480px]:grid-cols-2 min-[1100px]:grid-cols-4">
        <CarouselTile label="Оплачено" onOpen={() => toggleTile("spend")} pages={[
          { label: "Оплачено", value: money(h.spent), spark: ser.spend, rows: spendKinds.map((r, i) => [r.short, `${money(spendAl.values[i])} · ${spendPct[i]} %`] as [string, string]), hint: <p>Все проведённые оплаты периода по дате платежа ({vatNote}).</p> },
        ]} />
        <Tile label="Выручка" value={hasSales ? money(recvSum(cat, exVat)) : "–"} sub={hasSales ? undefined : "нет данных о продажах"} spark={hasSales ? m.keep.map((i) => (exVat ? salesBy[cat].revEx[i] : salesBy[cat].revIncl[i])) : undefined}
          mini={mini((c) => `${money(recvSum(c, exVat))} · ${recvSum(cat, exVat) ? Math.round((recvSum(c, exVat) / recvSum(cat, exVat)) * 100) : 0} %`)} expandId={hasSales ? "recv" : undefined} onToggle={toggleTile}
          hint={<p>Розничная выручка из выгрузки продаж: чистые продажи после скидок, возвраты вычтены; по дате продажи; режим НДС — как в панели фильтров (внутри окна его можно переключить только для окна). Доля — от выручки всех категорий. {noSalesNote}</p>} />
        {hasSales && !filtered ? (
          <CarouselTile onOpen={() => toggleTile("flow")} pages={[
            { label: "Чистый денежный поток", value: money(h.net), tone: h.net < 0 ? "bad" : "good", spark: ser.net, sparkKind: "bars", hint: <p>Выручка минус оплачено за период, на одной базе НДС — как в панели фильтров ({vatNote}): «с НДС» — движение денег, «без НДС» — экономика.</p> },
            ...(money(m.cumNetEnd) === money(h.net) ? [] : [{ label: "Накопленный итог", value: money(m.cumNetEnd), tone: m.cumNetEnd < 0 ? "bad" : "good", spark: ser.cumNet, sparkKind: "area", hint: <p>Выручка минус оплачено нарастающим итогом с первого месяца данных до конца выбранного периода.</p> } satisfies Page]),
          ]} />
        ) : (
          <Tile label="Чистый поток / накопленный итог" value="–" sub={filtered ? "не делится по категориям" : "нет данных о продажах"} hint={<p>Чистый денежный поток = получено − оплачено; накопленный итог — то же нарастающим итогом. При фильтре по категории траты не делятся, поэтому не считаются.</p>} />
        )}
        <CarouselTile label="Работа в месяц" initial={pageOf[cat]} onOpen={(k) => openFor("workMonth", k)} pages={catPages.map((c) => { const st = wm.st[c]; return {
          label: `Работа в месяц · ${c === "all" ? "Всего" : CAT_LABEL[c]}`,
          value: st.avgUnits === null || st.avgUnits === 0 ? "–" : `${st.avgUnits.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} шт./мес.`,
          rows: [["Работа в месяц, ₽", rubOrDash(st.avgMonth)]] as [string, string][],
          hint: <p>Штук в месяц = единицы, полученные за период, ÷ число календарных месяцев проекта (общее число единиц, не среднее средних). Работа в месяц = вся работа подрядчику ÷ те же месяцы; по категориям — работа по ТЗ категории и приход категории ÷ N (работа без привязки к ТЗ — только в «Тотал»). Месяцы: от августа 2025 (первая оплата работы) до текущего включительно, в границах периода: {st.n} мес.; в расчёт входят и месяцы без работы и поставок, текущий месяц неполный.</p>,
        }; })} />
        <CarouselTile label="Работа на единицу" initial={pageOf[cat]} onOpen={(k) => openFor("workUnit", k)} pages={catPages.map((c) => { const st = wm.st[c]; return {
          label: `Работа на единицу · ${c === "all" ? "Всего" : CAT_LABEL[c]}`,
          value: rubOrDash(st.perUnit),
          sub: hasSales ? undefined : "нет данных о приходе",
          hint: <p>Вся работа подрядчику за период ÷ все единицы, полученные за период (без привязки к месяцам). Это оценка: оплата и поступление могут приходиться на разные месяцы (аванс за будущее). По категориям — работа по ТЗ категории ÷ приход категории.</p>,
        }; })} />
        {hasSales ? (
          <CarouselTile label="Средняя цена продажи" initial={pageOf[cat]} onOpen={(k) => openFor("price", k)} pages={catPages.map((c) => { const g = groupSales(saleLines, months, exVat, () => "x", c)[0]; return {
            label: `Средняя цена продажи · ${c === "all" ? "Всего" : CAT_LABEL[c]}`,
            value: g && g.pcs > 0 ? formatMoney(g.rev / g.pcs) : "–",
            sub: g && g.pcs > 0 ? `${pcs(g.pcs)} шт. продано` : "нет продаж",
            rows: [["Выручка", g ? money(g.rev) : "–"], ["Выручка в среднем в месяц (по месяцам с продажами)", g ? money(g.rev / Math.max(1, m.keep.filter((i) => (exVat ? salesBy[c].revEx[i] : salesBy[c].revIncl[i]) > 0.5).length)) : "–"]] as [string, string][],
            hint: <p>Выручка ({vatNote}) ÷ проданные единицы (возвраты минус) за выбранный период и категорию; режим НДС — как в панели (в окне его можно переключить только для окна).</p>,
          }; })} />
        ) : <Tile label="Средняя цена продажи" value="–" sub="нет данных о продажах" />}
      </section>

      {openTile && (
        <TileModal title={{ spend: "Оплачено", recv: "Выручка", flow: "Денежный поток по месяцам", workMonth: "Работа в месяц", workUnit: "Работа на единицу", price: "Средняя цена продажи" }[openTile] ?? ""} subtitle={openTile === "recv" || openTile === "price" ? shownText.replace(/с НДС|без НДС/, modalExEff ? "без НДС" : "с НДС") : shownText} onClose={() => { setOpenTile(null); }}>
          {openTile === "spend" && <SpendDetail pays={pays} months={months} exVat={exVat} d={d} total={h.spent} />}
          {openTile === "recv" && <RecvDetail lines={saleLines} months={months} exVat={modalExEff} cat={catArg} total={recvSum(cat, modalExEff)} />}
          {openTile === "flow" && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-neutral-800">
                {fp.firstPositive ? `Первый месяц с положительным потоком: ${monthLabel(fp.firstPositive)}. ` : "Месяцев с положительным потоком нет. "}
                Самый глубокий накопленный минус: {money(fp.deepest.cum)} ({monthLabel(fp.deepest.month)}). Максимальная просадка накопленного итога от пика: {money(fp.drawdown)}.
              </p>
              <ExpTable head={["Месяц", "Оплачено", "Выручка", "Чистый", "Накопленный"]} rows={months.map((mo, i) => ({ id: mo, cells: [monthLabel(mo), money(ser.spend[i]), money(ser.revenue[i]), money(ser.net[i]), money(ser.cumNet[i])], sub: (["clothes", "acc", "other"] as const).map((c) => [CAT_LABEL[c], "–", money(clsMonth(c, m.keep[i]).rev), "–", "–"]).filter((r) => r[2] !== "–") }))} total={["Итого", money(h.spent), money(h.received), money(h.net), money(m.cumNetEnd)]} />
            </div>
          )}
          {openTile === "workMonth" && <WorkMonthWindow months={wm.months} by={wm.by} initialCat={winCat} />}
          {openTile === "workUnit" && <WorkUnitWindow months={wm.months} by={wm.by} initialCat={winCat} />}
          {openTile === "price" && <PriceDetail lines={saleLines} months={months} exVat={modalExEff} cat={winCat} />}
        </TileModal>
      )}

      <ClassicTable period={period} title="Cashflow, ₽" months={months} d={d} ser={ser} hasSales={hasSales} filtered={filtered} detail={detail} setDetail={setDetail} hot={hot} setHot={setHot} active={active} setActive={setActive} yearHot={yearHot} setYearHot={setYearHot} vatPay={vatPay} vatRev={vatRev} prepaid={months.map((mo) => prepaidBy[mo] ?? 0)} prepaidList={prepaidList} hasVat={hasSales} />

      <section aria-label="Деньги и оплаты" className="rounded-lg border border-neutral-300 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{chartView === "money" ? "Оплаты и полученные деньги по месяцам" : "Оплаты по видам платежа"}</h2>
          <div role="group" aria-label="График" className={SEG_GROUP + " print:hidden"}>
            {([["money", "Оплаты и выручка"], ["kinds", "Виды оплаты"]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={chartView === k} onClick={() => setChartView(k)} className={seg(chartView === k)}>{t}</button>)}
          </div>
        </div>
        {chartView === "money" ? (
          <>
        <ChartBox n={months.length}>{(colW) => <Chart kind="money" hotLine={hotMoney} months={months} d={d} s={s} ser={ser} stock={m.stock} active={active} setActive={setActive} hot={hot} setHot={setHot} yearHot={yearHot} filtered={filtered} colW={colW} />}</ChartBox>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
          <li><button type="button" aria-pressed={hotMoney === "spend"} onMouseEnter={() => setHotMoney("spend")} onMouseLeave={() => setHotMoney(null)} onFocus={() => setHotMoney("spend")} onBlur={() => setHotMoney(null)} onClick={() => setHotMoney(hotMoney === "spend" ? null : "spend")} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: SPEND }} />Оплачено за месяц (вниз)</button></li>
          <li><button type="button" aria-pressed={hotMoney === "get"} onMouseEnter={() => setHotMoney("get")} onMouseLeave={() => setHotMoney(null)} onFocus={() => setHotMoney("get")} onBlur={() => setHotMoney(null)} onClick={() => setHotMoney(hotMoney === "get" ? null : "get")} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: GET }} />Выручка за месяц (вверх)</button></li>
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
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1 text-sm font-semibold">Накопительно: оплачено и выручка
            <InfoHint label="Как читать накопительный график" wide><p>Каждый месяц — итог с первого месяца данных: красный столбец вниз — сколько оплачено, зелёный вверх — сколько получено. Число над столбцом — чистый итог (получено − оплачено): зелёное «+» — в плюсе, красное «−» — в минусе. Кнопка «Линии» показывает то же линиями.</p></InfoHint>
          </h2>
          <CumStyleSwitch value={cumStyle} onChange={setCumStyle} seg={seg} />
        </div>
        <ChartBox n={months.length} extra={cumStyle === "lines" ? 142 : 70}>{(colW) => <Chart kind="cum" cumStyle={cumStyle} hotLine={hotLine} months={months} d={d} s={s} ser={ser} stock={m.stock} active={active} setActive={setActive} hot={hot} setHot={setHot} yearHot={yearHot} filtered={filtered} colW={colW} />}</ChartBox>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
          {([["spend", SPEND, cumStyle === "bars" ? "Оплачено нарастающим итогом (вниз)" : "Оплачено нарастающим итогом", false], ["get", GET, cumStyle === "bars" ? "Выручка нарастающим итогом (вверх)" : "Выручка нарастающим итогом", true], ["net", NAVY, cumStyle === "bars" ? "Чистый итог" : "Чистый итог", true]] as const).filter((x) => x[0] === "spend" || (hasSales && (x[0] === "get" || !filtered))).map(([k, c, t]) => (
            <li key={k}><button type="button" aria-pressed={hotLine === k} onMouseEnter={() => setHotLine(k)} onMouseLeave={() => setHotLine(null)} onFocus={() => setHotLine(k)} onBlur={() => setHotLine(null)} onClick={() => setHotLine(hotLine === k ? null : k)} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2">{cumStyle === "bars" ? k === "net" ? <span aria-hidden className="inline-block w-3 text-center text-xs font-bold leading-none">±</span> : <span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: c }} /> : <span aria-hidden className={"inline-block h-0.5 w-4 " + (k === "net" ? "border-t-2 border-dashed" : "")} style={k === "net" ? { borderColor: c } : { background: c }} />}{t}</button></li>
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
                <li><button type="button" aria-pressed={hotKind === "units"} onMouseEnter={() => setHotKind("units")} onMouseLeave={() => setHotKind(null)} onFocus={() => setHotKind("units")} onBlur={() => setHotKind(null)} onClick={() => setHotKind(hotKind === "units" ? null : "units")} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ background: NAVY }} />Приход, шт.</button></li>
              </ul>
            </div>

          </>
        ) : <p className="text-sm text-neutral-700">{noSalesNote}</p>}
      </section>


    </div>
  );
}
