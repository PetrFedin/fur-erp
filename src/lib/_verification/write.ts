// Запись «Подтверждено»: подтвердить, снять, сбросить по цепочке после правки (вынесено из verification.ts без изменений).
import "server-only";
import { prisma as appPrisma } from "@/lib/prisma";
import { auctionName } from "@/lib/auction-payments";
import { formatDate } from "@/lib/utils";
import type { VerifyKind } from "@/lib/verification-kinds";
import type { Db, Readiness } from "./types";

// ====================================================================================================== ЗАПИСЬ

/** Подтвердить строку. Вопреки замечаниям — только с примечанием. Возвращает ошибку или null. */
export async function applyVerify(
  db: Db,
  orgId: string,
  kind: VerifyKind,
  id: string,
  userId: string,
  readiness: Readiness,
  note: string | null,
  by: string = userId,
): Promise<string | null> {
  const n = note?.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 500) || null;
  if (!readiness.ready && !n) return `Есть замечания (${readiness.blockers.length}): подтвердить можно только с примечанием — напишите, почему подтверждаете вопреки им.`;
  const override = !readiness.ready;
  const stamp = { verifiedAt: new Date(), verifiedBy: by, verifyNote: override ? `Вопреки замечаниям: ${n}` : n };
  if (kind === "purchase") {
    const r = await db.purchase.updateMany({ where: { id, organizationId: orgId }, data: stamp });
    return r.count ? null : "Закупка не найдена";
  }
  if (kind === "order") {
    const r = await db.productionOrder.updateMany({ where: { id, organizationId: orgId }, data: stamp });
    return r.count ? null : "ТЗ не найдено";
  }
  if (kind === "batch") {
    const r = await db.productionBatch.updateMany({ where: { id, organizationId: orgId }, data: stamp });
    return r.count ? null : "Партия не найдена";
  }
  // оплаты: confirmed = true (владелец подтвердил), confirmedAt/By; примечание — в заметку оплаты.
  const tail = override ? `\n[${formatDate(new Date())}] Подтверждено вручную вопреки замечаниям: ${n}` : "";
  if (kind === "payment") {
    const p = await db.payment.findFirst({ where: { id, organizationId: orgId }, select: { notes: true } });
    if (!p) return "Оплата не найдена";
    await db.payment.update({ where: { id }, data: { confirmed: true, confirmedAt: stamp.verifiedAt, confirmedBy: by, ...(tail ? { notes: `${p.notes ?? ""}${tail}`.slice(0, 2000) } : {}) } });
    return null;
  }
  const p = await db.productionPayment.findFirst({ where: { id, organizationId: orgId }, select: { notes: true } });
  if (!p) return "Оплата не найдена";
  await db.productionPayment.update({ where: { id }, data: { confirmed: true, confirmedAt: stamp.verifiedAt, confirmedBy: by, ...(tail ? { notes: `${p.notes ?? ""}${tail}`.slice(0, 2000) } : {}) } });
  return null;
}

/** Снять подтверждение (флаг «оплата подтверждена» у платежей не трогаем — снимается только отметка человека). */
export async function applyUnverify(db: Db, orgId: string, kind: VerifyKind, id: string): Promise<string | null> {
  const clear = { verifiedAt: null, verifiedBy: null, verifyNote: null };
  if (kind === "purchase") return (await db.purchase.updateMany({ where: { id, organizationId: orgId }, data: clear })).count ? null : "Закупка не найдена";
  if (kind === "order") return (await db.productionOrder.updateMany({ where: { id, organizationId: orgId }, data: clear })).count ? null : "ТЗ не найдено";
  if (kind === "batch") return (await db.productionBatch.updateMany({ where: { id, organizationId: orgId }, data: clear })).count ? null : "Партия не найдена";
  if (kind === "payment") return (await db.payment.updateMany({ where: { id, organizationId: orgId }, data: { confirmedAt: null, confirmedBy: null } })).count ? null : "Оплата не найдена";
  return (await db.productionPayment.updateMany({ where: { id, organizationId: orgId }, data: { confirmedAt: null, confirmedBy: null } })).count ? null : "Оплата не найдена";
}

export type ResetScope = {
  purchaseIds?: (string | null | undefined)[];
  /** Название аукциона (Purchase.auctionSession, первая строка): сбрасываются все закупки аукциона. */
  auctions?: (string | null | undefined)[];
  orderIds?: (string | null | undefined)[];
  batchIds?: (string | null | undefined)[];
  paymentIds?: (string | null | undefined)[];
  prodPaymentIds?: (string | null | undefined)[];
};
const ids = (a?: (string | null | undefined)[]) => [...new Set((a ?? []).filter((x): x is string => !!x))];

/**
 * Любая правка суммы, документа, даты или лотов сбрасывает подтверждение связанных строк (вызывается из server actions ПОСЛЕ правки).
 * Сброс цепочкой: платёж → его закупка и все закупки аукциона → ; ТЗ → его партия; оплата партии → её ТЗ и партия.
 * Меняет только уже подтверждённые строки; возвращает, сколько строк сброшено. Ошибки не пробрасываются — правка важнее отметки.
 */
export async function resetVerification(db: Db, orgId: string, s: ResetScope): Promise<number> {
  try {
    let n = 0;
    const clear = { verifiedAt: null, verifiedBy: null, verifyNote: null };
    const purchaseIds = new Set(ids(s.purchaseIds));
    const auctions = new Set(ids(s.auctions).map((a) => auctionName(a)).filter((x): x is string => !!x));
    const orderIds = new Set(ids(s.orderIds));
    const batchIds = new Set(ids(s.batchIds));

    const payIds = ids(s.paymentIds);
    if (payIds.length) {
      const pays = await db.payment.findMany({ where: { organizationId: orgId, id: { in: payIds } }, select: { id: true, purchaseId: true, auctionSession: true, confirmedAt: true } });
      for (const p of pays) {
        if (p.purchaseId) purchaseIds.add(p.purchaseId);
        const a = auctionName(p.auctionSession);
        if (a) auctions.add(a);
        if (p.confirmedAt) {
          n += (await db.payment.updateMany({ where: { id: p.id, confirmedAt: { not: null } }, data: { confirmedAt: null, confirmedBy: null } })).count;
        }
      }
    }
    const ppIds = ids(s.prodPaymentIds);
    if (ppIds.length) {
      const pays = await db.productionPayment.findMany({ where: { organizationId: orgId, id: { in: ppIds } }, select: { id: true, orders: { select: { productionOrderId: true, productionOrder: { select: { batchId: true } } } } } });
      for (const p of pays) {
        for (const l of p.orders) {
          orderIds.add(l.productionOrderId);
          if (l.productionOrder.batchId) batchIds.add(l.productionOrder.batchId);
        }
        n += (await db.productionPayment.updateMany({ where: { id: p.id, confirmedAt: { not: null } }, data: { confirmedAt: null, confirmedBy: null } })).count;
      }
    }
    // закупка → аукцион → все закупки аукциона
    if (purchaseIds.size) {
      const ps = await db.purchase.findMany({ where: { organizationId: orgId, id: { in: [...purchaseIds] } }, select: { auctionSession: true } });
      for (const p of ps) {
        const a = auctionName(p.auctionSession);
        if (a) auctions.add(a);
      }
    }
    if (auctions.size) {
      const all = await db.purchase.findMany({ where: { organizationId: orgId, auctionSession: { not: null } }, select: { id: true, auctionSession: true } });
      for (const p of all) if (auctions.has(auctionName(p.auctionSession) ?? "")) purchaseIds.add(p.id);
    }
    if (purchaseIds.size) n += (await db.purchase.updateMany({ where: { organizationId: orgId, id: { in: [...purchaseIds] }, verifiedAt: { not: null } }, data: clear })).count;
    // ТЗ → партия
    if (orderIds.size) {
      const os = await db.productionOrder.findMany({ where: { organizationId: orgId, id: { in: [...orderIds] } }, select: { batchId: true } });
      for (const o of os) if (o.batchId) batchIds.add(o.batchId);
      n += (await db.productionOrder.updateMany({ where: { organizationId: orgId, id: { in: [...orderIds] }, verifiedAt: { not: null } }, data: clear })).count;
    }
    if (batchIds.size) n += (await db.productionBatch.updateMany({ where: { organizationId: orgId, id: { in: [...batchIds] }, verifiedAt: { not: null } }, data: clear })).count;
    return n;
  } catch (e) {
    console.error("resetVerification:", e);
    return 0;
  }
}

// ---- короткие вызовы из server actions: организация определяется по самой строке (ID уникальны), сброс — по цепочке -----

/** Закупка изменена (сумма, лоты, расходы, оплата, документ, дата): сбросить её и все закупки её аукциона. */
export async function resetByPurchase(purchaseId: string | null | undefined): Promise<void> {
  if (!purchaseId) return;
  const p = await appPrisma.purchase.findUnique({ where: { id: purchaseId }, select: { organizationId: true } });
  if (p) await resetVerification(appPrisma, p.organizationId, { purchaseIds: [purchaseId] });
}
/** Оплата поставщику изменена/удалена/добавлена (по аукциону или закупке). */
export async function resetByAuction(orgId: string, auction: string | null | undefined, purchaseId?: string | null, paymentId?: string | null): Promise<void> {
  await resetVerification(appPrisma, orgId, { auctions: [auction], purchaseIds: [purchaseId], paymentIds: [paymentId] });
}
/** ТЗ изменено (количество, цена, материалы, дата, документ): сбросить его и его партию. */
export async function resetByOrder(orderId: string | null | undefined): Promise<void> {
  if (!orderId) return;
  const o = await appPrisma.productionOrder.findUnique({ where: { id: orderId }, select: { organizationId: true } });
  if (o) await resetVerification(appPrisma, o.organizationId, { orderIds: [orderId] });
}
/** Оплата производства изменена: сбросить её, связанные ТЗ и партии. */
export async function resetByProdPayment(orgId: string, paymentId: string | null | undefined, orderIds?: (string | null | undefined)[]): Promise<void> {
  await resetVerification(appPrisma, orgId, { prodPaymentIds: [paymentId], orderIds });
}
/** Партия изменена (расчёт, счёт): сбросить партию. */
export async function resetByBatch(orgId: string, batchId: string | null | undefined): Promise<void> {
  await resetVerification(appPrisma, orgId, { batchIds: [batchId] });
}
/** Документ (DriveDocument / PurchaseDocument) приложен, заменён или удалён: сбросить то, к чему он привязан. */
export async function resetByDriveDoc(doc: { purchaseId?: string | null; lotId?: string | null; productionOrderId?: string | null; productionBatchId?: string | null; paymentId?: string | null; productionPaymentId?: string | null }): Promise<void> {
  if (doc.purchaseId) await resetByPurchase(doc.purchaseId);
  if (doc.lotId) {
    const l = await appPrisma.rawMaterialLot.findUnique({ where: { id: doc.lotId }, select: { purchaseId: true } });
    if (l?.purchaseId) await resetByPurchase(l.purchaseId);
  }
  if (doc.productionOrderId) await resetByOrder(doc.productionOrderId);
  if (doc.productionBatchId) {
    const b = await appPrisma.productionBatch.findUnique({ where: { id: doc.productionBatchId }, select: { organizationId: true } });
    if (b) await resetVerification(appPrisma, b.organizationId, { batchIds: [doc.productionBatchId] });
  }
  if (doc.paymentId) {
    const p = await appPrisma.payment.findUnique({ where: { id: doc.paymentId }, select: { organizationId: true } });
    if (p) await resetVerification(appPrisma, p.organizationId, { paymentIds: [doc.paymentId] });
  }
  if (doc.productionPaymentId) {
    const p = await appPrisma.productionPayment.findUnique({ where: { id: doc.productionPaymentId }, select: { organizationId: true } });
    if (p) await resetVerification(appPrisma, p.organizationId, { prodPaymentIds: [doc.productionPaymentId] });
  }
}
/** Документ закупки (PurchaseDocument): к закупке или ко всему аукциону (batch). */
export async function resetByPurchaseDoc(orgId: string, doc: { purchaseId?: string | null; batch?: string | null }): Promise<void> {
  await resetVerification(appPrisma, orgId, { purchaseIds: [doc.purchaseId], auctions: [doc.batch] });
}
