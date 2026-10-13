import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Можно ли отменить ОШИБОЧНО ПРИНЯТУЮ закупку (RECEIVED → CANCELLED). Возвращает причину отказа или null.
 * Условия: по лотам закупки нет списаний (ProductionMaterialUsage) и других движений склада, кроме самой приёмки (PURCHASE_IN),
 * остаток лота равен принятому, лот не общий (подкладка в метрах копится в один пул), нет оплат этой закупки и оплат её аукциона.
 */
export async function purchaseCancelBlocker(db: Db, orgId: string, purchaseId: string): Promise<string | null> {
  const p = await db.purchase.findFirst({
    where: { id: purchaseId, organizationId: orgId },
    select: { id: true, status: true, auctionSession: true, items: { select: { id: true, lotId: true, rawMaterial: { select: { unit: true } } } } },
  });
  if (!p) return "Закупка не найдена";
  if (p.status === "CANCELLED") return "Закупка уже отменена";
  if (p.status !== "RECEIVED") return null; // черновик отменяется обычным образом
  if (p.items.some((i) => i.rawMaterial.unit === "M")) return "В закупке подкладка (метры): её ткань учтена общим пулом, отмену придётся делать вручную";
  const lotIds = [...new Set(p.items.map((i) => i.lotId).filter((x): x is string => !!x))];
  const lots = await db.rawMaterialLot.findMany({
    where: { organizationId: orgId, OR: [{ id: { in: lotIds } }, { purchaseId }] },
    select: { id: true, quantityReceived: true, quantityRemaining: true, lotNumber: true, _count: { select: { purchaseItems: true } } },
  });
  const ids = lots.map((l) => l.id);
  const [usages, otherMoves, payments, auctionPayments] = await Promise.all([
    db.productionMaterialUsage.count({ where: { lotId: { in: ids } } }),
    db.stockMovement.count({ where: { lotId: { in: ids }, NOT: { type: "PURCHASE_IN" } } }),
    db.payment.count({ where: { organizationId: orgId, purchaseId } }),
    p.auctionSession ? db.payment.count({ where: { organizationId: orgId, auctionSession: p.auctionSession, status: "COMPLETED" } }) : Promise.resolve(0),
  ]);
  if (usages > 0) return `По лотам закупки есть списания в ТЗ (${usages}) — сначала удалите списания`;
  if (otherMoves > 0) return "По лотам закупки есть движения склада (перемещение, корректировка) — отмена невозможна";
  if (lots.some((l) => !l.quantityReceived.equals(l.quantityRemaining))) return "Остаток лота отличается от принятого — отмена невозможна";
  if (lots.some((l) => l._count.purchaseItems > 1)) return "Лот общий для нескольких закупок — отмена невозможна";
  if (payments > 0) return `К закупке привязаны оплаты (${payments}) — сначала удалите оплаты`;
  if (auctionPayments > 0) return `По аукциону «${p.auctionSession}» есть оплаты — сначала удалите их`;
  return null;
}

/** Откат приёмки в открытой транзакции: движения PURCHASE_IN и лоты удаляются, позиции отвязываются, статус CANCELLED. */
export async function cancelReceivedPurchaseInTx(tx: Prisma.TransactionClient, orgId: string, purchaseId: string): Promise<{ lots: number; movements: number }> {
  const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Purchase" WHERE "id" = ${purchaseId} AND "organizationId" = ${orgId} FOR UPDATE`;
  if (!locked[0]) throw new Error("Закупка не найдена");
  if (locked[0].status !== "RECEIVED") throw new Error("Закупка не в статусе «принята»");
  const reason = await purchaseCancelBlocker(tx, orgId, purchaseId);
  if (reason) throw new Error(reason);
  const items = await tx.purchaseItem.findMany({ where: { purchaseId }, select: { lotId: true } });
  const lots = await tx.rawMaterialLot.findMany({
    where: { organizationId: orgId, OR: [{ id: { in: items.map((i) => i.lotId).filter((x): x is string => !!x) } }, { purchaseId }] },
    select: { id: true },
  });
  const ids = lots.map((l) => l.id);
  const mv = await tx.stockMovement.deleteMany({ where: { organizationId: orgId, OR: [{ lotId: { in: ids }, type: "PURCHASE_IN" }, { purchaseId, type: "PURCHASE_IN" }] } });
  await tx.purchaseItem.updateMany({ where: { purchaseId }, data: { lotId: null } });
  await tx.rawMaterialLot.deleteMany({ where: { id: { in: ids }, organizationId: orgId } });
  await tx.purchase.update({ where: { id: purchaseId }, data: { status: "CANCELLED", receivedDate: null } });
  return { lots: ids.length, movements: mv.count };
}
