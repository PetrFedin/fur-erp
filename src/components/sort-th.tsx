import type { ReactNode } from "react";
import { TH, type THAlign } from "@/components/table-head";
import { sortHref, type SortParams, type SortState } from "@/lib/table-sort";

/**
 * Заголовок столбца с сортировкой по клику (серверные страницы): ▲/▼, повторный клик меняет направление,
 * aria-sort, доступен с клавиатуры (это обычная ссылка). Данные сортирует sortRows() из src/lib/table-sort.ts.
 */
export function SortTh({ path, sp, k, cur, label, align = "left", unit, prefix = "", className }: {
  path: string; sp: SortParams; k: string; cur: SortState | null; label: ReactNode; align?: THAlign; unit?: string; prefix?: string; className?: string;
}) {
  const dir = cur?.key === k ? cur.dir : "none";
  return (
    <TH
      label={label}
      unit={unit}
      align={align}
      sort={dir}
      href={sortHref(path, sp, k, cur, prefix)}
      className={className ?? "px-3 py-2"}
    />
  );
}
