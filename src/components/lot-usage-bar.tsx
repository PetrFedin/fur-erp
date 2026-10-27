"use client";

import Link from "next/link";
import { TH as Head } from "@/components/table-head";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatPercent, formatQty, formatDec1 } from "@/lib/utils";

/** Сегмент схемы: ТЗ, списавшее с лота, «прочее списание» (не через ТЗ) или остаток. Количества — в единицах лота (шт. / м). */
export type UsageSeg = {
  key: string;
  kind: "order" | "other" | "rem";
  /** Короткая подпись: «ТЗ 164». */
  label: string;
  /** Артикул (для ТЗ). */
  sku?: string | null;
  href?: string;
  qty: number;
  /** Дата списания, уже отформатированная (для ТЗ). */
  date?: string | null;
  /** Сумма ₽ (с НДС / без — как в шапке), готовый узел. */
  cost?: ReactNode;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pct = (q: number, total: number) => (total > 0 ? (q / total) * 100 : 0);

/** Палитра темы: оттенки акцента (--ui-accent; в «Текущем» он нейтральный) вперемешку с нейтральными — соседние сегменты различимы. */
const TONES = [
  "var(--ui-accent)",
  "#6b6b6b",
  "color-mix(in srgb, var(--ui-accent) 62%, white)",
  "#a3a3a3",
  "color-mix(in srgb, var(--ui-accent) 82%, black)",
  "#8a8a8a",
  "color-mix(in srgb, var(--ui-accent) 38%, white)",
  "#4d4d4d",
];
const toneOf = (i: number) => TONES[i % TONES.length];
const OTHER_BG = "repeating-linear-gradient(45deg, #d4d4d4 0 4px, #ececec 4px 8px)";
const REM_BORDER = "1.5px dashed var(--ui-accent)";
const HOVER_BG = "var(--ui-field-bg, #fff1eb)";

const tipOf = (s: UsageSeg, total: number, unit: string) =>
  s.kind === "order"
    ? `${s.label}${s.sku ? ` · ${s.sku}` : ""} · ${formatDec1(s.qty)} ${unit} · ${formatPercent(pct(s.qty, total))}`
    : `${s.label} · ${formatDec1(s.qty)} ${unit} · ${formatPercent(pct(s.qty, total))}`;

function Marker({ seg, bg }: { seg: UsageSeg; bg: string }) {
  return <span aria-hidden className="mr-2 inline-block h-3 w-3 shrink-0 rounded-sm align-middle" style={seg.kind === "rem" ? { border: REM_BORDER, background: "#fafaf9" } : { background: bg }} />;
}

/** Схема расхода лота: составная полоса «ТЗ | прочее | остаток», линия остатка, легенда-таблица (карточки на телефоне), график «остаток по времени». */
export function LotUsageViz({
  unit,
  recv,
  startDate,
  segs,
  totalCost,
}: {
  unit: string;
  recv: number;
  /** Дата закупки (старт графика), отформатированная. */
  startDate: string;
  segs: UsageSeg[];
  /** Сумма лота при закупке (узел) — для итоговой строки легенды. */
  totalCost?: ReactNode;
}) {
  const [active, setActive] = useState<string | null>(null);
  const total = recv > 0 ? recv : segs.reduce((a, s) => a + s.qty, 0);
  const orders = segs.filter((s) => s.kind === "order");
  const other = segs.find((s) => s.kind === "other");
  const rem = segs.find((s) => s.kind === "rem");
  const usedQty = r3(orders.reduce((a, s) => a + s.qty, 0));
  const remQty = rem?.qty ?? 0;
  const boundary = pct(total - remQty, total); // граница «использовано | остаток», %
  const on = (k: string | null) => ({ onMouseEnter: () => setActive(k), onMouseLeave: () => setActive(null), onFocus: () => setActive(k), onBlur: () => setActive(null) });
  const toneByKey = new Map<string, string>();
  orders.forEach((s, i) => toneByKey.set(s.key, toneOf(i)));
  const bgOf = (s: UsageSeg) => (s.kind === "other" ? OTHER_BG : s.kind === "rem" ? "#fafaf9" : (toneByKey.get(s.key) ?? toneOf(0)));
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  const rowCls = (k: string) => "transition-colors " + (active === k ? "shadow-[inset_0_0_0_1.5px_var(--ui-accent)]" : "");
  const rowStyle = (k: string) => (active === k ? { background: HOVER_BG } : undefined);

  const cells = (s: UsageSeg) => ({
    title: s.kind === "order" ? (s.href ? <Link href={s.href} className="text-blue-700 hover:underline">{s.label}</Link> : s.label) : s.kind === "rem" ? <b>Остаток</b> : "Прочее списание (не через ТЗ)",
    sku: s.kind === "order" ? (s.sku ?? "–") : "–",
    date: s.kind === "order" ? (s.date ?? "–") : "–",
  });

  return (
    <div className="flex flex-col gap-3">
      {/* итоги */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm tabular-nums">
        <span>Куплено: <b>{formatDec1(total)} {unit}</b></span>
        <span>Использовано: <b>{formatDec1(usedQty)} {unit}</b> ({formatPercent(pct(usedQty, total))})</span>
        {other && <span>Прочее списание: <b>{formatDec1(other.qty)} {unit}</b> ({formatPercent(pct(other.qty, total))})</span>}
        <span>Остаток: <b>{formatDec1(remQty)} {unit}</b> ({formatPercent(pct(remQty, total))})</span>
      </div>

      {/* шкала 0 … всего */}
      <div className="relative mt-1 h-4 text-[11px] text-neutral-600 tabular-nums" aria-hidden>
        {ticks.map((t, i) => (
          <span
            key={t}
            className={"absolute top-0 whitespace-nowrap " + (i % 2 === 1 ? "hidden sm:block" : "")}
            style={t === 1 ? { right: 0 } : t === 0 ? { left: 0 } : { left: `${t * 100}%`, transform: "translateX(-50%)" }}
          >
            {t === 0 ? "0" : `${formatDec1(r3(total * t))}${t === 1 ? ` ${unit}` : ""}`}
          </span>
        ))}
      </div>

      {/* составная полоса */}
      <div className="relative pb-6">
        <div role="group" aria-label={`Схема расхода лота: куплено ${formatDec1(total)} ${unit}, использовано ${formatDec1(usedQty)}, остаток ${formatDec1(remQty)}`} className="flex h-9 w-full overflow-hidden rounded-md border border-neutral-300 bg-white" data-testid="lot-usage-bar">
          {segs.filter((s) => s.qty > 0).map((s) => {
            const w = pct(s.qty, total);
            const style: React.CSSProperties = {
              flex: `${s.qty} 1 0`,
              minWidth: 2,
              background: bgOf(s),
              opacity: active && active !== s.key ? 0.55 : 1,
              ...(s.kind === "rem" ? { borderLeft: "none" } : { borderRight: "1px solid #fff" }),
              ...(active === s.key ? { boxShadow: "inset 0 0 0 2px var(--ui-accent), inset 0 0 0 3px #fff" } : {}),
            };
            const common = { style, title: tipOf(s, total, unit), "aria-label": tipOf(s, total, unit), "data-seg": s.key, "data-qty": s.qty, ...on(s.key) };
            if (s.kind === "order" && s.href) {
              return <Link key={s.key} href={s.href} className="block min-w-0 transition-opacity focus-visible:outline-2" {...common} />;
            }
            return (
              <div key={s.key} tabIndex={0} role="img" className="flex min-w-0 items-center overflow-hidden px-2 text-xs text-neutral-800 focus-visible:outline-2" {...common}>
                {s.kind === "rem" && w >= 16 ? <span className="truncate">Остаток {formatDec1(s.qty)} {unit} ({formatPercent(w)})</span> : null}
              </div>
            );
          })}
        </div>
        {/* линия остатка */}
        <div aria-hidden className="pointer-events-none absolute top-0 h-9" style={{ left: `${boundary}%`, width: 0 }}>
          <div className="absolute -top-1 -bottom-1 -translate-x-1/2" style={{ width: 3, background: "var(--ui-accent)", boxShadow: "0 0 0 1px #fff" }} />
        </div>
        <div
          className="absolute top-10 whitespace-nowrap text-xs font-medium tabular-nums"
          style={{ color: "var(--ui-accent-text)", ...(boundary > 70 ? { right: `${100 - boundary}%`, textAlign: "right" } : boundary < 8 ? { left: `${boundary}%` } : { left: `${boundary}%`, transform: "translateX(-50%)" }) }}
          data-testid="lot-usage-marker"
        >
          остаток: {formatDec1(remQty)} {unit}
        </div>
      </div>

      {/* легенда: таблица на широком экране */}
      <div className="hidden lg:block">
        <table className="w-full text-sm" data-testid="lot-usage-legend">
          <caption className="sr-only">Расход лота по ТЗ</caption>
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-600">
              <th className="w-6 py-1.5 pr-2 font-medium"><span className="sr-only">Цвет</span></th>
              <th className="py-1.5 pr-3 font-medium">ТЗ</th>
              <th className="py-1.5 pr-3 font-medium">Артикул</th>
              <th className="py-1.5 pr-3 text-right font-medium">Кол-во, {unit}</th>
              <th className="py-1.5 pr-3 text-right font-medium">Доля от лота</th>
              <Head label="Сумма" unit="₽" align="right" />
              <th className="py-1.5 font-medium">Дата списания</th>
            </tr>
          </thead>
          <tbody>
            {segs.map((s) => {
              const c = cells(s);
              return (
                <tr key={s.key} className={"border-b border-neutral-100 " + rowCls(s.key)} style={rowStyle(s.key)} {...on(s.key)}>
                  <td className="py-1.5 pl-1 pr-2"><Marker seg={s} bg={bgOf(s)} /></td>
                  <td className="py-1.5 pr-3">{c.title}</td>
                  <td className="py-1.5 pr-3">{c.sku}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatDec1(s.qty)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatPercent(pct(s.qty, total))}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{s.cost ?? "–"}</td>
                  <td className="whitespace-nowrap py-1.5">{c.date}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-neutral-300 font-semibold">
              <td />
              <td className="py-1.5 pr-3" colSpan={2}>Куплено (всего)</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{formatDec1(total)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{formatPercent(100)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{totalCost ?? "–"}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {/* легенда: карточки на узком экране */}
      <ul className="flex flex-col gap-2 lg:hidden" data-testid="lot-usage-legend-cards">
        {segs.map((s) => {
          const c = cells(s);
          return (
            <li key={s.key} className={"rounded-lg border border-neutral-200 p-3 text-sm " + rowCls(s.key)} style={rowStyle(s.key)} {...on(s.key)}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 font-medium"><Marker seg={s} bg={bgOf(s)} />{c.title}</span>
                <span className="shrink-0 tabular-nums">{formatDec1(s.qty)} {unit} · {formatPercent(pct(s.qty, total))}</span>
              </div>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-neutral-600">
                {s.kind === "order" && (<><dt>Артикул</dt><dd className="break-words">{c.sku}</dd><dt>Дата</dt><dd>{c.date}</dd></>)}
                <dt>Сумма, ₽</dt><dd className="tabular-nums">{s.cost ?? "–"}</dd>
              </dl>
            </li>
          );
        })}
        <li className="rounded-lg bg-neutral-50 p-3 text-sm font-semibold">
          Куплено: {formatDec1(total)} {unit} · {formatPercent(100)}{totalCost ? <> · {totalCost}</> : null}
        </li>
      </ul>

      <RemainderChart unit={unit} recv={total} startDate={startDate} orders={orders} other={other} />
    </div>
  );
}

type Step = { key: string; label: string; date: string; qty: number; bal: number };

/** Ступенчатый график остатка лота после каждого списания: старт = куплено, каждое ТЗ — ступенька вниз. SVG без библиотек, ширина по контейнеру. */
function RemainderChart({ unit, recv, startDate, orders, other }: { unit: string; recv: number; startDate: string; orders: UsageSeg[]; other?: UsageSeg }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, Math.floor(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(280, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);

  const list = [...orders, ...(other ? [other] : [])];
  const steps: Step[] = [];
  let bal = recv;
  for (const s of list) {
    bal = r3(bal - s.qty);
    steps.push({ key: s.key, label: s.kind === "order" ? s.label : "Прочее", date: s.kind === "order" ? (s.date ?? "без даты") : "без даты", qty: s.qty, bal });
  }

  const title = "Остаток лота по времени";
  if (steps.length === 0) {
    return (
      <section aria-label={title} className="mt-1 border-t border-neutral-100 pt-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-sm text-neutral-600">Списаний не было: остаток равен количеству при закупке ({formatDec1(recv)} {unit}).</p>
      </section>
    );
  }

  const H = 210, L = 44, R = 14, T = 16, B = 46;
  const pw = w - L - R, ph = H - T - B;
  const n = steps.length;
  const xAt = (i: number) => L + (i / (n + 1)) * pw; // i = 0..n; справа свободное поле до «сейчас»
  const yAt = (v: number) => T + ph - (recv > 0 ? (Math.max(0, v) / recv) * ph : 0);
  let d = `M${xAt(0)} ${yAt(recv)}`;
  steps.forEach((s, i) => { d += ` H${xAt(i + 1)} V${yAt(s.bal)}`; });
  const lastBal = steps[n - 1].bal;
  d += ` H${L + pw}`;
  const area = `${d} V${T + ph} H${xAt(0)} Z`;
  const every = Math.max(1, Math.ceil(104 / (pw / (n + 1))));
  const summary = `${title}: куплено ${formatDec1(recv)} ${unit} (${startDate}); ${steps.map((s) => `${s.label} ${s.date}: остаток ${formatDec1(s.bal)}`).join("; ")}.`;

  return (
    <section aria-label={title} className="mt-1 border-t border-neutral-100 pt-3" data-testid="lot-remainder-chart">
      <h3 className="text-sm font-medium">{title}</h3>
      <div ref={wrap} className="mt-1 w-full">
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={summary} className="block max-w-full">
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={L} x2={L + pw} y1={yAt(recv * t)} y2={yAt(recv * t)} stroke="#e5e5e5" strokeWidth={1} />
              <text x={L - 6} y={yAt(recv * t) + 4} textAnchor="end" fontSize={11} fill="#525252">{formatDec1(r3(recv * t))}</text>
            </g>
          ))}
          <text x={4} y={11} fontSize={11} fill="#525252">{unit}</text>
          <path d={area} fill="var(--ui-soft)" opacity={0.7} />
          <path d={d} fill="none" stroke="var(--ui-accent)" strokeWidth={2.5} strokeLinejoin="round" />
          {/* остаток сейчас */}
          <line x1={xAt(n)} x2={L + pw} y1={yAt(lastBal)} y2={yAt(lastBal)} stroke="var(--ui-accent)" strokeWidth={2.5} strokeDasharray="5 4" />
          <text x={L + pw} y={yAt(lastBal) - 6} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--ui-accent-text)" stroke="#fff" strokeWidth={3} paintOrder="stroke">остаток: {formatDec1(lastBal)}</text>
          {[{ label: "Покупка", date: startDate, bal: recv, qty: 0 }, ...steps].map((s, i) => (
            <g key={i}>
              <circle cx={xAt(i)} cy={yAt(s.bal)} r={4} fill="var(--ui-accent)" stroke="#fff" strokeWidth={1.5}>
                <title>{i === 0 ? `Покупка ${s.date}: ${formatDec1(recv)} ${unit}` : `${s.label} · ${s.date} · −${formatDec1(s.qty)} ${unit} · остаток ${formatDec1(s.bal)}`}</title>
              </circle>
              {i % every === 0 ? (
                <text x={xAt(i)} y={T + ph + 15} textAnchor="middle" fontSize={10.5} fill="#404040">
                  <tspan x={xAt(i)}>{s.label}</tspan>
                  <tspan x={xAt(i)} dy={12} fill="#525252">{s.date}</tspan>
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
      <details className="mt-1 text-sm">
        <summary className="cursor-pointer text-xs text-neutral-600">Таблица данных графика</summary>
        <table className="mt-1 w-full max-w-xl text-xs">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-600">
              <th className="py-1 pr-3 font-medium">Событие</th>
              <th className="py-1 pr-3 font-medium">Дата</th>
              <th className="py-1 pr-3 text-right font-medium">Списано, {unit}</th>
              <th className="py-1 text-right font-medium">Остаток, {unit}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-100"><td className="py-1 pr-3">Покупка</td><td className="py-1 pr-3">{startDate}</td><td className="py-1 pr-3 text-right">–</td><td className="py-1 text-right tabular-nums">{formatDec1(recv)}</td></tr>
            {steps.map((s) => (
              <tr key={s.key} className="border-b border-neutral-100">
                <td className="py-1 pr-3">{s.label}</td>
                <td className="py-1 pr-3">{s.date}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{formatDec1(s.qty)}</td>
                <td className="py-1 text-right tabular-nums">{formatDec1(s.bal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

/** Компактная полоса для строк списков: использовано (акцент) | остаток (светло-серый) + «X,X% использовано». */
export function LotUsageMini({ recv, used, unit, className }: { recv: number; used: number; unit: string; className?: string }) {
  const p = recv > 0 ? Math.min(100, Math.max(0, (used / recv) * 100)) : 0;
  return (
    <div className={className} data-testid="lot-usage-mini">
      <div
        role="img"
        aria-label={`Использовано ${formatDec1(used)} из ${formatDec1(recv)} ${unit} (${formatPercent(p)}), остаток ${formatDec1(Math.max(0, Math.round((recv - used) * 1000) / 1000))} ${unit}`}
        className="h-2.5 w-full overflow-hidden rounded-full"
        style={{ background: "#e7e5e4" }}
      >
        <div className="h-full" style={{ width: `${p}%`, background: "var(--ui-accent)" }} />
      </div>
      <div className="mt-0.5 text-[11px] leading-4 text-neutral-600 tabular-nums">{formatPercent(p)} использовано</div>
    </div>
  );
}
