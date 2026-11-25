// Лёгкая сводка «подтверждено / ждёт» (вынесено из verification.ts без изменений; мемоизация — в verification.ts).
import type { VerifyKind } from "@/lib/verification-kinds";
import { isCountedPayment } from "./evidence";
import type { Db, VerifyFlag, VerifyFlags } from "./types";

/** Лёгкая сводка «подтверждено / ждёт» для реестра сверки, «Что не заведено», Сводки и подсказки долга. */
export async function loadVerifyFlagsImpl(db: Db, orgId: string, year?: string): Promise<VerifyFlags> {
  const [purchases, batches, orders, pays, prodPays] = await Promise.all([
    db.purchase.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" } }, select: { number: true, orderDate: true, verifiedAt: true, verifiedBy: true } }),
    db.productionBatch.findMany({ where: { organizationId: orgId }, select: { number: true, year: true, verifiedAt: true, verifiedBy: true, orders: { select: { status: true } } } }),
    db.productionOrder.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" } }, select: { id: true, verifiedAt: true, verifiedBy: true, workOrderDate: true, endDate: true, startDate: true, batch: { select: { year: true } } } }),
    db.payment.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" } }, select: { amount: true, status: true, paidAt: true, confirmed: true, confirmedAt: true, confirmedBy: true } }),
    db.productionPayment.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" } }, select: { amount: true, paidAt: true, confirmed: true, confirmedAt: true, confirmedBy: true } }),
  ]);
  const y = year && year !== "all" ? Number(year) : null;
  const counts: VerifyFlags["counts"] = {
    payment: { total: 0, verified: 0, auto: 0 }, prodPayment: { total: 0, verified: 0, auto: 0 }, purchase: { total: 0, verified: 0, auto: 0 }, order: { total: 0, verified: 0, auto: 0 }, batch: { total: 0, verified: 0, auto: 0 },
  };
  const add = (k: VerifyKind, yr: number | null | undefined, ok: boolean, by: string | null) => {
    if (y != null && yr !== y) return;
    counts[k].total++;
    if (ok) {
      counts[k].verified++;
      if (by?.startsWith("auto:")) counts[k].auto++;
    }
  };
  const purchaseByNumber = new Map<string, VerifyFlag>();
  for (const p of purchases) {
    add("purchase", p.orderDate.getUTCFullYear(), !!p.verifiedAt, p.verifiedBy);
    purchaseByNumber.set(p.number, { verified: !!p.verifiedAt, auto: !!p.verifiedBy?.startsWith("auto:") });
  }
  const batchByNumber = new Map<number, VerifyFlag>();
  for (const b of batches) {
    if (!b.orders.some((o) => o.status !== "CANCELLED")) continue;
    add("batch", b.year, !!b.verifiedAt, b.verifiedBy);
    batchByNumber.set(b.number, { verified: !!b.verifiedAt, auto: !!b.verifiedBy?.startsWith("auto:") });
  }
  const orderById = new Map<string, VerifyFlag>();
  for (const o of orders) {
    const d = o.workOrderDate ?? o.endDate ?? o.startDate;
    add("order", d ? d.getUTCFullYear() : (o.batch?.year ?? null), !!o.verifiedAt, o.verifiedBy);
    orderById.set(o.id, { verified: !!o.verifiedAt, auto: !!o.verifiedBy?.startsWith("auto:") });
  }
  const paid = { verified: 0, waiting: 0, noProof: 0 };
  for (const p of pays) {
    const ok = p.confirmed && !!p.confirmedAt;
    if (isCountedPayment(p.amount)) add("payment", p.paidAt.getUTCFullYear(), ok, p.confirmedBy);
    if (p.status !== "COMPLETED" || (y != null && p.paidAt.getUTCFullYear() !== y)) continue;
    const a = Number(p.amount);
    if (ok) paid.verified += a;
    else {
      paid.waiting += a;
      if (!p.confirmed) paid.noProof += a;
    }
  }
  for (const p of prodPays) if (isCountedPayment(p.amount)) add("prodPayment", p.paidAt.getUTCFullYear(), p.confirmed && !!p.confirmedAt, p.confirmedBy);
  return { counts, purchaseByNumber, batchByNumber, orderById, paid };
}
