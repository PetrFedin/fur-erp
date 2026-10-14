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
        <button type="button" onClick={fold.toggle} data-touch-ok className={btn + " border-neutral-200 bg-white text-neutral-600"}>{fold.open ? "Свернуть" : "Развернуть"}</button>
        <button type="button" onClick={fold.togglePin} data-touch-ok aria-pressed={fold.pinned} title="Закрепить: заголовок остаётся вверху при прокрутке"
          className={btn + (fold.pinned ? " border-neutral-900 bg-neutral-900 text-white" : " border-neutral-200 bg-white text-neutral-600")}>{fold.pinned ? "Закреплено" : "Закрепить"}</button>
      </div>
    </div>
  );
}
