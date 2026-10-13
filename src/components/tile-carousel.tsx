"use client";

import { type ReactNode } from "react";
import { useSlideWindow } from "@/components/slide-window";
import { InfoHint } from "@/components/info-hint";
import { grpBlock } from "@/lib/block-hover";
import { TILE_BOX, TileHead } from "@/app/(app)/dashboard/tile";

export type GroupSel = "all" | "Одежда" | "Аксессуары";
const GROUPS: { id: GroupSel; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "Одежда", label: "Одежда" },
  { id: "Аксессуары", label: "Аксессуары" },
];

/** Переключатель «Все · Одежда · Аксессуары» (общий для слайдов плитки). */
export function GroupSwitch({ value, onChange, label }: { value: GroupSel; onChange: (g: GroupSel) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="mt-1.5 inline-flex self-start overflow-hidden rounded-md border border-neutral-300 text-xs">
      {GROUPS.map((g) => (
        <button key={g.id} type="button" aria-pressed={value === g.id} onClick={() => onChange(g.id)}
          className={"px-2.5 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 " + (value === g.id ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50")}>{g.label}</button>
      ))}
    </div>
  );
}

/** Стрелка ‹ › каруселей: без рамки, прозрачная; при наведении — оранжевая с мягкой подложкой; область нажатия 32×32. */
export const CAROUSEL_ARROW = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-transparent text-xl leading-none text-neutral-600 transition-colors hover:bg-orange-50 hover:text-orange-600 disabled:pointer-events-none disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600";

/**
 * Плитка-карусель: слайды листаются жестом (прокрутка со «прилипанием»), стрелками ‹ › и точками.
 * Слайд «Тотал» — первый; в заголовке подпись текущего слайда. Механика как у «Среднее на изделие» на Главной.
 */
export function TileCarousel({ title, hintLabel, hint, slides, toolbar, clickable = false, slidesLabel = "слайды по типам меха", dotsLabel = "Тип меха", hoverBlocks = false, twoUp = false }: {
  /** На экране от 1024px показывать два соседних слайда; стрелки сдвигают окно на один слайд. */
  twoUp?: boolean;
  /** Плитки выпуска: при наведении подсвечиваются строки таблицы «Производство…» (Тотал — «Всего», группа — её строка). */
  hoverBlocks?: boolean;
  title: string;
  hintLabel: string;
  hint: ReactNode;
  slides: { key: string; label: string; body: ReactNode }[];
  toolbar?: ReactNode;
  /** Тело слайдов — ссылки/кнопки: граница плитки при наведении (.tile-click). */
  clickable?: boolean;
  slidesLabel?: string;
  dotsLabel?: string;
}) {
  const sw = useSlideWindow(slides.length, "(min-width: 1024px)", twoUp ? 2 : 1);
  const { scroller, perView, cur, maxStart, goTo, step, onScroll, dragProps } = sw;
  const inWin = (i: number) => i >= cur && i < cur + perView;
  const arrow = CAROUSEL_ARROW;
  return (
    <div className="relative">
      <div data-hover-block={hoverBlocks ? (slides[cur]?.key === "total" ? "prod" : grpBlock(slides[cur]?.key ?? "")) : undefined} className={twoUp ? "flex h-full flex-col gap-1 pr-8" : TILE_BOX + (clickable ? " tile-click" : "") + " shadow-sm print:shadow-none"}>
        <TileHead>{title} · {perView > 1 ? slides.slice(cur, cur + perView).map((x) => x.label).join(" · ") : slides[cur]?.label}</TileHead>
        {toolbar}
        <div ref={scroller} onScroll={onScroll} {...dragProps} tabIndex={0}
          onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); step(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); } }}
          className={(twoUp ? "-mx-1.5 " : "-mx-1 ") + "mt-1 flex snap-x snap-mandatory items-stretch overflow-x-auto overscroll-x-contain motion-safe:scroll-smooth [scrollbar-width:none] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 [&::-webkit-scrollbar]:hidden"}
          role="group" aria-roledescription="карусель" aria-label={`${title}: ${slidesLabel}`}>
          {slides.map((s, i) => (
            <div key={s.key} className={"snap-start " + (twoUp ? "min-w-full px-1.5 lg:min-w-[50%]" : "min-w-full px-1")} aria-hidden={!inWin(i)} role="group" aria-roledescription="слайд" aria-label={`${s.label}, ${i + 1} из ${slides.length}`}>{twoUp ? <div className={TILE_BOX + (clickable ? " tile-click" : "") + " shadow-sm print:shadow-none"}>{s.body}</div> : s.body}</div>
          ))}
        </div>
        <div className="mt-auto flex items-center justify-center gap-2 pt-3">
          <button type="button" className={arrow} onClick={() => step(-1)} disabled={cur === 0} aria-label="Предыдущий слайд">‹</button>
          <div className="flex min-w-0 flex-wrap items-center justify-center gap-1.5" role="tablist" aria-label={dotsLabel}>
            {slides.map((s, i) => (
              <button key={s.key} type="button" role="tab" aria-selected={inWin(i)} aria-label={s.label} title={s.label} onClick={() => goTo(i)}
                className={"h-2 rounded-full transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 " + (inWin(i) ? "w-5 bg-neutral-900" : "w-2 bg-neutral-300 hover:bg-neutral-400")} />
            ))}
          </div>
          <button type="button" className={arrow} onClick={() => step(1)} disabled={cur >= maxStart} aria-label="Следующий слайд">›</button>
        </div>
      </div>
      <div className={twoUp ? "absolute right-0 top-0" : "absolute right-3 top-3"}>
        <InfoHint label={hintLabel} wide align="right">{hint}</InfoHint>
      </div>
    </div>
  );
}
