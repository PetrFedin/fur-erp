"use client";

import { useVatDisplay } from "@/lib/vat-display";

/** Label that follows the site-wide "С НДС / Без НДС" toggle: "Маржа (без НДС)". */
export function VatLabel({ base }: { base: string }) {
  const { mode } = useVatDisplay();
  // Подпись режима 4% (« (с 4%)») сливаем в одни скобки: «Маржа (с НДС, с 4%)», без двойных скобок.
  const c4 = base.endsWith(" (с 4 %)");
  const name = c4 ? base.slice(0, -" (с 4 %)".length) : base;
  return (
    <>
      {name} ({mode === "excl" ? "без НДС" : "с НДС"}
      {c4 ? ", с 4 %" : ""})
    </>
  );
}

/** Подпись для сумм, которые всегда с НДС: в режиме «Без НДС» уточняет это. */
export function InclVatOnlyLabel({ base }: { base: string }) {
  const { mode } = useVatDisplay();
  return <>{mode === "excl" ? `${base} (всегда с НДС)` : base}</>;
}
