"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FLOWS, FUTURE, type Branch, type CardKey, type Future, type Step } from "./data";
import { IconGear, IconPencil } from "@/components/icons";

/* ───────────── раскладка: схема в центре, планы Веллмеха слева и сверху, наш план справа и снизу ───────────── */

type R = { x: number; y: number; w: number; h: number };
const NW = 210, NH = 76, PH = 64;
/** Блоки шагов 1–8 (в порядке STEPS). Шаг 8 — широкая полоса внизу, в неё «стекается» всё остальное. */
const NODES: R[] = [
  { x: 445, y: 110, w: NW, h: NH }, { x: 205, y: 260, w: NW, h: NH }, { x: 685, y: 260, w: NW, h: NH }, { x: 445, y: 410, w: NW, h: NH },
  { x: 205, y: 560, w: NW, h: NH }, { x: 445, y: 560, w: NW, h: NH }, { x: 685, y: 560, w: NW, h: NH }, { x: 445, y: 710, w: 450, h: NH },
];
/** Положение плановых блоков: индекс = индекс в FUTURE (data.ts). Зелёные — слева и сверху, красные — справа и снизу, каждый рядом со своим шагом. */
const PLAN_POS: R[] = [
  { x: 450, y: 8, w: 200, h: PH },     // Документы Веллмеха автоматически → 1
  { x: 0, y: 566, w: 165, h: PH },     // Приёмка оплат и смет → 5
  { x: 0, y: 266, w: 165, h: PH },     // Этапы сырья из Excel → 2
  { x: 935, y: 690, w: 165, h: PH },   // Второй подрядчик → 8
  { x: 935, y: 462, w: 165, h: PH },   // «Веллмех» → любой подрядчик → 4
  { x: 150, y: 820, w: 165, h: PH },   // Авансы по счетам и спецификациям → 5
  { x: 935, y: 380, w: 165, h: PH },   // Статусы ТЗ → 4
  { x: 935, y: 84, w: 165, h: PH },    // Мост Telegram и WhatsApp → 1
  { x: 935, y: 156, w: 165, h: PH },   // Демо-стенд для внешних → 1
  { x: 935, y: 272, w: 165, h: PH },   // Прогноз закупок → 3
  { x: 935, y: 566, w: 165, h: PH },   // Продажи и скорость продаж → 7
  { x: 935, y: 762, w: 165, h: PH },   // Мобильная версия → 8
  { x: 335, y: 820, w: 165, h: PH },   // Банк, 1С и ЭДО → 5
];
const VIEW_W = 1100, VIEW_H = 900;

/** Линии связей между шагами: f → t по номерам шагов (FLOWS); координаты подобраны под NODES. Связи в шаг 8 показаны номерами на его полосе. */
const EDGES: { f: number; t: number; d: string; lx?: number; ly?: number; dash?: boolean }[] = [
  { f: 1, t: 2, d: "M 490 186 C 490 226 330 216 330 260", lx: 405, ly: 224 },
  { f: 1, t: 4, d: "M 550 186 V 410", lx: 550, ly: 298 },
  { f: 2, t: 4, d: "M 395 336 C 395 392 425 440 445 440", lx: 410, ly: 374 },
  { f: 3, t: 4, d: "M 750 336 C 750 400 695 448 655 448", lx: 745, ly: 380 },
  { f: 3, t: 7, d: "M 790 336 V 560", lx: 790, ly: 448 },
  { f: 4, t: 6, d: "M 550 486 V 560", lx: 550, ly: 523 },
  { f: 4, t: 7, d: "M 635 486 C 635 530 720 520 720 560", lx: 683, ly: 528 },
  { f: 2, t: 5, d: "M 245 336 V 560", lx: 245, ly: 420 },
  { f: 4, t: 5, d: "M 470 486 C 470 536 405 526 405 560", lx: 437, ly: 524 },
  { f: 5, t: 2, d: "M 300 560 V 336", lx: 300, ly: 470, dash: true },
  { f: 5, t: 4, d: "M 360 560 C 360 505 410 470 445 470", dash: true },
];

const SIDE = {
  wellmekh: { stroke: "#059669", fill: "#ecfdf5", hot: "#a7f3d0", text: "#065f46", sub: "#047857", marker: "arr-g", name: "Веллмех" },
  ours: { stroke: "#dc2626", fill: "#fef2f2", hot: "#fecaca", text: "#991b1b", sub: "#b91c1c", marker: "arr-r", name: "Наш план" },
} as const;

function wrap(t: string, n: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of t.split(" ")) {
    if ((cur + " " + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}

const mid = (r: R) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
/** С какой стороны шага подходит линия от планового блока: l/r/t/b. */
function sideOnStep(a: R, b: R): "l" | "r" | "t" | "b" {
  const ca = mid(a), cb = mid(b);
  if (Math.abs(cb.x - ca.x) > (a.w + b.w) / 2) return cb.x > ca.x ? "l" : "r";
  return cb.y > ca.y ? "t" : "b";
}
/** Пунктирная связь плановый блок ↔ шаг: кубическая кривая от края блока к краю шага; offB смещает точку вдоль стороны шага. */
function planPath(a: R, b: R, offB: number, reverse: boolean): string {
  const s = sideOnStep(a, b);
  const ca = mid(a), cb = mid(b);
  let p1: { x: number; y: number }, p2: { x: number; y: number }, c1: { x: number; y: number }, c2: { x: number; y: number };
  if (s === "l" || s === "r") {
    const dir = s === "l" ? 1 : -1;
    p1 = { x: dir > 0 ? a.x + a.w : a.x, y: ca.y };
    p2 = { x: dir > 0 ? b.x : b.x + b.w, y: cb.y + offB };
    const k = Math.max(24, Math.abs(p2.x - p1.x) * 0.4);
    c1 = { x: p1.x + dir * k, y: p1.y }; c2 = { x: p2.x - dir * k, y: p2.y };
  } else {
    const dir = s === "t" ? 1 : -1;
    p1 = { x: ca.x, y: dir > 0 ? a.y + a.h : a.y };
    p2 = { x: cb.x + offB, y: dir > 0 ? b.y : b.y + b.h };
    const k = Math.max(24, Math.abs(p2.y - p1.y) * 0.4);
    c1 = { x: p1.x, y: p1.y + dir * k }; c2 = { x: p2.x, y: p2.y - dir * k };
  }
  const f = (n: number) => Math.round(n * 10) / 10;
  return reverse
    ? `M ${f(p2.x)} ${f(p2.y)} C ${f(c2.x)} ${f(c2.y)} ${f(c1.x)} ${f(c1.y)} ${f(p1.x)} ${f(p1.y)}`
    : `M ${f(p1.x)} ${f(p1.y)} C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
}

/** Смещения основных линий вдоль стороны шага, чтобы линии к одному шагу не сливались. */
const SPREAD: Record<number, number> = { 4: 44 };
function primaryOffsets(): number[] {
  const groups = new Map<string, number[]>();
  FUTURE.forEach((f, k) => {
    const key = `${f.steps[0]}-${sideOnStep(PLAN_POS[k], NODES[f.steps[0] - 1])}`;
    groups.set(key, [...(groups.get(key) ?? []), k]);
  });
  const off: number[] = FUTURE.map(() => 0);
  groups.forEach((ks, key) => {
    const step = Number(key.split("-")[0]);
    const sp = SPREAD[step] ?? 24;
    ks.forEach((k, i) => { off[k] = (i - (ks.length - 1) / 2) * sp; });
  });
  return off;
}
const PRIMARY_OFF = primaryOffsets();

const stepName = (steps: Step[], n: number) => `${n}. ${steps[n - 1].title}`;
type Sel = { kind: "step"; i: number } | { kind: "branch"; i: number; j: number } | { kind: "future"; i: number } | null;
type Show = "all" | "wellmekh" | "ours";

/** Схема: узлы-коробки и линии; планы стоят вокруг схемы, каждый рядом со своим шагом. По клику открывается окно с подробностями. */
export function SchemeDiagram({ steps, cards }: { steps: Step[]; cards: Partial<Record<CardKey, string>> }) {
  const [sel, setSel] = useState<Sel>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [hoverF, setHoverF] = useState<number | null>(null);
  const [show, setShow] = useState<Show>("all");
  const [cardTop, setCardTop] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (sel && !d.open) d.showModal();
    if (!sel && d.open) d.close();
  }, [sel]);

  const visible = (f: Future) => show === "all" || f.side === show;
  const fHot = hoverF != null && visible(FUTURE[hoverF]) ? FUTURE[hoverF] : null;
  const hot = fHot ? null : hover ?? (sel && sel.kind !== "future" ? sel.i : null);
  const fut = sel && sel.kind === "future" ? FUTURE[sel.i] : null;
  const step = sel && sel.kind !== "future" ? steps[sel.i] : null;
  const takes = step && sel ? FLOWS.filter((f) => f.to === sel.i + 1) : [];
  const gives = step && sel ? FLOWS.filter((f) => f.from === sel.i + 1) : [];
  const branch: Branch | null = sel && sel.kind === "branch" ? steps[sel.i].branches[sel.j] : null;
  const plansOfStep = (n: number) => FUTURE.map((f, k) => ({ f, k })).filter((e) => e.f.steps.includes(n) && visible(e.f));
  const docked = (k: number) => (fHot ? FUTURE[k] === fHot : hot != null && FUTURE[k].steps.includes(hot + 1));
  const key = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } };
  const enterF = (k: number, el: Element) => { setHoverF(k); setCardTop(el.getBoundingClientRect().top + 32 > window.innerHeight / 2); };
  const sources = FLOWS.filter((f) => f.to === 8).map((f) => f.from);
  const dimStep = (i: number) => (fHot ? !fHot.steps.includes(i + 1) : false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700" data-legend>
        <span className="inline-flex items-center gap-1.5"><IconPencil className="h-3.5 w-3.5 text-amber-700" /> создают и правят вручную</span>
        <span className="inline-flex items-center gap-1.5"><IconGear className="h-3.5 w-3.5 text-emerald-700" /> собирается автоматически</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border-2 border-neutral-900 bg-white" /> уже есть</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border border-dashed border-emerald-600 bg-emerald-50" /> план Веллмеха</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border border-dashed border-red-500 bg-red-50" /> наш план</span>
        <div role="group" aria-label="Показать планы" className="ml-auto inline-flex items-center rounded-md border border-neutral-300 bg-white p-0.5" data-plan-filter>
          <span className="px-2 text-neutral-600">Планы:</span>
          {([["all", "Все"], ["wellmekh", "Веллмех"], ["ours", "Наш"]] as const).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={show === v} onClick={() => setShow(v)}
              className={"min-h-11 rounded px-3 text-xs md:min-h-7 " + (show === v ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")}>{l}</button>
          ))}
        </div>
      </div>

      {/* Схема для экрана от 768px: весь план вокруг основной схемы */}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white max-md:hidden" data-scheme>
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="mx-auto block w-full min-w-[1040px]" role="group" aria-label="Схема связей и взаимодействий">
          <defs>
            {([["arr", "#a3a3a3"], ["arr-hot", "#171717"], ["arr-g", "#059669"], ["arr-r", "#dc2626"]] as const).map(([id, c]) => (
              <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={c} /></marker>
            ))}
          </defs>
          <text x="0" y="26" fontSize="13" fontWeight="700" fill={SIDE.wellmekh.text} opacity={show === "ours" ? 0.3 : 1}>План Веллмеха</text>
          <text x={VIEW_W} y="26" textAnchor="end" fontSize="13" fontWeight="700" fill={SIDE.ours.text} opacity={show === "wellmekh" ? 0.3 : 1}>Наш план</text>

          {/* пунктирные связи планов с шагами (под блоками): основная всегда, остальные — при наведении */}
          {FUTURE.map((f, k) => {
            if (!visible(f)) return null;
            const c = SIDE[f.side];
            const on = docked(k);
            const dim = fHot ? !on : hot != null && !on;
            return f.steps.map((n, idx) => {
              if (idx > 0 && !on) return null;
              const reverse = f.dir === "out";
              const both = f.dir === "both" && idx === 0;
              return (
                <path key={`${k}-${n}`} data-plan-link={k + 1} d={planPath(PLAN_POS[k], NODES[n - 1], idx === 0 ? PRIMARY_OFF[k] : 0, reverse)} fill="none" stroke={c.stroke}
                  strokeWidth={on ? 2.2 : 1.4} strokeDasharray="6 4" opacity={on ? 0.9 : dim ? 0.2 : 0.65}
                  markerEnd={`url(#${c.marker})`} markerStart={both ? `url(#${c.marker})` : undefined} />
              );
            });
          })}

          {EDGES.map((e) => {
            const f = FLOWS.find((x) => x.from === e.f && x.to === e.t)!;
            const on = hot != null && (f.from === hot + 1 || f.to === hot + 1);
            return (
              <g key={`${e.f}-${e.t}`} opacity={fHot ? 0.15 : hot == null || on ? 1 : 0.25}>
                <title>{f.what}</title>
                <path d={e.d} fill="none" stroke={on ? "#171717" : "#a3a3a3"} strokeWidth={on ? 2 : 1.4} strokeDasharray={e.dash ? "5 4" : undefined} markerEnd={on ? "url(#arr-hot)" : "url(#arr)"} />
                {e.lx != null && e.ly != null && (
                  <g transform={`translate(${e.lx} ${e.ly})`}>
                    <rect x={-(f.label.length * 3.2 + 6)} y="-10" width={f.label.length * 6.4 + 12} height="19" rx="4" fill="white" opacity="0.94" />
                    <text textAnchor="middle" y="3.5" fontSize="12" fill={on ? "#171717" : "#525252"} fontWeight={on ? 600 : 400}>{f.label}</text>
                  </g>
                )}
              </g>
            );
          })}

          {steps.map((s, i) => {
            const p = NODES[i];
            const bar = i === 7;
            const lines = wrap(s.title, bar ? 30 : 20);
            const hasManual = s.entities.some((e) => e.kind !== "auto");
            const hasAuto = s.entities.some((e) => e.kind !== "manual");
            const isHot = hot === i;
            const ringed = fHot ? fHot.steps.includes(i + 1) : false;
            const c = fHot ? SIDE[fHot.side] : null;
            const ty = lines.length > 1 ? 26 : 32;
            return (
              <g key={s.title} data-step={i + 1} transform={`translate(${p.x} ${p.y})`} className="cursor-pointer" tabIndex={0} role="button" aria-label={`Шаг ${i + 1}. ${s.title}`}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                onClick={() => setSel({ kind: "step", i })} onKeyDown={key(() => setSel({ kind: "step", i }))}>
                <rect width={p.w} height={p.h} rx="12" fill={isHot ? "#171717" : ringed && c ? c.fill : "white"} stroke={ringed && c ? c.stroke : "#171717"} strokeWidth={ringed ? 4 : 2} opacity={dimStep(i) ? 0.35 : 1} />
                <circle cx="25" cy="38" r="14" fill={isHot ? "white" : "#171717"} opacity={dimStep(i) ? 0.35 : 1} />
                <text x="25" y="43" textAnchor="middle" fontSize="14" fontWeight="600" fill={isHot ? "#171717" : "white"}>{i + 1}</text>
                {lines.map((l, k) => <text key={k} x="48" y={ty + k * 16} fontSize="13.5" fontWeight="600" fill={isHot ? "white" : "#171717"} opacity={dimStep(i) ? 0.45 : 1}>{l}</text>)}
                {s.sub && <text x="48" y={lines.length > 1 ? 62 : 56} fontSize="12" fontStyle="italic" fill={isHot ? "#d4d4d4" : "#595959"} opacity={dimStep(i) ? 0.45 : 1}>{s.sub}</text>}
                {!bar && (
                  <g transform={`translate(${NW - 52} 50)`} aria-hidden>
                    {hasManual && <path transform="scale(0.85)" d="M2.5 13.5l.6-3L10.6 3a1.4 1.4 0 0 1 2 0l.4.4a1.4 1.4 0 0 1 0 2l-7.5 7.5-3 .6zM9.5 4.2l2.3 2.3" fill="none" stroke={isHot ? "#fcd34d" : "#b45309"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
                    {hasAuto && <g transform={`translate(${hasManual ? 24 : 0} 0) scale(0.85)`} fill="none" stroke={isHot ? "#6ee7b7" : "#047857"} strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" /></g>}
                  </g>
                )}
                {bar && (
                  <g aria-hidden>
                    <text x="236" y="26" fontSize="12" fill={isHot ? "#d4d4d4" : "#595959"}>собирается само из шагов</text>
                    {sources.map((n, k) => {
                      const lit = isHot || hot === n - 1 || (fHot ? fHot.steps.includes(n) : false);
                      return (
                        <g key={n} transform={`translate(${250 + k * 34} 52)`}>
                          <circle r="12" fill={lit ? (isHot ? "white" : "#171717") : "none"} stroke={isHot ? "white" : "#171717"} strokeWidth="1.5" opacity={lit ? 1 : 0.6} />
                          <text y="4.5" textAnchor="middle" fontSize="12" fontWeight="600" fill={lit ? (isHot ? "#171717" : "white") : isHot ? "white" : "#171717"}>{n}</text>
                        </g>
                      );
                    })}
                  </g>
                )}
              </g>
            );
          })}

          {/* плановые блоки: неактивны, пунктир; зелёные — план Веллмеха (слева и сверху), красные — наш план (справа и снизу) */}
          {FUTURE.map((f, k) => {
            if (!visible(f)) return null;
            const c = SIDE[f.side];
            const p = PLAN_POS[k];
            const on = docked(k);
            const dim = fHot ? !on : hot != null && !on;
            const lines = wrap(f.title, p.w > 180 ? 24 : 20);
            const maxSub = p.w > 180 ? 30 : 23;
            return (
              <g key={f.title} data-future={k + 1} data-side={f.side} transform={`translate(${p.x} ${p.y})`} className="cursor-pointer" tabIndex={0} role="button"
                aria-label={`${SIDE[f.side].name}: ${f.title} (пока не реализовано). Встроится в: ${f.steps.map((n) => stepName(steps, n)).join("; ")}`}
                opacity={dim ? 0.5 : 1}
                onMouseEnter={(e) => enterF(k, e.currentTarget)} onMouseLeave={() => setHoverF(null)} onFocus={(e) => enterF(k, e.currentTarget)} onBlur={() => setHoverF(null)}
                onClick={() => setSel({ kind: "future", i: k })} onKeyDown={key(() => setSel({ kind: "future", i: k }))}>
                <rect width={p.w} height={p.h} rx="10" fill={on ? c.hot : c.fill} stroke={c.stroke} strokeWidth={on ? 2.6 : 1.8} strokeDasharray="7 4" />
                {lines.slice(0, 2).map((l, j) => <text key={j} x="12" y={(lines.length > 1 ? 20 : 26) + j * 16} fontSize="13" fontWeight="600" fill={c.text}>{l}</text>)}
                <text x="12" y={lines.length > 1 ? 56 : 48} fontSize="12" fontStyle="italic" fill={c.sub}>{f.sub.length > maxSub ? f.sub.slice(0, maxSub - 1) + "…" : f.sub}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Телефон и узкий экран: вертикальный список, планы по группам */}
      <div className="flex flex-col gap-4 md:hidden" data-scheme-list>
        <section aria-label="Шаги схемы" className="rounded-xl border border-neutral-200 bg-white p-2">
          <ol className="flex flex-col gap-1">
            {steps.map((s, i) => (
              <li key={s.title}>
                <button type="button" onClick={() => setSel({ kind: "step", i })} aria-label={`Шаг ${i + 1}. ${s.title}`}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg border-2 border-neutral-900 bg-white px-3 py-2 text-left">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-white">{i + 1}</span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-neutral-900">{s.title}</span>{s.sub && <span className="block text-xs italic text-neutral-600">{s.sub}</span>}</span>
                  <span className="inline-flex shrink-0 gap-1" aria-hidden>
                    {s.entities.some((e) => e.kind !== "auto") && <IconPencil className="h-4 w-4 text-amber-700" />}
                    {s.entities.some((e) => e.kind !== "manual") && <IconGear className="h-4 w-4 text-emerald-700" />}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
        {(["wellmekh", "ours"] as const).filter((sd) => show === "all" || show === sd).map((sd) => {
          const c = SIDE[sd];
          return (
            <section key={sd} aria-label={sd === "wellmekh" ? "Веллмех: что планируется" : "Наш план"} className="rounded-xl border border-dashed p-2" style={{ borderColor: c.stroke, background: c.fill }}>
              <h2 className="px-1 pb-2 text-sm font-semibold" style={{ color: c.text }}>{sd === "wellmekh" ? "Веллмех: что планируется" : "Наш план"}</h2>
              <ul className="flex flex-col gap-1.5">
                {FUTURE.map((f, k) => ({ f, k })).filter((e) => e.f.side === sd).map(({ f, k }) => (
                  <li key={f.title}>
                    <button type="button" onClick={() => setSel({ kind: "future", i: k })} data-future={k + 1}
                      className="flex min-h-11 w-full flex-col justify-center rounded-lg border border-dashed bg-white/70 px-3 py-2 text-left" style={{ borderColor: c.stroke }}>
                      <span className="text-sm font-semibold" style={{ color: c.text }}>{f.title}</span>
                      <span className="text-xs" style={{ color: c.sub }}>встроится в: {f.steps.slice(0, 3).map((n) => `${n}. ${steps[n - 1].title}`).join(", ")}{f.steps.length > 3 ? "…" : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {fHot && (
        <aside aria-live="polite" data-link-panel
          className={"pointer-events-none fixed left-1/2 z-30 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border-2 bg-white p-3 shadow-xl max-md:hidden " + (cardTop ? "top-20 " : "bottom-4 ") + (fHot.side === "wellmekh" ? "border-emerald-500" : "border-red-500")}>
          <p className={"text-xs font-semibold " + (fHot.side === "wellmekh" ? "text-emerald-800" : "text-red-800")}>{SIDE[fHot.side].name} · пока не реализовано</p>
          <p className="mb-2 text-sm font-semibold text-neutral-900">{fHot.title}</p>
          <div className="grid grid-cols-3 gap-3 text-xs text-neutral-800">
            <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">Что даёт</p><ul className="flex flex-col gap-0.5">{fHot.gives.slice(0, 3).map((x) => <li key={x}>{x}</li>)}</ul></div>
            <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">С чем связано</p><ul className="flex flex-col gap-0.5">{fHot.steps.map((n) => <li key={n}>{stepName(steps, n)}</li>)}</ul></div>
            <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">Зависит от</p><p>{fHot.needs}</p></div>
          </div>
        </aside>
      )}

      <dialog
        ref={ref}
        onClose={() => setSel(null)}
        onClick={(e) => { if (e.target === ref.current) setSel(null); }}
        className="m-auto w-[min(34rem,calc(100vw-1.5rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl backdrop:bg-black/40"
      >
        {sel && (step || fut) && (
          <div className="flex max-h-[85vh] flex-col gap-3 overflow-y-auto p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-neutral-900">{fut ? fut.title : branch ? branch.title : step!.title}</h2>
                <p className="mt-0.5 text-xs text-neutral-600">
                  {fut ? `${SIDE[fut.side].name} · пока не реализовано` : branch ? `Часть шага ${sel.i + 1}: ${step!.title}` : step!.from ? `Данные берёт из: ${step!.from}` : "Начало цепочки"}
                </p>
              </div>
              <button type="button" onClick={() => setSel(null)} aria-label="Закрыть" title="Закрыть" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 md:h-8 md:w-8">✕</button>
            </div>

            {fut ? (
              <>
                <p className={"rounded-md px-3 py-1.5 text-xs font-medium " + (fut.side === "wellmekh" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900")}>
                  {fut.side === "wellmekh" ? "План Веллмеха: делается в его кабинете" : "Наш план: развитие нашей системы"}
                </p>
                <p className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-800"><span className="font-medium">Зачем: </span>{fut.why}</p>
                <Section tone="neutral" icon={<span aria-hidden>•</span>} title="Что делает" items={fut.what} />
                <Section tone="emerald" icon={<span aria-hidden>←</span>} title="Что даёт системе" items={fut.gives} />
                <Section tone="violet" icon={<span aria-hidden>→</span>} title="Что берёт из системы" items={fut.takes} />
                <Section tone="amber" icon={<span aria-hidden>⚙</span>} title="Зависит от" items={[fut.needs]} />
                <div className="rounded-md border border-neutral-200 p-3" data-docks>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">Встроится в</p>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {fut.steps.map((n) => (
                      <li key={n}><button type="button" onClick={() => setSel({ kind: "step", i: n - 1 })} className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-neutral-50 md:min-h-8">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs text-white">{n}</span>{steps[n - 1].title}</button></li>
                    ))}
                  </ul>
                </div>
              </>
            ) : branch ? (
              <>
                <p className="text-sm text-neutral-800">{branch.text}</p>
                <Link href={branch.href} className="inline-flex h-11 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700">Открыть раздел →</Link>
              </>
            ) : (
              <>
                {step!.note && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-note>{step!.note}</p>}
                <div className="rounded-md bg-amber-50/70 p-3" data-how>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Как это делается</p>
                  <ol className="mt-1.5 flex list-decimal flex-col gap-1 pl-5 text-sm text-neutral-800">{step!.how.map((x) => <li key={x}>{x}</li>)}</ol>
                </div>
                <Section tone="neutral" icon={<span aria-hidden>→</span>} title="Что получаем" items={step!.get} />
                <div className="rounded-md border border-neutral-200 p-3" data-entities>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">Что здесь создаётся и где открыть</p>
                  <ul className="mt-1.5 flex flex-col gap-2">
                    {step!.entities.map((e) => (
                      <li key={e.name} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-start gap-1.5">
                          <span className="mt-0.5 inline-flex shrink-0 items-center gap-0.5" title={e.kind === "manual" ? "Создают вручную" : e.kind === "auto" ? "Собирается автоматически, вручную не создаётся" : "Часть вносят вручную, часть собирается сама"}>
                            {e.kind !== "auto" && <IconPencil className="h-3.5 w-3.5 text-amber-700" />}
                            {e.kind !== "manual" && <IconGear className="h-3.5 w-3.5 text-emerald-700" />}
                          </span>
                          <span className="min-w-0"><span className="font-medium">{e.name}</span><span className="text-neutral-600"> — {e.text}</span></span>
                        </span>
                        <span className="flex shrink-0 gap-1.5">
                          <Link href={e.list} className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs hover:bg-neutral-100 md:min-h-8">Список →</Link>
                          {e.card && cards[e.card] && <Link href={cards[e.card]!} className="inline-flex min-h-11 items-center rounded-md bg-neutral-900 px-2 py-1 text-xs text-white hover:bg-neutral-700 md:min-h-8">Карточка →</Link>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                {plansOfStep(sel.i + 1).length > 0 && (
                  <div className="rounded-md border border-dashed border-neutral-300 p-3" data-plans>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">Планируется рядом</p>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {plansOfStep(sel.i + 1).map(({ f, k }) => (
                        <li key={f.title}><button type="button" onClick={() => setSel({ kind: "future", i: k })} className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-neutral-50 md:min-h-8">
                          <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-sm border border-dashed" style={{ borderColor: SIDE[f.side].stroke, background: SIDE[f.side].fill }} />
                          <span><span className="font-medium">{f.title}</span><span className="text-neutral-600"> — {SIDE[f.side].name}</span></span></button></li>
                      ))}
                    </ul>
                  </div>
                )}
                <details className="rounded-md border border-neutral-200" data-more>
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">Подробнее: что менять, что считается само, что пересчитается</summary>
                  <div className="flex flex-col gap-2 border-t border-neutral-200 p-3">
                    <Section tone="amber" icon={<IconPencil className="h-3.5 w-3.5" />} title="Вносят вручную" items={step!.enter} />
                    <Section tone="sky" icon={<IconPencil className="h-3.5 w-3.5" />} title="Можно изменить" items={step!.edit} />
                    <Section tone="emerald" icon={<IconGear className="h-3.5 w-3.5" />} title="Считается автоматически" items={step!.auto} />
                    {takes.length > 0 && <Section tone="violet" icon={<span aria-hidden>←</span>} title="Забирает данные из" items={takes.map((f) => `Шаг ${f.from}. ${steps[f.from - 1].title}: ${f.what}`)} />}
                    {gives.length > 0 && <Section tone="violet" icon={<span aria-hidden>→</span>} title="Отдаёт данные в" items={gives.map((f) => `Шаг ${f.to}. ${steps[f.to - 1].title}: ${f.what}`)} />}
                    <Section tone="rose" icon={<IconGear className="h-3.5 w-3.5" />} title="Если поправить здесь, пересчитается" items={step!.recalc} />
                    {step!.branches.length > 0 && (
                      <div className="rounded-md bg-neutral-50 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">Связанные разделы</p>
                        <ul className="mt-1.5 flex flex-col gap-1.5">
                          {step!.branches.map((b) => (
                            <li key={b.title} className="flex items-center justify-between gap-2 text-sm">
                              <span className="min-w-0"><span className="font-medium">{b.title}</span><span className="text-neutral-600"> — {b.text}</span></span>
                              <Link href={b.href} className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs hover:bg-neutral-100 md:min-h-8">Открыть →</Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </details>
                <Link href={step!.href} className="inline-flex h-11 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700">{step!.open} →</Link>
              </>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}

const TONES = {
  amber: "bg-amber-50/70 text-amber-800",
  sky: "bg-sky-50/70 text-sky-800",
  emerald: "bg-emerald-50/70 text-emerald-800",
  neutral: "bg-neutral-100 text-neutral-700",
  violet: "bg-violet-50/70 text-violet-800",
  rose: "bg-rose-50/70 text-rose-800",
} as const;

function Section({ tone, icon, title, items }: { tone: keyof typeof TONES; icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <div className={"rounded-md p-3 " + TONES[tone].split(" ")[0]}>
      <p className={"inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide " + TONES[tone].split(" ")[1]}>{icon}{title}</p>
      <ul className="mt-1 flex flex-col gap-1 text-sm text-neutral-800">
        {items.map((x) => <li key={x} className="flex gap-1.5"><span aria-hidden className="text-neutral-600">›</span>{x}</li>)}
      </ul>
    </div>
  );
}
