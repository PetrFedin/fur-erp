"use server";

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";

/** Сколько ТЗ (позиций) в плане и в работе получат новую цену артикула — только чтение, для окна подтверждения. */
export async function countOpenOrdersForModel(modelId: string): Promise<number> {
  const session = await requireRole(...ACCESS.models);
  return prisma.productionOrder.count({
    where: { productModelId: modelId, organizationId: session.user.organizationId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
  });
}
