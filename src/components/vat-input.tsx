"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";

const RATES = [0, 5, 7, 10, 20, 22];

/**
 * Ставка НДС: числовое поле с подсказками стандартных ставок. В отличие от
 * select, не теряет нестандартное значение (18, 10,5 …) при правке.
 * Работает и как неуправляемое (defaultValue), и как управляемое (value/onChange).
 */
export function VatInput({
  name,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type" | "list" | "step" | "min" | "max">) {
  const listId = useId();
  return (
    <>
      <Input name={name} type="number" step="any" min="0" max="100" list={listId} inputMode="decimal" className={className} {...props} />
      <datalist id={listId}>
        {RATES.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
    </>
  );
}
