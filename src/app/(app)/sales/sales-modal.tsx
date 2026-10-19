"use client";

import { useEffect, useRef } from "react";

/** Окно деталей поверх страницы: Esc и клик вне окна закрывают, фокус заперт внутри, на телефоне на весь экран (как в Cashflow). */
export function SalesModal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const f = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])")).filter((el) => !el.hasAttribute("disabled"));
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/45 sm:items-center sm:p-4 print:hidden" onMouseDown={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="sales-modal-title" className="flex h-dvh max-h-dvh w-full max-w-3xl flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[94vh] sm:rounded-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 p-4">
          <div className="min-w-0">
            <h2 id="sales-modal-title" className="text-lg font-semibold">{title}</h2>
            {subtitle ? <div className="mt-0.5 text-xs text-neutral-600">{subtitle}</div> : null}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Закрыть окно" className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-neutral-300 px-3 text-sm hover:bg-neutral-50">✕ Закрыть</button>
        </div>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

/** Небольшая таблица для окон: первый столбец слева, остальные числа справа. */
export function MiniTable({ head, rows, total }: { head: string[]; rows: string[][]; total?: string[] }) {
  const cell = (c: string, i: number, k: string | number) => <td key={k} className={"px-2 py-1.5 tabular-nums " + (i === 0 ? "text-left" : "text-right whitespace-nowrap")}>{c}</td>;
  return (
    <div className="w-full min-w-0 overflow-x-auto rounded-lg border border-neutral-300" data-keep-scroll tabIndex={0}>
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-b border-neutral-300">{head.map((h, i) => <th key={h + i} scope="col" className={"px-2 py-2 text-xs font-semibold " + (i === 0 ? "text-left" : "text-right")}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, ri) => <tr key={ri} className="border-b border-neutral-200">{r.map((c, i) => cell(c, i, i))}</tr>)}
          {total ? <tr className="border-t-2 border-neutral-400 font-semibold">{total.map((c, i) => cell(c, i, i))}</tr> : null}
        </tbody>
      </table>
    </div>
  );
}
