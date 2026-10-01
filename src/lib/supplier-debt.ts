import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma, PrismaClient } from "@prisma/client";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { auctionName, buildAuctionSummaries, type PurchaseForPay } from "@/lib/auction-payments";

/**
 * ЕДИНЫЙ расчёт «Долга поставщику» (с НДС, в рублях) — одно число для Сводки, Оплат и Сводки по годам.
 *
 *   долг = стоимость закупок (без отменённых)
 *        − оплачено (COMPLETED: оплаты закупок и аукционов целиком; переплата одного аукциона/закупки
 *          не гасит другой — остаток каждого не ниже нуля)
 *        − авансы без привязки (COMPLETED, нет ни закупки, ни аукциона), итог не ниже нуля.
 *
 * Строка-расшифровка в интерфейсе: «стоимость закупок {total} − оплачено {paid} − авансы без привязки {unlinkedAdvances}»,
 * и total − paid − unlinkedAdvances = debt (кроме редкого случая, когда авансы больше всего долга: тогда debt = 0).
 * `paid` — оплаты, засчитанные в долг (переплата сверх стоимости аукциона/закупки в него не входит).
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type SupplierDebtAuction = {
  name: string;
  purchases: number;
  total: Decimal;
  paid: Decimal;
  /** Остаток по аукциону, не ниже нуля. */
  due: Decimal;
};

export type SupplierDebt = {
  /** Стоимость закупок без отменённых, с НДС. */
  total: Decimal;
  /** Оплаты, засчитанные в долг по закупкам и аукционам (без переплат). */
  paid: Decimal;
  /** Авансы поставщикам без привязки к закупке и аукциону (фактическая сумма). */
  unlinkedAdvances: Decimal;
  /** Итоговый долг поставщику. */
  debt: Decimal;
  /** Долг по аукционам с остатком, по убыванию. */
  byAuction: SupplierDebtAuction[];
  /** Долг по закупкам вне аукционов (до вычета авансов). */
  nonAuctionDebt: Decimal;
  /** Часть долга до вычета авансов, приходящаяся на черновики (мех не принят). */
  draftDebt: Decimal;
};

const EPS = new Decimal("0.005");
const zero = () => new Decimal(0);

export type SupplierDebtPurchase = PurchaseForPay;
export type SupplierDebtAuctionPayment = { auctionSession: string | null; amount: Prisma.Decimal; status: string };
export type SupplierDebtAdvance = { amount: Prisma.Decimal };

/** Чистая функция расчёта — на вход уже загруженные данные (закупки со статусами оплат, оплаты аукционов, авансы). */
export function computeSupplierDebt(
  purchases: SupplierDebtPurchase[],
  auctionPayments: SupplierDebtAuctionPayment[],
  unlinkedAdvances: SupplierDebtAdvance[],
): SupplierDebt {
  let total = zero();
  let dueSum = zero();
  let draftDebt = zero();
  let nonAuctionDebt = zero();

  for (const p of purchases) {
    if (p.status === "CANCELLED" || auctionName(p.auctionSession)) continue;
    const t = purchaseTotalInclVat(p);
    total = total.add(t);
    const paid = p.payments.filter((x) => x.status === "COMPLETED").reduce((s, x) => s.add(x.amount), zero());
    const due = t.sub(paid);
    if (!due.greaterThan(0)) continue;
    dueSum = dueSum.add(due);
    nonAuctionDebt = nonAuctionDebt.add(due);
    if (p.status !== "RECEIVED") draftDebt = draftDebt.add(due);
  }

  const byAuction: SupplierDebtAuction[] = [];
  for (const a of buildAuctionSummaries(purchases, auctionPayments)) {
    total = total.add(a.total);
    const due = Decimal.max(a.remaining, zero());
    if (!due.greaterThan(EPS)) continue;
    dueSum = dueSum.add(due);
    byAuction.push({ name: a.name, purchases: a.purchases, total: a.total, paid: a.paid, due });
    // Доля черновиков в долге аукциона — пропорционально остаткам закупок.
    const weights = a.perPurchase.map((pp) => ({ pp, w: Decimal.max(pp.total.sub(pp.paid), zero()) }));
    const wSum = weights.reduce((s, x) => s.add(x.w), zero());
    if (!wSum.greaterThan(0)) continue;
    for (const { pp, w } of weights) {
      if (pp.status !== "RECEIVED" && w.greaterThan(0)) draftDebt = draftDebt.add(due.mul(w).div(wSum));
    }
  }
  byAuction.sort((x, y) => y.due.comparedTo(x.due));

  const advances = unlinkedAdvances.reduce((s, x) => s.add(x.amount), zero());
  const debt = Decimal.max(dueSum.sub(advances), zero());
  return {
    total,
    paid: total.sub(dueSum),
    unlinkedAdvances: advances,
    debt,
    byAuction,
    nonAuctionDebt,
    draftDebt,
  };
}

/** Загружает данные организации и считает долг поставщику. */
export async function loadSupplierDebt(db: Db, organizationId: string): Promise<SupplierDebt> {
  const [purchases, auctionPayments, advances] = await Promise.all([
    // Отменённые тоже: деньги, ушедшие по ним в рамках аукциона, входят в оплаченное по аукциону.
    db.purchase.findMany({
      where: { organizationId },
      include: {
        items: true,
        expenses: true,
        supplier: { select: { name: true } },
        payments: { where: { status: { in: ["COMPLETED", "PENDING"] } }, select: { amount: true, status: true } },
      },
    }),
    db.payment.findMany({
      where: { organizationId, purchaseId: null, auctionSession: { not: null }, status: { in: ["COMPLETED", "PENDING"] } },
      select: { auctionSession: true, amount: true, status: true },
    }),
    db.payment.findMany({
      where: { organizationId, purchaseId: null, auctionSession: null, status: "COMPLETED" },
      select: { amount: true },
    }),
  ]);
  return computeSupplierDebt(purchases, auctionPayments, advances);
}
