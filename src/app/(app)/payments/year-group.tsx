"use client";

import { Fragment, useState, type ReactNode } from "react";
import { Chevron } from "@/components/tree-table";

/**
 * Год в таблицах оплат: строка-итог года со стрелкой; оплаты (партии, даты) раскрываются по клику.
 * По умолчанию свёрнуто до годов; `cells` — остальные ячейки итоговой строки (суммы года), `labelSpan` — сколько колонок занимает подпись.
 */
export function YearGroup({ label, sub, cells, labelSpan = 1, defaultOpen = false, children }: { label: ReactNode; sub?: ReactNode; cells: ReactNode; labelSpan?: number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Fragment>
      <tr className="border-b border-neutral-100 bg-neutral-50 text-sm font-semibold text-neutral-900">
        <td className="px-3 py-2" colSpan={labelSpan}>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-baseline gap-1 text-left hover:text-blue-700">
            <Chevron open={open} />
            <span>{label}</span>
            {sub ? <span className="ml-1 text-xs font-normal text-neutral-600">{sub}</span> : null}
          </button>
        </td>
        {cells}
      </tr>
      {open ? children : null}
    </Fragment>
  );
}
