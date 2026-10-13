"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Td, Tr } from "@/components/ui/table";

/**
 * Строка ТЗ из документа с несколькими артикулами (позициями): одна строка-ТЗ с суммами и раскрытием «› N артикулов».
 * before — ячейка «Партия», label — содержимое ячейки «ТЗ» (после стрелки), after — остальные ячейки; children — строки-позиции.
 * Строки приходят с сервера готовыми, здесь только состояние «раскрыто».
 */
export function TzGroupRows({ before, label, after, count, n, href, children, defaultOpen = false }: { before: ReactNode; label: ReactNode; after: ReactNode; count: string; n: number; href: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <Tr className={"border-t border-neutral-100 " + (open ? "bg-neutral-50" : "")}>
        {before}
        <Td className="p-0 font-medium">
          <div className="flex items-center whitespace-nowrap">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`${open ? "Свернуть" : "Раскрыть"}: ${count}`} className="py-2 pl-3 pr-1 text-left">
              <span aria-hidden className={"inline-block w-3 text-neutral-500 transition-transform " + (open ? "rotate-90" : "")}>›</span>
            </button>
            <Link href={href} className="py-2 pr-3 hover:underline" title="Открыть ТЗ (позиции — в шапке карточки)">{label}</Link>
          </div>
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
