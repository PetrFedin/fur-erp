import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { extraInclOnly } from "@/lib/commission4";
import { DEFAULT_COMMISSION4_MODE, type Commission4Mode } from "@/lib/commission4-mode";
import { orderUnits } from "@/lib/production-totals";
import { classifyProduct } from "@/lib/product-category";

/** Количество изделий ТЗ (production-totals.ts): выпуск у завершённого, план у ТЗ в работе. */
export const orderUnitsDec = (o: { status: string; plannedQuantity: Decimal; producedQuantity: Decimal }) => new Decimal(orderUnits(o).toFixed(3));

/**
 * Название партии для подписи рядом с «Партия N»: служебное «Поставка N» (то же самое,
 * что номер) не показываем, чтобы не было двух названий одного.
 */
export function batchExtraName(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  return n && !/^(поставка|партия)\s*№?\s*\d+$/i.test(n) ? n : null;
}

/**
 * Сумма «шкур подрядчика», учтённая в оплате (из заметки платежа вида «… шкуры свакары подрядчика 4 584 500 …»),
 * чтобы объяснить, почему оплата больше работы партии. Нет такой пометки — null.
 */
export function contractorHidesFromNotes(notes: string | null | undefined): Decimal | null {
  const m = /шкур[а-яё]*[^\d.;]{0,40}?(\d[\d\s\u00a0]*\d)/i.exec(notes ?? "");
  if (!m) return null;
  const n = m[1].replace(/[\s\u00a0]/g, "");
  return /^\d+$/.test(n) ? new Decimal(n) : null;
}

/** ТЗ с данными для сводки по партии (себестоимость, работа, оплаты). */
export const batchOrderInclude = {
  productModel: { select: { name: true, category: true, categoryRef: { select: { name: true } }, salesCode: true, salesName: true } },
  client: { select: { name: true } },
  // quantity и lot — для разбивки по ставкам НДС лотов (lib/tz-vat.ts): в одном ТЗ ставки бывают 20% и 22%.
  materialUsages: {
    select: {
      totalCost: true,
      commission4: true,
      vatRate: true,
      quantity: true,
      lot: { select: { materialCostExclVat: true, expenseCostExclVat: true, unitCost: true, vatRate: true } },
    },
  },
  expenses: { select: { amount: true } },
  paymentAllocations: {
    select: { productionPayment: { select: { id: true, amount: true, status: true, paidAt: true, paymentType: true, docRef: true, confirmed: true, notes: true, allocations: { select: { amount: true } } } } },
  },
  // Разнесение оплат по ТЗ (PaymentAllocation): «оплачено по ТЗ» считается из него, не из валовой суммы платежей.
  payShares: { select: { amount: true, productionPaymentId: true, productionPayment: { select: { status: true } } } },
} satisfies Prisma.ProductionOrderInclude;

/** Ремонт определяется той же классификацией, что и на Главной (справочник категорий, затем название/описание), а не только полем модели. */
export function isRepairOrder(o: { materialDescription?: string | null; productModel: { name: string; category: string | null; categoryRef?: { name: string } | null } }): boolean {
  return classifyProduct({ refName: o.productModel.categoryRef?.name, modelCategory: o.productModel.category, orderDescription: o.materialDescription, modelName: o.productModel.name }).category === "Ремонт";
}

export type BatchOrder = Prisma.ProductionOrderGetPayload<{ include: typeof batchOrderInclude }>;

export type OrderStat = { qty: Decimal; cost: Decimal; work: Decimal };

/**
 * Себестоимость ТЗ; в режиме «С 4%» к ней добавляется надбавка 4% на сырьё и
 * подкладку (списания с commission4 = true). Снимок totalCost хранится «без 4%».
 * Работа и расходы не облагаются. Цифры партии — с НДС (как и раньше).
 */
export function orderStat(o: BatchOrder, mode: Commission4Mode = DEFAULT_COMMISSION4_MODE): OrderStat {
  const qty = orderUnitsDec(o);
  const projected = o.materialUsages
    .reduce((s, u) => s.add(u.totalCost), new Decimal(0))
    .add(o.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0)));
  const cost = (o.totalCost ?? projected).add(extraInclOnly(o.materialUsages, mode));
  const work = o.clientWorkPricePerUnit ? o.clientWorkPricePerUnit.mul(qty) : new Decimal(0);
  return { qty, cost, work };
}

export type BatchTotals = {
  orders: number;
  /** Произведено: выпуск завершённых ТЗ партии. */
  producedUnits: Decimal;
  producedOrders: number;
  /** В работе: план ТЗ «В работе» и «Запланировано». Отдельно от произведённого. */
  inWorkUnits: Decimal;
  inWorkOrders: number;
  /** Себестоимость и работа — по всем действующим ТЗ партии (произведённым и в работе: сырьё списано, работа к оплате). */
  cost: Decimal;
  work: Decimal;
  /** Оплачено = разнесено на ТЗ партии (PaymentAllocation). Остаток = работа − оплачено. */
  paid: Decimal;
  remaining: Decimal;
  /** Валовая сумма платежей, привязанных к ТЗ партии (каждый — один раз): для сверки с документами, где платёж виден целиком. */
  paidGross: Decimal;
  /** Часть платежей партии, не разнесённая ни на одно ТЗ (аванс без разнесения или сверх работы, напр. шкуры подрядчика). */
  unallocated: Decimal;
  /** Применяется ли 4% хоть к одному списанию действующих ТЗ (иначе подпись «с 4%» не ставим). */
  c4Applies: boolean;
};

export function batchTotals(orders: BatchOrder[], mode: Commission4Mode = DEFAULT_COMMISSION4_MODE): BatchTotals {
  const live = orders.filter((o) => o.status !== "CANCELLED");
  let pUnits = 0, pOrders = 0;
  const wUnits = 0, wOrders = 0; // «в работе» отдельно не показываем: произведено = все ТЗ без отменённых и ремонта
  let cost = new Decimal(0);
  let work = new Decimal(0);
  const pay = new Map<string, Decimal>();
  const rest = new Map<string, Decimal>();
  let shared = new Decimal(0);
  const c4Applies = live.some((o) => o.materialUsages.some((u) => u.commission4));
  for (const o of live) {
    const s = orderStat(o, mode);
    // Всё, что в ТЗ, производится и учитывается (как на Главной): завершённые + в работе + запланированные; ремонт — не изделия.
    if (!isRepairOrder(o)) { pOrders += 1; pUnits += orderUnits(o); }
    cost = cost.add(s.cost);
    work = work.add(s.work);
    for (const a of o.paymentAllocations) {
      if (a.productionPayment.status === "CANCELLED") continue;
      pay.set(a.productionPayment.id, a.productionPayment.amount);
      const done = a.productionPayment.allocations.reduce((x, y) => x.add(y.amount), new Decimal(0));
      const left = a.productionPayment.amount.sub(done);
      rest.set(a.productionPayment.id, left.greaterThan(0) ? left : new Decimal(0));
    }
    for (const sh of o.payShares) if (sh.productionPayment.status !== "CANCELLED") shared = shared.add(sh.amount);
  }
  const paidGross = Array.from(pay.values()).reduce((s, v) => s.add(v), new Decimal(0));
  const unallocated = Array.from(rest.values()).reduce((s, v) => s.add(v), new Decimal(0));
  const paid = shared;
  return { orders: live.length, producedUnits: new Decimal(pUnits.toFixed(3)), producedOrders: pOrders, inWorkUnits: new Decimal(wUnits.toFixed(3)), inWorkOrders: wOrders, cost, work, paid, remaining: work.sub(paid), paidGross, unallocated, c4Applies };
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
