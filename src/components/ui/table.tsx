import Link from "next/link";
import { cn } from "@/lib/utils";
import { SortMark, type THSort } from "@/components/table-head";
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

/**
 * anchor / label — необязательный идентификатор таблицы для комментариев («table:fur»); без него таблица получает номер автоматически.
 * stickyFirst — первый столбец закреплён слева при горизонтальной прокрутке.
 * stickyHeader — шапка остаётся на месте, пока длинную таблицу листают (таблица прокручивается внутри своей рамки, до 75% высоты экрана).
 * На любом экране у края видна тень, если справа или слева есть скрытые столбцы (класс scroll-hint).
 */
export function Table({
  className,
  anchor,
  label,
  stickyHeader = false,
  stickyFirst = false,
  ...props
}: HTMLAttributes<HTMLTableElement> & { anchor?: string; label?: string; stickyHeader?: boolean; /** Первый столбец остаётся на месте при горизонтальной прокрутке (широкие таблицы). */ stickyFirst?: boolean }) {
  return (
    <div
      data-comment-anchor={anchor}
      data-comment-label={label}
      className={cn(
        "table-scroll scroll-hint w-fit max-w-full rounded-lg border border-neutral-200 bg-white",
        stickyHeader ? "max-h-[75vh] overflow-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10" : "overflow-x-auto",
      )}
    >
      <table data-sticky-first={stickyFirst ? "" : undefined} className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
}

export function Thead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-neutral-50 text-left", className)} {...props} />;
}

export function Tbody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-neutral-100", className)} {...props} />;
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("hover:bg-neutral-50/60", className)} {...props} />;
}

/**
 * Ячейка заголовка. unit — единица (UNIT.* из src/lib/units.ts) мелкой второй строкой под названием;
 * числовые колонки задают className="text-right" (подпись и единица прижимаются к правому краю).
 * Вертикально всегда по центру. Подробнее — src/components/table-head.tsx.
 * Сортировка по клику: sort + href (серверные страницы, thSort() из src/lib/table-sort.ts) или sort + onSort (клиентские,
 * useClientSort из src/lib/use-client-sort.ts): ▲/▼, повторный клик меняет направление, aria-sort, ссылка/кнопка доступна с клавиатуры.
 */
export function Th({ className, unit, children, sort, href, onSort, after, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { unit?: string; sort?: THSort; href?: string; onSort?: () => void; /** Подсказка «i» и т.п.: рядом с подписью, но вне ссылки/кнопки сортировки (кнопка в ссылке недопустима). */ after?: React.ReactNode }) {
  const cls = className ?? "";
  const stack = /text-right/.test(cls) ? "items-end" : /text-center/.test(cls) ? "items-center" : "items-start";
  const interactive = Boolean(href || onSort);
  const body = (
    <span className={cn("inline-flex flex-col leading-tight", stack)}>
      <span className="inline-flex items-center gap-1">{children}{sort ? <SortMark dir={sort} /> : null}</span>
      {unit ? <span className="text-[11px] font-normal opacity-80">{unit}</span> : null}
    </span>
  );
  const ariaSort = sort === "asc" ? "ascending" : sort === "desc" ? "descending" : sort === "none" ? "none" : undefined;
  return (
    <th scope={interactive ? "col" : props.scope} aria-sort={ariaSort} className={cn("whitespace-nowrap px-3 py-2 align-middle text-xs font-medium text-neutral-500", (sort === "asc" || sort === "desc") && "text-[color:var(--ui-accent-text)]", className)} {...props}>
      {href ? (
        <span className="inline-flex items-center gap-1"><Link href={href} scroll={false} className="hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center">{body}</Link>{after}</span>
      ) : onSort ? (
        <span className="inline-flex items-center gap-1"><button type="button" onClick={onSort} className="hover:underline max-md:min-h-11">{body}</button>{after}</span>
      ) : unit || sort ? <>{body}{after}</> : <>{children}{after}</>}
    </th>
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
}
