import type { DrillOrder } from "@/lib/dashboard-drill";
import { isRepair, sumOrders, sumTotal, type VatSel } from "@/lib/orders-sum";

/**
 * Разбивка «Получено» на «по ТЗ» и «сверх ТЗ» (получено больше объёма ТЗ модели или у модели нет ТЗ вовсе).
 * qf — доля ТЗ в «Произведено» (получено по модели ÷ объём ТЗ модели): до 1 — часть ТЗ получена, выше 1 — получено сверх объёма.
 * Деньги: по ТЗ = Σ затрат ТЗ × min(qf, 1); сверх ТЗ = Σ затрат ТЗ × (qf − 1) по средней себестоимости модели. Штуки «без ТЗ вовсе» — без себестоимости.
 */
export type ReceivedSplit = { total: number; tzQty: number; tzCost: number; overQty: number; overCost: number; noCostQty: number; models: { label: string; qty: number }[] };

export function receivedSplit(orders: DrillOrder[], vat: VatSel, grp: "all" | "Одежда" | "Аксессуары"): ReceivedSplit {
  const r: ReceivedSplit = { total: 0, tzQty: 0, tzCost: 0, overQty: 0, overCost: 0, noCostQty: 0, models: [] };
  const over = new Map<string, number>();
  for (const o of orders) {
    if (isRepair(o) || (grp !== "all" && o.grp !== grp)) continue;
    if (o.id.startsWith("no-tz")) { { const q = o.qd ?? 0; r.noCostQty += q; r.overQty += q; r.total += q; over.set(o.ml, (over.get(o.ml) ?? 0) + q); } continue; }
    const f = o.qf ?? 0, c = sumTotal(sumOrders([o], vat));
    const got = o.qty * f, inTz = Math.min(got, o.qty), extra = Math.max(0, got - o.qty);
    r.total += got; r.tzQty += inTz; r.tzCost += c * Math.min(f, 1);
    if (extra > 0) { r.overQty += extra; r.overCost += c * (f - 1); over.set(o.ml, (over.get(o.ml) ?? 0) + extra); }
  }
  r.models = [...over].map(([label, qty]) => ({ label, qty: Math.round(qty) })).filter((m) => m.qty > 0).sort((a, b) => b.qty - a.qty);
  return r;
}
