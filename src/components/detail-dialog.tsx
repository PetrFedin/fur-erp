"use client";

import { useRef, type ReactNode } from "react";

/**
 * Кнопка «Подробнее» под плиткой и окно с расшифровкой (таблица внутри). Закрывается крестиком, Esc и щелчком по затемнению.
 * Содержимое окна приходит готовым с сервера (children), здесь только открытие и закрытие.
 */
export function DetailDialog({ title, children, label = "Подробнее" }: { title: string; children: ReactNode; label?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} aria-haspopup="dialog" data-touch-ok
        className="mt-auto inline-flex min-h-11 items-center gap-1 self-start pt-2 text-xs text-blue-700 hover:underline print:hidden">
        {label} <span aria-hidden>›</span>
      </button>
      <dialog ref={ref} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
        className="m-auto w-[calc(100vw-2rem)] max-w-2xl rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40">
        <div className="max-h-[88dvh] overflow-y-auto p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
            <button type="button" onClick={() => ref.current?.close()} className="min-h-11 shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">✕ Закрыть</button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}

/** Таблица расшифровки: строки «подпись — сумма»; sub — вложенная строка, strong — итог. */
export function DetailTable({ head, rows }: { head?: string[]; rows: { k: ReactNode; cells: ReactNode[]; sub?: boolean; strong?: boolean }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        {head ? <thead><tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wide text-neutral-500">{head.map((h, i) => <th key={i} className={"py-1.5 pr-2 font-semibold " + (i > 0 ? "text-right" : "")}>{h}</th>)}</tr></thead> : null}
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={"border-b border-neutral-100 " + (r.strong ? "font-semibold" : r.sub ? "text-neutral-600" : "")}>
              <td className={"py-1.5 pr-2 " + (r.sub ? "pl-4" : "")}>{r.k}</td>
              {r.cells.map((c, j) => <td key={j} className="whitespace-nowrap py-1.5 pl-2 text-right tabular-nums">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
