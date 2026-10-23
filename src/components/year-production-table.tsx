import { Fragment } from "react";
import { isRepair, sumOrders, sumTotal, type Sum } from "@/lib/orders-sum";
import type { DrillOrder } from "@/lib/dashboard-drill";
import { formatMoney, formatQty } from "@/lib/utils";

// Очень простая таблица: сколько изделий получено за год и во что обошлось производство.
// Строки — мех → категория 1 → категория 2, столбцы — статьи расходов; расходы ТЗ входят в мех. Числа те же, что в «Произведено» на Главной (с НДС, до тысяч).

const K = (v: number) => (Math.abs(v) < 500 ? "—" : formatMoney(Math.round(v / 1000) * 1000));
const td = "whitespace-nowrap px-2 py-1.5 text-right tabular-nums";

type Node = { key: string; label: string; orders: DrillOrder[]; kids: Node[] };

function group(os: DrillOrder[], by: (o: DrillOrder) => string): Node[] {
  const m = new Map<string, DrillOrder[]>();
  for (const o of os) { const k = by(o) || "Без категории"; const l = m.get(k) ?? []; l.push(o); m.set(k, l); }
  return [...m].map(([label, orders]) => ({ key: label, label, orders, kids: [] })).sort((a, b) => sumTotal(sumOrders(b.orders, "incl")) - sumTotal(sumOrders(a.orders, "incl")));
}

export function YearProductionTable({ orders, year }: { orders: DrillOrder[]; year: number }) {
  const own = orders.filter((o) => o.y === year && !isRepair(o));
  if (own.length === 0) return null;
  const furs = group(own, (o) => o.fur);
  for (const f of furs) {
    f.kids = group(f.orders, (o) => o.grp);
    for (const g of f.kids) g.kids = group(g.orders, (o) => o.cat);
  }
  const row = (n: Node, depth: number): React.ReactNode => {
    const s: Sum = sumOrders(n.orders, "incl");
    return (
      <Fragment key={depth + n.key + n.label}>
        <tr className={"border-b border-neutral-100 " + (depth === 0 ? "bg-neutral-50 font-medium" : depth === 1 ? "text-[13px]" : "text-[13px] text-neutral-600")}>
          <td className="px-2 py-1.5 text-left" style={{ paddingLeft: 8 + depth * 18 }}>{n.label}</td>
          <td className={td}>{formatQty(s.qty)}</td>
          <td className={td}>{K(s.fur + s.other)}</td>
          <td className={td}>{K(s.lining)}</td>
          <td className={td}>{K(s.c4)}</td>
          <td className={td}>{K(s.work)}</td>
          <td className={td + " font-medium"}>{K(sumTotal(s))}</td>
        </tr>
        {n.kids.map((k) => row(k, depth + 1))}
      </Fragment>
    );
  };
  const tot = sumOrders(own, "incl");
  return (
    <section aria-label={`Изделия ${year}: расходы на производство`} className="rounded-lg border border-neutral-300 bg-white p-3" data-testid="year-production">
      <h2 className="mb-2 text-sm font-semibold">Получено в {year} и расходы на производство, ₽ с НДС</h2>
      <div className="overflow-x-auto rounded-lg border border-neutral-200" data-keep-scroll tabIndex={0}>
        <table className="table-keep w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-600">
              <th scope="col" className="px-2 py-2 text-left font-semibold">Мех / категория</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Изделий, шт.</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Мех (с расходами ТЗ)</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Подкладка</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Надбавка 4 %</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Работа</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Всего</th>
            </tr>
          </thead>
          <tbody>
            {furs.map((f) => row(f, 0))}
            <tr className="row-total border-t-2 border-neutral-400 font-semibold">
              <td className="px-2 py-1.5 text-left">Всего</td>
              <td className={td}>{formatQty(tot.qty)}</td>
              <td className={td}>{K(tot.fur + tot.other)}</td>
              <td className={td}>{K(tot.lining)}</td>
              <td className={td}>{K(tot.c4)}</td>
              <td className={td}>{K(tot.work)}</td>
              <td className={td}>{K(sumTotal(tot))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
