"use client";

import { formatMoney } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";
import { formatCompactMoney } from "./compact";

/** Сумма для плитки Сводки: компактно («587,9 млн ₽»), полное число — во всплывающей подсказке. Следует за «С НДС / Без НДС». */
export function CompactMoney({ incl, excl }: { incl: string; excl?: string | null }) {
  const { mode } = useVatDisplay();
  const v = mode === "excl" && excl != null ? excl : incl;
  return (
    <span className="whitespace-nowrap" title={formatMoney(v)}>
      {formatCompactMoney(v)}
    </span>
  );
}
