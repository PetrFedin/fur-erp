import "server-only";
// Загрузка данных для раздела «Отгрузки» (сервер): позиции загруженных ТЗ как кандидаты в состав отгрузки.
import { prisma } from "@/lib/prisma";
import { loadOrderRows } from "@/lib/analytics-orders";
import { loadTzPositions } from "@/lib/order-label-db";
import { orderLabel } from "@/lib/order-label";
import { ORDER_COLORS_INCLUDE } from "@/lib/order-colors";
import { furKindsOfOrder } from "@/lib/order-fur";
import { buildPeopleBySide, candidateRows, defaultShipmentName, lineKey, MONTHS_NOM } from "@/lib/shipment-calc";
import { orderSortKey } from "@/lib/shipments";

export type ShipmentCandidate = {
  key: string;
  orderId: string;
  /** «ТЗ 182 · поз. 1/3». */
  label: string;
  workOrder: string;
  article: string;
  color: string | null;
  size: string | null;
  furKind: string;
  batchNumber: number | null;
  /** Сколько штук по этой строке в ТЗ. */
  qtyTz: number;
  /** Уже в других отгрузках. */
  inOthers: number;
  /** Уже в этой отгрузке (добавление суммируется со строкой). */
  inHere: number;
};

/**
 * Строки-кандидаты из всех неотменённых ТЗ организации: цвет, размер и вид меха берутся из ТЗ (вид меха — как в списке ТЗ, loadOrderRows).
 * `shipmentId` — отгрузка, в которую добавляем: её строки считаются отдельно («уже в этой»), остальные — «в других отгрузках».
 * `onlyBatchNumber` — только ТЗ этой партии (для примера данных).
 */
export async function loadShipmentCandidates(orgId: string, shipmentId: string | null, opts?: { onlyBatchNumber?: number }): Promise<ShipmentCandidate[]> {
  const [orders, rows, lines] = await Promise.all([
    prisma.productionOrder.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" }, ...(opts?.onlyBatchNumber != null ? { batch: { number: opts.onlyBatchNumber } } : {}) },
      select: {
        id: true, number: true, workOrderNumber: true, plannedQuantity: true, size: true, color: true,
        productModel: { select: { name: true } },
        batch: { select: { number: true } },
        ...ORDER_COLORS_INCLUDE,
      },
    }),
    loadOrderRows(orgId, "all", "on"),
    prisma.shipmentLine.findMany({
      where: { shipment: { organizationId: orgId } },
      select: { shipmentId: true, productionOrderId: true, color: true, size: true, quantity: true },
    }),
  ]);
  const furById = new Map(rows.map((r) => [r.id, furKindsOfOrder(r.fur).join(" + ")]));
  const pos = await loadTzPositions(orgId, orders);
  const others = new Map<string, number>();
  const here = new Map<string, number>();
  for (const l of lines) {
    if (!l.productionOrderId) continue; // «свой» артикул без ТЗ в остатках по ТЗ не участвует
    const k = lineKey(l.productionOrderId, l.color, l.size);
    const m = l.shipmentId === shipmentId ? here : others;
    m.set(k, (m.get(k) ?? 0) + l.quantity);
  }
  const out: ShipmentCandidate[] = [];
  const sorted = [...orders].sort((a, b) => orderSortKey(a) - orderSortKey(b) || a.number.localeCompare(b.number, "ru", { numeric: true }));
  for (const o of sorted) {
    const label = orderLabel({ workOrderNumber: o.workOrderNumber, number: o.number, ...pos.get(o.id) });
    for (const r of candidateRows({ ...o, plannedQuantity: Number(o.plannedQuantity) })) {
      const key = lineKey(o.id, r.color, r.size);
      out.push({
        key,
        orderId: o.id,
        label,
        workOrder: o.workOrderNumber ?? o.number,
        article: o.productModel.name,
        color: r.color,
        size: r.size,
        furKind: furById.get(o.id) ?? "",
        batchNumber: o.batch?.number ?? null,
        qtyTz: r.qty,
        inOthers: others.get(key) ?? 0,
        inHere: here.get(key) ?? 0,
      });
    }
  }
  return out;
}

/** Название по умолчанию: «Отгрузка октябрь 2026 · N», N — следующий номер в месяце плановой даты (или текущем). */
export async function nextShipmentName(orgId: string, plannedDate?: string): Promise<string> {
  const ok = plannedDate && /^\d{4}-\d{2}-\d{2}$/.test(plannedDate) && !Number.isNaN(new Date(plannedDate).getTime());
  const d = ok ? new Date(plannedDate) : new Date();
  const names = await prisma.shipment.findMany({
    where: { organizationId: orgId, name: { startsWith: `Отгрузка ${MONTHS_NOM[d.getUTCMonth()]} ${d.getUTCFullYear()} · ` } },
    select: { name: true },
  });
  return defaultShipmentName(d.getUTCMonth(), d.getUTCFullYear(), names.map((n) => n.name));
}

/** Действующие лица по компаниям: имена из этапов всех отгрузок организации; для ЦУМ ещё активные пользователи приложения. Отдельной таблицы нет. */
export async function loadShipmentPeople(orgId: string): Promise<Record<string, string[]>> {
  const [groups, users] = await Promise.all([
    prisma.shipmentEvent.groupBy({ by: ["side", "responsibleName"], where: { shipment: { organizationId: orgId }, responsibleName: { not: null } }, _count: { _all: true } }),
    prisma.user.findMany({ where: { organizationId: orgId, isActive: true }, select: { name: true } }),
  ]);
  // groupBy даёт строку на пару (side, имя) со счётчиком: разворачиваем в события для общей чистой функции.
  const events = groups.flatMap((g) => Array.from({ length: g._count._all }, () => ({ side: g.side, responsibleName: g.responsibleName })));
  return buildPeopleBySide(events, { CUM: users.map((u) => u.name) });
}
