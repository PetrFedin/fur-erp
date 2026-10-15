import type { ReactNode, ThHTMLAttributes } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Единое оформление шапок таблиц (docs/ui-style-guide.md, п. 5).
 * - заголовки строго по центру по вертикали (align-middle), одинаковая высота строки шапки (h-10);
 * - числовые колонки — по правому краю, текстовые — по левому (align="left"), блоки — по центру;
 * - «Название» первой строкой, единица (₽, $, шт., м, %, ₽/шт.) — мелкой серой второй строкой (UNIT из src/lib/units.ts);
 * - сортировка: ▲/▼ в зарезервированной ширине (подпись не двигается), активная — оранжевая (акцент темы).
 */

export type THAlign = "left" | "right" | "center";
export type THSort = "asc" | "desc" | "none";

const ALIGN_CELL: Record<THAlign, string> = { left: "text-left", right: "text-right", center: "text-center" };
const ALIGN_STACK: Record<THAlign, string> = { left: "items-start", right: "items-end", center: "items-center" };

/** Метка сортировки фиксированной ширины: неактивная невидима, но место занимает. */
export function SortMark({ dir }: { dir: THSort }) {
  return (
    <span aria-hidden className={cn("inline-block w-3 shrink-0 text-center text-[11px] leading-none", dir === "none" ? "invisible" : "text-[color:var(--ui-accent)]")}>
      {dir === "desc" ? "▼" : "▲"}
    </span>
  );
}

type THProps = Omit<ThHTMLAttributes<HTMLTableCellElement>, "children"> & {
  /** Название колонки (первая строка). */
  label?: ReactNode;
  /** Единица (UNIT.*) — второй, мелкой строкой. Для названий, дат, номеров, статусов не указывать. */
  unit?: string;
  align?: THAlign;
  /** Состояние сортировки; вместе с href (ссылка) или onSort (кнопка) делает заголовок сортируемым. */
  sort?: THSort;
  href?: string;
  onSort?: () => void;
  /** Левая вертикальная линия блока колонок. */
  sep?: boolean;
  /** Подсказка «i» и т.п. — после подписи. */
  after?: ReactNode;
  children?: ReactNode;
};

export function TH({ label, unit, align = "right", sort, href, onSort, sep, after, className, children, ...rest }: THProps) {
  const interactive = Boolean(href || onSort);
  // Подсказка «i» — кнопка: внутри ссылки или кнопки сортировки её вкладывать нельзя (button в button — ошибка гидратации), поэтому она рядом.
  const body = (inner: ReactNode) => (
    <span className={cn("inline-flex flex-col leading-tight", ALIGN_STACK[align])}>
      <span className="inline-flex items-center gap-1">
        {label ?? children}
        {sort ? <SortMark dir={sort} /> : null}
        {inner}
      </span>
      {unit ? <span className="text-[11px] font-normal opacity-80">{unit}</span> : null}
    </span>
  );
  const ariaSort = sort === "asc" ? "ascending" : sort === "desc" ? "descending" : sort === "none" ? "none" : undefined;
  const active = sort === "asc" || sort === "desc";
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        "h-10 whitespace-nowrap px-1.5 py-1 align-middle text-xs font-medium text-neutral-500",
        ALIGN_CELL[align],
        sep && "border-l border-neutral-200",
        active && "text-[color:var(--ui-accent-text)]",
        className,
      )}
      {...rest}
    >
      {interactive ? (
        <span className={cn("inline-flex items-center gap-1", after ? "" : "contents")}>
          {href ? (
            <Link href={href} scroll={false} className="hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center">{body(null)}</Link>
          ) : (
            <button type="button" onClick={onSort} className="hover:underline max-md:min-h-11">{body(null)}</button>
          )}
          {after}
        </span>
      ) : (
        body(after)
      )}
    </th>
  );
}

/** Подпись блока колонок (colSpan): по центру блока, линия снизу, вертикальная линия слева между блоками. */
export function THGroup({ children, colSpan, sep = true, className, ...rest }: Omit<ThHTMLAttributes<HTMLTableCellElement>, "children"> & { children: ReactNode; sep?: boolean }) {
  return (
    <th
      colSpan={colSpan}
      className={cn(
        "h-7 whitespace-nowrap border-b border-neutral-200 px-1.5 align-middle text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500",
        sep && "border-l",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}
