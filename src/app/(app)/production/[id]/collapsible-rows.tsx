"use client";

import { useState, type ReactNode } from "react";
import { Tr, Td } from "@/components/ui/table";

/** Длинные списки строк: по умолчанию первые N и кнопка «Показать все (M)». Итоги считаются снаружи — по всем строкам. */
export function CollapsibleRows({ rows, colSpan, limit = 8, what = "строки" }: { rows: ReactNode[]; colSpan: number; limit?: number; what?: string }) {
  const [all, setAll] = useState(false);
  if (rows.length <= limit) return <>{rows}</>;
  return (
    <>
      {all ? rows : rows.slice(0, limit)}
      <Tr>
        <Td colSpan={colSpan} className="py-1 text-left">
          <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="text-xs text-blue-700 hover:underline" title={all ? `Свернуть ${what}` : `Показать все ${what}`}>
            {all ? `Свернуть (показаны все ${rows.length})` : `Показать все (${rows.length})`}
          </button>
        </Td>
      </Tr>
    </>
  );
}
