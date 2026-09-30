"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_LINKS } from "./nav-links";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex h-full w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-neutral-200 bg-white px-3 py-4">
      <div className="px-2 text-lg font-semibold">МехУчёт</div>
      <div className="flex flex-col gap-0.5">
        {NAV_LINKS.map((link) => {
          const active = [link.href, ...link.also].some(
            (h) => pathname === h || pathname.startsWith(h + "/")
          );
          return (
            <Link
              key={link.href}
              href={link.href}
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
    </nav>
  );
}
