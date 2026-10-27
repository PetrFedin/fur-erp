import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma, PrismaClient } from "@prisma/client";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";

/**
 * Оплаты по аукционам. Аукцион = первая строка Purchase.auctionSession (партия
 * закупок, напр. «СП 09.26»). Полная стоимость аукциона — сумма итогов
 * (с НДС, в рублях) его не отменённых закупок: то, что мы должны поставщику
 * (так же считает «Остаток к оплате» закупки и «Долг поставщикам» в Сводке).
 * Оплачено = оплаты со статусом COMPLETED: оплаты самого аукциона
 * (Payment.auctionSession) + оплаты его закупок (Payment.purchaseId).
 * Запланировано = то же со статусом PENDING (в «оплачено» не входит).
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const PAY_EPS = new Decimal("0.005");

/** Заметка оплаты «закрытие остатка»: по ней в списке ставится бейдж и оплату можно откатить удалением. */
export const CLOSING_NOTE = "Оплачено до начала учёта в системе (закрытие остатка)";

export { auctionName } from "@/lib/auction-names";
import { auctionName } from "@/lib/auction-names";

export type AuctionPayStatus = "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID";

export const AUCTION_PAY_STATUS_LABELS: Record<AuctionPayStatus, string> = {
  UNPAID: "Не оплачен",
  PARTIAL: "Частично",
  PAID: "Оплачен",
  OVERPAID: "Переплата",
};

export type PurchaseForPay = {
  id: string;
  status: string;
  supplierId: string;
  auctionSession: string | null;
  exchangeRate: Prisma.Decimal;
  /** Дата закупки — для сортировки аукционов по актуальности. */
  orderDate?: Date | null;
  items: { subtotal: Prisma.Decimal; vatRate: Prisma.Decimal; quantity?: Prisma.Decimal; costPlan?: unknown }[];
  expenses: { amount: Prisma.Decimal; vatRate: Prisma.Decimal }[];
  payments: { amount: Prisma.Decimal; status: string }[];
  supplier?: { name: string } | null;
};

export type AuctionPaymentRow = { auctionSession: string | null; amount: Prisma.Decimal; status: string; supplierId?: string };

export type AuctionPay = {
  name: string;
  /** Не отменённых закупок. */
  purchases: number;
  purchasesAll: number;
  total: Decimal;
  paid: Decimal;
  paidByPurchases: Decimal;
  paidByAuction: Decimal;
  planned: Decimal;
  /** total − paid; отрицательный — переплата. */
  remaining: Decimal;
  percentPaid: number;
  /** Самая свежая дата закупки (не отменённой, иначе любой). */
  lastPurchaseAt: Date | null;
  status: AuctionPayStatus;
  suppliers: { id: string; name: string }[];
  /** По не отменённым закупкам: итог, оплачено по самой закупке, поставщик, статус (для Сводки). */
  perPurchase: { id: string; supplierId: string; status: string; total: Decimal; paid: Decimal }[];
};

/**
 * Единая формула «оплачено по закупке» (Закупки, Сводка закупок, карточка лота): собственные оплаты закупки
 * + доля оплат аукциона целиком пропорционально стоимости закупки. Сумма по партии равна её оплатам.
 * Закупка вне аукциона (a не задан) — свои оплаты (ownFallback); отменённая закупка аукциона в расчёт не входит (0).
 */
export function purchasePaidShare(a: AuctionPay | undefined, purchaseId: string, ownFallback: Decimal): Decimal {
  if (!a) return ownFallback;
  const pp = a.perPurchase.find((x) => x.id === purchaseId);
  if (!pp) return new Decimal(0);
  if (a.paidByAuction.greaterThan(0) && a.total.greaterThan(0)) return pp.paid.add(a.paidByAuction.mul(pp.total).div(a.total));
  return pp.paid;
}

/** Для подписи статуса остаток меньше рубля (копейки округления) — это «Оплачен», а не «Частично»/«Переплата». */
export const STATUS_EPS = new Decimal(1);

export function payStatus(total: Decimal, paid: Decimal): AuctionPayStatus {
  const remaining = total.sub(paid);
  if (remaining.lessThan(STATUS_EPS.neg())) return "OVERPAID";
  if (paid.lessThanOrEqualTo(PAY_EPS)) return "UNPAID";
  if (remaining.lessThan(STATUS_EPS)) return "PAID";
  return "PARTIAL";
}

export function buildAuctionSummaries(purchases: PurchaseForPay[], auctionPayments: AuctionPaymentRow[]): AuctionPay[] {
  const zero = () => new Decimal(0);
  const map = new Map<string, AuctionPay>();
  for (const p of purchases) {
    const name = auctionName(p.auctionSession);
    if (!name) continue;
    const a: AuctionPay =
      map.get(name) ??
      {
        name,
        purchases: 0,
        purchasesAll: 0,
        total: zero(),
        paid: zero(),
        paidByPurchases: zero(),
        paidByAuction: zero(),
        planned: zero(),
        remaining: zero(),
        percentPaid: 0,
        lastPurchaseAt: null,
        status: "UNPAID",
        suppliers: [],
        perPurchase: [],
      };
    a.purchasesAll++;
    if (p.orderDate && (!a.lastPurchaseAt || p.orderDate > a.lastPurchaseAt)) a.lastPurchaseAt = p.orderDate;
    // Деньги, реально ушедшие по закупке, учитываем даже если закупку потом отменили.
    const done = p.payments.filter((x) => x.status === "COMPLETED").reduce((s, x) => s.add(x.amount), zero());
    const plan = p.payments.filter((x) => x.status === "PENDING").reduce((s, x) => s.add(x.amount), zero());
    a.paidByPurchases = a.paidByPurchases.add(done);
    a.planned = a.planned.add(plan);
    if (p.status !== "CANCELLED") {
      const t = purchaseTotalInclVat(p);
      a.purchases++;
      a.total = a.total.add(t);
      a.perPurchase.push({ id: p.id, supplierId: p.supplierId, status: p.status, total: t, paid: done });
      if (!a.suppliers.some((s) => s.id === p.supplierId)) a.suppliers.push({ id: p.supplierId, name: p.supplier?.name ?? "–" });
    }
    map.set(name, a);
  }
  for (const pay of auctionPayments) {
    const normalized = auctionName(pay.auctionSession);
    const a = normalized ? map.get(normalized) : undefined;
    if (!a) continue;
    if (pay.status === "COMPLETED") a.paidByAuction = a.paidByAuction.add(pay.amount);
    else if (pay.status === "PENDING") a.planned = a.planned.add(pay.amount);
  }
  for (const a of map.values()) {
    a.paid = a.paidByPurchases.add(a.paidByAuction);
    a.remaining = a.total.sub(a.paid);
    a.percentPaid = a.total.greaterThan(0) ? Number(a.paid.div(a.total).mul(100).toFixed(3)) : 0;
    a.status = payStatus(a.total, a.paid);
  }
  return Array.from(map.values());
}

/** Загружает сводки по аукционам организации (все или только перечисленные по названию). */
export async function loadAuctionSummaries(db: Db, organizationId: string, names?: string[]): Promise<AuctionPay[]> {
  const purchases = await db.purchase.findMany({
    where: { organizationId, auctionSession: { not: null } },
    include: {
      items: true,
      expenses: true,
      supplier: { select: { name: true } },
      payments: { where: { status: { in: ["COMPLETED", "PENDING"] } }, select: { amount: true, status: true } },
    },
  });
  const wanted = names ? purchases.filter((p) => names.includes(auctionName(p.auctionSession) ?? "")) : purchases;
  const paymentsAll = await db.payment.findMany({
    where: {
      organizationId,
      purchaseId: null,
      auctionSession: { not: null },
      status: { in: ["COMPLETED", "PENDING"] },
    },
    select: { auctionSession: true, amount: true, status: true },
  });
  const payments = names ? paymentsAll.filter((p) => {
    const name = auctionName(p.auctionSession);
    return !!name && names.includes(name);
  }) : paymentsAll;
  return buildAuctionSummaries(wanted, payments);
}

/** Блокировка на время расчёта остатка аукциона (внутри транзакции): параллельные оплаты идут по очереди. */
export async function lockAuction(tx: Prisma.TransactionClient, organizationId: string, name: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${"auction-pay:" + organizationId + ":" + name}))) t`;
}
