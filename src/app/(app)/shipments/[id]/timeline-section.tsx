"use client";

import { useState, type ReactNode } from "react";

/** Раздел «Хронология»: заголовок со стрелкой сворачивает всё, включая кнопку «+ Этап». */
export function TimelineSection({ count, action, children }: { count: number; action: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="block-title flex items-center gap-1">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-touch-ok className="inline-flex items-center gap-1 hover:text-neutral-700">
            <span aria-hidden className={"inline-block w-3 transition-transform " + (open ? "rotate-90" : "")}>›</span>
            Хронология <span className="font-normal text-neutral-500">({count})</span>
          </button>
        </h2>
        {open && action}
      </div>
      <div className={open ? "flex flex-col gap-2" : "hidden"}>{children}</div>
    </>
  );
}
