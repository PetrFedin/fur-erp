"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { Chart, type Pt, type Series } from "../dashboard/sales-block-charts";
import { GET, REV, money, moneyC, n0, seg, segGroup } from "../sales/sales-fmt";
import type { FeedRow } from "@/lib/shipments-feed";

// «Приёмки по датам»: что и когда пришло (приход по файлу), график по месяцам с первой приёмки по текущий месяц (пустые месяцы — нули),
// столбцы разделены на одежду и аксессуары; фильтры по типу меха и категории; список по датам с раскрытием до артикула, ТЗ и партии.
const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const dateRu = (iso: string) => iso.split("-").reverse().join(".");
const SEL = "min-h-11 rounded-lg border border-neutral-300 bg-white px-2 text-sm";

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
  const series: Series[] = [{
    name: unit === "pcs" ? "Принято, шт." : `Принято, ₽ (${mode === "incl" ? "с НДС" : "без НДС"})`, color: GET, kind: "bar", axis: "l", fmt,
    vals: pts.map((_, i) => clothes[i] + acc[i] + other[i]), partLabel: "Принято",
    parts: [{ name: "Одежда", color: GET, vals: clothes }, { name: "Аксессуары", color: REV, vals: acc }, ...(other.some((v) => v > 0) ? [{ name: "Прочее", color: "#9ca3af", vals: other }] : [])],
  }];

  // Список по датам.
  const days = useMemo(() => {
    const m = new Map<string, FeedRow[]>();
    for (const r of f) (m.get(r.date) ?? m.set(r.date, []).get(r.date)!).push(r);
    return Array.from(m).sort((a, b) => b[0].localeCompare(a[0]));
  }, [f]);
  const totalQty = f.reduce((a, r) => a + r.qty, 0), totalSum = f.reduce((a, r) => a + sum(r), 0);

  return (
    <section aria-label="Приёмки по датам" className="space-y-3 rounded-lg border border-neutral-200 bg-white p-3" data-testid="shipments-feed">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Приёмки по датам</h2>
        <span className="text-xs text-neutral-600">Принято {n0(totalQty)} шт. · {money(totalSum)} по себестоимости ТЗ, {mode === "incl" ? "с НДС" : "без НДС"}</span>
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
      {pts.length ? <Chart pts={pts} series={series} label={`Принято по месяцам: ${unit === "pcs" ? "штуки" : "деньги"}`} testId="shipments-chart" /> : <p className="text-sm text-neutral-600">Приёмок пока нет.</p>}

      <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
        {days.map(([d, rs]) => {
          const q = rs.reduce((a, r) => a + r.qty, 0), s = rs.reduce((a, r) => a + sum(r), 0);
          return (
            <details key={d} className="group">
              <summary className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1 text-sm hover:bg-neutral-50">
                <span className="w-24 font-medium tabular-nums">{dateRu(d)}</span>
                <span className="tabular-nums">{n0(q)} шт.</span>
                <span className="tabular-nums text-neutral-600">{money(s)}</span>
                <span className="ml-auto text-xs text-neutral-500">{rs.length} поз. · {new Set(rs.map((r) => r.article)).size} артикулов</span>
              </summary>
              <div className="overflow-x-auto px-3 pb-3">
                <table className="w-full min-w-[720px] text-sm">
                  <thead><tr className="border-b text-left text-xs text-neutral-600"><th className="py-1 pr-2">Артикул</th><th className="pr-2">Цвет</th><th className="pr-2">Мех</th><th className="pr-2">Категория</th><th className="pr-2 text-right">Шт.</th><th className="pr-2 text-right">Сумма</th><th>ТЗ · партия</th></tr></thead>
                  <tbody>
                    {rs.map((r, i) => (
                      <tr key={i} className="border-b border-neutral-100 align-top">
                        <td className="py-1 pr-2">{r.model ? <Link href={`/models/${r.model.id}`} className="text-blue-700 hover:underline">{r.article}</Link> : r.article}</td>
                        <td className="pr-2">{r.color || "–"}</td><td className="pr-2">{r.fur}</td><td className="pr-2">{r.cat}</td>
                        <td className="pr-2 text-right tabular-nums">{n0(r.qty)}</td><td className="pr-2 text-right tabular-nums">{money(sum(r))}</td>
                        <td className="text-xs">
                          {r.orders.length ? r.orders.map((o) => (
                            <span key={o.id} className="mr-1.5 inline-block whitespace-nowrap">
                              <Link href={`/production/${o.id}`} className="text-blue-700 hover:underline">ТЗ {o.wo ?? o.number}</Link>
                              {o.batch != null ? <> · <Link href={`/production/batches/${o.batch}`} className="text-blue-700 hover:underline">партия {o.batch}</Link></> : null}
                            </span>
                          )) : <span className="text-neutral-500">ТЗ не найдено</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
