"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { FUR_SRC_KEYS, FUR_SRC_LABEL, type FurSrc } from "@/components/fur-source-nav";

/**
 * Область действия переключателя «Вся закупка / На аукционах / У поставщика» на Главной: он меняет ТОЛЬКО блоки внутри
 * <FurScope> (мех, «Динамика по годам», «Динамика по сырью», «Из чего складывается стоимость меха»), по умолчанию — «Вся закупка».
 * Остальные блоки (производство, оплаты, долги) от него не зависят. Липкая плашка сверху области всегда показывает выбранный источник и фильтры.
 */
type Ctx = { src: FurSrc; setSrc: (s: FurSrc) => void };
const FurScopeCtx = createContext<Ctx | null>(null);

/** Выбранный источник (null — блок вне области: переключатель не действует). */
export const useFurScope = () => useContext(FurScopeCtx);

export function FurScope({ info, children }: { /** Год и активные фильтры меха — для плашки. */ info: { year: string; filters: string | null }; children: ReactNode }) {
  const [src, setSrcState] = useState<FurSrc>("all");
  // Источник хранится в адресе (?fsrc=auction|supplier; «Вся закупка» — без параметра) и в sessionStorage: он сохраняется при
  // переходе Главная ⇄ страницы видов меха. Читаем после загрузки, чтобы разметка сервера и клиента совпала.
  useEffect(() => {
    try {
      const q = new URL(window.location.href).searchParams.get("fsrc");
      const v = (FUR_SRC_KEYS as string[]).includes(q ?? "") ? (q as FurSrc) : (FUR_SRC_KEYS as string[]).includes(sessionStorage.getItem("fur-src") ?? "") ? (sessionStorage.getItem("fur-src") as FurSrc) : "all";
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v !== "all") setSrcState(v);
      if (v !== "all" && q !== v) { const u = new URL(window.location.href); u.searchParams.set("fsrc", v); window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash); }
    } catch { /* адрес и хранилище недоступны — работает без них */ }
  }, []);
  const setSrc = useCallback((s: FurSrc) => {
    setSrcState(s);
    try {
      sessionStorage.setItem("fur-src", s);
      const url = new URL(window.location.href);
      if (s === "all") url.searchParams.delete("fsrc"); else url.searchParams.set("fsrc", s);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch { /* без адресной строки переключатель всё равно работает */ }
  }, []);
  return (
    <FurScopeCtx.Provider value={{ src, setSrc }}>
      <div data-testid="fur-scope" className="flex flex-col gap-5">
        {/* Плашка прилипает к верху, пока на экране блоки области; на телефоне — две строки, кнопки ≥44px. */}
        <div data-testid="fur-scope-bar" className="sticky top-0 z-30 -mx-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-neutral-200 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur print:hidden">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Источник меха</span>
          <div role="group" aria-label="Источник закупки меха для блоков сырья" data-testid="fur-source-switch" className="inline-flex overflow-hidden rounded-md border border-neutral-300 text-xs">
            {FUR_SRC_KEYS.map((k) => (
              <button key={k} type="button" aria-pressed={src === k} onClick={() => setSrc(k)}
                className={"min-h-11 whitespace-nowrap px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 " + (src === k ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50")}>{FUR_SRC_LABEL[k]}</button>
            ))}
          </div>
          <span className="min-w-0 text-xs text-neutral-600" data-testid="fur-scope-now">
            Выбрано: <b className="font-semibold text-orange-700">{FUR_SRC_LABEL[src]}</b> · {info.year}{info.filters ? ` · ${info.filters}` : ""}
            <span className="hidden sm:inline text-neutral-500"> · действует на сырьё, динамику и состав стоимости; производство и оплаты не меняются</span>
          </span>
        </div>
        {children}
      </div>
    </FurScopeCtx.Provider>
  );
}

/** Метка в заголовке блока: какой источник сейчас показан (только внутри области). */
export function ScopeBadge() {
  const c = useFurScope();
  if (!c) return null;
  return <span data-testid="scope-badge" className={"rounded-full px-2 py-0.5 text-[11px] font-medium " + (c.src === "all" ? "bg-neutral-100 text-neutral-700" : "bg-orange-50 text-orange-800")}>Мех: {FUR_SRC_LABEL[c.src]}</span>;
}
