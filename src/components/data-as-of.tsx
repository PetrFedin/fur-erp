import type { DataAsOf } from "@/lib/data-as-of";

const ru = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "—");

/** Строка «данные на дату»: откуда продажи и поступления, когда загружены и до какой даты в них есть строки. */
export function DataAsOf({ asOf }: { asOf: DataAsOf }) {
  const { sales, receipts } = asOf;
  if (!sales && !receipts) return null;
  return (
    <p className="text-xs text-neutral-600 print:text-black" data-as-of>
      {sales ? <>Продажи: {sales.source}, загружено {ru(sales.loaded)}, последняя продажа {ru(sales.last)}. </> : null}
      {receipts ? <>Поступления: {receipts.source}, загружено {ru(receipts.loaded)}, последнее поступление {ru(receipts.last)}. </> : null}
      Остатки считаются как поступления минус продажи по этим данным.
    </p>
  );
}
