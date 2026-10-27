"use client";

import { useEffect, useRef, useState } from "react";
import { GRAN_LABEL, type Bucket, type Gran } from "@/lib/sales-section";
import { GET, NAVY, PRICE, REV, STOCK, moneyC, n0, seg, segGroup } from "./sales-fmt";

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

const H = 230, PT = 14, PB = 46, PL = 44, PR = 48;

type Series = { name: string; color: string; vals: number[]; kind: "bar" | "line"; axis: "l" | "r" };

/** Столбцы и линия по периодам на двух шкалах (слева — столбцы, справа — линия). Подсветка периода общая с таблицей. Широкий ряд прокручивается внутри блока. */
function Chart({ buckets, series, hot, setHot, label, fmtL, fmtR }: { buckets: Bucket[]; series: Series[]; hot: number | null; setHot: (i: number | null) => void; label: string; fmtL: (v: number) => string; fmtR: (v: number) => string }) {
  const n = buckets.length;
  // Ряд под курсором в легенде: остальные приглушаются, у выбранного на графике подписаны значения по периодам.
  const [hotS, setHotS] = useState<string | null>(null);
  const dimS = (name: string) => (hotS !== null && hotS !== name ? 0.2 : 1);
  // Ширина колонки: не меньше базовой, но график растягивается на всю ширину блока (ResizeObserver); очень длинный ряд прокручивается.
  const box = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const upd = () => setCw(el.clientWidth);
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const baseW = n > 40 ? 22 : n > 20 ? 34 : 56;
  const colW = Math.max(baseW, cw > 0 && n > 0 ? Math.floor(((cw - 2 - PL - PR) / n) * 100) / 100 : 0);
  const W = PL + PR + n * colW;
  const bars = series.filter((s) => s.kind === "bar"), lines = series.filter((s) => s.kind === "line");
  const maxL = niceMax(Math.max(...bars.flatMap((s) => s.vals), ...series.filter((s) => s.axis === "l" && s.kind === "line").flatMap((s) => s.vals), 0));
  const maxR = niceMax(Math.max(...series.filter((s) => s.axis === "r").flatMap((s) => s.vals), 0));
  const yL = (v: number) => PT + (H - PT - PB) * (1 - v / maxL), yR = (v: number) => PT + (H - PT - PB) * (1 - v / maxR);
  const bw = Math.max(4, Math.min(28, (colW - 8) / Math.max(1, bars.length)));
  const x = (i: number) => PL + i * colW + colW / 2;
  const every = Math.ceil(n / Math.max(1, Math.floor((n * colW) / 64)));
  const ticks = [0, 0.5, 1];
  const labEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((n * colW) / 38))));
  const hotB = hot !== null ? buckets[hot] : null;
  return (
    <div className="relative min-w-0">
      <div ref={box} className="overflow-x-auto" data-keep-scroll tabIndex={0} role="img" aria-label={label}>
        <svg width={Math.max(W, 300)} height={H} className="block" onMouseLeave={() => setHot(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PL} x2={W - PR} y1={yL(maxL * t)} y2={yL(maxL * t)} stroke="#e5e5e5" />
              <text x={PL - 6} y={yL(maxL * t) + 4} textAnchor="end" fontSize="11" fill="#525252">{fmtL(maxL * t)}</text>
              {lines.some((s) => s.axis === "r") ? <text x={W - PR + 6} y={yR(maxR * t) + 4} fontSize="11" fill="#525252">{fmtR(maxR * t)}</text> : null}
            </g>
          ))}
          {buckets.map((b, i) => (
            <g key={b.key} onMouseEnter={() => setHot(i)}>
              <rect x={PL + i * colW} y={PT} width={colW} height={H - PT - PB} fill={hot === i ? "#f5f5f5" : "transparent"} />
              {bars.map((s, si) => {
                const v = s.vals[i], h = (H - PT - PB) * (v / maxL);
                return v > 0 ? <g key={s.name} opacity={dimS(s.name)}><rect x={x(i) - (bars.length * bw) / 2 + si * bw} y={yL(v)} width={bw - 1} height={h} fill={s.color} rx="1"><title>{`${b.label}: ${s.name} ${fmtL(v)}`}</title></rect>{hotS === s.name && i % labEvery === 0 ? <text x={x(i) - (bars.length * bw) / 2 + si * bw + (bw - 1) / 2} y={yL(v) - 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#171717">{fmtL(v)}</text> : null}</g> : null;
              })}
              {i % every === 0 ? <text x={x(i)} y={H - PB + 14} textAnchor="end" fontSize="11" fill="#404040" transform={`rotate(-35 ${x(i)} ${H - PB + 14})`}>{b.label}</text> : null}
            </g>
          ))}
          {lines.map((s) => {
            const f = s.axis === "l" ? yL : yR;
            const pts = s.vals.map((v, i) => (Number.isNaN(v) ? null : `${x(i)},${f(v)}`)).filter(Boolean);
            return (
              <g key={s.name} opacity={dimS(s.name)}>
                <polyline points={pts.join(" ")} fill="none" stroke={s.color} strokeWidth={hotS === s.name ? 3.5 : 2} />
                {s.vals.map((v, i) => (Number.isNaN(v) ? null : <circle key={i} cx={x(i)} cy={f(v)} r={hot === i || hotS === s.name ? 4 : n > 40 ? 1.5 : 3} fill={s.color} />))}
                {hotS === s.name ? s.vals.map((v, i) => (Number.isNaN(v) || i % labEvery !== 0 ? null : <text key={"t" + i} x={x(i)} y={f(v) - 8} textAnchor="middle" fontSize="11" fontWeight="700" fill="#171717" stroke="#fff" strokeWidth="3" paintOrder="stroke">{Math.abs(v) < 0.5 ? "–" : (s.axis === "l" ? fmtL : fmtR)(v)}</text>)) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-1 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-800" aria-live="polite">
        {series.map((s) => <button key={s.name} type="button" aria-pressed={hotS === s.name} onMouseEnter={() => setHotS(s.name)} onMouseLeave={() => setHotS(null)} onFocus={() => setHotS(s.name)} onBlur={() => setHotS(null)} onClick={() => setHotS(hotS === s.name ? null : s.name)} className={"inline-flex min-h-11 items-center gap-1 rounded-md px-2 " + (hotS === s.name ? "bg-neutral-100 font-semibold" : "")}><i aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />{s.name}{hotB && hot !== null ? <b className="tabular-nums"> {s.axis === "l" ? fmtL(s.vals[hot]) : fmtR(s.vals[hot])}</b> : null}</button>)}
        {hotB ? <span className="ml-auto font-medium">{hotB.label}</span> : <span className="ml-auto text-neutral-600">Наведите на период, чтобы увидеть числа</span>}
      </div>
    </div>
  );
}

function GranSwitch({ gran, onGran }: { gran: Gran; onGran: (g: Gran) => void }) {
  return (
    <div role="group" aria-label="Период графика" className={segGroup}>
      {(Object.keys(GRAN_LABEL) as Gran[]).map((g) => <button key={g} type="button" aria-pressed={gran === g} onClick={() => onGran(g)} className={seg(gran === g)}>{GRAN_LABEL[g]}</button>)}
    </div>
  );
}

/** Главный график «Приход · Продажи · Остаток»: единственное место этого ряда на странице. */
export function SalesCharts({ buckets, gran, onGran, hot, setHot }: { buckets: Bucket[]; gran: Gran; onGran: (g: Gran) => void; hot: number | null; setHot: (i: number | null) => void }) {
  return (
    <section aria-label="Приход, продажи и остаток по периодам" data-metric="chart-flow" className="flex min-w-0 flex-col gap-3 rounded-lg border border-neutral-300 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Приход · Продажи · Остаток</h2>
        <GranSwitch gran={gran} onGran={onGran} />
      </div>
      {buckets.length === 0 ? <p className="text-sm text-neutral-700">Нет движений за выбранный период.</p> : (
        <Chart buckets={buckets} hot={hot} setHot={setHot} label="Приход и продажи столбцами, остаток нарастающим итогом линией" fmtL={(v) => n0(Math.round(v))} fmtR={(v) => n0(Math.round(v))}
          series={[
            { name: "Получено, шт.", color: NAVY, vals: buckets.map((b) => b.m.received), kind: "bar", axis: "l" },
            { name: "Продано, шт.", color: GET, vals: buckets.map((b) => Math.max(0, b.m.sold)), kind: "bar", axis: "l" },
            { name: "Остаток, шт.", color: STOCK, vals: buckets.map((b) => b.stock), kind: "line", axis: "r" },
          ]} />
      )}
    </section>
  );
}

/** График «Выручка и цена» — во вкладке «Динамика». */
export function RevenueChart({ buckets, gran, onGran, ex }: { buckets: Bucket[]; gran: Gran; onGran: (g: Gran) => void; ex: boolean }) {
  const [hot, setHot] = useState<number | null>(null);
  return (
    <div data-metric="chart-revenue" className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Выручка и цена, {ex ? "без НДС" : "с НДС"}</h3>
        <GranSwitch gran={gran} onGran={onGran} />
      </div>
      {buckets.length === 0 ? <p className="text-sm text-neutral-700">Нет данных.</p> : (
        <Chart buckets={buckets} hot={hot} setHot={setHot} label="Выручка столбцами, средняя цена продажи линией" fmtL={(v) => moneyC(v).replace(/\s*₽$/, "")} fmtR={(v) => moneyC(v).replace(/\s*₽$/, "")}
          series={[
            { name: "Выручка, ₽", color: REV, vals: buckets.map((b) => Math.max(0, b.m.revenue)), kind: "bar", axis: "l" },
            { name: "Средняя цена, ₽", color: PRICE, vals: buckets.map((b) => b.m.avgPrice ?? Number.NaN), kind: "line", axis: "r" },
          ]} />
      )}
    </div>
  );
}
