"use client";

import { useState, type ReactNode } from "react";

/**
 * <details>, чьё содержимое попадает в DOM только после первого раскрытия.
 * Нужен для длинных списков (лоты по материалам): иначе на телефоне страница
 * получается в сотни тысяч пикселей высотой. Открытое по умолчанию рисуется сразу.
 *
 * load — серверное действие, которое отдаёт содержимое (React-узел) при первом раскрытии:
 * тогда лоты вообще не рендерятся на сервере вместе со страницей.
 */
export function LazyDetails({
  summary,
  children,
  load,
  defaultOpen = false,
  className,
}: {
  summary: ReactNode;
  children?: ReactNode;
  load?: () => Promise<ReactNode>;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [shown, setShown] = useState(defaultOpen);
  const [loaded, setLoaded] = useState<ReactNode>(null);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  function fetchContent() {
    setState("loading");
    load!()
      .then((node) => {
        setLoaded(node);
        setState("done");
      })
      .catch(() => setState("error"));
  }

  return (
    <details
      className={className}
      open={defaultOpen || undefined}
      onToggle={(e) => {
        if (!e.currentTarget.open) return;
        setShown(true);
        if (load && state === "idle") fetchContent();
      }}
    >
      {summary}
      {load && !defaultOpen ? (
        shown && (
          <>
            {state === "loading" && <div className="border-t border-neutral-100 bg-neutral-50 px-3 py-3 text-sm text-neutral-400">Загружаем лоты…</div>}
            {state === "error" && (
              <div className="border-t border-neutral-100 bg-neutral-50 px-3 py-3 text-sm text-red-600">
                Не удалось загрузить лоты.{" "}
                <button type="button" className="underline" onClick={fetchContent}>
                  Повторить
                </button>
              </div>
            )}
            {state === "done" ? loaded : null}
          </>
        )
      ) : shown ? (
        children
      ) : null}
    </details>
  );
}
