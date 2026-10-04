"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

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
  id,
}: {
  summary: ReactNode;
  children?: ReactNode;
  load?: () => Promise<ReactNode>;
  defaultOpen?: boolean;
  className?: string;
  id?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [shown, setShown] = useState(defaultOpen);
  const [loaded, setLoaded] = useState<ReactNode>(null);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  // Ссылка вида /страница#id раскрывает именно этот блок (иначе пользователь попадает на свёрнутую строку).
  useEffect(() => {
    if (!id || defaultOpen) return;
    try {
      if (decodeURIComponent(window.location.hash.slice(1)) !== id) return;
    } catch {
      return;
    }
    const el = ref.current;
    if (el && !el.open) {
      el.open = true;
      el.scrollIntoView({ block: "start" });
    }
  }, [id, defaultOpen]);

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
      ref={ref}
      id={id}
      className={className}
      open={defaultOpen || undefined}
      onToggle={(e) => {
        if (!e.currentTarget.open) return;
        setShown(true);
        if (load && state === "idle") fetchContent();
      }}
    >
      <Fragment key="summary">{summary}</Fragment>
      {load && !defaultOpen ? (
        shown && (
          <>
            {state === "loading" && <div className="border-t border-neutral-100 bg-neutral-50 px-3 py-3 text-sm text-neutral-400">Загружаем…</div>}
            {state === "error" && (
              <div className="border-t border-neutral-100 bg-neutral-50 px-3 py-3 text-sm text-red-600">
                Не удалось загрузить.{" "}
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
