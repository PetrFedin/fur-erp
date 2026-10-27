import type { DataAsOf } from "@/lib/data-as-of";

const ru = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "–");

/** Строка «данные на дату»: коротко — когда загружено и до какой даты есть продажи и поступления. */
export function DataAsOf({ asOf }: { asOf: DataAsOf }) {
  const { sales, receipts } = asOf;
  if (!sales && !receipts) return null;
  const loaded = sales?.loaded || receipts?.loaded || "";
  return (
    <p className="text-xs text-neutral-600 print:text-black" data-as-of>
      Данные на {ru(loaded)}{sales ? <> · продажи по {ru(sales.last)}</> : null}{receipts ? <> · поступления по {ru(receipts.last)}</> : null}
    </p>
  );
}
