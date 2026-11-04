import type { DataAsOf } from "@/lib/data-as-of";

const ru = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "–");

/** Строка «данные на дату»: ведущая дата — отчёт «заказ и продажи» (он задаёт заказ/размеры/прайс), дальше — до какой даты есть продажи и поступления. */
export function DataAsOf({ asOf }: { asOf: DataAsOf }) {
  const { sales, receipts, report } = asOf;
  if (!sales && !receipts && !report) return null;
  return (
    <p className="text-xs text-neutral-600 print:text-black" data-as-of>
      Данные на {ru(report ?? sales?.loaded ?? receipts?.loaded ?? "")}{sales ? <> · продажи по {ru(sales.last)}</> : null}{receipts ? <> · поступления по {ru(receipts.last)}</> : null}
    </p>
  );
}
