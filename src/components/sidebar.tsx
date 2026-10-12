"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { NAV_LINKS, activeNavHref } from "./nav-links";

export function Sidebar() {
  const pathname = usePathname();
  const activeHref = activeNavHref(pathname);

  return (
    <nav aria-label="Основное меню" className="hidden h-full w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-neutral-200 bg-white px-3 py-4 md:flex print:!hidden">
      <div className="px-2 text-lg font-semibold">MVST FUR PRODUCTION</div>
      <div className="flex flex-col gap-0.5">
        {NAV_LINKS.map((link) => {
          const active = activeHref === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-2 py-1.5 text-sm transition-colors",
                active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
      <div className="mt-auto px-1 xl:hidden"><ThemeToggle className="w-full flex-col [&>button]:w-full" /></div>
    </nav>
  );
}
