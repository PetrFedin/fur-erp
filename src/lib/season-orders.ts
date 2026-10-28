// Переключатель «Сезон» на Главной для блока «Производство»: ТЗ целиком или долями сезона (DrillOrder.sw, см. order-seasons.ts).
// Доля w умножает штуки, работу, расходы, шкуры подрядчика, остаток снимка и все строки списания (штуки и суммы), поэтому таблицы и
// плитки, считающие от ТЗ, работают без изменений: сумма по сезонам = «Все». Без клиентского состояния, без базы.
import type { DrillData, DrillLine, DrillOrder } from "@/lib/dashboard-drill";
import { seasonStartYear } from "@/lib/order-seasons";

const scaleLine = (l: DrillLine, w: number): DrillLine => ({ ...l, q: l.q * w, i: l.i * w, e: l.e * w, ci: l.ci * w, ce: l.ce * w });

export function scaleOrder(o: DrillOrder, w: number): DrillOrder {
  return {
    ...o, qty: o.qty * w, qo: o.qo === undefined ? undefined : o.qo * w, qd: o.qd === undefined ? undefined : o.qd * w, work: o.work * w, exp: o.exp * w, xs: o.xs?.map((x) => ({ ...x, a: x.a * w })),
    hI: o.hI * w, hE: o.hE * w, resI: o.resI * w, resE: o.resE * w, lines: o.lines.map((l) => scaleLine(l, w)),
  };
}

/** ТЗ выбранного сезона (доля ≥ 0,05 %); «all» — без изменений. ТЗ без долей считается целиком. */
const OPEN_SEASON = "FW 26/27";
export function ordersForSeason(orders: DrillOrder[], season: string): DrillOrder[] {
  if (season === "all") return orders;
  const out: DrillOrder[] = [];
  for (const o of orders) {
    if (o.id.startsWith("no-tz")) continue; // получено без ТЗ — только в «Все сезоны» и в открытом сезоне ниже
    // Закрытые сезоны (FW 25/26, SS 2026): всё получено, заказ = приход — ТЗ берётся долей полученного (qd × доля сезона), «ждём» и «сверх ТЗ» нет.
    if (season !== OPEN_SEASON && o.qf !== undefined) {
      const w = o.swd?.[season] ?? 0;
      if (w > 0.0005 && o.qf > 0) {
        const b = scaleOrder(o, w * o.qf);
        out.push({ ...b, qo: b.qty, qd: b.qty, qf: 1, y: Math.max(o.y ?? 0, seasonStartYear(season)) || o.y, orig: o, sn: season });
      }
      continue;
    }
    const w = o.sw ? o.sw[season] ?? 0 : 1;
    if (w > 0.0005) out.push({ ...(w >= 0.9995 ? o : scaleOrder(o, w)), y: Math.max(o.y ?? 0, seasonStartYear(season)) || o.y, orig: o, sn: season });
  }
  return out;
}

export function drillForSeason(d: DrillData | null, season: string): DrillData | null {
  return d && season !== "all" ? { ...d, orders: ordersForSeason(d.orders, season) } : d;
}
