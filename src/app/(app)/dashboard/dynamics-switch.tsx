"use client";

import { useState, type ReactNode } from "react";

/**
 * Один блок «Динамика» вместо двух: «По годам» и «По видам и аукционам» — переключатель, показан один из них.
 * Таблицы (YearsTable, RawTable) приходят готовыми; выбор не запоминается между заходами.
 */
export function DynamicsSwitch({ years, raw }: { years: ReactNode; raw: ReactNode }) {
  const [tab, setTab] = useState<"years" | "raw">("years");
  const items = [["years", "По годам"], ["raw", "По видам и аукционам"]] as const;
  return (
    <div className="space-y-2" data-testid="dynamics-switch">
      <div role="group" aria-label="Динамика сырья" className="inline-flex overflow-hidden rounded-lg border border-neutral-300 text-xs print:hidden">
        {items.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}
            className={"inline-flex min-h-11 items-center px-3 md:min-h-8 " + (tab === k ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50")}>{label}</button>
        ))}
      </div>
      <div hidden={tab !== "years"} className="print:block">{years}</div>
      <div hidden={tab !== "raw"} className="print:block">{raw}</div>
    </div>
  );
}
