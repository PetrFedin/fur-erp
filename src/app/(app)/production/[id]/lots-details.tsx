"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Свёрнутый по умолчанию блок карточки ТЗ («Состав по лотам»); раскрывается, если открыли ссылку с якорем на него (#tz-composition). */
export function LotsDetails({ summary, children, id = "tz-composition" }: { summary: ReactNode; children: ReactNode; id?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const open = () => {
      if (window.location.hash === `#${id}` && ref.current) {
        ref.current.open = true;
        ref.current.scrollIntoView({ block: "start" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [id]);
  return (
    <details ref={ref} id={id} className="group scroll-mt-4 rounded-lg border border-neutral-200 bg-white px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-base font-semibold [&::-webkit-details-marker]:hidden">
        <span className="inline-block text-neutral-500 transition-transform group-open:rotate-90">›</span>
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
