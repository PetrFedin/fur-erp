"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/analytics/raw", label: "Сырьё" },
  { href: "/analytics/products", label: "Изделия" },
  { href: "/analytics/pricing", label: "Цены" },
  { href: "/analytics/margin", label: "Маржа" },
] as const;

/** Вкладки «Сырьё | Изделия | Цены | Маржа» раздела «Аналитика». Активная — по адресу. */
export function AnalyticsTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Разделы аналитики" className="flex gap-1 border-b border-neutral-200 pb-2">
      {TABS.map((t) => {
        const active = path === t.href || path.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={
              "rounded-md px-3 py-1.5 text-sm max-md:min-h-9 max-md:inline-flex max-md:items-center " +
              (active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
