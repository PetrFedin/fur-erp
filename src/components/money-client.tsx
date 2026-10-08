"use client";

import { formatMoney } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";

/**
 * Client half of <Money>: only ever receives plain strings (see money.tsx —
 * Prisma Decimal instances can't cross the Server -> Client boundary).
 */
export function MoneyClient({
  incl,
  excl,
  className,
}: {
  incl: string;
  excl: string | null;
  className?: string;
}) {
  const { mode } = useVatDisplay();
  const showExcl = mode === "excl" && excl != null;
  const isFallback = mode === "excl" && excl == null;

  return (
    <span className={className} title={isFallback ? "Без НДС недоступно для этой суммы — показано с НДС" : undefined}>
      {formatMoney(showExcl ? excl : incl)}
      {isFallback && <sup className="ml-0.5 text-neutral-500">*</sup>}
    </span>
  );
}
