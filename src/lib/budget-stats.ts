import { orderKey } from "@/lib/tz-key";
import "server-only";
import { loadOrderRows } from "@/lib/analytics-orders";
import { prisma } from "@/lib/prisma";
import { LENGTHS, type BudgetStat } from "@/lib/budget-calc";

/**
 * Статистика системы для бюджета: средневзвешенно (сумма ÷ сумма) по ТЗ со списанием шкур, без ремонта; цены с НДС, без 4%.
 * Три вида записей: пара «мех × категория» (key "мех|категория"), та же пара по длине (key "мех|категория|len:Short", len; длина — ProductModel.lengthClass
 * артикула, артикулы без длины в эту запись не попадают) и артикул в меху (key "m:<id>|мех", modelId).
 */
export async function loadBudgetStats(orgId: string): Promise<BudgetStat[]> {
  const rows = await loadOrderRows(orgId, "all", "off");
  const lenRows = await prisma.productModel.findMany({ where: { organizationId: orgId, lengthClass: { not: null } }, select: { id: true, lengthClass: true } });
  const lenOf = new Map<string, string>();
  for (const m of lenRows) { const l = LENGTHS.find((x) => x.toLowerCase() === (m.lengthClass ?? "").trim().toLowerCase()); if (l) lenOf.set(m.id, l); }
  type S = { fur: string; cat: string; modelId?: string; len?: string; qty: number; orders: number; hides: number; furSum: number; meters: number; linSum: number; work: number };
  const m = new Map<string, S>();
  const tz = new Map<string, Set<string>>(); // ключ группы → уникальные ТЗ (по номеру из документа)
  for (const o of rows) {
    if (o.category === "Ремонт") continue;
    if (!o.lines.some((l) => !l.isLining)) continue;
    const len = lenOf.get(o.modelId);
    for (const key of [`${o.fur}|${o.category}`, `m:${o.modelId}|${o.fur}`, ...(len ? [`${o.fur}|${o.category}|len:${len}`] : [])]) {
      const isArt = key.startsWith("m:");
      const isLen = !isArt && key.includes("|len:");
      const s = m.get(key) ?? { fur: o.fur, cat: isArt ? o.modelLabel : o.category, modelId: isArt ? o.modelId : undefined, len: isLen ? len : undefined, qty: 0, orders: 0, hides: 0, furSum: 0, meters: 0, linSum: 0, work: 0 };
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
      key, fur: s.fur, cat: s.cat, modelId: s.modelId, len: s.len, qty: s.qty, orders: s.orders,
      hidesPer: s.hides / s.qty, hidePrice: s.hides > 0 ? s.furSum / s.hides : 0,
      metersPer: s.meters / s.qty, meterPrice: s.meters > 0 ? s.linSum / s.meters : 0, workPer: s.work / s.qty,
    }))
    .sort((a, b) => a.key.localeCompare(b.key, "ru"));
}
