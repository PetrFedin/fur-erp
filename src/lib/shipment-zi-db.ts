import "server-only";
import { prisma } from "@/lib/prisma";
import { parseZi, ziKey, type ZiData } from "@/lib/shipment-zi";

/** Накладные ЗИ отгрузки (или null, если не внесены). */
export async function loadZi(organizationId: string, shipmentId: string): Promise<ZiData | null> {
  const row = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId, key: ziKey(shipmentId) } }, select: { value: true } });
  return row ? parseZi(row.value) : null;
}
