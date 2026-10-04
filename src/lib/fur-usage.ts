import "server-only";
import { prisma } from "@/lib/prisma";
import { buildFurIndex, matchFurRef, type FurIndex } from "@/lib/fur-ref";

/**
 * Сколько лотов, позиций закупок и ТЗ приходится на каждый вид меха справочника и что не сопоставилось.
 *  — лоты и позиции закупок: по названию материала (кроме подкладки, ед. «м»);
 *  — ТЗ (кроме отменённых): по описанию материала в ТЗ, а если его нет — по категории/названию изделия.
 */
export type FurUsage = { lots: number; items: number; orders: number; seen: string[] };
export type FurUsageReport = {
  byRef: Map<string, FurUsage>;
  unmatchedMaterials: Array<{ name: string; lots: number; items: number }>;
  unmatchedOrders: Array<{ text: string; orders: number }>;
  ordersNoText: number;
  totals: { materials: number; materialsMatched: number; lots: number; lotsMatched: number; items: number; itemsMatched: number; orders: number; ordersMatched: number };
};

export async function loadFurUsage(orgId: string, refs: Array<{ id: string; name: string; nameEn: string | null; aliases: string[] }>, index?: FurIndex): Promise<FurUsageReport> {
  const idx = index ?? buildFurIndex(refs);
  const [materials, lotGroups, itemGroups, orders] = await Promise.all([
    prisma.rawMaterial.findMany({ where: { organizationId: orgId, unit: { not: "M" } }, select: { id: true, name: true } }),
    prisma.rawMaterialLot.groupBy({ by: ["rawMaterialId"], where: { organizationId: orgId }, _count: { _all: true } }),
    prisma.purchaseItem.groupBy({ by: ["rawMaterialId"], where: { purchase: { organizationId: orgId } }, _count: { _all: true } }),
    prisma.productionOrder.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" } },
      select: { materialDescription: true, productModel: { select: { category: true, name: true } } },
    }),
  ]);
  const lots = new Map(lotGroups.map((g) => [g.rawMaterialId, g._count._all]));
  const items = new Map(itemGroups.map((g) => [g.rawMaterialId, g._count._all]));
  const byRef = new Map<string, FurUsage>();
  const get = (id: string) => {
    let u = byRef.get(id);
    if (!u) byRef.set(id, (u = { lots: 0, items: 0, orders: 0, seen: [] }));
    return u;
  };
  for (const r of refs) get(r.id);
  const totals = { materials: 0, materialsMatched: 0, lots: 0, lotsMatched: 0, items: 0, itemsMatched: 0, orders: 0, ordersMatched: 0 };
  const unmatchedMaterials: FurUsageReport["unmatchedMaterials"] = [];
  for (const m of materials) {
    const l = lots.get(m.id) ?? 0;
    const i = items.get(m.id) ?? 0;
    totals.materials++;
    totals.lots += l;
    totals.items += i;
    const ref = matchFurRef(m.name, idx);
    if (ref?.id) {
      const u = get(ref.id);
      u.lots += l;
      u.items += i;
      if (!u.seen.includes(m.name)) u.seen.push(m.name);
      totals.materialsMatched++;
      totals.lotsMatched += l;
      totals.itemsMatched += i;
    } else unmatchedMaterials.push({ name: m.name, lots: l, items: i });
  }
  const un = new Map<string, number>();
  let noText = 0;
  for (const o of orders) {
    totals.orders++;
    const text = (o.materialDescription ?? "").trim() || (o.productModel.category ?? "").trim() || o.productModel.name;
    const hasDesc = !!((o.materialDescription ?? "").trim() || (o.productModel.category ?? "").trim());
    const ref = matchFurRef(o.materialDescription, idx) ?? matchFurRef(o.productModel.category, idx) ?? matchFurRef(o.productModel.name, idx);
    if (ref?.id) {
      get(ref.id).orders++;
      totals.ordersMatched++;
    } else if (!hasDesc) noText++;
    else un.set(text.replace(/\s+/g, " ").toLowerCase(), (un.get(text.replace(/\s+/g, " ").toLowerCase()) ?? 0) + 1);
  }
  return {
    byRef,
    unmatchedMaterials: unmatchedMaterials.sort((a, b) => b.lots + b.items - (a.lots + a.items)),
    unmatchedOrders: Array.from(un, ([text, n]) => ({ text, orders: n })).sort((a, b) => b.orders - a.orders),
    ordersNoText: noText,
    totals,
  };
}
