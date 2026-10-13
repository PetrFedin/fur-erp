"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Артикул в таблице: по клику открывается окно поверх страницы с подробностями (склад, себестоимость, отгрузки), а не разворот строки. */
export function ArticleDialog({ label, title, tzHref, tzCount, children }: { label: ReactNode; title: string; tzHref?: string; tzCount?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const srcRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (open) ref.current?.showModal();
  }, [open]);
  return (
    <>
      <button ref={srcRef} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="cursor-pointer text-left font-medium hover:underline">
        {label}
      </button>
      {open ? (
        <dialog
          ref={ref}
          aria-labelledby={titleId}
          onClose={() => { setOpen(false); srcRef.current?.focus(); }}
          onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
          className="m-auto w-[calc(100vw-2rem)] max-w-2xl rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40"
        >
          <div className="max-h-[88vh] overflow-y-auto p-4">
            <div className="mb-3 flex items-start justify-between gap-3 border-b border-neutral-200 pb-2">
              <h2 id={titleId} className="block-title">{title}</h2>
              <button type="button" autoFocus onClick={() => ref.current?.close()} aria-label="Закрыть окно" className="btn-accent shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm">✕ Закрыть</button>
            </div>
            <div className="flex flex-col gap-2 text-sm text-neutral-700">{children}</div>
            {tzHref ? (
              <a href={tzHref} className="mt-4 inline-block rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700">Перейти в ТЗ артикула{tzCount ? ` (${tzCount})` : ""} →</a>
            ) : null}
          </div>
        </dialog>
      ) : null}
    </>
  );
}
