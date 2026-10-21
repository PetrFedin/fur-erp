"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from "react";
import { seg, segGroup } from "../sales/sales-fmt";

// Сезон на Главной: панель «Сезон» начинается с раздела «Производство» и закреплена сверху, пока прокручиваются блоки ниже
// (Производство, Продажи и остатки). Выбранный сезон общий — блок «Продажи и остатки» берёт его отсюда.

type Ctx = { season: string; setSeason: (k: string) => void; keys: string[] };
const SeasonCtx = createContext<Ctx | null>(null);

/** Выбранный сезон («all» или ключ сезона); вне панели — свой локальный выбор. */
export function useSeasonScope(): Ctx | null { return useContext(SeasonCtx); }

/** Переключатель «Все / сезон». */
export function SeasonSwitch({ keys, value, onChange }: { keys: string[]; value: string; onChange: (k: string) => void }) {
  return (
    <div role="group" aria-label="Сезон" className={segGroup}>
      {["all", ...keys].map((k) => <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className={seg(value === k)}>{k === "all" ? "Все" : k}</button>)}
    </div>
  );
}

/** Обёртка: закреплённая панель сезона + блоки, которые за ней следуют. */
export function SeasonScope({ keys, children }: { keys: string[]; children: React.ReactNode }) {
  const [season, setSeasonState] = useState("all");
  const wrap = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ el: Element; top: number } | null>(null);

  // При смене сезона блоки выше и ниже меняют высоту (другое число строк и плиток) — страница «дёргается». Запоминаем блок под панелью
  // (Производство или Продажи) и после перерисовки возвращаем его на то же место экрана.
  const setSeason = useCallback((k: string) => {
    const root = wrap.current;
    if (root) {
      const probe = (root.querySelector('[data-testid="dash-sales-season-bar"]')?.getBoundingClientRect().bottom ?? 0) + 8;
      const blocks = Array.from(root.children).filter((c) => !c.hasAttribute("data-testid") || c.getAttribute("data-testid") !== "dash-sales-season-bar");
      const el = blocks.find((c) => { const r = c.getBoundingClientRect(); return r.top <= probe && r.bottom > probe; }) ?? blocks.find((c) => c.getBoundingClientRect().top > probe) ?? blocks[blocks.length - 1];
      if (el) anchor.current = { el, top: el.getBoundingClientRect().top };
    }
    setSeasonState(k);
  }, []);
  useLayoutEffect(() => {
    const keep = () => {
      const a = anchor.current;
      if (!a) return;
      const d = a.el.getBoundingClientRect().top - a.top;
      if (Math.abs(d) > 1) window.scrollBy(0, d);
    };
    keep();
    // Данные блоков досчитываются в следующий кадр (таблицы, графики): подправляем ещё раз, затем отпускаем.
    const id = requestAnimationFrame(() => { keep(); anchor.current = null; });
    return () => cancelAnimationFrame(id);
  }, [season]);

  return (
    <SeasonCtx.Provider value={{ season, setSeason, keys }}>
      <div ref={wrap} data-testid="dash-season-scope" className="space-y-6">
        <div data-testid="dash-sales-season-bar" className="sticky top-0 z-30 -mx-1 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur print:hidden">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Сезон</span>
          <SeasonSwitch keys={keys} value={season} onChange={setSeason} />
        </div>
        {children}
      </div>
    </SeasonCtx.Provider>
  );
}
