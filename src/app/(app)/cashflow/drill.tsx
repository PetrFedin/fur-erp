"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/utils";
import { CASHFLOW_ARTICLES, type ArticleKey, type CashflowData } from "@/lib/cashflow";
import { groupSales, spendByArticle, spendByType, topPays, workByTz, type PayLite } from "@/lib/cashflow-detail";
import { CAT_LABEL, type CatClass, type SalesAggLine } from "@/lib/sales-receipts-core";

const money = (v: number) => (Math.abs(v) < 0.5 ? "—" : formatMoney(v));
const dmy = (iso: string) => iso.split("-").reverse().join(".");
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
export const monthLabel = (mo: string) => `${MONTHS[Number(mo.slice(5, 7)) - 1]} ${mo.slice(0, 4)}`;

export function MiniTable({ head, rows, total }: { head: string[]; rows: React.ReactNode[][]; total?: React.ReactNode[] }) {
  return (
    <div className="w-full min-w-0 overflow-x-auto rounded-lg border border-neutral-300" data-keep-scroll tabIndex={0}>
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-b border-neutral-300">{head.map((h, i) => <th key={h + i} scope="col" className={"px-2 py-2 text-xs font-semibold " + (i === 0 ? "text-left" : "text-right")}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, ri) => <tr key={ri} className="border-b border-neutral-200">{r.map((c, i) => <td key={i} className={"px-2 py-1.5 tabular-nums " + (i === 0 ? "text-left" : "text-right whitespace-nowrap")}>{c}</td>)}</tr>)}
          {total ? <tr className="border-t-2 border-neutral-400 font-semibold">{total.map((c, i) => <td key={i} className={"px-2 py-1.5 tabular-nums " + (i === 0 ? "text-left" : "text-right whitespace-nowrap")}>{c}</td>)}</tr> : null}
        </tbody>
      </table>
    </div>
  );
}

export type ExpRow = { id: string; cells: React.ReactNode[]; sub?: React.ReactNode[][] };
/** Таблица по месяцам: строка раскрывается шевроном справа (aria-expanded, ≥44px) на подстроки «Одежда / Аксессуары / Прочее». */
export function ExpTable({ head, rows, total }: { head: string[]; rows: ExpRow[]; total?: React.ReactNode[] }) {
  const [open, setOpen] = useState<string[]>([]);
  return (
    <div className="w-full min-w-0 overflow-x-auto rounded-lg border border-neutral-300" data-keep-scroll tabIndex={0}>
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-b border-neutral-300">{head.map((h, i) => <th key={h + i} scope="col" className={"px-2 py-2 text-xs font-semibold " + (i === 0 ? "text-left" : "text-right")}>{h}</th>)}<th scope="col" className="w-11"><span className="sr-only">По категориям</span></th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.includes(r.id);
            return (
              <Fragment key={r.id}>
                <tr className="border-b border-neutral-200">
                  {r.cells.map((c, i) => <td key={i} className={"px-2 py-1.5 tabular-nums " + (i === 0 ? "text-left" : "text-right whitespace-nowrap")}>{c}</td>)}
                  <td className="w-11 text-right">{r.sub ? <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Показать"} по категориям: ${String(r.cells[0])}`} onClick={() => setOpen(isOpen ? open.filter((x) => x !== r.id) : [...open, r.id])} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md">{isOpen ? "▴" : "▾"}</button> : null}</td>
                </tr>
                {isOpen && r.sub?.map((sc, si) => (
                  <tr key={r.id + si} className="border-b border-neutral-100 bg-neutral-50 text-xs">
                    {sc.map((c, i) => <td key={i} className={"px-2 py-1.5 tabular-nums " + (i === 0 ? "pl-6 text-left" : "text-right whitespace-nowrap")}>{c}</td>)}
                    <td />
                  </tr>
                ))}
              </Fragment>
            );
          })}
          {total ? <tr className="border-t-2 border-neutral-400 font-semibold">{total.map((c, i) => <td key={i} className={"px-2 py-1.5 tabular-nums " + (i === 0 ? "text-left" : "text-right whitespace-nowrap")}>{c}</td>)}<td /></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

/** Выбираемые чипы (одна выбрана), цель касания ≥44px. */
function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      {options.map(([k, t]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          className={"inline-flex min-h-11 items-center rounded-full border px-3 text-xs " + (value === k ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700")}>{t}</button>
      ))}
    </div>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values, 0), hi = Math.max(...values, 1), W = 100, H = 28;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - 2 - ((v - lo) / (hi - lo || 1)) * (H - 4)}`).join(" ");
  return <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-7 w-full" role="img" aria-label="Динамика по месяцам"><polyline points={pts} fill="none" stroke="#d93a0e" strokeWidth={1.5} vectorEffect="non-scaling-stroke" /></svg>;
}

/** «Потрачено»: все статьи или выбранная статья — по видам платежа (сумма, доля, число), по месяцам и список платежей. */
export function SpendDetail({ pays, months, exVat, d, total }: { pays: PayLite[]; months: string[]; exVat: boolean; d: CashflowData; total: number }) {
  const [sel, setSel] = useState<"all" | ArticleKey>("all");
  const [sort, setSort] = useState<"date" | "amount">("date");
  const det = useMemo(() => (sel === "all" ? null : spendByArticle(pays, months, exVat, sel)), [pays, months, exVat, sel]);
  const opts: ["all" | ArticleKey, string][] = [["all", "Все статьи"], ...d.articles.map((a) => [a.key, a.label] as ["all" | ArticleKey, string])];
  if (!det) {
    return (
      <div className="flex flex-col gap-4">
        <Chips label="Статья" value={sel} options={opts} onChange={setSel} />
        <div className="grid gap-4 md:grid-cols-2">
          <MiniTable head={["Статья", "Сумма"]} rows={d.articles.map((a) => [a.label, money(a.total)])} total={["Итого", money(total)]} />
          <MiniTable head={["Вид платежа", "Сумма"]} rows={spendByType(pays, months, exVat).map((r) => [r.label, money(r.total)])} total={["Итого", money(total)]} />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold">Пять крупнейших платежей</p>
          <MiniTable head={["Дата", "За что", "Документ", "Сумма"]} rows={topPays(pays, months, exVat).map((p) => [dmy(p.iso), <Link key={p.id} href={p.href} className="underline">{p.label}</Link>, p.doc ?? "—", money(exVat ? p.ex : p.amount)])} />
        </div>
      </div>
    );
  }
  const list = [...det.list].sort((a, b) => (sort === "date" ? b.pay.iso.localeCompare(a.pay.iso) : b.amount - a.amount));
  return (
    <div className="flex flex-col gap-4">
      <Chips label="Статья" value={sel} options={opts} onChange={setSel} />
      <p className="text-sm font-semibold">{CASHFLOW_ARTICLES.find((a) => a.key === sel)?.label}: {money(det.total)}, платежей {det.list.length}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <MiniTable head={["Вид платежа", "Сумма", "Доля", "Платежей"]} rows={det.byType.map((r) => [r.label, money(r.total), det.total ? Math.round((r.total / det.total) * 100) + " %" : "—", String(r.count)])} total={["Итого", money(det.total), "100 %", String(det.list.length)]} />
        <div>
          <MiniTable head={["Месяц", "Сумма"]} rows={det.byMonth.filter((x) => Math.abs(x.total) > 0.005).map((x) => [monthLabel(x.month), money(x.total)])} total={["Итого", money(det.total)]} />
          <Spark values={det.byMonth.map((x) => x.total)} />
        </div>
      </div>
      <Chips label="Сортировка платежей" value={sort} options={[["date", "По дате"], ["amount", "По сумме"]]} onChange={setSort} />
      <MiniTable head={["Дата", "За что", "Документ", "Вид", "Сумма"]} rows={list.map((x) => [dmy(x.pay.iso), <Link key={x.pay.id} href={x.pay.href} className="underline">{x.pay.label}</Link>, x.pay.doc ?? "—", x.pay.type === "ADVANCE" ? "аванс" : x.pay.type === "PARTIAL" ? "доплата" : x.pay.type === "FINAL" ? "окончательный" : "прочее", money(x.amount)])} />
    </div>
  );
}

/** «Получено»: выбор сезона и категории → месяцы и артикулы. */
export function RecvDetail({ lines, months, exVat, cat, total, controls }: { lines: SalesAggLine[]; months: string[]; exVat: boolean; cat: CatClass | "all"; total: number; controls?: React.ReactNode }) {
  const seasons = useMemo(() => [...new Set(lines.map((l) => l.season))], [lines]);
  const [season, setSeason] = useState("all");
  const [cls, setCls] = useState<"all" | CatClass>("all");
  const base = useMemo(() => lines.filter((l) => (season === "all" || l.season === season) && (cls === "all" || l.cls === cls)), [lines, season, cls]);
  const byMonth = groupSales(base, months, exVat, (l) => l.iso.slice(0, 7), cat).sort((a, b) => a.key.localeCompare(b.key));
  const byArt = groupSales(base, months, exVat, (l) => l.article, cat);
  const sumRev = byMonth.reduce((a, g) => a + g.rev, 0), sumPcs = byMonth.reduce((a, g) => a + g.pcs, 0);
  const isAll = season === "all" && cls === "all";
  return (
    <div className="flex flex-col gap-4">
      {controls}
      <Chips label="Сезон" value={season} options={[["all", "Все сезоны"], ...seasons.map((s) => [s, s] as [string, string])]} onChange={setSeason} />
      <Chips label="Категория" value={cls} options={[["all", "Все категории"], ["clothes", CAT_LABEL.clothes], ["acc", CAT_LABEL.acc], ["other", CAT_LABEL.other]]} onChange={setCls} />
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <ExpTable head={["Месяц", "шт.", "Выручка"]} rows={byMonth.map((g) => ({ id: g.key, cells: [monthLabel(g.key), String(g.pcs), money(g.rev)], sub: (["clothes", "acc", "other"] as const).map((c) => groupSales(base.filter((l) => l.cls === c), [g.key], exVat, () => g.key, cat)[0]).map((x, ci) => [CAT_LABEL[(["clothes", "acc", "other"] as const)[ci]], String(x?.pcs ?? 0), money(x?.rev ?? 0)]).filter((r) => r[1] !== "0" || r[2] !== "—") }))} total={["Итого", String(sumPcs), money(isAll && cat === "all" ? total : sumRev)]} />
          <Spark values={byMonth.map((g) => g.rev)} />
        </div>
        <MiniTable head={["Артикул", "шт.", "Выручка"]} rows={byArt.slice(0, 15).map((g) => [g.key, String(g.pcs), money(g.rev)])} total={["Итого (все артикулы)", String(byArt.reduce((a, g) => a + g.pcs, 0)), money(byArt.reduce((a, g) => a + g.rev, 0))]} />
      </div>
    </div>
  );
}

/** «Работа»: выбор категории → месяцы оплат и ТЗ (партии) с суммами работы. */
export function WorkDetail({ pays, months, d, units }: { pays: PayLite[]; months: string[]; d: CashflowData; units: number[] }) {
  const [cls, setCls] = useState<"all" | CatClass>("all");
  const det = useMemo(() => workByTz(pays, months, cls), [pays, months, cls]);
  const byMonth = useMemo(() => months.map((m, i) => ({ m, i, v: workByTz(pays, [m], cls).total })).filter((x) => Math.abs(x.v) > 0.005), [pays, months, cls]);
  const workTotal = d.articles.find((a) => a.key === "work")?.total ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <Chips label="Категория" value={cls} options={[["all", "Все категории"], ["clothes", CAT_LABEL.clothes], ["acc", CAT_LABEL.acc], ["other", "Прочее / без привязки"]]} onChange={setCls} />
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <ExpTable head={["Месяц оплат", "Работа", "шт. получено", "₽ / шт."]} rows={byMonth.map((x) => ({ id: x.m, cells: [monthLabel(x.m), money(x.v), cls === "all" ? String(units[x.i]) : "—", cls === "all" && units[x.i] > 0 ? money(x.v / units[x.i]) : "—"], sub: (["clothes", "acc", "other"] as const).map((c) => [CAT_LABEL[c], money(workByTz(pays, [x.m], c).total), "—", "—"]).filter((r) => r[1] !== "—") }))} total={["Итого", money(det.total), "", ""]} />
          <Spark values={byMonth.map((x) => x.v)} />
        </div>
        <MiniTable head={["ТЗ (партия)", "Платежей", "Работа"]} rows={[...det.rows.map((r) => [<Link key={r.href} href={r.href} className="underline">{r.label}</Link>, String(r.count), money(r.amount)]), ...(Math.abs(det.unlinked.amount) > 0.005 ? [["Аванс без привязки к ТЗ", String(det.unlinked.count), money(det.unlinked.amount)]] : [])]} total={["Итого", "", money(det.total)]} />
      </div>
      {cls === "all" && <p className="text-xs text-neutral-700">Итого по ТЗ и неразнесённым авансам = «Работа подрядчику» в таблице: {money(workTotal)}.</p>}
    </div>
  );
}

type Agg = { pcs: number; rev: number; retailIncl: number; disc: number };
const aggOf = (ls: SalesAggLine[], ex: boolean): Agg => ({ pcs: ls.reduce((a, l) => a + l.pcs, 0), rev: ls.reduce((a, l) => a + (ex ? l.retailRubExVat : l.retailRub), 0), retailIncl: ls.reduce((a, l) => a + l.retailRub, 0), disc: ls.reduce((a, l) => a + l.discountRub, 0) });

/** «Средняя цена продажи»: чипы Тотал | сезон сверху; средняя цена, шт., выручка, скидка (Discount файла), категории, топ-артикулы и таблица по всем сезонам сразу. */
export function PriceDetail({ lines, months, exVat, cat, controls }: { lines: SalesAggLine[]; months: string[]; exVat: boolean; cat: CatClass | "all"; controls?: React.ReactNode }) {
  const seasons = useMemo(() => [...new Set(lines.map((l) => l.season))], [lines]);
  const [sel, setSel] = useState("all");
  const inPeriod = useMemo(() => lines.filter((l) => l.kind === "SALE" && inM(l.iso, months) && (cat === "all" || l.cls === cat)), [lines, months, cat]);
  const cur = inPeriod.filter((l) => sel === "all" || l.season === sel);
  const a = aggOf(cur, exVat);
  const avg = (x: Agg) => (x.pcs > 0 ? money(x.rev / x.pcs) : "—");
  const byArt = groupSales(cur, months, exVat, (l) => l.article, "all");
  return (
    <div className="flex flex-col gap-4">
      {controls}
      <Chips label="Сезон" value={sel} options={[["all", "Тотал"], ...seasons.map((s) => [s, s] as [string, string])]} onChange={setSel} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Stat2 label="Средняя цена продажи" value={avg(a)} sub={exVat ? "без НДС" : "с НДС"} />
        <Stat2 label="Продано, шт." value={n0(a.pcs)} />
        <Stat2 label="Выручка" value={money(a.rev)} sub={exVat ? "без НДС" : "с НДС"} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <MiniTable head={["Категория", "шт.", "Средняя цена"]} rows={(["clothes", "acc", "other"] as const).map((c) => { const x = aggOf(cur.filter((l) => l.cls === c), exVat); return [CAT_LABEL[c], String(x.pcs), avg(x)]; }).filter((r) => r[1] !== "0")} total={["Итого", String(a.pcs), avg(a)]} />
        <MiniTable head={["Сезон (все сразу)", "шт.", "Выручка", "Средняя цена"]} rows={seasons.map((s) => { const x = aggOf(inPeriod.filter((l) => l.season === s), exVat); return [s, n0(x.pcs), money(x.rev), avg(x)]; })} total={["Тотал", n0(aggOf(inPeriod, exVat).pcs), money(aggOf(inPeriod, exVat).rev), avg(aggOf(inPeriod, exVat))]} />
      </div>
      <MiniTable head={["Топ-5 артикулов по выручке", "шт.", "Средняя цена"]} rows={byArt.slice(0, 5).map((g) => [g.key, String(g.pcs), g.pcs > 0 ? money(g.rev / g.pcs) : "—"])} />
    </div>
  );
}

const n0 = (v: number) => (v === 0 ? "—" : String(v));
const inM = (iso: string, months: string[]) => months.includes(iso.slice(0, 7));
function Stat2({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-neutral-300 p-3">
      <div className="text-xs text-neutral-600">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-neutral-600">{sub}</div> : null}
    </div>
  );
}

const TYPE_COLS: { key: "ADVANCE" | "PARTIAL" | "FINAL" | "OTHER"; label: string }[] = [{ key: "ADVANCE", label: "Аванс" }, { key: "PARTIAL", label: "Доплата" }, { key: "FINAL", label: "Окончательный" }, { key: "OTHER", label: "Прочее" }];
const SHORT_MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** Таблица «Категория → Период»: строки — статьи → годы → месяцы, колонки — Итого и виды платежа. Свёрнуто до статей; итог = «Потрачено» плитки. */
export function CategoryTable({ d, open, setOpen }: { d: CashflowData; open: string[]; setOpen: (v: string[]) => void }) {
  const years = [...new Set(d.months.map((m) => m.slice(0, 4)))];
  const toggle = (id: string) => setOpen(open.includes(id) ? open.filter((x) => x !== id) : [...open, id]);
  const th = "px-2 py-2 text-right text-xs font-semibold whitespace-nowrap";
  const td = "min-w-[6.5rem] px-2 py-1.5 text-right text-sm tabular-nums whitespace-nowrap";
  const sum = (a: number[], idx: number[]) => idx.reduce((t, i) => t + (a[i] ?? 0), 0);
  const cells = (a: CashflowData["articles"][number], idx: number[]) => [sum(a.byMonth, idx), ...TYPE_COLS.map((c) => sum(a.types.find((t) => t.type === c.key)?.byMonth ?? [], idx))];
  const all = d.months.map((_, i) => i);
  const totals = TYPE_COLS.reduce((acc, c, k) => { acc[k + 1] = d.articles.reduce((t, a) => t + sum(a.types.find((x) => x.type === c.key)?.byMonth ?? [], all), 0); return acc; }, [d.total, 0, 0, 0, 0]);
  const btn = (id: string, isOpen: boolean, label: string) => <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Развернуть"}: ${label}`} onClick={() => toggle(id)} className="inline-flex min-h-11 items-center gap-1.5 text-left"><span aria-hidden>{isOpen ? "▾" : "▸"}</span>{label}</button>;
  return (
    <div className="max-h-[75vh] overflow-auto rounded-lg border border-neutral-300 bg-white" tabIndex={0} role="region" aria-label="Таблица Cashflow: строки — статьи, годы и месяцы, колонки — виды платежа">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-neutral-300">
            <th scope="col" className={th + " sticky left-0 top-0 z-[2] min-w-[11rem] bg-white text-left"}>Статья / период</th>
            <th scope="col" className={th + " sticky top-0 bg-white"}>Итого</th>
            {TYPE_COLS.map((c) => <th key={c.key} scope="col" className={th + " sticky top-0 bg-white font-normal text-neutral-700"}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {d.articles.map((a) => {
            const aid = "a:" + a.key, aOpen = open.includes(aid);
            return (
              <Fragment key={a.key}>
                <tr className="border-b border-neutral-300 bg-neutral-100 font-semibold">
                  <th scope="row" className="sticky left-0 z-[1] bg-neutral-100 px-2 py-1 text-left text-sm">{btn(aid, aOpen, a.label)}</th>
                  {cells(a, all).map((v, i) => <td key={i} className={td}>{money(v)}</td>)}
                </tr>
                {aOpen && years.map((y) => {
                  const yid = `y:${a.key}:${y}`, yOpen = open.includes(yid);
                  const yidx = d.months.map((m, i) => (m.startsWith(y) ? i : -1)).filter((i) => i >= 0);
                  return (
                    <Fragment key={yid}>
                      <tr className="border-b border-neutral-200 font-medium">
                        <th scope="row" className="sticky left-0 z-[1] bg-white py-1 pl-6 pr-2 text-left text-sm">{btn(yid, yOpen, y)}</th>
                        {cells(a, yidx).map((v, i) => <td key={i} className={td}>{money(v)}</td>)}
                      </tr>
                      {yOpen && yidx.filter((i) => Math.abs(a.byMonth[i]) > 0.005).map((i) => (
                        <tr key={yid + i} className="border-b border-neutral-100 text-sm">
                          <th scope="row" className="sticky left-0 z-[1] bg-white py-1.5 pl-12 pr-2 text-left font-normal">{SHORT_MON[Number(d.months[i].slice(5, 7)) - 1]} {y}</th>
                          {cells(a, [i]).map((v, k) => <td key={k} className={td}>{money(v)}</td>)}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </Fragment>
            );
          })}
          <tr className="border-t-2 border-neutral-400 font-bold">
            <th scope="row" className="sticky left-0 z-[1] bg-white px-2 py-1.5 text-left text-sm">Итого</th>
            {totals.map((v, i) => <td key={i} className={td}>{money(v)}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
