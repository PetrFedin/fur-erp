import "server-only";
import { prisma } from "@/lib/prisma";
import type { LotOpt } from "@/app/(app)/supplier/tz/tz-form";

/** Справочники для формы ТЗ поставщика. Только названия, номера и остатки: никаких наших цен и себестоимости. */
export async function loadTzFormRefs(orgId: string): Promise<{ colors: string[]; models: string[]; lots: LotOpt[]; nextNumber: string }> {
  const [colors, models, lots, orders, inbox] = await Promise.all([
    prisma.colorRef.findMany({ where: { organizationId: orgId }, select: { name: true }, orderBy: { name: "asc" } }),
    prisma.productModel.findMany({ where: { organizationId: orgId, isActive: true }, select: { name: true, sku: true }, orderBy: { name: "asc" } }),
    prisma.rawMaterialLot.findMany({
      where: { organizationId: orgId, quantityRemaining: { gt: 0 } },
      select: { id: true, lotNumber: true, color: true, quantityRemaining: true, rawMaterial: { select: { name: true } } },
      orderBy: { createdAt: "desc" }, take: 400,
    }),
    prisma.productionOrder.findMany({ where: { organizationId: orgId }, select: { workOrderNumber: true } }),
    prisma.supplierInbox.findMany({ where: { organizationId: orgId, kind: "TZ" }, select: { payload: true } }),
  ]);
  const nums = [
    ...orders.map((o) => (/^\d{1,5}$/.test((o.workOrderNumber ?? "").trim()) ? Number(o.workOrderNumber) : NaN)),
    ...inbox.map((i) => parseInt(String((i.payload as { number?: string })?.number ?? "").replace(/\D/g, ""), 10)),
  ].filter((n) => Number.isFinite(n) && n < 100000);
  return {
    colors: colors.map((c) => c.name),
    models: models.map((m) => m.sku || m.name),
    lots: lots.map((l) => ({ id: l.id, lot: l.lotNumber ?? "", material: l.rawMaterial.name, color: l.color ?? "", remaining: String(Number(l.quantityRemaining)) })),
    nextNumber: String((nums.length ? Math.max(...nums) : 0) + 1),
  };
}
