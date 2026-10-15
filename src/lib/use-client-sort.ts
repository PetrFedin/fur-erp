"use client";
// Сортировка клиентских таблиц по клику на заголовок (▲/▼, повторный клик меняет направление).
// Серверные страницы сортируют через ?sort=…&dir=… (src/lib/table-sort.ts + <SortTh/>), клиентские — этим хуком и <TH {...th("ключ")} />.
import { useState } from "react";
import { sortRows, type SortDir, type SortState, type SortVal } from "@/lib/table-sort";
import type { THSort } from "@/components/table-head";

export function useClientSort<T>(getters: Record<string, (r: T) => SortVal>, def: SortState | null = null) {
  const [st, setSt] = useState<SortState | null>(def);
  /** Свойства для <TH>: состояние ▲/▼ и обработчик клика (новый столбец — по возрастанию, повторный клик — наоборот). */
  const th = (key: string): { sort: THSort; onSort: () => void } => ({
    sort: st?.key === key ? st.dir : "none",
    onSort: () => setSt((c) => ({ key, dir: (c?.key === key ? (c.dir === "asc" ? "desc" : "asc") : "asc") as SortDir })),
  });
  /** Стабильная сортировка копии; пустые значения — в конце. */
  const sort = <R extends T>(rows: R[]): R[] => sortRows(rows, st, getters as unknown as Record<string, (r: R) => SortVal>);
  return { th, sort, state: st };
}
