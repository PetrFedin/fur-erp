"use client";

import { cn } from "@/lib/utils";
import { useCommission4Display } from "@/lib/commission4-display";

const HINT =
  "4% — доп. комиссия посредника к сырью и подкладке (договор, расчёты «+4%»); работа не облагается. Закупки, оплаты и долги не меняются.";

/** Переключатель «Без 4% | С 4%» в шапке, рядом с «С НДС / Без НДС». */
export function Commission4Toggle() {
  const { mode, setMode, pending } = useCommission4Display();
  const btn = (m: "off" | "on", text: string) => (
    <button
      type="button"
      onClick={() => mode !== m && setMode(m)}
      aria-pressed={mode === m}
      className={cn(
        "rounded-sm px-2 py-1 font-medium transition-colors",
        mode === m ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-900",
      )}
    >
      {text}
    </button>
  );
  return (
    <div
      title={HINT}
      className={cn("flex items-center rounded-md border border-neutral-300 bg-white p-0.5 text-xs", pending && "opacity-70")}
    >
      {btn("off", "Без 4%")}
      {btn("on", "С 4%")}
    </div>
  );
}
