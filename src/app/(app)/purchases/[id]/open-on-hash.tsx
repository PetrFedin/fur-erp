"use client";

import { useEffect } from "react";

/** Открывает и показывает сворачиваемый блок, id которого указан в адресе (#item-…): переход к конкретному лоту. */
export function OpenOnHash() {
  useEffect(() => {
    const go = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      for (let p: HTMLElement | null = el; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true;
      el.scrollIntoView({ block: "center" });
      el.classList.add("ring-2", "ring-[var(--ui-accent)]");
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);
  return null;
}
