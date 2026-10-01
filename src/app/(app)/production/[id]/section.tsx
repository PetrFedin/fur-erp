"use client";

import { useEffect, useRef } from "react";

const MOBILE = "(max-width: 639px)";

/**
 * Секция карточки ТЗ. От sm и выше всегда раскрыта (заголовок скрыт — у блоков свои),
 * на мобильном — сворачиваемая <details>. Якорь (#id) открывает секцию.
 */
export function Section({
  id,
  title,
  defaultOpenMobile = false,
  children,
}: {
  id: string;
  title: string;
  defaultOpenMobile?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mq = window.matchMedia(MOBILE);
    const sync = () => {
      if (!mq.matches) el.open = true;
    };
    if (mq.matches && !defaultOpenMobile && window.location.hash !== `#${id}`) el.open = false;
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [id, defaultOpenMobile]);
  return (
    <details ref={ref} id={id} open className="scroll-mt-16">
      <summary className="cursor-pointer list-none rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 sm:hidden">
        {title}
      </summary>
      <div className="mt-2 flex flex-col gap-4 sm:mt-0">{children}</div>
    </details>
  );
}

/** Оглавление-якоря вверху карточки; на мобильном открывает свёрнутую секцию. */
export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  return (
    <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-600" aria-label="Разделы карточки">
      {items.map((it) => (
        <a
          key={it.id}
          href={`#${it.id}`}
          className="inline-block underline-offset-2 hover:underline max-md:py-2"
          onClick={(e) => {
            const el = document.getElementById(it.id);
            if (!el) return;
            e.preventDefault();
            if (el instanceof HTMLDetailsElement) el.open = true;
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          {it.label}
        </a>
      ))}
    </nav>
  );
}
