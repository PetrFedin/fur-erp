"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Значок «i»: длинное описание, цифры, таблицы и расчёты прячутся в подсказку.
 * Наведение мыши или фокус клавиатурой — показать; касание/клик — закрепить (на телефоне); Esc или клик снаружи — закрыть.
 * Содержимое — любые элементы (текст, таблица, список).
 */
export function InfoHint({
  children,
  label = "Пояснение",
  align = "left",
  wide = false,
  className,
}: {
  children: ReactNode;
  label?: string;
  align?: "left" | "right";
  wide?: boolean;
  className?: string;
}) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const open = pinned || hover;

  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPinned(false);
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [pinned]);

  return (
    <span
      ref={ref}
      className={cn("relative inline-flex align-middle", className)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setPinned((v) => !v)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className="inline-flex size-4 items-center justify-center rounded-full border border-neutral-300 bg-white text-[10px] font-semibold leading-none text-neutral-500 hover:border-neutral-500 hover:text-neutral-800 max-md:size-5"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className={cn(
            "absolute top-full z-50 mt-1.5 block max-h-[70vh] overflow-auto rounded-md border border-neutral-200 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-neutral-700 shadow-lg",
            wide ? "w-[min(34rem,calc(100vw-2rem))]" : "w-[min(20rem,calc(100vw-2rem))]",
            align === "right" ? "right-0" : "left-0",
            // Телефон: подсказка на всю ширину экрана с полями, а не от значка (иначе уезжает за край).
            "max-md:fixed max-md:inset-x-4 max-md:top-auto max-md:w-auto",
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
