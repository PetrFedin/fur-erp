import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FilterPanel({
  children,
  title = "Фильтры",
  applied = false,
}: {
  children: ReactNode;
  title?: string;
  applied?: boolean;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">{title}</div>
        {applied ? <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-white">применены</span> : null}
      </div>
      {children}
    </section>
  );
}


export function FilterField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-neutral-500", className)}>
      <span>{label}</span>
      <span className="normal-case font-normal tracking-normal text-neutral-900">{children}</span>
    </label>
  );
}
