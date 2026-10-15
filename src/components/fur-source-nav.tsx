"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSlideWindow } from "@/components/slide-window";
import { CAROUSEL_ARROW } from "@/components/tile-carousel";

/** Источник закупки меха: верхний уровень виджета «Мех» (переключатель), под ним — слайды по типам меха. */
export type FurSrc = "all" | "auction" | "supplier";
export const FUR_SRC_KEYS: FurSrc[] = ["all", "auction", "supplier"];
export const FUR_SRC_LABEL: Record<FurSrc, string> = { all: "Вся закупка", auction: "На аукционах", supplier: "У поставщика" };
/** Первый слайд каждого источника — итог по всем типам меха; ключ слайда пустой. */
export const ALL_TYPES_LABEL = "Все типы";

/**
 * Состояние двухуровневого виджета: источник (переключатель) → слайды типов меха внутри него («Все типы» первым).
 * Смена источника сохраняет выбранный тип, если он есть в новом источнике, иначе показывает «Все типы».
 * Листание — общий useSlideWindow (колесо/тачпад/Shift+колесо/свайп/перетаскивание со scroll-snap, стрелки, точки).
 */
export function useSrcTypeNav(typesBySrc: Partial<Record<FurSrc, string[]>>, initial: FurSrc = "all", ctl?: { src: FurSrc; setSrc: (s: FurSrc) => void }) {
  const [localSrc, setLocalSrc] = useState<FurSrc>(initial);
  const src = ctl?.src ?? localSrc;
  const setSrc = ctl?.setSrc ?? setLocalSrc;
  const types = typesBySrc[src] ?? [];
  const keys = ["", ...types];
  const sw = useSlideWindow(keys.length, "(min-width: 1024px)", 1);
  const typeNow = keys[sw.cur] ?? "";
  const pending = useRef<string | null>(null);
  const pick = (s: FurSrc) => {
    if (s === src) return;
    pending.current = typeNow;
    setSrc(s);
  };
  // После смены источника лента перестроилась: ставим её на прежний тип (или на «Все типы»).
  useEffect(() => {
    const want = pending.current;
    if (want === null) return;
    pending.current = null;
    const el = sw.scroller.current;
    if (!el) return;
    const i = Math.max(0, keys.indexOf(want));
    el.scrollTo({ left: i * (el.clientWidth / sw.perView), behavior: "instant" as ScrollBehavior });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  return { src, pick, sw, keys, typeNow };
}

/** Сегмент-кнопки в стиле проекта (как «Все · Одежда · Аксессуары»): aria-pressed. */
export function SegmentSwitch<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: string }[]; onChange: (k: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} data-testid="fur-source-switch" className="inline-flex overflow-hidden rounded-md border border-neutral-300 text-xs print:hidden">
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)}
          className={"whitespace-nowrap px-2.5 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 " + (value === o.key ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50")}>{o.label}</button>
      ))}
    </div>
  );
}

/** Стрелки ‹ ›, точки и подпись слайда типа меха (нижний уровень). */
export function TypeDots({ accent, labels, cur, goTo, step, last, nowLabel, ariaLabel = "Тип меха" }: { /** Активный тип подсвечен оранжевым (цвет акцента проекта). */ accent?: boolean; labels: string[]; cur: number; goTo: (i: number) => void; step: (d: number) => void; last: number; nowLabel?: ReactNode; ariaLabel?: string }) {
  return (
    <div role="group" aria-label="Слайды по типам меха" className="inline-flex items-center gap-1 print:hidden">
      <button type="button" className={CAROUSEL_ARROW} aria-label="Предыдущий слайд" disabled={cur === 0} onClick={() => step(-1)}>‹</button>
      <div className="flex items-center gap-1" role="tablist" aria-label={ariaLabel}>
        {labels.map((l, i) => (
          <button key={`${i}:${l}`} type="button" role="tab" aria-selected={i === cur} aria-label={l} title={l} onClick={() => goTo(i)} className={"h-2 rounded-full transition-all " + (i === cur ? (accent ? "w-5 bg-orange-500" : "w-5 bg-neutral-900") : "w-2 bg-neutral-300 hover:bg-neutral-400")} />
        ))}
      </div>
      <button type="button" className={CAROUSEL_ARROW} aria-label="Следующий слайд" disabled={cur >= last} onClick={() => step(1)}>›</button>
      {nowLabel ? <span className="ml-1 max-w-[9rem] truncate text-xs font-semibold text-orange-700">{nowLabel}</span> : null}
    </div>
  );
}
