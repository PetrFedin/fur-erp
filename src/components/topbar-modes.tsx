"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { VatToggle } from "@/components/vat-toggle";
import { Commission4Toggle } from "@/components/commission4-toggle";
import { YearToggle } from "@/components/year-toggle";
import { modesForPath } from "@/lib/page-modes";

const QUERY = "(max-width: 1279px)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** Телефон и планшет (< 1280 px): переключатели Год/Цены/4% не помещаются в шапку рядом с меню, поиском и «Выйти». */
function useNarrow() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/**
 * Переключатели режимов в шапке. На ширине >= 1280 px — в ряд; на уже — одна кнопка «Режимы»
 * с панелью на всю ширину под шапкой, чтобы шапка не налезала на меню и не выходила за экран (360 и 320 px).
 */
export function TopbarModes({ yearOnly = false }: { yearOnly?: boolean } = {}) {
  const narrow = useNarrow();
  // Какие режимы имеют смысл на странице — см. src/lib/page-modes.ts; в кабинете поставщика режимы не показываем (ничего не меняют)
  const pathModes = modesForPath(usePathname());
  const modes = yearOnly ? { year: false, vat: false, c4: false } : pathModes;
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

  if (!modes.year && !modes.vat && !modes.c4) return null;

  if (!narrow) {
    // До гидратации narrow всегда false: на телефоне ряд переключателей не показываем (иначе шапка на миг вылезает за экран).
    return (
      <div className="hidden xl:contents">
        {modes.year && (
<div className="flex items-center gap-1.5">
          <span className="hidden text-xs text-neutral-500 xl:inline">Год:</span>
          <YearToggle supplier={yearOnly} />
        </div>
)}
        {(modes.vat || modes.c4) && (
          <>
            {modes.vat && (
            <div className="flex items-center gap-1.5">
              <span className="hidden text-xs text-neutral-500 xl:inline">Цены:</span>
              <VatToggle />
            </div>
            )}
            {modes.c4 && (
<div className="flex items-center gap-1.5">
              <span className="hidden text-xs text-neutral-500 xl:inline">4 % к сырью:</span>
              <Commission4Toggle />
            </div>
)}
          </>
        )}
      </div>
    );
  }
  return (
    <div ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-11 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
      >
        Режимы
        <span aria-hidden="true" className="text-neutral-500">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Режимы показа"
          className="absolute inset-x-0 top-full z-40 flex flex-col gap-3 border-b border-neutral-200 bg-white px-4 py-3 shadow-lg [&_button]:min-h-11 [&_button]:shrink-0 [&_button]:whitespace-nowrap [&_button]:px-4"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-neutral-900">Режимы показа</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть" className="inline-flex size-11 items-center justify-center rounded-md text-lg text-neutral-600 hover:bg-neutral-100">✕</button>
          </div>
          {modes.year && (
<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="text-sm text-neutral-700">Год</span>
            <YearToggle supplier={yearOnly} />
          </div>
)}
          {(modes.vat || modes.c4) && (
            <>
              {modes.vat && (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <span className="text-sm text-neutral-700">Цены</span>
                <VatToggle />
              </div>
              )}
              {modes.c4 && (
<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <span className="text-sm text-neutral-700">4 % к сырью</span>
                <Commission4Toggle />
              </div>
)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
