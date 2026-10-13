"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Раздел с кнопками «Свернуть» и «Закрепить» для таблиц с раскрытием строк (Главная: «Динамика по годам», «Динамика по сырью»).
 * - «Свернуть» прячет раздел до названия (запоминается в браузере отдельно для страницы и раздела);
 * - «Закрепить» запоминает раздел ровно в том виде, как его развернул пользователь (value — какие строки раскрыты), и восстанавливает при следующем заходе.
 * Без памяти браузера работает так же, просто без запоминания.
 * Использование: <PinSection id="x" title="…" value={Array.from(open)} onRestore={(v) => setOpen(new Set(v))}>…таблица…</PinSection>
 */
export function PinSection({ id, title, headerExtra, value, onRestore, children, className = "space-y-2" }: {
  id: string;
  title: string;
  headerExtra?: ReactNode;
  /** Текущий вид раздела (список раскрытых строк) — сохраняется, пока раздел закреплён. */
  value: string[];
  /** Вызывается один раз при заходе, если раздел закреплён и сохранённый вид есть. */
  onRestore: (value: string[]) => void;
  children: ReactNode;
  className?: string;
}) {
  const path = usePathname();
  const key = `pin-section:${path}:${id}`;
  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [ready, setReady] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let c = false, p = false, s: string[] | null = null;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const v = JSON.parse(raw) as { c?: boolean; p?: boolean; s?: unknown };
        c = !!v.c; p = !!v.p;
        if (p && Array.isArray(v.s)) s = v.s.filter((x): x is string => typeof x === "string");
      }
    } catch { /* без памяти браузера — без запоминания */ }
    setCollapsed(c); setPinned(p);
    if (s) onRestore(s);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const serialized = JSON.stringify(value);
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(pinned ? { c: collapsed, p: true, s: JSON.parse(serialized) } : { c: collapsed, p: false }));
    } catch { /* ничего */ }
  }, [ready, key, collapsed, pinned, serialized]);

  const btn = "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-xs transition btn-accent";
  return (
    <section aria-label={title} className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="block-title">
            <button type="button" onClick={() => setCollapsed((v) => !v)} aria-expanded={!collapsed} data-touch-ok
              className="inline-flex items-center gap-1 hover:text-neutral-600">
              <span aria-hidden className={"inline-block w-3 text-neutral-400 transition-transform " + (collapsed ? "" : "rotate-90")}>›</span>
              {title}
            </button>
          </h2>
          {headerExtra}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setCollapsed((v) => !v)} data-touch-ok aria-label={collapsed ? `Развернуть: ${title}` : `Свернуть до названия: ${title}`}
            title={collapsed ? "Показать таблицу" : "Скрыть таблицу, оставить только название"}
            className={btn + " border-neutral-200 bg-white text-neutral-600"}>{collapsed ? "Развернуть" : "Свернуть"}</button>
          <button type="button" onClick={() => setPinned((v) => !v)} data-touch-ok aria-pressed={pinned} aria-label={pinned ? `Открепить: ${title}` : `Закрепить: ${title}`}
            title={pinned ? "Сейчас таблица запоминается так, как вы её развернули. Нажмите, чтобы открепить" : "Запомнить таблицу в том виде, как вы её развернули"}
            className={btn + (pinned ? " border-neutral-900 bg-neutral-900 text-white" : " border-neutral-200 bg-white text-neutral-600")}>
            <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M9.8 1.2 14.8 6.2l-1.1.4-1.6 1.6.5 3.1-1 1-2.9-2.9-3.7 3.7-.7-.7 3.7-3.7L3.1 5.8l1-1 3.1.5 1.6-1.6z" /></svg>
            {pinned ? "Закреплено" : "Закрепить"}
          </button>
        </div>
      </div>
      <div className={collapsed && ready ? "hidden print:block" : ""}>{children}</div>
    </section>
  );
}
