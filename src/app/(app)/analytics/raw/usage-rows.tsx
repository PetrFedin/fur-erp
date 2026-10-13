import Link from "next/link";
import { Decimal } from "@prisma/client/runtime/library";
import { formatQty } from "@/lib/utils";
import { usageByLot, type RawLot, type UsageRow } from "@/lib/raw-analytics";
import { CostCell } from "./cost-cell";

/** Колонки сводной таблицы «по изделию / по ТЗ». */
export const USAGE_COLS = "md:grid-cols-[2fr_0.8fr_1fr_1fr_1fr_1.4fr_1.2fr]";

/** Лоты одного изделия (или ТЗ) — раскрытие строки: какой лот, сколько ушло и во сколько обошлось. */
export function UsageGroupLots({ rows, lots, unit, c4, by }: { rows: UsageRow[]; lots: Map<string, RawLot>; unit: string; c4: "on" | "off"; by: "article" | "order" }) {
  const list = usageByLot(rows);
  const lab = "block text-xs text-neutral-500 md:hidden";
  return (
    <div className="bg-neutral-50/60 px-3 pb-3">
      <div className="hidden gap-2 border-b border-neutral-200 py-1 text-xs font-medium text-neutral-500 md:grid md:grid-cols-[2fr_2fr_1fr_1.4fr]">
        <span>Лот</span>
        <span>{by === "article" ? "ТЗ" : "Остаток лота"}</span>
        <span>Списано</span>
        <span>Стоимость списания</span>
      </div>
      {list.map((g) => {
        const l = lots.get(g.lotId);
        return (
          <div key={g.lotId} className="grid grid-cols-2 gap-2 border-t border-neutral-200 py-2 text-sm first:border-t-0 md:grid-cols-[2fr_2fr_1fr_1.4fr]">
            <div className="col-span-2 md:col-span-1">
              <div className="font-medium">
                Лот{" "}
                <Link href={`/analytics/raw/lot/${g.lotId}`} className="underline hover:text-neutral-900">{l?.lotNumber ?? "—"}</Link>
              </div>
              {l && (
                <div className="text-xs text-neutral-500">
                  {l.kind === "Подкладка" ? l.materialName : l.kind} · {l.cat}{l.size !== "Не указан" ? ` · ${l.size}` : ""} · {l.auctionLabel} · {l.year}
                </div>
              )}
            </div>
            <div className="col-span-2 text-xs text-neutral-600 md:col-span-1">
              {by === "article" ? (
                g.orders.map((o, i) => (
                  <span key={o.orderId}>
                    {i > 0 && ", "}
                    <Link href={`/production/${o.orderId}`} className="underline hover:text-neutral-900">{o.label}</Link> ({formatQty(o.qty.toString())})
                  </span>
                ))
              ) : l ? (
                <span className="tabular-nums">{formatQty(l.rem.toString())} {unit} из {formatQty(l.recv.toString())}</span>
              ) : null}
            </div>
            <span className="tabular-nums"><span className={lab}>Списано</span>{formatQty(g.qty.toString())} {unit}</span>
            <span className="tabular-nums"><span className={lab}>Стоимость</span><CostCell incl={g.incl} excl={g.excl} extraIncl={g.extraIncl} extraExcl={g.extraExcl} c4={c4} /></span>
          </div>
        );
      })}
    </div>
  );
}

export const perUnit = (qty: Decimal, produced: Decimal): Decimal | null => (produced.greaterThan(0) ? qty.div(produced) : null);
