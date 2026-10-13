import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { orderLabel, positionsOf, type TzPos } from "@/lib/order-label";

/**
 * Позиции ТЗ с учётом ВСЕХ записей организации с тем же рабочим номером (а не только загруженных строк):
 * «поз. 2/3» верно и в отфильтрованном списке. Записи без рабочего номера в результат не попадают.
 */
export async function loadTzPositions(
  organizationId: string,
  rows: readonly { id: string; number: string; workOrderNumber?: string | null }[],
  db: Pick<PrismaClient, "productionOrder"> = prisma,
): Promise<Map<string, TzPos>> {
  const wos = Array.from(new Set(rows.map((r) => (r.workOrderNumber ?? "").trim()).filter(Boolean)));
  if (!wos.length) return new Map();
  const all = await db.productionOrder.findMany({
    where: { organizationId, workOrderNumber: { in: wos } },
    select: { id: true, number: true, workOrderNumber: true },
  });
  return positionsOf(all);
}

/**
 * Проставляет единую подпись ТЗ (label) списку строк, у которых уже есть orderId, внутренний номер и рабочий № ТЗ:
 * «ТЗ 182 · поз. 1/3» с учётом всех записей организации с тем же рабочим номером.
 */
export async function relabelOrders<T extends { label: string }>(
  organizationId: string,
  items: T[],
  pick: (i: T) => { orderId: string; number: string; wo: string | null },
  db: Pick<PrismaClient, "productionOrder"> = prisma,
): Promise<void> {
  if (!items.length) return;
  const pos = await loadTzPositions(organizationId, items.map((i) => { const p = pick(i); return { id: p.orderId, number: p.number, workOrderNumber: p.wo }; }), db);
  for (const i of items) { const p = pick(i); i.label = orderLabel({ workOrderNumber: p.wo, number: p.number, ...pos.get(p.orderId) }); }
}
