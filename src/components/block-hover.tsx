"use client";

import { useEffect } from "react";

/**
 * Один слушатель на весь документ: при наведении на [data-hover-block="K"] добавляет класс .block-hl всем [data-block~="K"]
 * (оранжевая тонкая граница + светлая подложка), при уходе — снимает. Работает и для окон; таблицы не перерисовываются.
 */
export function BlockHover() {
  useEffect(() => {
    let cur: Element | null = null;
    let marked: Element[] = [];
    const clear = () => { for (const el of marked) el.classList.remove("block-hl"); marked = []; cur = null; };
    const over = (e: MouseEvent) => {
      const t = (e.target as Element | null)?.closest?.("[data-hover-block]") ?? null;
      if (t === cur) return;
      clear();
      if (!t) return;
      cur = t;
      for (const k of (t.getAttribute("data-hover-block") ?? "").split(/\s+/).filter(Boolean)) {
        document.querySelectorAll(`[data-block~="${k}"]`).forEach((el) => { if (el !== t && !t.contains(el)) { el.classList.add("block-hl"); marked.push(el); } });
      }
    };
    document.addEventListener("mouseover", over, { passive: true });
    document.documentElement.addEventListener("mouseleave", clear);
    return () => { document.removeEventListener("mouseover", over); document.documentElement.removeEventListener("mouseleave", clear); clear(); };
  }, []);
  return null;
}
