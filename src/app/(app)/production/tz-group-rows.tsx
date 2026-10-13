"use client";

import { useState, type ReactNode } from "react";
import { Td, Tr } from "@/components/ui/table";

/**
 * Строка ТЗ из документа с несколькими артикулами (позициями): одна строка-ТЗ с суммами и раскрытием «› N артикулов».
 * before — ячейка «Партия», label — содержимое ячейки «ТЗ» (после стрелки), after — остальные ячейки; children — строки-позиции.
 * Строки приходят с сервера готовыми, здесь только состояние «раскрыто».
 */
export function TzGroupRows({ before, label, after, count, n, children, defaultOpen = false }: { before: ReactNode; label: ReactNode; after: ReactNode; count: string; n: number; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <Tr className={"border-t border-neutral-100 " + (open ? "bg-neutral-50" : "")}>
        {before}
        <Td className="p-0 font-medium">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`${open ? "Свернуть" : "Раскрыть"}: ${count}`} className="flex w-full items-center gap-1 whitespace-nowrap px-3 py-2 text-left hover:underline">
            <span aria-hidden className={"inline-block w-3 text-neutral-500 transition-transform " + (open ? "rotate-90" : "")}>›</span>
            {label}
          </button>
        </Td>
        <Td className="p-0 text-right tabular-nums">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`${open ? "Свернуть" : "Раскрыть"}: ${count}`} className="block w-full px-3 py-2 text-right hover:underline">{n}</button>
        </Td>
        {after}
      </Tr>
      {open ? children : null}
    </>
  );
}
