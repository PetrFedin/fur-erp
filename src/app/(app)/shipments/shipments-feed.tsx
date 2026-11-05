"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { Chart, type Pt, type Series } from "../dashboard/sales-block-charts";
import { GET, NAVY, REV, btn, money, moneyC, n0, seg, segGroup } from "../sales/sales-fmt";
import { SalesModal } from "../sales/sales-modal";
import { SortMark, TH } from "@/components/table-head";
import { sortRows, type SortState } from "@/lib/table-sort";
import type { FeedRow } from "@/lib/shipments-feed";

// «Приёмки по датам»: что и когда пришло (приход по файлу), график по месяцам с первой приёмки по текущий месяц (пустые месяцы — нули),
// столбцы разделены на одежду и аксессуары; фильтры по типу меха и категории; список по датам с раскрытием до артикула, ТЗ и партии.
const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const dateRu = (iso: string) => iso.split("-").reverse().join(".");
const SEL = "min-h-11 rounded-lg border border-neutral-300 bg-white px-2 text-sm";

/** «1 артикул», «2 артикула», «5 артикулов». */
const pluralArticles = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "артикул" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "артикула" : "артикулов"}`;

export function ShipmentsFeed({ rows }: { rows: FeedRow[] }) {
  const { mode } = useVatDisplay();
  const [unit, setUnit] = useState<"pcs" | "rub">("pcs");
  const [fur, setFur] = useState("");
  const [cat, setCat] = useState("");
  const furs = useMemo(() => Array.from(new Set(rows.map((r) => r.fur))).sort(), [rows]);
  const cats = useMemo(() => Array.from(new Set(rows.filter((r) => !fur || r.fur === fur).map((r) => r.cat))).sort(), [rows, fur]);
  const sum = (r: FeedRow) => (mode === "incl" ? r.costIncl : r.costExcl);
  const val = (r: FeedRow) => (unit === "pcs" ? r.qty : sum(r));
  const f = useMemo(() => rows.filter((r) => (!fur || r.fur === fur) && (!cat || r.cat === cat)), [rows, fur, cat]);
  // Месяц, выбранный кликом по графику, и день, открытый в окне. Список — одна строка на дату; детали (артикулы, ТЗ, партии) — в окне поверх.
  const [monthSel, setMonthSel] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [daySort, setDaySort] = useState<SortState | null>(null);
  const [rowSort, setRowSort] = useState<SortState | null>(null);
  const flip = (cur: SortState | null, key: string): SortState | null => (cur?.key === key ? (cur.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" });
  const dirOf = (cur: SortState | null, key: string): "asc" | "desc" | "none" => (cur?.key === key ? cur.dir : "none");

  // Месяцы: с первой приёмки по текущий, пустые — нули.
  const pts: Pt[] = useMemo(() => {
    if (!rows.length) return [];
    const first = rows[0].date.slice(0, 7), now = new Date().toISOString().slice(0, 7);
    const out: Pt[] = [];
    let [y, m] = first.split("-").map(Number);
    const [ey, em] = now.split("-").map(Number);
    while (y < ey || (y === ey && m <= em)) { out.push({ key: `${y}-${String(m).padStart(2, "0")}`, label: `${MONTHS[m - 1]} ${String(y).slice(2)}` }); m++; if (m > 12) { m = 1; y++; } }
    return out;
  }, [rows]);
  const by = (grp: string) => pts.map((p) => f.filter((r) => r.date.startsWith(p.key) && r.grp === grp).reduce((a, r) => a + val(r), 0));
  const clothes = by("Одежда"), acc = by("Аксессуары"), other = by("Прочее");
  const fmt = unit === "pcs" ? n0 : moneyC;
  const barName = unit === "pcs" ? "Получено, шт." : `Получено, ₽ (${mode === "incl" ? "с НДС" : "без НДС"})`;
  const lineName = unit === "pcs" ? "Приход нарастающим итогом, шт." : "Приход нарастающим итогом, ₽";
  const monthly = pts.map((_, i) => clothes[i] + acc[i] + other[i]);
  const cum: number[] = []; monthly.reduce((a, v, i) => (cum[i] = a + v), 0);
  const series: Series[] = [{
    name: barName, color: GET, kind: "bar", axis: "l", fmt,
    vals: monthly, partLabel: "Получено",
    parts: [{ name: "Одежда", color: GET, vals: clothes }, { name: "Аксессуары", color: REV, vals: acc }, ...(other.some((v) => v > 0) ? [{ name: "Прочее", color: "#9ca3af", vals: other }] : [])],
  }, { name: lineName, color: NAVY, kind: "line", axis: "r", fmt, vals: cum }];

  // Список по датам.
  const days = useMemo(() => {
    const m = new Map<string, FeedRow[]>();
    for (const r of f) { if (monthSel && !r.date.startsWith(monthSel)) continue; (m.get(r.date) ?? m.set(r.date, []).get(r.date)!).push(r); }
    const list = Array.from(m).sort((a, b) => b[0].localeCompare(a[0]));
    const stat = (rs: FeedRow[]) => ({ qty: rs.reduce((a, r) => a + r.qty, 0), sum: rs.reduce((a, r) => a + sum(r), 0), arts: new Set(rs.map((r) => r.article)).size });
    return sortRows(list, daySort, { date: (d) => d[0], qty: (d) => stat(d[1]).qty, sum: (d) => stat(d[1]).sum, arts: (d) => stat(d[1]).arts });
  }, [f, monthSel, daySort, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  // Дни-блоки: последние 5 приёмок раскрыты, остальные свёрнуты; любой день можно раскрыть, есть «Развернуть все / Свернуть все».
  const shown = monthSel ? f.filter((r) => r.date.startsWith(monthSel)) : f;
  const totalQty = shown.reduce((a, r) => a + r.qty, 0), totalSum = shown.reduce((a, r) => a + sum(r), 0);

  return (
    <section aria-label="Приёмки по датам" className="space-y-3 rounded-lg border border-neutral-200 bg-white p-3" data-testid="shipments-feed">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Приёмки по датам</h2>
        <span className="text-xs text-neutral-600">Получено в рознице {n0(totalQty)} шт. · {money(totalSum)} по себестоимости ТЗ, {mode === "incl" ? "с НДС" : "без НДС"}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Единицы" className={segGroup}>
            <button type="button" aria-pressed={unit === "pcs"} className={seg(unit === "pcs")} onClick={() => setUnit("pcs")}>Штуки</button>
            <button type="button" aria-pressed={unit === "rub"} className={seg(unit === "rub")} onClick={() => setUnit("rub")}>Деньги</button>
          </div>
          <label className="flex items-center gap-1 text-xs text-neutral-600">Мех
            <select className={SEL} value={fur} onChange={(e) => { setFur(e.target.value); setCat(""); }}><option value="">Все</option>{furs.map((x) => <option key={x}>{x}</option>)}</select>
          </label>
          <label className="flex items-center gap-1 text-xs text-neutral-600">Категория
            <select className={SEL} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Все</option>{cats.map((x) => <option key={x}>{x}</option>)}</select>
          </label>
        </div>
      </div>
      {pts.length ? <Chart pts={pts} series={series} label={`Получено по месяцам: ${unit === "pcs" ? "штуки" : "деньги"}`} testId="shipments-chart" valueLabels={[barName]} selectedKey={monthSel} onSelect={setMonthSel} /> : <p className="text-sm text-neutral-600">Приёмок пока нет.</p>}

      {monthSel ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-700">
          <span>Показан месяц: <b>{pts.find((p) => p.key === monthSel)?.label ?? monthSel}</b> · {days.length} дат приёмки</span>
          <button type="button" onClick={() => setMonthSel(null)} className={btn}>Показать все месяцы</button>
        </div>
      ) : <p className="text-xs text-neutral-600">Нажмите на месяц на графике — в списке останутся его приёмки. Нажмите на дату — откроется окно с артикулами, ТЗ и партиями.</p>}
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <div role="row" className="grid grid-cols-[5.75rem_minmax(2.25rem,1fr)_minmax(6rem,1.5fr)_minmax(4.5rem,1fr)] gap-x-2 md:min-w-[460px] md:grid-cols-[6.5rem_minmax(3rem,1fr)_minmax(7.5rem,1.5fr)_minmax(4.5rem,1fr)] md:gap-x-3 items-center border-b border-neutral-200 bg-neutral-50">
          {([["date", "Дата", undefined, true], ["qty", "Штук", "шт.", false], ["sum", "Сумма", mode === "incl" ? "₽ с НДС" : "₽ без НДС", false], ["arts", "Артикулов", undefined, false]] as const).map(([k, label, unit, left]) => (
            <div key={k} role="columnheader" aria-sort={daySort?.key === k ? (daySort.dir === "asc" ? "ascending" : "descending") : undefined} className={left ? "text-left" : "text-right"}>
              <button type="button" onClick={() => setDaySort(flip(daySort, k))} className={"inline-flex min-h-11 flex-col justify-center px-1.5 text-xs font-medium text-neutral-600 hover:underline " + (left ? "items-start" : "items-end")}>
                <span className="inline-flex items-center gap-1">{label}<SortMark dir={dirOf(daySort, k)} /></span>
                {unit ? <span className="text-[11px] font-normal opacity-80">{unit}</span> : null}
              </button>
            </div>
          ))}
        </div>
        <ul className="divide-y divide-neutral-200">
          {days.map(([d, rs]) => {
            const q = rs.reduce((a, r) => a + r.qty, 0), sm = rs.reduce((a, r) => a + sum(r), 0), arts = new Set(rs.map((r) => r.article)).size;
            return (
              <li key={d}>
                <button type="button" onClick={() => setOpenDay(d)} aria-haspopup="dialog" className="grid min-h-11 w-full grid-cols-[5.75rem_minmax(2.25rem,1fr)_minmax(6rem,1.5fr)_minmax(4.5rem,1fr)] gap-x-2 md:min-w-[460px] md:grid-cols-[6.5rem_minmax(3rem,1fr)_minmax(7.5rem,1.5fr)_minmax(4.5rem,1fr)] md:gap-x-3 items-center px-1.5 py-1 text-left text-sm tabular-nums hover:bg-neutral-50">
                  <span className="font-medium">{dateRu(d)}</span>
                  <span className="text-right">{n0(q)}</span>
                  <span className="text-right text-neutral-700">{money(sm)}</span>
                  <span className="text-right text-neutral-600">{arts}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {openDay ? (() => {
        const rs = f.filter((r) => r.date === openDay);
        const q = rs.reduce((a, r) => a + r.qty, 0), sm = rs.reduce((a, r) => a + sum(r), 0);
        const sorted = sortRows(rs, rowSort, { article: (r) => r.article, color: (r) => r.color, fur: (r) => r.fur, cat: (r) => r.cat, qty: (r) => r.qty, sum: (r) => sum(r), tz: (r) => r.orders[0]?.wo ?? r.orders[0]?.number ?? null });
        return (
          <SalesModal title={`Приёмка ${dateRu(openDay)}`} subtitle={`${n0(q)} шт. · ${money(sm)} по себестоимости ТЗ, ${mode === "incl" ? "с НДС" : "без НДС"} · ${pluralArticles(new Set(rs.map((r) => r.article)).size)}`} onClose={() => setOpenDay(null)} wide>
            <div className="overflow-x-auto rounded-lg border border-neutral-300" data-keep-scroll tabIndex={0}>
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-neutral-300 bg-neutral-50">
                    <TH align="left" label="Артикул" sort={dirOf(rowSort, "article")} onSort={() => setRowSort(flip(rowSort, "article"))} />
                    <TH align="left" label="Цвет" sort={dirOf(rowSort, "color")} onSort={() => setRowSort(flip(rowSort, "color"))} />
                    <TH align="left" label="Мех" sort={dirOf(rowSort, "fur")} onSort={() => setRowSort(flip(rowSort, "fur"))} />
                    <TH align="left" label="Категория" sort={dirOf(rowSort, "cat")} onSort={() => setRowSort(flip(rowSort, "cat"))} />
                    <TH label="Штук" unit="шт." sort={dirOf(rowSort, "qty")} onSort={() => setRowSort(flip(rowSort, "qty"))} />
                    <TH label="Сумма" unit="₽" sort={dirOf(rowSort, "sum")} onSort={() => setRowSort(flip(rowSort, "sum"))} />
                    <TH align="left" label="ТЗ · партия" sort={dirOf(rowSort, "tz")} onSort={() => setRowSort(flip(rowSort, "tz"))} />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => (
                    <tr key={i} className="border-b border-neutral-100 align-top">
                      <td className="px-1.5 py-1.5">{r.model ? <Link href={`/models/${r.model.id}`} className="text-blue-700 hover:underline">{r.article}</Link> : r.article}</td>
                      <td className="px-1.5 py-1.5">{r.color || "–"}</td><td className="px-1.5 py-1.5">{r.fur}</td><td className="px-1.5 py-1.5">{r.cat}</td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums">{n0(r.qty)}</td><td className="px-1.5 py-1.5 text-right tabular-nums">{money(sum(r))}</td>
                      <td className="px-1.5 py-1.5 text-xs">
                        {r.orders.length ? r.orders.filter((o, oi, all) => all.findIndex((x) => x.id === o.id) === oi).map((o) => (
                          <span key={o.id} className="mr-1.5 inline-block whitespace-nowrap">
                            <Link href={`/production/${o.id}`} className="text-blue-700 hover:underline">ТЗ {o.wo ?? o.number}</Link>
                            {o.batch != null ? <> · <Link href={`/production/batches/${o.batch}`} className="text-blue-700 hover:underline">партия {o.batch}</Link></> : null}
                          </span>
                        )) : <span className="text-neutral-500">ТЗ не найдено</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-neutral-400 font-semibold"><td className="px-1.5 py-1.5" colSpan={4}>Итого</td><td className="px-1.5 py-1.5 text-right tabular-nums">{n0(q)}</td><td className="px-1.5 py-1.5 text-right tabular-nums">{money(sm)}</td><td /></tr></tfoot>
              </table>
            </div>
          </SalesModal>
        );
      })() : null}
    </section>
  );
}
