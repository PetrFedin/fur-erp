"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Branch, Kind, Step } from "./data";
import { IconGear, IconPencil, IconTrash } from "@/components/icons";

function KindIcons({ kind, className = "h-3.5 w-3.5" }: { kind: Kind; className?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1" aria-hidden>
      {kind !== "auto" && <IconPencil className={className + " text-amber-700"} />}
      {kind !== "manual" && <IconGear className={className + " text-emerald-700"} />}
    </span>
  );
}

type Sel = { kind: "step"; i: number } | { kind: "branch"; i: number; j: number } | null;

/** Схема: узлы-коробки и линии; по клику на узел поверх схемы открывается окно с подробностями и кнопкой перехода в раздел. */
export function SchemeDiagram({ steps }: { steps: Step[] }) {
  const [sel, setSel] = useState<Sel>(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (sel && !d.open) d.showModal();
    if (!sel && d.open) d.close();
  }, [sel]);

  const step = sel ? steps[sel.i] : null;
  const branch: Branch | null = sel && sel.kind === "branch" ? steps[sel.i].branches[sel.j] : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700" data-legend>
        <span className="inline-flex items-center gap-1.5"><IconPencil className="h-3.5 w-3.5 text-amber-700" /> вносят и правят вручную</span>
        <span className="inline-flex items-center gap-1.5"><IconGear className="h-3.5 w-3.5 text-emerald-700" /> считается автоматически</span>
        <span className="inline-flex items-center gap-1.5"><IconTrash className="h-3.5 w-3.5 text-red-600" /> можно удалить</span>
        <span className="text-neutral-500">Нажмите на блок — откроется описание</span>
      </div>
      <ol className="flex flex-col items-stretch" data-scheme>
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col items-center md:flex-row md:items-center md:gap-0" data-step={i + 1}>
            <div className="flex w-full flex-col items-center md:w-72 md:shrink-0">
              <button
                type="button"
                onClick={() => setSel({ kind: "step", i })}
                className="group flex w-full items-center gap-3 rounded-xl border-2 border-neutral-900 bg-white px-3 py-3 text-left shadow-sm transition hover:bg-neutral-900 hover:text-white"
              >
                <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-white group-hover:bg-white group-hover:text-neutral-900">{i + 1}</span>
                <span className="min-w-0 flex-1 text-sm font-semibold leading-snug">{s.title}</span>
                <KindIcons kind={i === steps.length - 1 ? "auto" : "both"} />
              </button>
              {i < steps.length - 1 && (
                <span aria-hidden className="flex h-8 flex-col items-center md:h-10">
                  <span className="w-px flex-1 bg-neutral-400" />
                  <svg viewBox="0 0 10 6" className="h-1.5 w-2.5 text-neutral-400" fill="currentColor"><path d="M0 0h10L5 6z" /></svg>
                </span>
              )}
            </div>
            {/* ветви справа от узла, соединены линией */}
            <div className="flex w-full flex-wrap justify-center gap-2 pb-2 md:ml-0 md:w-auto md:flex-1 md:flex-nowrap md:items-center md:justify-start md:pb-10">
              <span aria-hidden className="hidden h-px w-8 shrink-0 bg-neutral-400 md:block" />
              {s.branches.map((b, j) => (
                <button
                  key={b.title}
                  type="button"
                  onClick={() => setSel({ kind: "branch", i, j })}
                  className="rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-left text-xs font-medium text-neutral-800 shadow-sm transition hover:border-neutral-900 hover:bg-white"
                >
                  <span className="inline-flex items-center gap-1.5">{b.title}<KindIcons kind={b.kind} className="h-3 w-3" /></span>
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>

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
              </>
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
