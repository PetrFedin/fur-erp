// Переключатель «Сезон» на Главной для блока «Производство»: ТЗ целиком или долями сезона (DrillOrder.sw, см. order-seasons.ts).
// Доля w умножает штуки, работу, расходы, шкуры подрядчика, остаток снимка и все строки списания (штуки и суммы), поэтому таблицы и
// плитки, считающие от ТЗ, работают без изменений: сумма по сезонам = «Все». Без клиентского состояния, без базы.
import type { DrillData, DrillLine, DrillOrder } from "@/lib/dashboard-drill";

const scaleLine = (l: DrillLine, w: number): DrillLine => ({ ...l, q: l.q * w, i: l.i * w, e: l.e * w, ci: l.ci * w, ce: l.ce * w });

export function scaleOrder(o: DrillOrder, w: number): DrillOrder {
  return {
    ...o, qty: o.qty * w, work: o.work * w, exp: o.exp * w, xs: o.xs?.map((x) => ({ ...x, a: x.a * w })),
    hI: o.hI * w, hE: o.hE * w, resI: o.resI * w, resE: o.resE * w, lines: o.lines.map((l) => scaleLine(l, w)),
  };
}

/** ТЗ выбранного сезона (доля ≥ 0,05 %); «all» — без изменений. ТЗ без долей считается целиком. */
export function ordersForSeason(orders: DrillOrder[], season: string): DrillOrder[] {
  if (season === "all") return orders;
  const out: DrillOrder[] = [];
  for (const o of orders) {
    const w = o.sw ? o.sw[season] ?? 0 : 1;
    if (w > 0.0005) out.push(w >= 0.9995 ? o : scaleOrder(o, w));
  }
  return out;
}

export function drillForSeason(d: DrillData | null, season: string): DrillData | null {
  return d && season !== "all" ? { ...d, orders: ordersForSeason(d.orders, season) } : d;
}
