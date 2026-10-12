"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { NAV_LINKS, SECONDARY_NAV_HREFS, activeNavHref } from "./nav-links";

export function Sidebar() {
  const pathname = usePathname();
  const activeHref = activeNavHref(pathname);

  return (
    <nav aria-label="Основное меню" className="hidden h-full w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-neutral-200 bg-white px-3 py-4 md:flex print:!hidden">
      <div className="px-2 text-lg font-semibold">MVST FUR PRODUCTION</div>
      <div className="flex flex-col gap-0.5">
        {NAV_LINKS.filter((l) => !SECONDARY_NAV_HREFS.includes(l.href)).map((link) => {
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
      <div className="mt-auto flex flex-col gap-0.5 border-t border-neutral-200 pt-3">
        {NAV_LINKS.filter((l) => SECONDARY_NAV_HREFS.includes(l.href)).map((link) => {
          const active = activeHref === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-2 py-1 text-xs transition-colors",
                active ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
      <div className="px-1 xl:hidden"><ThemeToggle className="w-full flex-col [&>button]:w-full" /></div>
    </nav>
  );
}
