import { cn } from "@/lib/utils";
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

/**
 * anchor / label — необязательный идентификатор таблицы для комментариев («table:fur»); без него таблица получает номер автоматически.
 * stickyHeader — шапка остаётся на месте, пока длинную таблицу листают (таблица прокручивается внутри своей рамки, до 75% высоты экрана).
 * На любом экране у края видна тень, если справа или слева есть скрытые столбцы (класс scroll-hint).
 */
export function Table({
  className,
  anchor,
  label,
  stickyHeader = false,
  ...props
}: HTMLAttributes<HTMLTableElement> & { anchor?: string; label?: string; stickyHeader?: boolean }) {
  return (
    <div
      data-comment-anchor={anchor}
      data-comment-label={label}
      className={cn(
        "table-scroll scroll-hint w-full rounded-lg border border-neutral-200 bg-white",
        stickyHeader ? "max-h-[75vh] overflow-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10" : "overflow-x-auto",
      )}
    >
      <table className={cn("w-full text-sm", className)} {...props} />
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

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500",
        className
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
}
