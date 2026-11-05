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

  // Окончательная страховка: после выбора стороны сдвигаем окно внутрь экрана (поля 8 px) на любой ширине от 768.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!open || !tip || window.innerWidth < 768) return;
    tip.style.transform = "";
    const r = tip.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    let dx = 0;
    if (r.right > vw - 8) dx = vw - 8 - r.right;
    if (r.left + dx < 8) dx = 8 - r.left;
    if (dx) tip.style.transform = `translateX(${Math.round(dx)}px)`;
  }, [open, flip]);

  // Телефон (<768): окно фиксировано по краям экрана; по вертикали ставим рядом со значком — снизу, а если там тесно, то сверху.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const box = ref.current;
    if (!open || !tip || !box || window.innerWidth >= 768) return;
    const place = () => {
      const vh = window.innerHeight;
      const r = box.getBoundingClientRect();
      tip.style.maxHeight = "";
      const h = tip.offsetHeight;
      const below = vh - r.bottom - 12;
      const above = r.top - 12;
      const useBelow = h <= below || below >= above;
      const room = Math.max(120, Math.min(vh * 0.7, useBelow ? below : above));
      tip.style.maxHeight = `${Math.round(room)}px`;
      const hh = Math.min(h, room);
      const top = useBelow ? r.bottom + 6 : Math.max(8, r.top - 6 - hh);
      tip.style.top = `${Math.round(Math.min(Math.max(8, top), vh - hh - 8))}px`;
    };
    place();
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && tip.contains(e.target)) return;
      place();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

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
        className="info-i relative inline-flex size-[18px] items-center after:absolute after:-inset-[13px] after:content-[''] justify-center rounded-full border border-neutral-400 bg-white text-[11px] font-semibold italic leading-none text-neutral-600 hover:border-neutral-700 hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 max-xl:size-5 max-xl:after:-inset-[13px]"
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
            "max-md:fixed max-md:inset-x-4 max-md:top-2 max-md:mt-0 max-md:w-auto max-md:overscroll-contain",
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
