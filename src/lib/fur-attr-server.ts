import "server-only";
// Признаки меха: загрузка справочника со счётчиками (страница /settings/fur-attrs).
import { prisma } from "@/lib/prisma";
import { ATTR_GROUP_ORDER } from "@/lib/fur-attr";

export type FurAttrRow = {
  id: string;
  name: string;
  group: string | null;
  furKind: string | null;
  aliases: string[];
  description: string | null;
  confirmed: boolean;
  autoDetect: boolean;
  /** Лотов с признаком и сколько шт. в них закуплено. */
  lots: number;
  qty: number;
  /** ТЗ: назван в самом ТЗ / списан лот с признаком (ТЗ без отменённых). */
  ordersOwn: number;
  ordersViaLots: number;
};

const groupRank = (g: string | null) => {
  const i = g ? ATTR_GROUP_ORDER.indexOf(g) : -1;
  return i < 0 ? ATTR_GROUP_ORDER.length : i;
};

export async function loadFurAttrRows(orgId: string): Promise<FurAttrRow[]> {
  const [refs, lotLinks, ownLinks, usageLinks] = await Promise.all([
    prisma.furAttrRef.findMany({ where: { organizationId: orgId } }),
    prisma.rawMaterialLotAttr.findMany({ where: { attr: { organizationId: orgId } }, select: { attrId: true, lot: { select: { quantityReceived: true } } } }),
    prisma.productionOrderAttr.findMany({ where: { attr: { organizationId: orgId }, order: { status: { not: "CANCELLED" } } }, select: { attrId: true } }),
    prisma.productionMaterialUsage.findMany({
      where: { productionOrder: { organizationId: orgId, status: { not: "CANCELLED" } }, lot: { attrs: { some: {} } } },
      select: { productionOrderId: true, lot: { select: { attrs: { select: { attrId: true } } } } },
    }),
  ]);
  const lots = new Map<string, { n: number; qty: number }>();
  for (const l of lotLinks) {
    const c = lots.get(l.attrId) ?? { n: 0, qty: 0 };
    c.n++;
    c.qty += Number(l.lot.quantityReceived);
    lots.set(l.attrId, c);
  }
  const own = new Map<string, number>();
  for (const o of ownLinks) own.set(o.attrId, (own.get(o.attrId) ?? 0) + 1);
  const via = new Map<string, Set<string>>();
  for (const u of usageLinks) for (const a of u.lot.attrs) (via.get(a.attrId) ?? via.set(a.attrId, new Set()).get(a.attrId)!).add(u.productionOrderId);
  return refs
    .map((r) => ({
      id: r.id, name: r.name, group: r.group, furKind: r.furKind, aliases: r.aliases, description: r.description, confirmed: r.confirmed, autoDetect: r.autoDetect,
      lots: lots.get(r.id)?.n ?? 0, qty: lots.get(r.id)?.qty ?? 0, ordersOwn: own.get(r.id) ?? 0, ordersViaLots: via.get(r.id)?.size ?? 0,
    }))
    .sort((a, b) => groupRank(a.group) - groupRank(b.group) || (a.group ?? "").localeCompare(b.group ?? "", "ru") || a.name.localeCompare(b.name, "ru", { numeric: true }));
}
