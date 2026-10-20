import Link from "next/link";
import { cn } from "@/lib/utils";

export type SegmentedItem = {
  key: string;
  label: React.ReactNode;
  on: boolean;
  /** Ссылка (серверные страницы, параметры в адресе) или обработчик (клиентские переключатели) — одно из двух. */
  href?: string;
  onSelect?: () => void;
  title?: string;
};

/** Классы одной кнопки сегмента: 44 px на телефоне, 36 px на мониторе; активная — акцентная (нейтрально-чёрная в теме, оранжевая в «Привычном»). */
export const segCls = (on: boolean, size: "md" | "sm" = "md") =>
  cn(
    "inline-flex items-center whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900",
    size === "sm" ? "min-h-11 px-2 text-xs md:min-h-8" : "min-h-11 px-3 text-sm md:min-h-9",
    on ? "bg-neutral-900 text-white" : "text-neutral-700 hover:text-neutral-900",
  );

/**
 * Единый сегмент-переключатель режимов (Тотал / Одежда / Аксессуары, Мех → Категории…): рамка 1px, p-0.5, активный — акцентный.
 * Как в Cashflow. Для переходов между разделами страницы используйте SectionTabs, а не этот компонент.
 */
export function Segmented({ label, items, size = "md", className }: { label: string; items: SegmentedItem[]; size?: "md" | "sm"; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex max-w-full self-start overflow-x-auto rounded-lg border border-neutral-300 bg-white p-0.5 [scrollbar-width:none] print:hidden", className)}>
      {items.map((it) =>
        it.href ? (
          <Link key={it.key} href={it.href} scroll={false} title={it.title} aria-current={it.on ? "page" : undefined} className={segCls(it.on, size)}>
            {it.label}
          </Link>
        ) : (
          <button key={it.key} type="button" title={it.title} aria-pressed={it.on} onClick={it.onSelect} className={segCls(it.on, size)}>
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}
