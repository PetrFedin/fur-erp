"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { FUR_SRC_KEYS, FUR_SRC_LABEL, type FurSrc } from "@/lib/fur-src";

/** Событие между переключателем в шапке и областью <FurScope> страницы: оба живут в разных частях дерева. */
export const FUR_SRC_EVENT = "fur-src-change";

const readSrc = (): FurSrc => {
  try {
    const q = new URL(window.location.href).searchParams.get("fsrc");
    return (FUR_SRC_KEYS as string[]).includes(q ?? "") ? (q as FurSrc) : "all";
  } catch {
    return "all";
  }
};

/**
 * Источник закупки в сквозной панели шапки (рядом с «Цены» и «4 %»): Все / На аукционах / У поставщика.
 * Действует на весь раздел «Сырьё»; значение живёт в адресе (?fsrc=…), по умолчанию — «Все».
 */
export function FurSrcMode() {
  const path = usePathname();
  const [src, setSrcState] = useState<FurSrc>("all");
  // После смены страницы читаем адрес заново: новая страница открывается в «Все», если параметра нет.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSrcState(readSrc());
  }, [path]);
  useEffect(() => {
    const on = (e: Event) => setSrcState((e as CustomEvent<FurSrc>).detail);
    window.addEventListener(FUR_SRC_EVENT, on);
    return () => window.removeEventListener(FUR_SRC_EVENT, on);
  }, []);
  const pick = useCallback((s: FurSrc) => {
    setSrcState(s);
    try {
      const url = new URL(window.location.href);
      if (s === "all") url.searchParams.delete("fsrc"); else url.searchParams.set("fsrc", s);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch { /* без адресной строки переключатель всё равно работает */ }
    window.dispatchEvent(new CustomEvent<FurSrc>(FUR_SRC_EVENT, { detail: s }));
  }, []);
  return (
    <div role="group" aria-label="Источник закупки для всего раздела «Сырьё»" data-testid="fur-source-switch" className="inline-flex overflow-hidden rounded-md border border-neutral-300 text-xs">
      {FUR_SRC_KEYS.map((k) => (
        <button key={k} type="button" aria-pressed={src === k} onClick={() => pick(k)}
          className={"min-h-9 whitespace-nowrap px-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 " + (src === k ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50")}>
          {k === "all" ? "Все" : FUR_SRC_LABEL[k]}
        </button>
      ))}
    </div>
  );
}
