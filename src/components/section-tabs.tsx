import Link from "next/link";
import { cn } from "@/lib/utils";

export type SectionTabItem = {
  key: string;
  href: string;
  label: React.ReactNode;
  on: boolean;
  title?: string;
  /** Второстепенная вкладка в конце ряда: мельче, прижата вправо. */
  muted?: boolean;
  /** Счётчик справа от подписи (например, «Задачи 27»). */
  badge?: React.ReactNode;
};

/** Классы одной вкладки раздела (общие для ТЗ, Сырья, Контроля, Оплат, Аналитики). */
export const tabCls = (on: boolean, muted?: boolean) =>
  cn(
    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 max-md:min-h-11",
    on ? "bg-neutral-900 text-white" : muted ? "ml-auto text-xs text-neutral-500 hover:bg-neutral-100" : "text-neutral-700 hover:bg-neutral-100",
  );

/** Рамка ряда вкладок: линия снизу, перенос на узком экране. */
export const TABS_NAV = "flex flex-wrap items-center gap-1 border-b border-neutral-200 pb-2 print:hidden";

/** Единые вкладки раздела (переходы между страницами/режимами раздела). Режимы показа внутри страницы — Segmented. */
export function SectionTabs({ label, items }: { label: string; items: SectionTabItem[] }) {
  return (
    <nav aria-label={label} className={TABS_NAV}>
      {items.map((t) => (
        <Link key={t.key} href={t.href} title={t.title} aria-current={t.on ? "page" : undefined} className={tabCls(t.on, t.muted)}>
          {t.label}
          {t.badge}
        </Link>
      ))}
    </nav>
  );
}
