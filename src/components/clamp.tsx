"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Одна строка с «…» и полным текстом в окошке: при наведении, фокусе (Tab) и тапе. Для ячеек таблиц — все строки одной высоты.
 * `children` — то, что видно в строке (можно ссылки, через запятую); `full` — что показать в окошке (по умолчанию то же).
 * Окошко показывается, только если текст не поместился (или задан `always`); Esc закрывает; окошко с ссылками не гаснет, пока на нём курсор.
 */
export function Clamp({ children, full, label, always, className, tipClassName }: {
  children: ReactNode; full?: ReactNode; label?: string; always?: boolean; className?: string; tipClassName?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxW: number } | null>(null);
  const id = useId();

  const open = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const el = ref.current;
    if (!el) return;
    if (!always && el.scrollWidth <= el.clientWidth + 1) return;
    const r = el.getBoundingClientRect();
    const maxW = Math.min(480, window.innerWidth - 16);
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - maxW - 8)), top: r.bottom + 4, maxW });
  }, [always]);
  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPos(null), 120);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        aria-describedby={pos ? id : undefined}
        aria-label={label}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onClick={() => (pos ? setPos(null) : open())}
        onKeyDown={(e) => { if (e.key === "Escape") setPos(null); }}
        className={cn("block max-w-full cursor-default truncate rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600", className)}
      >
        {children}
      </span>
      {pos && typeof document !== "undefined"
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              onMouseEnter={() => timer.current && clearTimeout(timer.current)}
              onMouseLeave={close}
              style={{ position: "fixed", left: pos.left, top: pos.top, maxWidth: pos.maxW, zIndex: 80 }}
              className={cn("max-h-64 overflow-auto whitespace-normal break-words rounded-md border border-neutral-300 bg-white px-3 py-2 text-left text-sm font-normal text-neutral-900 shadow-lg", tipClassName)}
            >
              {full ?? children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
