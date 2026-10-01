"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { VatToggle } from "@/components/vat-toggle";
import { Commission4Toggle } from "@/components/commission4-toggle";

const QUERY = "(max-width: 399px)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** Узкий экран (< 400 px): переключатели НДС и 4% не помещаются в шапку рядом с меню и «Выйти». */
function useNarrow() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/**
 * Переключатели режимов в шапке. На ширине >= 400 px — как раньше, в ряд; на уже — одна кнопка «Режимы»
 * с раскрывающейся панелью, чтобы шапка не налезала на меню и не выходила за экран (360 и 320 px).
 */
export function TopbarModes() {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  if (!narrow) {
    return (
      <>
        <div className="flex items-center gap-1.5">
          <span className="hidden text-xs text-neutral-500 xl:inline">Цены:</span>
          <VatToggle />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="hidden text-xs text-neutral-500 xl:inline">4% к сырью:</span>
          <Commission4Toggle />
        </div>
      </>
    );
  }
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
      >
        Режимы
        <span aria-hidden="true" className="text-neutral-400">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 flex w-max max-w-[calc(100vw-1.5rem)] flex-col gap-2 rounded-md border border-neutral-200 bg-white p-3 shadow-lg">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">Цены: с НДС или без НДС</span>
            <VatToggle />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">4% к сырью: без или с 4%</span>
            <Commission4Toggle />
          </div>
        </div>
      )}
    </div>
  );
}
