"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Ряд виджетов (плитки) с управлением: «свернуть» прячет плитки, «закрепить» (гвоздик) держит ряд видимым вверху экрана при прокрутке.
 * Состояние запоминается в браузере отдельно для каждой страницы и ряда (id).
 * Использование: <WidgetRow id="prod" title="Производство">…плитки…</WidgetRow>
 */
export function WidgetRow({ id, title = "Виджеты", children, className = "", titleClass = "", headerExtra, headerEnd }: { id: string; title?: string; children: ReactNode; className?: string; titleClass?: string; headerExtra?: ReactNode; headerEnd?: ReactNode }) {
  const path = usePathname();
  const key = `widgets:${path}:${id}`;
  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [ready, setReady] = useState(false);

  // Чтение localStorage возможно только в браузере (после гидратации), иначе разметка сервера и клиента разошлась бы.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let c = false, p = false;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) { const v = JSON.parse(raw) as { c?: boolean; p?: boolean }; c = !!v.c; p = !!v.p; }
    } catch { /* без памяти браузера работает так же, просто без запоминания */ }
    setCollapsed(c); setPinned(p);
    setReady(true);
  }, [key]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const save = (c: boolean, p: boolean) => {
    try { window.localStorage.setItem(key, JSON.stringify({ c, p })); } catch { /* ничего */ }
  };
  const toggleCollapsed = () => { const v = !collapsed; setCollapsed(v); save(v, pinned); };
  const togglePinned = () => { const v = !pinned; setPinned(v); save(collapsed, v); };

  const btn = "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-xs transition btn-accent";
  return (
    <section
      aria-label={title}
      data-widget-row
      className={(pinned ? "sticky top-0 z-30 -mx-3 border-b border-neutral-200 bg-white/95 px-3 pb-2 pt-1 shadow-sm backdrop-blur max-sm:max-h-[40vh] max-sm:overflow-y-auto md:-mx-6 md:px-6 print:static print:shadow-none " : "") + "flex flex-col gap-2 " + className}
    >
      <div className="flex items-start justify-between gap-2 print:hidden">
        <button type="button" onClick={toggleCollapsed} aria-expanded={!collapsed} data-touch-ok
          className={"inline-flex min-w-0 items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900 " + titleClass}>
          <span aria-hidden className={"inline-block w-3 transition-transform " + (collapsed ? "" : "rotate-90")}>›</span>
          <span className="text-left max-sm:break-words sm:truncate">{title}</span>
        </button>
        {headerExtra ? <div className="flex min-w-0 flex-1 items-center gap-2">{headerExtra}</div> : null}
        <div className={"flex shrink-0 gap-2 " + (headerEnd ? "flex-col items-end gap-1" : "items-center")}>
          {headerEnd ? <div className="flex h-7 items-center">{headerEnd}</div> : null}
          <div className="flex items-center gap-2">
          <button type="button" onClick={toggleCollapsed} data-touch-ok aria-label={collapsed ? "Развернуть виджеты" : "Свернуть виджеты"} title={collapsed ? "Развернуть" : "Свернуть"}
            className={btn + " border-neutral-200 bg-white text-neutral-600"}>{collapsed ? "Развернуть" : "Свернуть"}</button>
          <button type="button" onClick={togglePinned} data-touch-ok aria-pressed={pinned} aria-label={pinned ? "Открепить виджеты" : "Закрепить виджеты: показывать всегда"} title={pinned ? "Открепить" : "Закрепить: показывать всегда при прокрутке"}
            className={btn + (pinned ? " border-neutral-900 bg-neutral-900 text-white" : " border-neutral-200 bg-white text-neutral-600")}>
            <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M9.8 1.2 14.8 6.2l-1.1.4-1.6 1.6.5 3.1-1 1-2.9-2.9-3.7 3.7-.7-.7 3.7-3.7L3.1 5.8l1-1 3.1.5 1.6-1.6z" /></svg>
            {pinned ? "Закреплено" : "Закрепить"}
          </button>
          </div>
        </div>
      </div>
      <div className={collapsed && ready ? "hidden print:block" : ""}>{children}</div>
    </section>
  );
}
