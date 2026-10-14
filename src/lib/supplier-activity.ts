import "server-only";
import type { PrismaClient } from "@prisma/client";

export type SupplierActivityRow = { key: string; label: string; href: string; count: number; last: Date };

/** Что Веллмех внёс сам за последние дни (по журналу изменений, актёр с ролью SUPPLIER). Расчёты, ТЗ и документы идут через «Входящие», здесь — то, что попадает к нам сразу. */
const KINDS: { model: string; action: string; key: string; label: string; href: string }[] = [
  { model: "CalendarEvent", action: "create", key: "calendar", label: "в календаре по артикулам", href: "/calendar" },
  { model: "ShipmentEvent", action: "create", key: "shipment", label: "этапов отгрузок", href: "/shipments" },
  { model: "SupplierRawStage", action: "create", key: "raw", label: "этапов сырья по аукционам", href: "/purchases" },
  { model: "ProductModel", action: "create", key: "article", label: "новых артикулов", href: "/articles?src=supplier" },
];

export async function loadSupplierActivity(db: PrismaClient, organizationId: string, days = 7): Promise<SupplierActivityRow[]> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const logs = await db.auditLog.findMany({
    where: { organizationId, actorRole: "SUPPLIER", at: { gte: since }, OR: KINDS.map((k) => ({ model: k.model, action: k.action })) },
    select: { model: true, at: true },
  });
  const out: SupplierActivityRow[] = [];
  for (const k of KINDS) {
    const mine = logs.filter((l) => l.model === k.model);
    if (mine.length) out.push({ key: k.key, label: k.label, href: k.href, count: mine.length, last: new Date(Math.max(...mine.map((l) => l.at.getTime()))) });
  }
  return out;
}
