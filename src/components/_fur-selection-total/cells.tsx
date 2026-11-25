"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Th({ children, first }: { children: ReactNode; first?: boolean }) {
  return <th className={cn("px-2 py-1.5 text-right align-middle font-medium leading-tight", first && "border-l border-neutral-200")}>{children}</th>;
}

export function Num({ children, strong, small, muted, title, first }: { children: ReactNode; strong?: boolean; small?: boolean; muted?: boolean; title?: string; first?: boolean }) {
  return (
    <td title={title} className={cn("whitespace-nowrap px-2 py-2 text-right tabular-nums", first && "border-l border-neutral-100", small && "py-1.5 text-[13px]", strong && "font-semibold", muted && !strong && "text-neutral-500")}>
      {children}
    </td>
  );
}
