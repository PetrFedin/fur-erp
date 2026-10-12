import { orderKey } from "@/lib/tz-key";
import "server-only";
import { loadOrderRows } from "@/lib/analytics-orders";
import type { BudgetStat } from "@/lib/budget-calc";

/**
 * Статистика системы для бюджета: средневзвешенно (сумма ÷ сумма) по ТЗ со списанием шкур, без ремонта; цены с НДС, без 4%.
 * Два вида записей: пара «мех × категория» (key "мех|категория") и артикул в меху (key "m:<id>|мех", modelId).
 */
export async function loadBudgetStats(orgId: string): Promise<BudgetStat[]> {
  const rows = await loadOrderRows(orgId, "all", "off");
  type S = { fur: string; cat: string; modelId?: string; qty: number; orders: number; hides: number; furSum: number; meters: number; linSum: number; work: number };
  const m = new Map<string, S>();
  const tz = new Map<string, Set<string>>(); // ключ группы → уникальные ТЗ (по номеру из документа)
  for (const o of rows) {
    if (o.category === "Ремонт") continue;
    if (!o.lines.some((l) => !l.isLining)) continue;
    for (const key of [`${o.fur}|${o.category}`, `m:${o.modelId}|${o.fur}`]) {
      const isArt = key.startsWith("m:");
      const s = m.get(key) ?? { fur: o.fur, cat: isArt ? o.modelLabel : o.category, modelId: isArt ? o.modelId : undefined, qty: 0, orders: 0, hides: 0, furSum: 0, meters: 0, linSum: 0, work: 0 };
      m.set(key, s);
      const set = tz.get(key) ?? new Set<string>();
      set.add(orderKey(o));
      tz.set(key, set);
      s.orders = set.size; s.qty += o.qty; s.work += o.work;
      for (const l of o.lines) {
        if (l.isLining) { s.meters += l.qty; s.linSum += l.incl; } else { s.hides += l.qty; s.furSum += l.incl; }
      }
    }
  }
  return Array.from(m.entries())
    .filter(([, s]) => s.qty > 0)
    .map(([key, s]): BudgetStat => ({
      key, fur: s.fur, cat: s.cat, modelId: s.modelId, qty: s.qty, orders: s.orders,
      hidesPer: s.hides / s.qty, hidePrice: s.hides > 0 ? s.furSum / s.hides : 0,
      metersPer: s.meters / s.qty, meterPrice: s.meters > 0 ? s.linSum / s.meters : 0, workPer: s.work / s.qty,
    }))
    .sort((a, b) => a.key.localeCompare(b.key, "ru"));
}
