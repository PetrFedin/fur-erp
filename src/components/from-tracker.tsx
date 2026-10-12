"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CARD_PATH } from "@/lib/back-from";

/**
 * Помнит «откуда пришёл»: при обычном клике по внутренней ссылке на карточку (закупка, лот, ТЗ, партия,
 * артикул, вид меха, поставщик) добавляет к адресу ?from=<текущая страница>. На карточке <BackLink> показывает
 * «‹ Назад к: …». Ссылки с Ctrl/⌘/Shift, в новой вкладке и со своим ?from= не затрагиваются.
 */
export function FromTracker() {
  const router = useRouter();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const raw = a.getAttribute("href") ?? "";
      if (!raw.startsWith("/") || raw.startsWith("//")) return;
      let url: URL;
      try { url = new URL(raw, window.location.origin); } catch { return; }
      if (url.origin !== window.location.origin || !CARD_PATH.test(url.pathname) || url.searchParams.has("from")) return;
      if (url.pathname === window.location.pathname) return;
      const here = new URL(window.location.href);
      here.searchParams.delete("from");
      url.searchParams.set("from", here.pathname + here.search);
      e.preventDefault();
      e.stopPropagation();
      router.push(url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);
  return null;
}
