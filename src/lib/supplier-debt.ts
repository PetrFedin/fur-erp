import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma, PrismaClient } from "@prisma/client";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { auctionName, buildAuctionSummaries, type PurchaseForPay } from "@/lib/auction-payments";
import { inYear, type YearFilter } from "@/lib/year-filter";

/**
 * ЕДИНЫЙ расчёт «Долга поставщику» (с НДС, в рублях) — одно число для Сводки, Оплат и закупок.
 *
 *   долг = стоимость закупок (без отменённых)
 *        − оплачено (COMPLETED: оплаты закупок и аукционов целиком; переплата одного аукциона/закупки
 *          не гасит другой — остаток каждого не ниже нуля)
 *        − авансы без привязки (COMPLETED, нет ни закупки, ни аукциона), итог не ниже нуля.
 *
 * Долг делится на ТРИ понятные части (в сумме — тот же долг):
 *   1. «К оплате по УПД и счетам» — мех получен (закупка «Принята»), УПД/счёт есть, а оплаты не хватает.
 *      Из этой части вычитаются авансы без привязки.
 *   2. «Счёт выставлен, не оплачен» — закупка ещё не получена (черновик), но Веллмех уже выставил на неё счёт
 *      (см. INVOICES_FOR_DRAFTS: суммы счетов взяты из документов Drive).
 *   3. «Ожидаемое» — закупка не получена и счёта на эту часть ещё нет.
 *
 * Фильтр года: берутся закупки года (по дате заказа); оплаты — те, что привязаны к этим закупкам и их аукционам;
 * авансы без привязки — по дате оплаты в году.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Счета Веллмех на закупки, по которым мех ещё не получен (черновики). Только то, что назвали документы Drive «мех»:
 * `total` — сумма выставленных счетов по аукциону (с НДС). Остаток «счёта выставлен» = счета − уже оплачено.
 * Нет записи — счёт не выставлен, вся неоплаченная часть идёт в «Ожидаемое».
 */
export const INVOICES_FOR_DRAFTS: Record<string, { total: number; docs: string }> = {
  "FH 06-26": { total: 115_723_078, docs: "счета Веллмех №155 от 22.05.2026 (30 660 000) и №173 от 05.06.2026 (85 063 078)" },
  "СП 09-26": { total: 60_831_100, docs: "счёт Веллмех №271 от 30.09.2026 (срок 05.10.2026)" },
  "Подкладка Спец. 13": { total: 5_400_000, docs: "счёт Веллмех №157 от 26.05.2026" },
  "Доп. материалы Спец. 16": { total: 19_870, docs: "счёт Веллмех №181 от 16.06.2026" },
};

export type SupplierDebtAuction = {
  name: string;
  purchases: number;
  total: Decimal;
  paid: Decimal;
  /** Остаток по аукциону, не ниже нуля. */
  due: Decimal;
  /** Из остатка: мех получен (к оплате по УПД и счетам). */
  dueReceived: Decimal;
  /** Из остатка: мех не получен, счёт выставлен. */
  dueInvoiced: Decimal;
  /** Из остатка: мех не получен, счёта нет. */
  dueExpected: Decimal;
  /** Документы, по которым выставлен счёт на неполученную часть. */
  invoiceDocs: string | null;
};

export type SupplierDebt = {
  /** Стоимость закупок без отменённых, с НДС. */
  total: Decimal;
  /** Оплаты, засчитанные в долг по закупкам и аукционам (без переплат). */
  paid: Decimal;
  /** Авансы поставщикам без привязки к закупке и аукциону (фактическая сумма). */
  unlinkedAdvances: Decimal;
  /** Итоговый долг поставщику = receivedNet + invoiced + expected. */
  debt: Decimal;
  /** Часть 1: мех получен, к оплате по УПД и счетам — после вычета авансов без привязки. */
  receivedNet: Decimal;
  /** Часть 1 до вычета авансов. */
  receivedGross: Decimal;
  /** Часть 2: счёт выставлен, мех не получен, не оплачен. */
  invoiced: Decimal;
  /** Часть 3: ожидаемые закупки — не получены, счёта нет. */
  expected: Decimal;
  /** Аукционы с остатком, по убыванию. */
  byAuction: SupplierDebtAuction[];
  /** Долг по закупкам вне аукционов (до вычета авансов). */
  nonAuctionDebt: Decimal;
  /** Сколько закупок (без отменённых) вне аукционов. */
  nonAuctionPurchases: number;
  /** Не получено: «счёт выставлен» + «ожидаемое» (до вычета авансов). */
  draftDebt: Decimal;
  /**
   * Подтверждение оплат (см. src/lib/verification.ts): в расчёт долга входят ВСЕ проведённые оплаты, но часть из них
   * ещё не подтверждена человеком/документами. Заполняется loadSupplierDebt (computeSupplierDebt оставляет null).
   */
  paymentsVerification: { verified: Decimal; waiting: Decimal; noProof: Decimal } | null;
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
  let receivedGross = zero();
  let invoicedGross = zero();
  let expectedGross = zero();
  let nonAuctionDebt = zero();
  let nonAuctionPurchases = 0;

  for (const p of purchases) {
    if (p.status === "CANCELLED" || auctionName(p.auctionSession)) continue;
    const t = purchaseTotalInclVat(p);
    total = total.add(t);
    nonAuctionPurchases += 1;
    const paid = p.payments.filter((x) => x.status === "COMPLETED").reduce((s, x) => s.add(x.amount), zero());
    const due = t.sub(paid);
    if (!due.greaterThan(0)) continue;
    dueSum = dueSum.add(due);
    nonAuctionDebt = nonAuctionDebt.add(due);
    if (p.status === "RECEIVED") receivedGross = receivedGross.add(due);
    else expectedGross = expectedGross.add(due); // вне аукциона счёта на черновик нет в документах
  }

  const byAuction: SupplierDebtAuction[] = [];
  for (const a of buildAuctionSummaries(purchases, auctionPayments)) {
    total = total.add(a.total);
    const due = Decimal.max(a.remaining, zero());
    if (!due.greaterThan(EPS)) continue;
    dueSum = dueSum.add(due);
    // Доля неполученных закупок в остатке аукциона — пропорционально остаткам закупок.
    const weights = a.perPurchase.map((pp) => ({ pp, w: Decimal.max(pp.total.sub(pp.paid), zero()) }));
    const wSum = weights.reduce((s, x) => s.add(x.w), zero());
    let draftPart = zero();
    if (wSum.greaterThan(0)) {
      for (const { pp, w } of weights) {
        if (pp.status !== "RECEIVED" && w.greaterThan(0)) draftPart = draftPart.add(due.mul(w).div(wSum));
      }
    }
    const receivedPart = due.sub(draftPart);
    // Счёт выставлен = выставленные счета − всё оплаченное по аукциону, но не больше неполученной части.
    const inv = INVOICES_FOR_DRAFTS[a.name];
    const openInvoice = inv ? Decimal.max(new Decimal(inv.total).sub(a.paid), zero()) : zero();
    const invoicedPart = Decimal.min(draftPart, openInvoice);
    const expectedPart = draftPart.sub(invoicedPart);
    receivedGross = receivedGross.add(receivedPart);
    invoicedGross = invoicedGross.add(invoicedPart);
    expectedGross = expectedGross.add(expectedPart);
    byAuction.push({
      name: a.name,
      purchases: a.purchases,
      total: a.total,
      paid: a.paid,
      due,
      dueReceived: receivedPart,
      dueInvoiced: invoicedPart,
      dueExpected: expectedPart,
      invoiceDocs: invoicedPart.greaterThan(EPS) && inv ? inv.docs : null,
    });
  }
  byAuction.sort((x, y) => y.due.comparedTo(x.due));

  const advances = unlinkedAdvances.reduce((s, x) => s.add(x.amount), zero());
  // Авансы без привязки гасят сначала «к оплате по УПД и счетам», затем (редко) остальное.
  let left = advances;
  const take = (v: Decimal) => {
    const d = Decimal.min(v, left);
    left = left.sub(d);
    return v.sub(d);
  };
  const receivedNet = take(receivedGross);
  const invoiced = take(invoicedGross);
  const expected = take(expectedGross);
  const debt = receivedNet.add(invoiced).add(expected);
  return {
    total,
    paid: total.sub(dueSum),
    unlinkedAdvances: advances,
    debt,
    receivedNet,
    receivedGross,
    invoiced,
    expected,
    byAuction,
    nonAuctionDebt,
    nonAuctionPurchases,
    draftDebt: invoicedGross.add(expectedGross),
    paymentsVerification: null,
  };
}

/** Загружает данные организации и считает долг поставщику (при year ≠ "all" — за закупки этого года). */
export async function loadSupplierDebt(db: Db, organizationId: string, year: YearFilter = "all"): Promise<SupplierDebt> {
  const [allPurchases, auctionPayments, advances] = await Promise.all([
    // Отменённые тоже: деньги, ушедшие по ним в рамках аукциона, входят в оплаченное по аукциону.
    db.purchase.findMany({
      where: { organizationId },
      include: {
        items: true,
        expenses: true,
        supplier: { select: { name: true } },
        payments: { where: { status: { in: ["COMPLETED", "PENDING"] } }, select: { amount: true, status: true, confirmed: true, confirmedAt: true } },
      },
    }),
    db.payment.findMany({
      where: { organizationId, purchaseId: null, auctionSession: { not: null }, status: { in: ["COMPLETED", "PENDING"] } },
      select: { auctionSession: true, amount: true, status: true, confirmed: true, confirmedAt: true },
    }),
    db.payment.findMany({
      where: { organizationId, purchaseId: null, auctionSession: null, status: "COMPLETED" },
      select: { amount: true, paidAt: true, confirmed: true, confirmedAt: true },
    }),
  ]);
  const purchases = year === "all" ? allPurchases : allPurchases.filter((p) => inYear(p.orderDate, year));
  const adv = year === "all" ? advances : advances.filter((a) => inYear(a.paidAt, year));
  const debt = computeSupplierDebt(purchases, auctionPayments, adv);
  // Подтверждённость оплат (только для подсказки долга): оплаты в расчёте остаются все, как раньше.
  const v = { verified: zero(), waiting: zero(), noProof: zero() };
  const count = (x: { amount: Prisma.Decimal; status?: string; confirmed: boolean; confirmedAt: Date | null }) => {
    if (x.status && x.status !== "COMPLETED") return;
    if (x.confirmed && x.confirmedAt) v.verified = v.verified.add(x.amount);
    else {
      v.waiting = v.waiting.add(x.amount);
      if (!x.confirmed) v.noProof = v.noProof.add(x.amount);
    }
  };
  for (const p of purchases) for (const x of p.payments as unknown as Parameters<typeof count>[0][]) count(x);
  for (const x of auctionPayments as unknown as Parameters<typeof count>[0][]) count(x);
  for (const x of adv as unknown as Parameters<typeof count>[0][]) count(x);
  return { ...debt, paymentsVerification: v };
}
