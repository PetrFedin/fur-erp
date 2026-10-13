import "server-only";
import { prisma } from "@/lib/prisma";
import { tzCountText, uniqueOrderCount } from "@/lib/tz-key";

/** Почему партию нельзя удалить (null — можно): в ней нет ни ТЗ (даже отменённых), ни привязанных документов. */
export async function batchDeleteBlocker(orgId: string, batchId: string): Promise<string | null> {
  const [orderRows, docs] = await Promise.all([
    prisma.productionOrder.findMany({ where: { organizationId: orgId, batchId }, select: { number: true, workOrderNumber: true } }),
    prisma.driveDocument.count({ where: { organizationId: orgId, productionBatchId: batchId } }),
  ]);
  const orders = orderRows.length;
  if (orders > 0) return `В партии есть ТЗ (${tzCountText(uniqueOrderCount(orderRows), orders)}, включая отменённые) — сначала переведите их в другую партию (ТЗ → «Изменить» → «Партия»)`;
  if (docs > 0) return `К партии привязаны документы (${docs}) — сначала отвяжите их`;
  return null;
}

