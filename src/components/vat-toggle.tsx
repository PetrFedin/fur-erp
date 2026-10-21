"use client";

import { cn } from "@/lib/utils";
import { SEG_GROUP, segCls } from "@/components/segmented";
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
      className={segCls(mode === m, "sm")}
    >
      {text}
    </button>
  );
  return (
    <div title="Переключает показ цен и себестоимости: с НДС (по умолчанию) или без НДС. Долги и оплаты не меняются." className={SEG_GROUP}>
      {btn("excl", "Без НДС")}
      {btn("incl", "С НДС")}
    </div>
  );
}
