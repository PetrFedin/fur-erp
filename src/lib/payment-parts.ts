import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Другие записи той же оплаты: мастер «Внести оплату» разносит одну оплату (один п/п) на несколько записей Payment —
 * у них та же дата, поставщик, строка основания, время создания (в пределах 10 секунд) и пометка «часть i из n».
 */
export async function siblingPayments(
  db: Db,
  orgId: string,
  cur: { id: string; supplierId: string; paidAt: Date; docRef: string | null; notes: string | null; createdAt: Date },
): Promise<{ id: string; purchaseId: string | null; auctionSession: string | null }[]> {
  if (!cur.docRef || !cur.notes?.includes("часть ")) return [];
  return db.payment.findMany({
    where: {
      organizationId: orgId, supplierId: cur.supplierId, paidAt: cur.paidAt, docRef: cur.docRef, id: { not: cur.id }, notes: { contains: "часть " },
      createdAt: { gte: new Date(cur.createdAt.getTime() - 10_000), lte: new Date(cur.createdAt.getTime() + 10_000) },
    },
    select: { id: true, purchaseId: true, auctionSession: true },
  });
}
