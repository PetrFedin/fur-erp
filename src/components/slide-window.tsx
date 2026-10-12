"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Окно из N соседних слайдов в горизонтальной ленте со scroll-snap (на широком экране — 2 слайда, на узком — 1).
 * Стрелки сдвигают окно на ОДИН слайд. Возвращает ref ленты, число слайдов в окне, первый видимый слайд и переходы.
 * Ширина слайда в ленте — 100% / perView (класс задаёт вызывающий: min-w-full lg:min-w-[50%]).
 */
export function useSlideWindow(count: number, wideQuery = "(min-width: 1024px)", wideCount = 2) {
  const scroller = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [idx, setIdx] = useState(0);
  const perView = wide ? Math.min(wideCount, Math.max(1, count)) : 1;
  const maxStart = Math.max(0, count - perView);

  useEffect(() => {
    const mq = window.matchMedia(wideQuery);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [wideQuery]);

  const cur = Math.min(idx, maxStart);
  // Цель текущего плавного сдвига: быстрые повторные нажатия стрелки (в пределах 400 мс) считаются от неё, а не от ещё не доехавшей позиции.
  const target = useRef<{ to: number; at: number } | null>(null);
  const goTo = useCallback((i: number) => {
    const el = scroller.current;
    if (!el) return;
    const to = Math.max(0, Math.min(maxStart, i));
    target.current = { to, at: Date.now() };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: to * (el.clientWidth / perView), behavior: reduce ? "auto" : "smooth" });
  }, [maxStart, perView]);
  const step = useCallback((d: number) => {
    const el = scroller.current;
    const t = target.current;
    const base = t && Date.now() - t.at < 400 ? t.to : el && el.clientWidth ? Math.round(el.scrollLeft / (el.clientWidth / perView)) : cur;
    goTo(base + d);
  }, [goTo, cur, perView]);
  const onScroll = () => { const el = scroller.current; if (el && el.clientWidth) setIdx(Math.round(el.scrollLeft / (el.clientWidth / perView))); };
  return { scroller, perView, cur, maxStart, goTo, step, onScroll };
}
