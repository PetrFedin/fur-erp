"use client";

import { cn } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";

/**
 * Переключатель по всему сайту: суммы «С НДС» (по умолчанию) или «Без НДС». Стоит в шапке, доступен с любой страницы.
 */
export function VatToggle() {
  const { mode, setMode } = useVatDisplay();
  const btn = (m: "excl" | "incl", text: string) => (
    <button
      type="button"
      onClick={() => mode !== m && setMode(m)}
      aria-pressed={mode === m}
      className={cn(
        "rounded-sm px-2 py-1 font-medium transition-colors max-md:min-h-8",
        mode === m ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-900",
      )}
    >
      {text}
    </button>
  );
  return (
    <div title="Переключает показ цен и себестоимости: с НДС (по умолчанию) или без НДС. Долги и оплаты не меняются." className="flex items-center rounded-md border border-neutral-300 bg-white p-0.5 text-xs">
      {btn("excl", "Без НДС")}
      {btn("incl", "С НДС")}
    </div>
  );
}
