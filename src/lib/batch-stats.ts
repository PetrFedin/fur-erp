import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { extraInclOnly } from "@/lib/commission4";
import type { Commission4Mode } from "@/lib/commission4-mode";

/** ТЗ с данными для сводки по партии (себестоимость, работа, оплаты). */
export const batchOrderInclude = {
  productModel: { select: { name: true } },
  client: { select: { name: true } },
  materialUsages: { select: { totalCost: true, commission4: true } },
  expenses: { select: { amount: true } },
  paymentAllocations: {
    select: { productionPayment: { select: { id: true, amount: true, status: true, paidAt: true, paymentType: true, docRef: true, confirmed: true } } },
  },
} satisfies Prisma.ProductionOrderInclude;

export type BatchOrder = Prisma.ProductionOrderGetPayload<{ include: typeof batchOrderInclude }>;

export type OrderStat = { qty: Decimal; cost: Decimal; work: Decimal };

/**
 * Себестоимость ТЗ; в режиме «С 4%» к ней добавляется надбавка 4% на сырьё и
 * подкладку (списания с commission4 = true). Снимок totalCost хранится «без 4%».
 * Работа и расходы не облагаются. Цифры партии — с НДС (как и раньше).
 */
export function orderStat(o: BatchOrder, mode: Commission4Mode = "off"): OrderStat {
  const qty = o.producedQuantity.greaterThan(0) ? o.producedQuantity : o.plannedQuantity;
  const projected = o.materialUsages
    .reduce((s, u) => s.add(u.totalCost), new Decimal(0))
    .add(o.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0)));
  const cost = (o.totalCost ?? projected).add(extraInclOnly(o.materialUsages, mode));
  const work = o.clientWorkPricePerUnit ? o.clientWorkPricePerUnit.mul(qty) : new Decimal(0);
  return { qty, cost, work };
}

export type BatchTotals = {
  orders: number;
  units: Decimal;
  cost: Decimal;
  work: Decimal;
  /** Оплаты по ТЗ партии: каждая оплата учитывается один раз, даже если покрывает несколько ТЗ. */
  paid: Decimal;
  remaining: Decimal;
  /** Применяется ли 4% хоть к одному списанию действующих ТЗ (иначе подпись «с 4%» не ставим). */
  c4Applies: boolean;
};

export function batchTotals(orders: BatchOrder[], mode: Commission4Mode = "off"): BatchTotals {
  const live = orders.filter((o) => o.status !== "CANCELLED");
  let units = new Decimal(0);
  let cost = new Decimal(0);
  let work = new Decimal(0);
  const pay = new Map<string, Decimal>();
  const c4Applies = live.some((o) => o.materialUsages.some((u) => u.commission4));
  for (const o of live) {
    const s = orderStat(o, mode);
    units = units.add(s.qty);
    cost = cost.add(s.cost);
    work = work.add(s.work);
    for (const a of o.paymentAllocations) {
      if (a.productionPayment.status !== "CANCELLED") pay.set(a.productionPayment.id, a.productionPayment.amount);
    }
  }
  const paid = Array.from(pay.values()).reduce((s, v) => s.add(v), new Decimal(0));
  return { orders: live.length, units, cost, work, paid, remaining: work.sub(paid), c4Applies };
}

/** Партии организации с их ТЗ (для списка партий и сгруппированного вида). */
export async function loadBatchesWithOrders(organizationId: string) {
  return prisma.productionBatch.findMany({
    where: { organizationId },
    include: {
      orders: { include: batchOrderInclude, orderBy: { createdAt: "asc" } },
      _count: { select: { driveDocuments: true } },
    },
    orderBy: { number: "asc" },
  });
}
