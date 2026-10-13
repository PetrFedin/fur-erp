"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Общие мелкие элементы раздела «Бюджет»: окно, числовое поле, бейдж, форматирование. */

import { money, qty, pct, share, dateRu } from "./format";
export { money, qty, pct, share, dateRu };

export const BTN = "btn-accent inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-800 transition hover:bg-neutral-50 disabled:opacity-50 md:min-h-8 md:py-1";
export const BTN_PRIMARY = "btn-accent inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 md:min-h-8 md:py-1";
export const FIELD = "ui-field w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-sm focus-visible:outline-none md:py-1.5";
/** Сегмент-переключатель (как на Главной): активная кнопка bg-neutral-900 text-white. */
export const SEG_BOX = "inline-flex overflow-hidden rounded-lg border border-neutral-300 text-xs";
export const segBtn = (active: boolean) => "min-h-10 px-3 md:min-h-8 " + (active ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50");

const TONES = {
  ok: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  bad: "bg-red-50 text-red-700 ring-red-200",
  manual: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  info: "bg-orange-50 text-orange-800 ring-orange-200",
} as const;

export function Badge({ tone, children, title }: { tone: keyof typeof TONES; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] leading-4 ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Окно по п.6 свода: role=dialog, заголовок, Esc, клик по подложке, фокус зациклен, после закрытия возвращается на источник. */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = box.current;
    if (el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>("[autofocus], input, select, textarea") ?? el.querySelector<HTMLElement>("button"))?.focus();
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== "Tab" || !box.current) return;
      const f = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (!box.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => { window.removeEventListener("keydown", h); if (opener && document.contains(opener)) opener.focus(); };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`flex max-h-[90vh] w-full flex-col rounded-t-xl bg-white shadow-xl sm:rounded-lg ${wide ? "sm:max-w-lg" : "sm:max-w-md"}`}>
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h2 id={titleId} className="block-title">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="btn-accent inline-flex h-10 w-10 items-center justify-center rounded-md border border-transparent text-xl text-neutral-500 hover:text-neutral-900 md:h-8 md:w-8">×</button>
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
      className={`${disabled ? "" : "ui-field "}w-full min-w-0 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums focus-visible:outline-none disabled:border-transparent disabled:bg-transparent disabled:shadow-none md:py-1 ${className}`}
    />
  );
}
