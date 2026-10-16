import "server-only";
import { prisma } from "@/lib/prisma";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { auctionName } from "@/lib/auction-names";
import { orderWorkCents } from "@/lib/payment-alloc";
import { CONFIRMED_WHERE, normInvoice, payInfo, poolShares, type PayInfo, type PayLine } from "@/lib/supplier-pay-core";

/**
 * Статус оплат для подрядчика (Веллмеха): «Оплачено / Частично / Не оплачено» + дата и сумма — ТОЛЬКО его счетов, аукционов и ТЗ.
 * Единый источник — наши оплаты (Payment — «за сырьё», ProductionPayment + PaymentAllocation — «за работу»): статус пересчитывается
 * при каждом открытии страницы от ПОДТВЕРЖДЁННЫХ оплат (см. supplier-pay-core.ts), поэтому подтверждение и его снятие у заказчика
 * сразу меняют то, что видит подрядчик. Своей копии статусов нет. Остатки и долги заказчика, неразнесённые авансы, оплаты других
 * подрядчиков и сами платёжные документы наружу не выходят.
 */

type PurchaseRow = { id: string; key: string | null; total: number; invoice: string; at: number; number: string };
export type SupplierPayData = {
  purchases: Map<string, PurchaseRow>;
  /** Подтверждённые оплаты, привязанные к закупке напрямую (purchaseId или номер счёта). */
  direct: Map<string, PayLine[]>;
  /** Подтверждённые оплаты аукциона целиком (без счёта), по названию аукциона. */
  pools: Map<string, PayLine[]>;
};

/** Закупки подрядчика и подтверждённые оплаты ему — одной загрузкой на страницу. */
export async function loadSupplierPayData(orgId: string, supplierId: string): Promise<SupplierPayData> {
  const [purchases, pays] = await Promise.all([
    prisma.purchase.findMany({
      where: { organizationId: orgId, supplierId, status: { not: "CANCELLED" } },
      include: { items: true, expenses: true },
    }),
    prisma.payment.findMany({
      where: { organizationId: orgId, supplierId, ...CONFIRMED_WHERE },
      select: { amount: true, kind: true, paidAt: true, purchaseId: true, invoiceNo: true, auctionSession: true },
    }),
  ]);
  const rows = new Map<string, PurchaseRow>();
  const byInvoice = new Map<string, string[]>();
  for (const p of purchases) {
    rows.set(p.id, { id: p.id, key: auctionName(p.auctionSession), total: Number(purchaseTotalInclVat(p)), invoice: p.invoiceNumber ?? "", at: p.orderDate.getTime(), number: p.number });
    const n = normInvoice(p.invoiceNumber);
    if (n) byInvoice.set(n, [...(byInvoice.get(n) ?? []), p.id]);
  }
  const direct = new Map<string, PayLine[]>();
  const pools = new Map<string, PayLine[]>();
  for (const x of pays) {
    const line: PayLine = { kind: x.kind, amount: Number(x.amount), paidAt: x.paidAt };
    let pid = x.purchaseId && rows.has(x.purchaseId) ? x.purchaseId : null;
    // Оплата без закупки, но с номером счёта, который есть ровно у одной закупки подрядчика, относится к этому счёту.
    if (!pid && !x.purchaseId) {
      const hit = byInvoice.get(normInvoice(x.invoiceNo));
      if (hit?.length === 1) pid = hit[0];
    }
    if (pid) { direct.set(pid, [...(direct.get(pid) ?? []), line]); continue; }
    // Оплата аукциона целиком (закупка не названа) — общий пул аукциона; без аукциона и закупки (аванс «вообще») не показываем.
    const key = !x.purchaseId ? auctionName(x.auctionSession) : null;
    if (key) pools.set(key, [...(pools.get(key) ?? []), line]);
  }
  return { purchases: rows, direct, pools };
}

const sum = (l: PayLine[]) => l.reduce((a, x) => a + x.amount, 0);

/** Доли пулов аукционов по счетам: счета аукциона добирают остаток по порядку заказа. */
function sharesFor(d: SupplierPayData, key: string): Map<string, number> {
  const inAuction = [...d.purchases.values()].filter((p) => p.key === key).sort((a, b) => a.at - b.at || a.number.localeCompare(b.number, "ru", { numeric: true }));
  const pool = sum(d.pools.get(key) ?? []);
  return poolShares(inAuction.map((p) => ({ id: p.id, need: Math.max(0, p.total - sum(d.direct.get(p.id) ?? [])) })), pool);
}

const poolDate = (d: SupplierPayData, key: string): Date | null => (d.pools.get(key) ?? []).reduce<Date | null>((a, x) => (!a || x.paidAt > a ? x.paidAt : a), null);

/** Статус одного счёта (закупки): прямые оплаты + его доля оплат аукциона целиком. null — закупки нет среди его. */
export function invoicePayInfo(d: SupplierPayData, purchaseId: string): PayInfo | null {
  const p = d.purchases.get(purchaseId);
  if (!p) return null;
  const lines = [...(d.direct.get(p.id) ?? [])];
  const share = p.key ? sharesFor(d, p.key).get(p.id) ?? 0 : 0;
  if (share > 0.004 && p.key) lines.push({ kind: "OTHER", amount: share, paidAt: poolDate(d, p.key)! });
  return payInfo(p.total, lines);
}

/** Статус группы счетов (карточка аукциона / расчёт): все оплаты этих счетов и пулы их аукционов. */
export function groupPayInfo(d: SupplierPayData, purchaseIds: string[]): PayInfo | null {
  const ps = [...new Set(purchaseIds)].map((id) => d.purchases.get(id)).filter((p): p is PurchaseRow => !!p);
  if (ps.length === 0) return null;
  const lines = ps.flatMap((p) => d.direct.get(p.id) ?? []);
  const keys = [...new Set(ps.map((p) => p.key).filter((k): k is string => !!k))];
  for (const k of keys) {
    // пул считается целиком только если в группе все счета аукциона, иначе — долями этих счетов
    const shares = sharesFor(d, k);
    const part = ps.filter((p) => p.key === k).reduce((a, p) => a + (shares.get(p.id) ?? 0), 0);
    if (part > 0.004) lines.push({ kind: "OTHER", amount: part, paidAt: poolDate(d, k)! });
  }
  return payInfo(ps.reduce((a, p) => a + p.total, 0), lines);
}

/** Статус работы по ТЗ подрядчика (принятому из «Входящих»): разнесённые на эти ТЗ подтверждённые оплаты против цены работы. */
export async function tzPayInfo(orgId: string, supplierId: string, orderIds: string[]): Promise<PayInfo | null> {
  if (orderIds.length === 0) return null;
  const orders = await prisma.productionOrder.findMany({
    where: { id: { in: orderIds }, organizationId: orgId, contractorId: supplierId, status: { not: "CANCELLED" } },
    select: { id: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true },
  });
  if (orders.length === 0) return null;
  const allocs = await prisma.paymentAllocation.findMany({
    where: { organizationId: orgId, productionOrderId: { in: orders.map((o) => o.id) }, productionPayment: { ...CONFIRMED_WHERE } },
    select: { amount: true, productionPayment: { select: { paidAt: true, paymentType: true } } },
  });
  const cents = orders.map(orderWorkCents);
  const lines: PayLine[] = allocs.map((a) => ({ kind: a.productionPayment.paymentType, amount: Number(a.amount), paidAt: a.productionPayment.paidAt }));
  return payInfo(cents.reduce((a, c) => a + c, 0) / 100, lines, cents.every((c) => c > 0));
}
