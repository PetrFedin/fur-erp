import "server-only";
import { loadOrderRows } from "@/lib/analytics-orders";
import type { BudgetStat } from "@/lib/budget-calc";

/** Статистика системы для бюджета: средневзвешенно (сумма ÷ сумма) по ТЗ с списанием шкур, без ремонта; цены с НДС, без 4%. */
export async function loadBudgetStats(orgId: string): Promise<BudgetStat[]> {
  const rows = await loadOrderRows(orgId, "all", "off");
  type S = { fur: string; cat: string; qty: number; orders: number; hides: number; furSum: number; meters: number; linSum: number; work: number };
  const m = new Map<string, S>();
  for (const o of rows) {
    if (o.category === "Ремонт") continue;
    if (!o.lines.some((l) => !l.isLining)) continue;
    const key = `${o.fur}|${o.category}`;
    const s = m.get(key) ?? { fur: o.fur, cat: o.category, qty: 0, orders: 0, hides: 0, furSum: 0, meters: 0, linSum: 0, work: 0 };
    m.set(key, s);
    s.orders++; s.qty += o.qty; s.work += o.work;
    for (const l of o.lines) {
      if (l.isLining) { s.meters += l.qty; s.linSum += l.incl; } else { s.hides += l.qty; s.furSum += l.incl; }
    }
  }
  return Array.from(m.entries())
    .filter(([, s]) => s.qty > 0)
    .map(([key, s]) => ({
      key, fur: s.fur, cat: s.cat, qty: s.qty, orders: s.orders,
      hidesPer: s.hides / s.qty, hidePrice: s.hides > 0 ? s.furSum / s.hides : 0,
      metersPer: s.meters / s.qty, meterPrice: s.meters > 0 ? s.linSum / s.meters : 0, workPer: s.work / s.qty,
    }))
    .sort((a, b) => a.key.localeCompare(b.key, "ru"));
}
