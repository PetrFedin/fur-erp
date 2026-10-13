"use server";

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { PRODUCTION_EDIT_ROLES as EDIT_ROLES } from "@/lib/production-access";

/** Лот для выпадающих списков карточки ТЗ (только чтение). */
export type CatalogLot = {
  id: string;
  lotNumber: string | null;
  grade: string | null;
  color: string | null;
  rawMaterialId: string;
  rawMaterialName: string;
  unit: string;
  quantityRemaining: string;
  unitCost: string;
  /** Ставка НДС лота, %. */
  vatRate: string;
};

/**
 * Все лоты склада сырья этого ТЗ (с нулевым остатком тоже: собственный лот списания часто выбран целиком).
 * Карточка ТЗ не кладёт этот список в разметку, а запрашивает его, когда человек открывает список лотов.
 */
export async function loadLotCatalog(orderId: string): Promise<CatalogLot[]> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId },
    select: { rawWarehouseId: true },
  });
  if (!order) return [];
  const lots = await prisma.rawMaterialLot.findMany({
    where: { organizationId: session.user.organizationId, warehouseId: order.rawWarehouseId },
    include: { rawMaterial: true },
    orderBy: { receivedDate: "asc" },
  });
  return lots.map((l) => ({
    id: l.id,
    lotNumber: l.lotNumber,
    grade: l.grade,
    color: l.color,
    rawMaterialId: l.rawMaterialId,
    rawMaterialName: l.rawMaterial.name,
    unit: l.rawMaterial.unit,
    quantityRemaining: l.quantityRemaining.toString(),
    unitCost: l.unitCost.toString(),
    vatRate: l.vatRate.toString(),
  }));
}
