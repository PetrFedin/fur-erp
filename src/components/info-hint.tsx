"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  const tipRef = useRef<HTMLSpanElement>(null);
  const [flip, setFlip] = useState<"left" | "right" | null>(null);
  const open = pinned || hover;

  // Подсказка не должна выходить за край экрана: если с заданной стороны не помещается — открываем в другую.
  useLayoutEffect(() => {
    if (!open) return;
    const tip = tipRef.current;
    const box = ref.current;
    if (!tip || !box || window.innerWidth < 768) return;
    const w = tip.offsetWidth;
    const r = box.getBoundingClientRect();
    const fitsRight = r.left + w <= window.innerWidth - 8;
    const fitsLeft = r.right - w >= 8;
    if (align === "left" && !fitsRight && fitsLeft) setFlip("right");
    else if (align === "right" && !fitsLeft && fitsRight) setFlip("left");
    else setFlip(align);
  }, [open, align]);

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
        className="inline-flex size-[18px] items-center justify-center rounded-full border border-neutral-400 bg-white text-[11px] font-semibold italic leading-none text-neutral-600 hover:border-neutral-700 hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 max-md:size-5"
      >
        i
      </button>
      {open && (
        <span
          ref={tipRef}
          role="tooltip"
          className={cn(
            "absolute top-full z-50 mt-1.5 block max-h-[70vh] overflow-auto rounded-md border border-neutral-200 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-neutral-700 shadow-lg",
            wide ? "w-[min(26rem,calc(100vw-2rem))]" : "w-[min(20rem,calc(100vw-2rem))]",
            (flip ?? align) === "right" ? "right-0" : "left-0",
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
