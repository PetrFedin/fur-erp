import "server-only";
import { prisma } from "@/lib/prisma";
import { orderLabel, orderSortKey } from "@/lib/shipments";
import type { FormOrder } from "./shipment-form";

/** Данные для формы отгрузки: заказчики и ТЗ (по № ТЗ) с уже отгруженным количеством. */
export async function loadShipmentFormData(organizationId: string, excludeShipmentId?: string, keepOrderIds: string[] = []) {
  const [clients, orders, grouped] = await Promise.all([
    prisma.client.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.productionOrder.findMany({
      where: { organizationId, OR: [{ status: { not: "CANCELLED" } }, { id: { in: keepOrderIds } }] },
      select: {
        id: true,
        number: true,
        workOrderNumber: true,
        size: true,
        plannedQuantity: true,
        clientId: true,
        productModel: { select: { name: true } },
      },
    }),
    prisma.shipmentLine.groupBy({
      by: ["productionOrderId"],
      where: {
        shipment: {
          organizationId,
          status: { not: "CANCELLED" },
          ...(excludeShipmentId ? { id: { not: excludeShipmentId } } : {}),
        },
      },
      _sum: { quantity: true },
    }),
  ]);
  const shipped = new Map(grouped.map((g) => [g.productionOrderId, g._sum.quantity ?? 0]));
  const formOrders: FormOrder[] = [...orders]
    .sort((a, b) => orderSortKey(a) - orderSortKey(b) || a.number.localeCompare(b.number))
    .map((o) => ({
      id: o.id,
      label: orderLabel(o),
      modelName: o.productModel.name,
      clientKey: o.clientId ?? "none",
      sizeText: (o.size ?? "").trim(),
      plannedQty: Number(o.plannedQuantity),
      shippedElsewhere: shipped.get(o.id) ?? 0,
    }));
  return { clients, orders: formOrders };
}
