"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/utils";
import { toCsv } from "@/lib/csv";
import { InfoHint } from "@/components/info-hint";

type Series = { key: string; label: string; hint: string; byMonth: number[]; total: number; types: { type: string; label: string; byMonth: number[]; total: number }[] };
type ChartData = { months: string[]; articles: Series[]; monthTotals: number[]; cumulative: number[]; total: number };
export type CashflowViewProps = {
  months: string[];
  articles: Series[];
  monthTotals: number[];
  cumulative: number[];
  total: number;
  periodLabel: string;
};

// Цвета статей: различимы между собой и без цвета (подписи в легенде и подсказке; таблица рядом — текстовая альтернатива).
const COLORS: Record<string, string> = { furAuction: "#1b2a5c", furPurchase: "#4f6bb5", lining: "#2f7f8f", services: "#8a6d1d", work: "#d93a0e", hides: "#7a4a8c" };
const MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const mon = (m: string) => MON[Number(m.slice(5, 7)) - 1];
const full = (m: string) => `${mon(m)} ${m.slice(0, 4)}`;
const dash = (v: number) => (Math.abs(v) < 0.5 ? "—" : formatMoney(v));
const mln = (v: number) => (v / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " млн";

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}

function Chart({ d, mode, active, setActive, hot, setHot, yearHot }: { d: ChartData; mode: "month" | "cum"; active: number | null; setActive: (i: number | null) => void; hot: string | null; setHot: (k: string | null) => void; yearHot: string | null }) {
  const n = d.months.length;
  const colW = 28, left = 52, right = 12, top = 12, bottom = 40, H = 260;
  const W = left + right + n * colW;
  const maxV = niceMax(mode === "month" ? Math.max(...d.monthTotals, 0) : Math.max(...d.cumulative, 0));
  const y = (v: number) => top + (H - top - bottom) * (1 - v / maxV);
  const x = (i: number) => left + i * colW + colW / 2;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxV);
  const line = d.cumulative.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={mode === "month" ? "Траты по месяцам и статьям" : "Накопительный итог трат по месяцам"} className="block">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke="#d4d4d8" strokeWidth={1} />
          <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#5a6a94">{mln(t)}</text>
        </g>
      ))}
      {d.months.map((m, i) => (
        <g key={m}>
          <text x={x(i)} y={H - bottom + 16} textAnchor="middle" fontSize={11} fill="#5a6a94">{mon(m)}</text>
          {(i === 0 || m.endsWith("-01")) && <text x={x(i)} y={H - bottom + 30} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1b2a5c">{m.slice(0, 4)}</text>}
        </g>
      ))}
      {mode === "month" &&
        d.months.map((m, i) => {
          let acc = 0;
          return (
            <g key={m}>
              {d.articles.map((a) => {
                const v = a.byMonth[i];
                if (v <= 0.5) return null;
                const y0 = y(acc), y1 = y(acc + v);
                acc += v;
                const sel = active === i || (yearHot !== null && m.startsWith(yearHot));
                const dim = hot ? hot !== a.key : (active !== null || yearHot !== null) && !sel;
                return <rect key={a.key} x={x(i) - 9} width={18} y={y1} height={Math.max(0, y0 - y1)} fill={COLORS[a.key]} opacity={dim ? 0.25 : 1} stroke={hot === a.key ? "#111" : "none"} strokeWidth={1} className="motion-safe:transition-opacity"
                  aria-label={`${a.label}, ${full(m)}: ${formatMoney(v)}`} onMouseEnter={() => setHot(a.key)} onMouseLeave={() => setHot(null)} />;
              })}
            </g>
          );
        })}
      {mode === "cum" && (
        <>
          <path d={line} fill="none" stroke="#d93a0e" strokeWidth={2.5} />
          {d.cumulative.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={active === i ? 5 : 3} fill="#d93a0e" />)}
        </>
      )}
      {d.months.map((m, i) => (
        <rect key={m} x={left + i * colW} y={top} width={colW} height={H - top - bottom} fill="transparent" tabIndex={0}
          aria-label={`${full(m)}: за месяц ${dash(d.monthTotals[i])}, накопительно ${dash(d.cumulative[i])}`}
          onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onClick={() => setActive(i)} />
      ))}
    </svg>
  );
}

export function CashflowView(d: CashflowViewProps) {
  const [show, setShow] = useState(true);
  const [mode, setMode] = useState<"month" | "cum">("month");
  const [active, setActive] = useState<number | null>(null);
  const c = d;
  const [open, setOpen] = useState<string[]>([]);
  const setOpenSaved = setOpen;
  const [hot, setHot] = useState<string | null>(null);
  const [yearHot, setYearHot] = useState<string | null>(null);
  const clearHot = () => { setHot(null); setActive(null); setYearHot(null); };
  /** Наведение/фокус/касание на ячейке таблицы: статья + месяц (или год) подсвечиваются в графике. */
  const aim = (art: string | null, r: { kind: string; idx: number[]; id: string }) => {
    setHot(art);
    if (r.kind === "month") { setActive(r.idx[0]); setYearHot(null); } else if (r.kind === "year") { setActive(null); setYearHot(r.id.slice(1)); } else { setActive(null); setYearHot(null); }
  };

  // Столбцы: по каждой статье — виды платежа (если их больше одного) и «Итого по статье».
  type Col = { id: string; art?: Series; head: string; sub: string; strong?: boolean; get: (i: number) => number };
  const cols: Col[] = d.articles.flatMap((a): Col[] => [
    ...(a.types.length > 1 ? a.types.map((t): Col => ({ id: a.key + t.type, art: a, head: a.label, sub: t.label, get: (i) => t.byMonth[i] })) : []),
    { id: a.key + "T", art: a, head: a.label, sub: a.types.length > 1 ? "Итого по статье" : a.types[0]?.label ?? "Итого", strong: a.types.length > 1, get: (i) => a.byMonth[i] },
  ]);
  const years = [...new Set(d.months.map((m) => m.slice(0, 4)))];
  type Row = { id: string; label: string; kind: "month" | "year" | "total"; idx: number[] };
  const rows: Row[] = [
    ...years.flatMap((y): Row[] => {
      const idx = d.months.map((m, i) => (m.startsWith(y) ? i : -1)).filter((i) => i >= 0);
      return [...idx.map((i): Row => ({ id: d.months[i], label: full(d.months[i]), kind: "month", idx: [i] })), { id: "y" + y, label: `Итого ${y}`, kind: "year", idx }];
    }),
    ...(years.length > 1 ? [{ id: "all", label: "Итого", kind: "total" as const, idx: d.months.map((_, i) => i) }] : []),
  ];
  const sumRow = (r: Row, f: (i: number) => number) => r.idx.reduce((x, i) => x + f(i), 0);
  const cumOf = (r: Row) => d.cumulative[r.idx[r.idx.length - 1]];
  const num = (v: number) => v.toFixed(2).replace(".", ",");

  const csv = () => {
    const head = ["Период", ...cols.map((c) => `${c.head}: ${c.sub}`), "Итого за месяц", "Накопительно"];
    const body = rows.filter((r) => r.kind !== "month" || true).map((r) => [r.label, ...cols.map((c) => num(sumRow(r, c.get))), num(sumRow(r, (i) => d.monthTotals[i])), num(cumOf(r))]);
    const blob = new Blob([toCsv(head, body)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cashflow-${d.periodLabel.replace(/[^0-9a-zа-я]+/gi, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const btn = (on: boolean) => "inline-flex min-h-11 items-center rounded-md px-3 text-sm " + (on ? "bg-neutral-900 text-white" : "text-neutral-700 hover:text-neutral-900");
  const th = "px-2 py-2 text-right text-xs font-semibold whitespace-nowrap";
  const td = "px-2 py-1.5 text-right text-sm tabular-nums whitespace-nowrap";
  const sticky = "sticky left-0 z-[1] bg-white text-left";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button type="button" aria-pressed={show} onClick={() => setShow((s) => !s)} className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm">
          График: {show ? "скрыть" : "показать"}
        </button>
        {show && (
          <div role="group" aria-label="Вид графика" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
            <button type="button" aria-pressed={mode === "month"} onClick={() => setMode("month")} className={btn(mode === "month")}>По месяцам</button>
            <button type="button" aria-pressed={mode === "cum"} onClick={() => setMode("cum")} className={btn(mode === "cum")}>Накопительно</button>
          </div>
        )}
        <button type="button" onClick={() => setOpenSaved(open.length < years.length ? years : [])} className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-xs">{open.length < years.length ? "Развернуть все" : "Свернуть все"}</button>
        <button type="button" onClick={csv} className="ml-auto inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-xs">Скачать CSV</button>
      </div>

      {show && (
        <section aria-label="График Cashflow" className="rounded-lg border border-neutral-300 bg-white p-3">
          <div className="mb-2 min-h-[2.5rem] text-xs text-neutral-700" aria-live="polite">
            {hot && mode === "month" ? (() => {
              const a = c.articles.find((x) => x.key === hot)!;
              const yrs = [...new Set(c.months.map((m) => m.slice(0, 4)))];
              return (
                <span>
                  <b>{a.label}</b>: за период {formatMoney(a.total)}
                  {yrs.length > 1 ? yrs.map((y) => <span key={y}> · {y}: {formatMoney(c.months.reduce((t, m, i) => (m.startsWith(y) ? t + a.byMonth[i] : t), 0))}</span>) : null}
                  {active !== null ? <span> · {full(c.months[active])}: {formatMoney(a.byMonth[active])}</span> : null}
                  {" "}Подсвечены месяцы, где были оплаты.
                </span>
              );
            })() : active === null ? (
              <span>Наведите курсор или коснитесь месяца или статьи в легенде: появятся суммы. Итого за период {formatMoney(c.total)}.</span>
            ) : (
              <span>
                <b>{full(c.months[active])}</b>: за месяц {dash(c.monthTotals[active])}, накопительно {dash(c.cumulative[active])}
                {c.articles.filter((a) => Math.abs(a.byMonth[active]) >= 0.5).map((a) => <span key={a.key}> · {a.label} {formatMoney(a.byMonth[active])}</span>)}
              </span>
            )}
          </div>
          <div className="overflow-x-auto"><Chart d={c} mode={mode} active={active} setActive={setActive} hot={hot} setHot={setHot} yearHot={yearHot} /></div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
            {mode === "month" ? c.articles.map((a) => (
              <li key={a.key}>
                <button type="button" aria-pressed={hot === a.key} aria-label={`${a.label}: ${formatMoney(a.total)} за период`} data-touch-ok
                  onMouseEnter={() => setHot(a.key)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(a.key)} onBlur={() => setHot(null)} onClick={() => setHot(hot === a.key ? null : a.key)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: COLORS[a.key] }} />{a.label}</button>
              </li>
            )) : <li className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-0.5 w-4" style={{ background: "#d93a0e" }} />Накопительный итог трат</li>}
          </ul>
        </section>
      )}

      <div className="max-h-[75vh] overflow-auto rounded-lg border border-neutral-300 bg-white" tabIndex={0} role="region" aria-label="Таблица Cashflow: строки — годы и месяцы, столбцы — статьи оплат">
        <table className="w-full border-collapse" onMouseLeave={clearHot}>
          <thead>
            <tr className="border-b border-neutral-200">
              <th scope="col" rowSpan={2} className={th.replace("text-right", "text-left") + " " + sticky + " top-0 z-[2] min-w-[8rem]"}>Период</th>
              {d.articles.map((a) => (
                <th key={a.key} scope="colgroup" tabIndex={0} onMouseEnter={() => setHot(a.key)} onFocus={() => setHot(a.key)} onBlur={clearHot} onClick={() => setHot(a.key)} colSpan={cols.filter((c) => c.art === a).length} className="border-l border-neutral-200 px-2 py-2 text-center text-xs font-semibold">
                  <span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[a.key] }} />{a.label}
                  <InfoHint label={`За что платили: ${a.label}`} wide><p>{a.hint}</p></InfoHint>
                </th>
              ))}
              <th scope="col" rowSpan={2} className={th + " border-l border-neutral-300 font-bold"}>Итого за месяц</th>
              <th scope="col" rowSpan={2} className={th + " font-bold"}>Накопительно</th>
            </tr>
            <tr className="border-b border-neutral-300">
              {cols.map((c) => <th key={c.id} scope="col" className={th + " font-normal text-neutral-600 " + (c.strong ? "font-semibold" : "")}>{c.sub}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.filter((r) => r.kind !== "month" || open.includes(r.id.slice(0, 4))).map((r) => {
              const cls = r.kind === "month" ? "border-b border-neutral-200" : r.kind === "year" ? "border-b border-neutral-300 bg-neutral-100 font-semibold" : "row-total border-t-2 border-neutral-400 font-bold";
              const bg = r.kind === "month" ? "bg-white" : r.kind === "year" ? "bg-neutral-100" : "bg-white";
              return (
                <tr key={r.id} className={cls}>
                  <th scope="row" className={"px-2 py-1.5 text-sm " + (r.kind === "month" ? "font-normal " : "") + sticky.replace("bg-white", bg)}>
                    {r.kind === "year" ? (
                      <button type="button" aria-expanded={open.includes(r.id.slice(1))} data-touch-ok className="inline-flex min-h-11 items-center gap-1.5 text-left font-semibold"
                        onClick={() => setOpenSaved(open.includes(r.id.slice(1)) ? open.filter((y) => y !== r.id.slice(1)) : [...open, r.id.slice(1)])}>
                        <span aria-hidden>{open.includes(r.id.slice(1)) ? "▾" : "▸"}</span>{r.label}
                      </button>
                    ) : r.label}
                  </th>
                  {cols.map((c) => <td key={c.id} onMouseEnter={() => aim(c.art!.key, r)} onClick={() => aim(c.art!.key, r)} className={td + (c.strong ? " font-semibold" : "") + (hot === c.art!.key && ((active !== null && r.idx.includes(active)) || (yearHot !== null && r.id === "y" + yearHot)) ? " bg-[var(--ui-soft)]" : "")}>{dash(sumRow(r, c.get))}</td>)}
                  <td className={td + " border-l border-neutral-300 font-semibold"}>{dash(sumRow(r, (i) => d.monthTotals[i]))}</td>
                  <td className={td}>{dash(cumOf(r))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
