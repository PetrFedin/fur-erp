"use client";

import { cn } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";

/**
 * Site-wide switch for whether <Money> shows VAT-inclusive or VAT-exclusive
 * figures. Lives in the Topbar so it's reachable from every page.
 */
export function VatToggle() {
  const { mode, setMode } = useVatDisplay();

  return (
    <div
      title="Переключает цены и себестоимость. Долги и оплаты не меняются."
      className="flex items-center rounded-md border border-neutral-300 bg-white p-0.5 text-xs">
      <button
        type="button"
        onClick={() => setMode("incl")}
        className={cn(
          "rounded-sm px-2 py-1 font-medium transition-colors",
          mode === "incl" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-900"
        )}
      >
        С НДС
      </button>
      <button
        type="button"
        onClick={() => setMode("excl")}
        className={cn(
          "rounded-sm px-2 py-1 font-medium transition-colors",
          mode === "excl" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-900"
        )}
      >
        Без НДС
      </button>
    </div>
  );
}
