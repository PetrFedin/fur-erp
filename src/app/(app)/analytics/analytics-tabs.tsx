"use client";

import { usePathname } from "next/navigation";
import { SectionTabs } from "@/components/section-tabs";

const TABS = [
  { href: "/analytics/raw", label: "Сырьё" },
  { href: "/analytics/products", label: "Изделия" },
  { href: "/analytics/pricing", label: "Цены" },
  { href: "/analytics/margin", label: "Маржа" },
] as const;

/** Вкладки «Сырьё | Изделия | Цены | Маржа» раздела «Аналитика». Активная — по адресу. */
export function AnalyticsTabs() {
  const path = usePathname();
  return <SectionTabs label="Разделы аналитики" items={TABS.map((t) => ({ key: t.href, href: t.href, label: t.label, on: path === t.href || path.startsWith(`${t.href}/`) }))} />;
}
