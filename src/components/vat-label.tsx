"use client";

import { useVatDisplay } from "@/lib/vat-display";

/** Label that follows the site-wide "С НДС / Без НДС" toggle: "Маржа (без НДС)". */
export function VatLabel({ base }: { base: string }) {
  const { mode } = useVatDisplay();
  return (
    <>
      {base} ({mode === "excl" ? "без НДС" : "с НДС"})
    </>
  );
}

/** Подпись для сумм, которые всегда с НДС: в режиме «Без НДС» уточняет это. */
export function InclVatOnlyLabel({ base }: { base: string }) {
  const { mode } = useVatDisplay();
  return <>{mode === "excl" ? `${base} (всегда с НДС)` : base}</>;
}
