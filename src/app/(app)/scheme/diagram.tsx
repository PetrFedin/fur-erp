"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FLOWS, type Branch, type Step } from "./data";
import { IconGear, IconPencil, IconTrash } from "@/components/icons";

const NODES = [
  { x: 30, y: 30 }, { x: 730, y: 30 }, { x: 380, y: 220 }, { x: 30, y: 410 }, { x: 380, y: 410 }, { x: 730, y: 410 }, { x: 380, y: 600 },
];
/** Линии связей: k — индекс в FLOWS; координаты подобраны вручную под NODES. */
const EDGES: { k: number; d: string; lx: number; ly: number; dash?: boolean }[] = [
  { k: 0, d: "M 230 100 C 230 170 420 150 440 220", lx: 330, ly: 148 },
  { k: 1, d: "M 770 100 C 770 170 580 150 560 220", lx: 670, ly: 148 },
  { k: 2, d: "M 745 100 C 700 300 610 330 580 410", lx: 650, ly: 300 },
  { k: 3, d: "M 940 100 L 940 410", lx: 940, ly: 255 },
  { k: 4, d: "M 590 290 C 650 350 800 350 830 410", lx: 735, ly: 345 },
  { k: 5, d: "M 500 290 L 500 410", lx: 500, ly: 350 },
  { k: 6, d: "M 100 100 L 100 410", lx: 100, ly: 205 },
  { k: 7, d: "M 420 290 C 420 360 270 350 250 410", lx: 330, ly: 352 },
  { k: 8, d: "M 200 410 L 200 100", lx: 200, ly: 300, dash: true },
  { k: 9, d: "M 270 440 C 330 440 340 300 380 275", lx: 292, ly: 395, dash: true },
  { k: 10, d: "M 60 100 C -50 300 -50 560 380 640", lx: -10, ly: 470 },
  { k: 11, d: "M 620 255 C 700 255 700 600 620 640", lx: 690, ly: 520 },
  { k: 12, d: "M 150 480 C 150 570 300 620 380 625", lx: 205, ly: 585 },
  { k: 13, d: "M 500 480 L 500 600", lx: 500, ly: 540 },
  { k: 14, d: "M 850 480 C 850 570 680 650 620 655", lx: 770, ly: 595 },
];

function wrap(t: string, n: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of t.split(" ")) {
    if ((cur + " " + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}

type Sel = { kind: "step"; i: number } | { kind: "branch"; i: number; j: number } | null;

/** Схема: узлы-коробки и линии; по клику на узел поверх схемы открывается окно с подробностями и кнопкой перехода в раздел. */
export function SchemeDiagram({ steps }: { steps: Step[] }) {
  const [sel, setSel] = useState<Sel>(null);
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (sel && !d.open) d.showModal();
    if (!sel && d.open) d.close();
  }, [sel]);

  const hot = hover ?? (sel ? sel.i : null);
  const step = sel ? steps[sel.i] : null;
  const takes = sel ? FLOWS.filter((f) => f.to === sel.i + 1) : [];
  const gives = sel ? FLOWS.filter((f) => f.from === sel.i + 1) : [];
  const branch: Branch | null = sel && sel.kind === "branch" ? steps[sel.i].branches[sel.j] : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700" data-legend>
        <span className="inline-flex items-center gap-1.5"><IconPencil className="h-3.5 w-3.5 text-amber-700" /> вносят и правят вручную</span>
        <span className="inline-flex items-center gap-1.5"><IconGear className="h-3.5 w-3.5 text-emerald-700" /> считается автоматически</span>
        <span className="inline-flex items-center gap-1.5"><IconTrash className="h-3.5 w-3.5 text-red-600" /> можно удалить</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white" data-scheme>
        <svg viewBox="-60 0 1120 700" className="mx-auto block min-w-[980px] w-full" role="img" aria-label="Схема связей и взаимодействий">
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#a3a3a3" /></marker>
            <marker id="arr-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#171717" /></marker>
          </defs>
          {EDGES.map((e) => {
            const f = FLOWS[e.k];
            const on = hot != null && (f.from === hot + 1 || f.to === hot + 1);
            return (
              <g key={e.k} opacity={hot == null || on ? 1 : 0.25}>
                <path d={e.d} fill="none" stroke={on ? "#171717" : "#a3a3a3"} strokeWidth={on ? 2 : 1.4} strokeDasharray={e.dash ? "5 4" : undefined} markerEnd={on ? "url(#arr-hot)" : "url(#arr)"} />
                <g transform={`translate(${e.lx} ${e.ly})`}>
                  <rect x={-(f.label.length * 3.6 + 5)} y="-10" width={f.label.length * 7.2 + 10} height="18" rx="4" fill="white" opacity="0.92" />
                  <text textAnchor="middle" y="3" fontSize="12" fill={on ? "#171717" : "#525252"} fontWeight={on ? 600 : 400}>{f.label}</text>
                </g>
              </g>
            );
          })}
          {steps.map((s, i) => {
            const p = NODES[i];
            const lines = wrap(s.title, 26);
            const last = i === steps.length - 1;
            return (
              <g key={s.title} data-step={i + 1} transform={`translate(${p.x} ${p.y})`} className="cursor-pointer" tabIndex={0} role="button" aria-label={s.title}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                onClick={() => setSel({ kind: "step", i })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel({ kind: "step", i }); } }}>
                <rect width="240" height="70" rx="12" fill={hot === i ? "#171717" : "white"} stroke="#171717" strokeWidth="2" />
                <circle cx="26" cy="35" r="14" fill={hot === i ? "white" : "#171717"} />
                <text x="26" y="40" textAnchor="middle" fontSize="14" fontWeight="600" fill={hot === i ? "#171717" : "white"}>{i + 1}</text>
                {lines.map((l, k) => (
                  <text key={k} x="50" y={lines.length === 1 ? 39 : 30 + k * 16} fontSize="13.5" fontWeight="600" fill={hot === i ? "white" : "#171717"}>{l}</text>
                ))}
                <g transform="translate(176 50)" aria-hidden>
                  {!last && <path transform="scale(0.85)" d="M2.5 13.5l.6-3L10.6 3a1.4 1.4 0 0 1 2 0l.4.4a1.4 1.4 0 0 1 0 2l-7.5 7.5-3 .6zM9.5 4.2l2.3 2.3" fill="none" stroke="#b45309" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
                  {<g transform={`translate(${last ? 0 : 26} 0) scale(0.85)`} fill="none" stroke="#047857" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" /></g>}
                </g>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mt-2 text-xs text-neutral-500">Наведите на блок — подсветятся его связи. Если схема шире экрана, её можно прокрутить вбок.</p>

      <dialog
        ref={ref}
        onClose={() => setSel(null)}
        onClick={(e) => { if (e.target === ref.current) setSel(null); }}
        className="m-auto w-[min(34rem,calc(100vw-1.5rem))] rounded-xl border border-neutral-200 bg-white p-0 shadow-2xl backdrop:bg-black/40"
      >
        {step && sel && (
          <div className="flex max-h-[85vh] flex-col gap-3 overflow-y-auto p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-neutral-900">{branch ? branch.title : step.title}</h2>
                <p className="mt-0.5 text-xs text-neutral-500">{branch ? `Ветвь шага ${sel.i + 1}: ${step.title}` : step.from ? `Берёт данные: ${step.from}` : "Начало: отсюда заводятся данные"}</p>
              </div>
              <button type="button" onClick={() => setSel(null)} aria-label="Закрыть" title="Закрыть" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50">✕</button>
            </div>
            {branch ? (
              <p className="text-sm text-neutral-800">{branch.text}</p>
            ) : (
              <>
                <Section tone="amber" icon={<IconPencil className="h-3.5 w-3.5" />} title="Вносят вручную" items={step.enter} />
                <Section tone="sky" icon={<><IconPencil className="h-3.5 w-3.5" /><IconTrash className="h-3.5 w-3.5" /></>} title="Можно изменить и удалить" items={step.edit} />
                <Section tone="emerald" icon={<IconGear className="h-3.5 w-3.5" />} title="Считается автоматически" items={step.auto} />
                <Section tone="neutral" icon={<span aria-hidden>→</span>} title="Получаем" items={step.get} />
                {takes.length > 0 && <Section tone="violet" icon={<span aria-hidden>←</span>} title="Забирает данные из" items={takes.map((f) => `Шаг ${f.from}. ${steps[f.from - 1].title}: ${f.what}`)} />}
                {gives.length > 0 && <Section tone="violet" icon={<span aria-hidden>→</span>} title="Отдаёт данные в" items={gives.map((f) => `Шаг ${f.to}. ${steps[f.to - 1].title}: ${f.what}`)} />}
                <Section tone="rose" icon={<IconGear className="h-3.5 w-3.5" />} title="Если поправить здесь, пересчитается" items={step.recalc} />
              </>
            )}
            {!branch && step.branches.length > 0 && (
              <div className="rounded-md bg-neutral-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">Ветви шага</p>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {step.branches.map((b) => (
                    <li key={b.title} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0"><span className="font-medium">{b.title}</span><span className="text-neutral-600"> — {b.text}</span></span>
                      <Link href={b.href} className="shrink-0 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs hover:bg-neutral-100">Открыть →</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Link href={branch ? branch.href : step.href} className="inline-flex h-10 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700">
              {branch ? "Открыть раздел →" : `${step.open} →`}
            </Link>
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
        {items.map((x) => <li key={x} className="flex gap-1.5"><span aria-hidden className="text-neutral-400">›</span>{x}</li>)}
      </ul>
    </div>
  );
}
