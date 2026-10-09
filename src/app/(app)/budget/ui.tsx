"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Общие мелкие элементы раздела «Бюджет»: окно, числовое поле, бейдж, форматирование. */

import { money, qty, pct, share, dateRu } from "./format";
export { money, qty, pct, share, dateRu };

export const BTN = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-800 transition hover:bg-neutral-50 disabled:opacity-50 md:min-h-8 md:py-1";
export const BTN_PRIMARY = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 md:min-h-8 md:py-1";
export const FIELD = "w-full rounded-md border border-neutral-300 bg-white px-2.5 py-2 text-sm focus-visible:border-neutral-900 focus-visible:outline-none md:py-1.5";

const TONES = {
  ok: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  bad: "bg-red-50 text-red-700 ring-red-200",
  manual: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
} as const;

export function Badge({ tone, children, title }: { tone: keyof typeof TONES; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] leading-4 ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-[90vh] w-full flex-col rounded-t-xl bg-white shadow-xl sm:rounded-xl ${wide ? "sm:max-w-lg" : "sm:max-w-md"}`}>
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="inline-flex h-10 w-10 items-center justify-center rounded-md text-xl text-neutral-400 hover:text-neutral-900 md:h-8 md:w-8">×</button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100).replace(".", ",") : "0");

/** Числовое поле: запятая и точка, пустое = 0; значение извне (автоматический расчёт) подставляется сразу. */
export function NumInput({ value, onChange, disabled, ariaLabel, className = "" }: { value: number; onChange: (v: number) => void; disabled?: boolean; ariaLabel: string; className?: string }) {
  const [text, setText] = useState(() => fmt(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) { last.current = value; setText(fmt(value)); }
  }, [value]);
  return (
    <input
      type="text" inputMode="decimal" aria-label={ariaLabel} disabled={disabled} value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const x = Number(t.replace(/\s/g, "").replace(",", "."));
        const v = t.trim() === "" ? 0 : Number.isFinite(x) ? x : last.current;
        last.current = v;
        onChange(v);
      }}
      onFocus={(e) => e.target.select()}
      className={`w-full min-w-0 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums shadow-[inset_0_1px_0_rgba(0,0,0,0.03)] hover:border-neutral-400 focus-visible:border-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/10 disabled:border-transparent disabled:bg-transparent disabled:shadow-none md:py-1 ${className}`}
    />
  );
}
