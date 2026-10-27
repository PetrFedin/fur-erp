import Link from "next/link";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

/**
 * Хлебные крошки — путь по ИЕРАРХИИ раздела («Сырьё › Мех › Лиса › SAGA 03.25 › Лот 301023»), а не история браузера.
 * Последний элемент без ссылки, жирным (aria-current). Короткий серый текст; на узком экране лента прокручивается внутри себя
 * (длинный путь не ломает страницу). Общий компонент: items — [{ label, href? }].
 */
export function Breadcrumbs({ items: rawItems, className }: { items: Crumb[]; className?: string }) {
  // Путь всегда начинается с «Главная» — так видно, откуда и куда ведёт каждая ступень.
  const items: Crumb[] = rawItems[0]?.label === "Главная" ? rawItems : [{ label: "Главная", href: "/dashboard" }, ...rawItems];
  return (
    <nav aria-label="Путь" className={cn("print:hidden", className)}>
      <ol className="flex flex-nowrap items-center gap-1 overflow-x-auto whitespace-nowrap pb-0.5 text-xs text-neutral-500 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}:${c.label}`} className="flex shrink-0 items-center gap-1">
              {i > 0 ? <span aria-hidden className="text-neutral-600">›</span> : null}
              {last || !c.href ? (
                <span aria-current={last ? "page" : undefined} className={last ? "font-semibold text-neutral-800" : undefined}>{c.label}</span>
              ) : (
                <Link href={c.href} className="rounded-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900">{c.label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
