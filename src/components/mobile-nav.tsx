"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_LINKS } from "./nav-links";

/** Гамбургер и выезжающее меню для узких экранов (<768px); на десктопе скрыто. */
export function MobileNav() {
  const pathname = usePathname();
  const [openAt, setOpenAt] = useState<string | null>(null);
  // Меню открыто, только пока путь тот же, что при открытии: переход закрывает его.
  const open = openAt === pathname;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenAt(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? "Закрыть меню" : "Открыть меню"}
        aria-expanded={open}
        onClick={() => setOpenAt(open ? null : pathname)}
        className="flex h-10 w-10 items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M2 4.5h14M2 9h14M2 13.5h14" />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpenAt(null)} aria-hidden="true" />
          <nav className="absolute inset-y-0 left-0 flex w-64 max-w-[80vw] flex-col gap-6 overflow-y-auto bg-white px-3 py-4 shadow-xl">
            <div className="flex items-center justify-between px-2">
              <span className="text-lg font-semibold">МехУчёт</span>
              <button type="button" aria-label="Закрыть меню" onClick={() => setOpenAt(null)} className="text-neutral-500 hover:text-neutral-900">
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-0.5">
              {NAV_LINKS.map((link) => {
                const active = [link.href, ...link.also].some((h) => pathname === h || pathname.startsWith(h + "/"));
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpenAt(null)}
                    className={cn(
                      "rounded-md px-2 py-2 text-sm transition-colors",
                      active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"
                    )}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}
