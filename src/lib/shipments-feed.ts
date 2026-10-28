import "server-only";
import { prisma } from "@/lib/prisma";
import { furRu } from "@/app/(app)/dashboard/sales-block-data";
import { loadModelCosts } from "@/lib/margin-server";
import { furTypeOfFabric, normCode } from "@/lib/sales-receipts-core";
import { getCommission4Mode } from "@/lib/commission4-mode";

/** Приёмки товара (приход по файлу «поступления и продажи»): строка = артикул · цвет · дата. Для раздела «Отгрузки». */
export type FeedRow = {
  date: string; article: string; color: string; fur: string; grp: "Одежда" | "Аксессуары" | "Прочее"; cat: string;
  qty: number; costIncl: number; costExcl: number;
  model: { id: string; name: string } | null;
  orders: { id: string; number: string; wo: string | null; batch: number | null }[];
};

export async function loadShipmentsFeed(orgId: string): Promise<FeedRow[]> {
  const c4 = await getCommission4Mode();
  const [lines, models, orders, costs] = await Promise.all([
    prisma.salesReceiptLine.findMany({ where: { organizationId: orgId, kind: "RECEIPT" }, select: { date: true, article: true, colorId: true, fabric: true, level2: true, level3: true, level4: true, modelCode: true, pcs: true }, orderBy: { date: "asc" } }),
    prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, sku: true, salesCode: true, aliases: true } }),
    prisma.productionOrder.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" } }, select: { id: true, number: true, workOrderNumber: true, productModelId: true, batch: { select: { number: true } } }, orderBy: { number: "asc" } }),
    loadModelCosts(orgId, c4),
  ]);
  const keyOf = new Map<string, { id: string; name: string }>();
  for (const m of models) for (const k of [m.name, m.sku, m.salesCode, ...(m.aliases ?? [])]) if (k) { keyOf.set(normCode(k), { id: m.id, name: m.name }); const b = normCode(k.split(/[ /+]/)[0]); if (!keyOf.has(b)) keyOf.set(b, { id: m.id, name: m.name }); }
  const byModel = new Map<string, FeedRow["orders"]>();
  for (const o of orders) (byModel.get(o.productModelId) ?? byModel.set(o.productModelId, []).get(o.productModelId)!).push({ id: o.id, number: o.number, wo: o.workOrderNumber, batch: o.batch?.number ?? null });
  const rows = lines.filter((l) => (l.pcs ?? 0) !== 0).map((l) => {
    const model = keyOf.get(normCode(l.modelCode ?? "")) ?? keyOf.get(normCode(l.article.split(/[ /+]/)[0])) ?? null;
    const cost = model ? costs.get(normCode(model.name)) : undefined;
    const g = (l.level2 ?? "").trim().toLowerCase();
    return {
      date: l.date.toISOString().slice(0, 10), article: l.article, color: l.colorId ?? "", fur: furRu(furTypeOfFabric(l.fabric)),
      grp: g === "одежда" ? "Одежда" : g === "аксессуары" ? "Аксессуары" : "Прочее", cat: l.level4 ?? l.level3 ?? "—",
      qty: l.pcs ?? 0, costIncl: cost ? cost.unitIncl * (l.pcs ?? 0) : 0, costExcl: cost ? cost.unitExcl * (l.pcs ?? 0) : 0,
      model, orders: model ? byModel.get(model.id) ?? [] : [],
    } satisfies FeedRow;
  });
  // Только приход: возврат (минус) гасит самую раннюю приёмку того же артикула и цвета, так что сумма за период равна «Получено» (639).
  const byKey = new Map<string, FeedRow[]>();
  for (const r of rows) { const k = r.article + "|" + r.color; (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r); }
  const out: FeedRow[] = [];
  for (const list of byKey.values()) {
    const pos: FeedRow[] = [];
    for (const r of list) {
      if (r.qty > 0) { pos.push({ ...r }); continue; }
      let need = -r.qty;
      for (const p of pos) { if (need <= 0) break; if (p.qty <= 0) continue; const t = Math.min(p.qty, need), k = (p.qty - t) / p.qty; p.costIncl *= k; p.costExcl *= k; p.qty -= t; need -= t; }
    }
    out.push(...pos.filter((p) => p.qty > 0));
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
