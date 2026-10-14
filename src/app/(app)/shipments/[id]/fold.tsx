"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/** Свёрнутость и закрепление блока страницы; выбор запоминается в браузере отдельно для страницы и блока. */
export function useFold(id: string, defaultOpen = true) {
  const key = `fold:${usePathname()}:${id}`;
  const [open, setOpen] = useState(defaultOpen);
  const [pinned, setPinned] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) { const v = JSON.parse(raw) as { o?: boolean; p?: boolean }; if (v.o !== undefined) setOpen(!!v.o); setPinned(!!v.p); }
    } catch { /* без памяти браузера работает так же */ }
  }, [key]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const save = (o: boolean, p: boolean) => { try { window.localStorage.setItem(key, JSON.stringify({ o, p })); } catch { /* ничего */ } };
  return {
    open,
    pinned,
    toggle: () => { const v = !open; setOpen(v); save(v, pinned); },
    togglePin: () => { const v = !pinned; setPinned(v); save(open, v); },
  };
}

type Fold = ReturnType<typeof useFold>;
const btn = "inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-md border px-2 text-xs transition btn-accent";

/** Заголовок блока: стрелка + название, действия блока (только пока развёрнут), «Свернуть» и «Закрепить» (заголовок остаётся вверху при прокрутке). */
export function FoldHeader({ title, fold, hint, actions }: { title: ReactNode; fold: Fold; hint?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={"flex flex-wrap items-center justify-between gap-2 " + (fold.pinned ? "sticky top-0 z-20 -mx-3 border-b border-neutral-200 bg-white/95 px-3 py-1.5 backdrop-blur md:-mx-6 md:px-6" : "")}>
      <h2 className="block-title flex items-center gap-1">
        <button type="button" onClick={fold.toggle} aria-expanded={fold.open} data-touch-ok className="inline-flex items-center gap-1 hover:text-neutral-700">
          <span aria-hidden className={"inline-block w-3 transition-transform " + (fold.open ? "rotate-90" : "")}>›</span>
          {title}
        </button>
        {hint}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {fold.open && actions}
        <button type="button" onClick={fold.toggle} data-touch-ok aria-label={fold.open ? "Свернуть" : "Развернуть"} title={fold.open ? "Свернуть блок" : "Развернуть блок"} className={btn + " w-7 justify-center border-neutral-200 bg-white text-neutral-600"}>
          <svg aria-hidden viewBox="0 0 16 16" className={"h-3.5 w-3.5 transition-transform " + (fold.open ? "" : "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 10 8 5.5 12.5 10" /></svg>
        </button>
        <button type="button" onClick={fold.togglePin} data-touch-ok aria-pressed={fold.pinned} aria-label={fold.pinned ? "Открепить" : "Закрепить"} title={fold.pinned ? "Открепить заголовок" : "Закрепить: заголовок остаётся вверху при прокрутке"}
          className={btn + " w-7 justify-center" + (fold.pinned ? " border-neutral-900 bg-neutral-900 text-white" : " border-neutral-200 bg-white text-neutral-600")}>
          <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M9.8 1.2 14.8 6.2l-1.1.4-1.6 1.6.5 3.1-1 1-2.9-2.9-3.7 3.7-.7-.7 3.7-3.7L3.1 5.8l1-1 3.1.5 1.6-1.6z" /></svg>
        </button>
      </div>
    </div>
  );
}
