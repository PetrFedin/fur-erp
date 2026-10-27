import type { ReactNode } from "react";
import { Money } from "@/components/money";

/**
 * Стоимость двумя цифрами: «с 4%» крупно и под ней мелко «без 4%». «С НДС / Без НДС» — по общему переключателю шапки (Money).
 * Если 4% не добавляют (суммы совпадают) — вторая строка не показывается.
 */
export function CostTwo({
  on, off, suffix, empty = "–", className,
}: {
  on: { incl: number; excl: number } | null;
  off: { incl: number; excl: number } | null;
  /** Подпись после суммы: «/шкуру», «/м». */
  suffix?: ReactNode;
  empty?: ReactNode;
  className?: string;
}) {
  if (!on || Math.abs(on.incl) < 0.005) return <span className="text-neutral-600">{empty}</span>;
  const same = !off || (Math.abs(off.incl - on.incl) < 0.005 && Math.abs(off.excl - on.excl) < 0.005);
  return (
    <span className={`inline-flex flex-col leading-tight ${className ?? ""}`} title={!same && off ? `Без 4 %: ${Math.round(off.incl).toLocaleString("ru-RU")} ₽ с НДС` : undefined}>
      <span className="tabular-nums"><Money incl={on.incl.toFixed(2)} excl={on.excl.toFixed(2)} />{suffix}</span>
    </span>
  );
}
