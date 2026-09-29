"use client";

import { formatMoney } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";

type MoneyLike = number | string | { toString(): string };

/**
 * Renders a RUB amount that follows the site-wide "С НДС / Без НДС" toggle.
 * Server Components compute both `incl` and `excl` from real stored fields
 * and hand them both down here — this component only ever picks which
 * already-correct number to display, it never derives one itself.
 *
 * When a figure genuinely has no correct excl-VAT breakdown (see README),
 * pass only `incl` — the "Без НДС" mode then falls back to showing the
 * incl-VAT figure with a footnote marker rather than guessing.
 */
export function Money({
  incl,
  excl,
  className,
}: {
  incl: MoneyLike;
  excl?: MoneyLike | null;
  className?: string;
}) {
  const { mode } = useVatDisplay();
  const showExcl = mode === "excl" && excl != null;
  const value = showExcl ? excl : incl;
  const isFallback = mode === "excl" && excl == null;

  return (
    <span className={className} title={isFallback ? "Без НДС недоступно для этой суммы — показано с НДС" : undefined}>
      {formatMoney(value.toString())}
      {isFallback && <sup className="ml-0.5 text-neutral-400">*</sup>}
    </span>
  );
}
