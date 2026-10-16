"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

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

  // Ширина окна или число слайдов изменились (фильтры сузили список): прокрутка не должна остаться за последним слайдом.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !el.clientWidth) return;
    const max = maxStart * (el.clientWidth / perView);
    if (el.scrollLeft > max + 1) el.scrollTo({ left: max, behavior: "auto" });
  }, [maxStart, perView]);

  // Перетаскивание мышью (колесо/тачпад/свайп работают сами — это нативная прокрутка со scroll-snap): тянем ленту, на отпускании «прилипаем» к слайду.
  const dragged = useRef(false);
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    const el = scroller.current;
    if (e.pointerType !== "mouse" || e.button !== 0 || !el || el.scrollWidth <= el.clientWidth + 1) return;
    if ((e.target as HTMLElement).closest("input,textarea,select,option,[data-no-drag]")) return;
    const x0 = e.clientX, left0 = el.scrollLeft;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) > 6) {
        moved = true;
        el.style.scrollSnapType = "none"; el.style.scrollBehavior = "auto"; el.style.cursor = "grabbing"; el.style.userSelect = "none";
      }
      if (moved) el.scrollLeft = left0 - dx;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!moved) return;
      dragged.current = true;
      window.setTimeout(() => { dragged.current = false; }, 0);
      el.style.scrollSnapType = ""; el.style.scrollBehavior = ""; el.style.cursor = ""; el.style.userSelect = "";
      goTo(Math.round(el.scrollLeft / (el.clientWidth / perView)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  // После перетаскивания «клик» по плитке под курсором не нужен.
  const onClickCapture = (e: ReactMouseEvent<HTMLElement>) => { if (dragged.current) { e.stopPropagation(); e.preventDefault(); } };
  /** Разложить на ленту: <div ref={scroller} onScroll={onScroll} {...dragProps}> */
  const dragProps = { onPointerDown, onClickCapture };
  return { scroller, perView, cur, maxStart, goTo, step, onScroll, dragProps };
}

/**
 * Телефон (<768px): лента слайдов не растягивается до самого высокого слайда — её высота равна высоте активного слайда
 * (меняется вместе с ним и при перерисовке содержимого). На широком экране высота не трогается.
 * Слайды в ленте должны быть выровнены по верху (items-start). Меняет style.height напрямую, без повторных рендеров.
 */
export function useActiveSlideHeight(scroller: { current: HTMLElement | null }, cur: number) {
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const mq = window.matchMedia("(max-width: 767px)");
    let ro: ResizeObserver | null = null;
    const apply = () => {
      ro?.disconnect();
      ro = null;
      if (!mq.matches) { el.style.height = ""; el.style.overflowY = ""; return; }
      const slide = el.children[cur] as HTMLElement | undefined;
      if (!slide) return;
      el.style.overflowY = "hidden";
      el.style.height = `${slide.offsetHeight}px`;
      ro = new ResizeObserver(() => { el.style.height = `${slide.offsetHeight}px`; });
      ro.observe(slide);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => { mq.removeEventListener("change", apply); ro?.disconnect(); el.style.height = ""; el.style.overflowY = ""; };
  }, [scroller, cur]);
}
