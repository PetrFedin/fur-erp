"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Артикул в таблице: по клику открывается окно поверх страницы с подробностями (склад, себестоимость, отгрузки), а не разворот строки. */
export function ArticleDialog({ label, title, tzHref, tzCount, children }: { label: ReactNode; title: string; tzHref?: string; tzCount?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="cursor-pointer text-left font-medium hover:underline">
        {label}
      </button>
      {open ? (
        <dialog
          ref={ref}
          onClose={() => setOpen(false)}
          onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
          className="m-auto w-[calc(100vw-2rem)] max-w-2xl rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40"
        >
          <div className="max-h-[88vh] overflow-y-auto p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold">{title}</h2>
              <button type="button" onClick={() => ref.current?.close()} className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">✕ Закрыть</button>
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
