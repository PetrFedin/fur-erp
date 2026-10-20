"use client";

import { useState } from "react";
import { InfoHint } from "@/components/info-hint";
import { TILE_BOX, TileHead } from "./tile";
import { GET, NAVY, REV, STOCK, moneyC, n0 } from "../sales/sales-fmt";

// Графики блока «Продажи и остатки» на Главной: столбцы и линия на двух шкалах, как в разделе /sales, но в оформлении плиток Главной.
// Широкий ряд прокручивается внутри карточки; подсказка с цифрами — при наведении или касании периода и в строке под графиком.

type Series = { name: string; color: string; vals: number[]; kind: "bar" | "line"; axis: "l" | "r"; fmt: (v: number) => string };
type Pt = { key: string; label: string };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

const H = 230, PT = 14, PB = 46, PL = 46, PR = 52;

function Chart({ pts, series, label, testId }: { pts: Pt[]; series: Series[]; label: string; testId: string }) {
  const [hot, setHot] = useState<number | null>(null);
  const n = pts.length;
  const colW = n > 20 ? 34 : n > 8 ? 44 : 72;
  const W = PL + PR + n * colW;
  const bars = series.filter((s) => s.kind === "bar"), lines = series.filter((s) => s.kind === "line");
  const maxL = niceMax(Math.max(...series.filter((s) => s.axis === "l").flatMap((s) => s.vals), 0));
  const maxR = niceMax(Math.max(...series.filter((s) => s.axis === "r").flatMap((s) => s.vals), 0));
  const yL = (v: number) => PT + (H - PT - PB) * (1 - v / maxL), yR = (v: number) => PT + (H - PT - PB) * (1 - v / maxR);
  const bw = Math.max(6, Math.min(24, (colW - 10) / Math.max(1, bars.length)));
  const x = (i: number) => PL + i * colW + colW / 2;
  const fmtL = (v: number) => (series.find((s) => s.axis === "l")?.fmt ?? n0)(v), fmtR = (v: number) => (series.find((s) => s.axis === "r")?.fmt ?? n0)(v);
  const hasR = series.some((s) => s.axis === "r");
  return (
    <div className="relative min-w-0" data-testid={testId}>
      <div className="overflow-x-auto" data-keep-scroll tabIndex={0} role="img" aria-label={label}>
        <svg width={Math.max(W, 300)} height={H} className="block" onMouseLeave={() => setHot(null)}>
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={PL} x2={W - PR} y1={yL(maxL * t)} y2={yL(maxL * t)} stroke="#e5e5e5" />
              <text x={PL - 6} y={yL(maxL * t) + 4} textAnchor="end" fontSize="11" fill="#525252">{fmtL(maxL * t)}</text>
              {hasR ? <text x={W - PR + 6} y={yR(maxR * t) + 4} fontSize="11" fill="#525252">{fmtR(maxR * t)}</text> : null}
            </g>
          ))}
          {pts.map((p, i) => (
            <g key={p.key} onMouseEnter={() => setHot(i)} onClick={() => setHot(i)}>
              <rect x={PL + i * colW} y={PT} width={colW} height={H - PT - PB} fill={hot === i ? "#f5f5f5" : "transparent"} />
              {bars.map((s, si) => {
                const v = s.vals[i], h = (H - PT - PB) * (v / maxL);
                return v > 0 ? <rect key={s.name} x={x(i) - (bars.length * bw) / 2 + si * bw} y={yL(v)} width={bw - 1} height={h} fill={s.color} rx="1"><title>{`${p.label}: ${s.name} ${s.fmt(v)}`}</title></rect> : null;
              })}
              <text x={x(i)} y={H - PB + 14} textAnchor={n > 8 ? "end" : "middle"} fontSize="11" fill="#404040" transform={n > 8 ? `rotate(-35 ${x(i)} ${H - PB + 14})` : undefined}>{p.label}</text>
            </g>
          ))}
          {lines.map((s) => {
            const f = s.axis === "l" ? yL : yR;
            return (
              <g key={s.name}>
                <polyline points={s.vals.map((v, i) => `${x(i)},${f(v)}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2" />
                {s.vals.map((v, i) => <circle key={i} cx={x(i)} cy={f(v)} r={hot === i ? 4 : 3} fill={s.color}><title>{`${pts[i].label}: ${s.name} ${s.fmt(v)}`}</title></circle>)}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-1 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-700" aria-live="polite">
        {series.map((s) => <span key={s.name} className="inline-flex items-center gap-1"><i aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />{s.name}{hot !== null ? <b className="tabular-nums text-neutral-900"> {s.fmt(s.vals[hot])}</b> : null}</span>)}
        {hot !== null ? <span className="ml-auto font-medium text-neutral-900">{pts[hot].label}</span> : <span className="ml-auto text-neutral-500">Наведите или коснитесь периода, чтобы увидеть числа</span>}
      </div>
    </div>
  );
}

export type FlowPoint = { key: string; label: string; received: number; sold: number; stock: number };
export type SeasonPoint = { key: string; sold: number; revenue: number };

const pcs = (v: number) => n0(Math.round(v));

/** «Приход · Продажи · Остаток» по месяцам: столбцы — получено и продано, линия — остаток нарастающим итогом (правая шкала). */
export function FlowChart({ points }: { points: FlowPoint[] }) {
  return (
    <div className={TILE_BOX} data-hover-block="sales-flow">
      <TileHead>Приход · Продажи · Остаток по месяцам</TileHead>
      <div className="absolute right-3 top-3">
        <InfoHint label="Как читать график прихода, продаж и остатка" align="right">
          <p>Столбцы — штуки за месяц: <b>Получено</b> (приход, корректировки с минусом уже вычтены) и <b>Продано</b> (нетто: валовое минус возвраты). Линия — <b>остаток</b> нарастающим итогом на конец месяца (правая шкала): приход минус продано{" "}с начала данных.</p>
          <p className="mt-1">Те же числа, что на вкладке «Обзор» в «Продажи и остатки». Год — из шапки сайта.</p>
        </InfoHint>
      </div>
      {points.length === 0 ? <p className="mt-2 text-sm text-neutral-600">Нет движений за выбранный период.</p> : (
        <div className="mt-2">
          <Chart testId="dash-sales-chart-flow" pts={points} label="Приход и продажи столбцами по месяцам, остаток нарастающим итогом линией"
            series={[
              { name: "Получено, шт.", color: NAVY, vals: points.map((p) => p.received), kind: "bar", axis: "l", fmt: pcs },
              { name: "Продано, шт.", color: GET, vals: points.map((p) => Math.max(0, p.sold)), kind: "bar", axis: "l", fmt: pcs },
              { name: "Остаток, шт.", color: STOCK, vals: points.map((p) => p.stock), kind: "line", axis: "r", fmt: pcs },
            ]} />
        </div>
      )}
    </div>
  );
}

/** «Продано по сезонам»: столбцы — штуки (нетто), линия — выручка в выбранном режиме НДС (правая шкала). */
export function SeasonChart({ points, vatNote }: { points: SeasonPoint[]; vatNote: string }) {
  return (
    <div className={TILE_BOX} data-hover-block="sales-seasons">
      <TileHead>Продано по сезонам</TileHead>
      <div className="absolute right-3 top-3">
        <InfoHint label="Как читать график продаж по сезонам" align="right">
          <p>Сезон — по заказу в выгрузке продаж (FW 25/26, SS 2026, FW 26/27). Столбцы — продано, штуки нетто; линия — выручка, ₽ ({vatNote}), правая шкала. Режим НДС переключается в шапке сайта.</p>
        </InfoHint>
      </div>
      {points.length === 0 ? <p className="mt-2 text-sm text-neutral-600">Нет продаж за выбранный период.</p> : (
        <div className="mt-2">
          <Chart testId="dash-sales-chart-seasons" pts={points.map((p) => ({ key: p.key, label: p.key }))} label={`Продано штук по сезонам столбцами, выручка ${vatNote} линией`}
            series={[
              { name: "Продано, шт.", color: GET, vals: points.map((p) => Math.max(0, p.sold)), kind: "bar", axis: "l", fmt: pcs },
              { name: `Выручка, ₽ (${vatNote})`, color: REV, vals: points.map((p) => Math.max(0, p.revenue)), kind: "line", axis: "r", fmt: (v) => moneyC(v) },
            ]} />
        </div>
      )}
    </div>
  );
}
