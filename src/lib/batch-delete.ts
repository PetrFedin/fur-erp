import "server-only";
import { prisma } from "@/lib/prisma";

/** Почему партию нельзя удалить (null — можно): в ней нет ни ТЗ (даже отменённых), ни привязанных документов. */
export async function batchDeleteBlocker(orgId: string, batchId: string): Promise<string | null> {
  const [orders, docs] = await Promise.all([
    prisma.productionOrder.count({ where: { organizationId: orgId, batchId } }),
    prisma.driveDocument.count({ where: { organizationId: orgId, productionBatchId: batchId } }),
  ]);
  if (orders > 0) return `В партии есть ТЗ (${orders}) — сначала переведите их в другую партию (ТЗ → «Изменить» → «Партия»)`;
  if (docs > 0) return `К партии привязаны документы (${docs}) — сначала отвяжите их`;
  return null;
}

