import "server-only";
import { prisma } from "@/lib/prisma";
import type { LotOpt } from "@/app/(app)/supplier/tz/tz-form";

/** Справочники для формы ТЗ поставщика. Только названия и номера его же лотов: никаких наших цен, себестоимости и лотов других поставщиков. */
export async function loadTzFormRefs(orgId: string, supplierId: string): Promise<{ colors: string[]; models: string[]; lots: LotOpt[]; batches: { value: string; label: string }[]; nextNumber: string }> {
  const [colors, models, lots, orders, inbox, batches] = await Promise.all([
    prisma.colorRef.findMany({ where: { organizationId: orgId }, select: { name: true }, orderBy: { name: "asc" } }),
    prisma.productModel.findMany({ where: { organizationId: orgId, isActive: true }, select: { name: true, sku: true }, orderBy: { name: "asc" } }),
    prisma.rawMaterialLot.findMany({
      // только лоты из закупок самого поставщика: лоты других поставщиков (и что у нас лежит) ему не показываем
      where: { organizationId: orgId, quantityRemaining: { gt: 0 }, purchase: { supplierId } },
      select: { id: true, lotNumber: true, color: true, quantityRemaining: true, rawMaterial: { select: { name: true } } },
      orderBy: { createdAt: "desc" }, take: 400,
    }),
    prisma.productionOrder.findMany({ where: { organizationId: orgId }, select: { workOrderNumber: true } }),
    prisma.supplierInbox.findMany({ where: { organizationId: orgId, kind: "TZ" }, select: { payload: true } }),
    prisma.productionBatch.findMany({ where: { organizationId: orgId }, select: { number: true, name: true, year: true }, orderBy: { number: "desc" }, take: 60 }),
  ]);
  const nums = [
    ...orders.map((o) => (/^\d{1,5}$/.test((o.workOrderNumber ?? "").trim()) ? Number(o.workOrderNumber) : NaN)),
    ...inbox.map((i) => parseInt(String((i.payload as { number?: string })?.number ?? "").replace(/\D/g, ""), 10)),
  ].filter((n) => Number.isFinite(n) && n < 100000);
  return {
    colors: colors.map((c) => c.name),
    models: models.map((m) => m.sku || m.name),
    lots: lots.map((l) => ({ id: l.id, lot: l.lotNumber ?? "", material: l.rawMaterial.name, color: l.color ?? "", remaining: "" })),
    batches: batches.map((b) => ({ value: String(b.number), label: `Партия ${b.number}${b.year ? ` · ${b.year}` : ""}` })),
    nextNumber: String((nums.length ? Math.max(...nums) : 0) + 1),
  };
}
