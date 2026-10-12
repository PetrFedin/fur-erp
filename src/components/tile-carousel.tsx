"use client";

import { useRef, useState, type ReactNode } from "react";
import { InfoHint } from "@/components/info-hint";
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

/**
 * Плитка-карусель: слайды листаются жестом (прокрутка со «прилипанием»), стрелками ‹ › и точками.
 * Слайд «Тотал» — первый; в заголовке подпись текущего слайда. Механика как у «Среднее на изделие» на Главной.
 */
export function TileCarousel({ title, hintLabel, hint, slides, toolbar }: {
  title: string;
  hintLabel: string;
  hint: ReactNode;
  slides: { key: string; label: string; body: ReactNode }[];
  toolbar?: ReactNode;
}) {
  const [idx, setIdx] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const last = slides.length - 1;
  const cur = Math.min(idx, last);
  const goTo = (i: number) => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: Math.max(0, Math.min(last, i)) * el.clientWidth, behavior: "smooth" });
  };
  const onScroll = () => { const el = scroller.current; if (el && el.clientWidth) setIdx(Math.round(el.scrollLeft / el.clientWidth)); };
  const arrow = "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-300 bg-white text-base leading-none text-neutral-700 hover:bg-neutral-50 disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700";
  return (
    <div className="relative">
      <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
        <TileHead>{title} · {slides[cur]?.label}</TileHead>
        {toolbar}
        <div ref={scroller} onScroll={onScroll} tabIndex={0}
          onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); goTo(cur + 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(cur - 1); } }}
          className="-mx-1 mt-1 flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 [&::-webkit-scrollbar]:hidden"
          role="group" aria-roledescription="карусель" aria-label={`${title}: слайды по типам меха`}>
          {slides.map((s, i) => (
            <div key={s.key} className="min-w-full snap-center px-1" aria-hidden={i !== cur} role="group" aria-roledescription="слайд" aria-label={`${s.label}, ${i + 1} из ${slides.length}`}>{s.body}</div>
          ))}
        </div>
        <div className="mt-auto flex items-center justify-center gap-2 pt-3">
          <button type="button" className={arrow} onClick={() => goTo(cur - 1)} disabled={cur === 0} aria-label="Предыдущий слайд">‹</button>
          <div className="flex min-w-0 flex-wrap items-center justify-center gap-1.5" role="tablist" aria-label="Тип меха">
            {slides.map((s, i) => (
              <button key={s.key} type="button" role="tab" aria-selected={i === cur} aria-label={s.label} title={s.label} onClick={() => goTo(i)}
                className={"h-2 rounded-full transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 " + (i === cur ? "w-5 bg-neutral-900" : "w-2 bg-neutral-300 hover:bg-neutral-400")} />
            ))}
          </div>
          <button type="button" className={arrow} onClick={() => goTo(cur + 1)} disabled={cur === last} aria-label="Следующий слайд">›</button>
        </div>
      </div>
      <div className="absolute right-3 top-3">
        <InfoHint label={hintLabel} wide align="right">{hint}</InfoHint>
      </div>
    </div>
  );
}
