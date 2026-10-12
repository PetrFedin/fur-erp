import { prisma } from "./prisma";
import { summarizeMaterialVat, type MaterialVatSummary } from "./material-vat";

/** Сводка «НДС в ТЗ» по материалам организации: ставка по умолчанию + ставки лотов по дате закупки. */
export async function loadMaterialVat(orgId: string, unit?: "M" | "notM"): Promise<Map<string, MaterialVatSummary>> {
  const unitWhere = unit === "M" ? { unit: "M" as const } : unit === "notM" ? { unit: { not: "M" as const } } : {};
  const mats = await prisma.rawMaterial.findMany({
    where: { organizationId: orgId, ...unitWhere },
    select: {
      id: true,
      defaultVatRate: true,
      lots: { select: { vatRate: true, receivedDate: true, purchase: { select: { orderDate: true } } } },
    },
  });
  const out = new Map<string, MaterialVatSummary>();
  for (const m of mats) {
    out.set(
      m.id,
      summarizeMaterialVat(
        m.defaultVatRate != null ? Number(m.defaultVatRate) : null,
        m.lots.map((l) => ({ vatRate: Number(l.vatRate), date: l.purchase?.orderDate ?? l.receivedDate })),
      ),
    );
  }
  return out;
}
