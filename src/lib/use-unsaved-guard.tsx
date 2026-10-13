"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/confirm-dialog";

/**
 * Защита от потери введённого, пока форма «грязная» (dirty):
 *  • закрытие/перезагрузка вкладки — стандартное предупреждение браузера (beforeunload);
 *  • клик по внутренней ссылке — окно «Уйти без сохранения?» (`links: false` — только beforeunload).
 * Использование: const guard = useUnsavedGuard(dirty); ... {guard}
 */
export function useUnsavedGuard(dirty: boolean, opts?: { links?: boolean }): ReactNode {
  const router = useRouter();
  const { ask, node } = useConfirm();
  const links = opts?.links ?? true;

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty || !links) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // якорь на этой же странице
      e.preventDefault();
      e.stopPropagation();
      void ask("Есть несохранённые данные. Уйти без сохранения?", { ok: "Уйти", danger: true }).then((ok) => {
        if (ok) router.push(url.pathname + url.search + url.hash);
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty, links, router, ask]);

  return node;
}
