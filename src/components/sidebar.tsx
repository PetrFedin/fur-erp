"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_SECTIONS } from "./nav-links";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex h-full w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-neutral-200 bg-white px-3 py-4">
      <div className="px-2 text-lg font-semibold">МехУчёт</div>
      {NAV_SECTIONS.map((section) => (
        <div key={section.title || section.links[0]?.href}>
          {section.title && (
            <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {section.title}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {section.links.map((link) => {
              const active = pathname === link.href || pathname.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-neutral-900 text-white"
                      : "text-neutral-700 hover:bg-neutral-100"
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
