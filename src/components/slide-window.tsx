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

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const mq = window.matchMedia(wideQuery);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [wideQuery]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const cur = Math.min(idx, maxStart);
  const goTo = useCallback((i: number) => {
    const el = scroller.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: Math.max(0, Math.min(maxStart, i)) * (el.clientWidth / perView), behavior: reduce ? "auto" : "smooth" });
  }, [maxStart, perView]);
  const onScroll = () => { const el = scroller.current; if (el && el.clientWidth) setIdx(Math.round(el.scrollLeft / (el.clientWidth / perView))); };
  return { scroller, perView, cur, maxStart, goTo, onScroll };
}
