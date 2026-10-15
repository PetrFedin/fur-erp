import "server-only";
import { prisma } from "@/lib/prisma";
import { isRepairOrder } from "@/lib/batch-stats";
import { payloadFromOrders, type OrderForTz, type TzFromOrders } from "@/lib/tz-from-orders";

/** Все позиции ТЗ (записи с тем же номером ТЗ из документа) → данные для Word Веллмеха. Только чтение. */
export async function loadTzFromOrders(orgId: string, orderId: string): Promise<TzFromOrders | null> {
  const one = await prisma.productionOrder.findFirst({ where: { id: orderId, organizationId: orgId }, select: { id: true, workOrderNumber: true } });
  if (!one) return null;
  const wo = one.workOrderNumber?.trim();
  const rows = await prisma.productionOrder.findMany({
    where: wo ? { organizationId: orgId, workOrderNumber: wo } : { id: orderId, organizationId: orgId },
    orderBy: { number: "asc" },
    select: {
      id: true, number: true, status: true, plannedQuantity: true, producedQuantity: true, color: true, size: true, materialDescription: true, lining: true,
      contractNumber: true, workOrderNumber: true, workOrderDate: true, clientWorkPricePerUnit: true,
      client: { select: { name: true } },
      colorRef: { select: { name: true } },
      colors: { select: { quantity: true, sizes: true, colorRef: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      productModel: { select: { name: true, category: true, salesName: true, categoryRef: { select: { name: true } } } },
      materialUsages: {
        orderBy: { date: "asc" },
        select: {
          quantity: true, totalCost: true, commission4: true, vatRate: true,
          rawMaterial: { select: { name: true, unit: true } },
          lot: { select: { id: true, lotNumber: true, color: true, vatRate: true, unitCost: true, materialCostExclVat: true, expenseCostExclVat: true } },
        },
      },
    },
  });
  if (!rows.length) return null;
  const list: OrderForTz[] = rows.map((o) => ({
    ...o,
    isRepair: isRepairOrder({ materialDescription: o.materialDescription, productModel: o.productModel }),
  }));
  return payloadFromOrders(list);
}
