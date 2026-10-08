/**
 * Разнесение оплат производства по ТЗ и долг заказчиков — ЕДИНОЕ место формул.
 *
 *   • autoAllocatePayment — разнести платёж по набору ТЗ, к которым он привязан, пропорционально работе (не больше остатка работы ТЗ);
 *   • planAutoAllocations — то же чистой функцией (для сухого прогона скрипта и теста);
 *   • loadClientDebt — долг заказчиков для Сводки, партий и /payments (из PaymentAllocation + отдельная строка «неразнесённые авансы»);
 *   • loadUnallocatedPayments — платежи с неразнесённым остатком (список «Неразнесённые авансы» в Контроле).
 *
 * Правило: Σ разнесений платежа <= сумма платежа; остаток платежа — «неразнесённый аванс» и в долге заказчика учитывается отдельной строкой,
 * поэтому итог долга (работа − оплачено) не зависит от того, сколько уже разнесено.
 */
import { Decimal } from "@prisma/client/runtime/library";
import { orderUnits } from "@/lib/production-totals";
import { fromCents, splitByWeights, toCents, unallocatedKind, type AllocLine, type UnallocatedKind } from "@/lib/payment-alloc-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = Record<string, any>;
type YearFilterLike = "all" | "2025" | "2026" | (string & {});

export const AUTO_NOTE = "Авто: по набору ТЗ платежа, пропорционально работе";
const EPS_CENTS = 1;

type OrderQty = { status: string; plannedQuantity: Decimal | number | string; producedQuantity: Decimal | number | string; clientWorkPricePerUnit: Decimal | number | string | null };

/** Работа ТЗ в копейках: цена работы заказчика × количество (выпуск у завершённого, план у ТЗ в работе). 0 — цена не задана. */
export function orderWorkCents(o: OrderQty): number {
  if (o.clientWorkPricePerUnit == null) return 0;
  const units = new Decimal(orderUnits({ status: o.status, plannedQuantity: o.plannedQuantity.toString(), producedQuantity: o.producedQuantity.toString() }).toFixed(3));
  return Math.round(new Decimal(o.clientWorkPricePerUnit.toString()).mul(units).mul(100).toNumber());
}

// ---------- Автоматическое разнесение ----------

export type PlanPayment = { id: string; amountCents: number; paidAt: number; createdAt: number; linkedOrderIds: string[] };
export type PlanOrder = { id: string; workCents: number; live: boolean };
export type PlanResult = { paymentId: string; lines: AllocLine[]; unallocatedCents: number; why: string };

/**
 * План автоматического разнесения: платежи по порядку оплаты; каждый делится между ТЗ из своего набора пропорционально работе,
 * но не больше остатка работы ТЗ (работа минус уже разнесённое). Всё, что сверх, остаётся неразнесённым.
 * `existing` — уже разнесённые суммы по ТЗ (от платежей, которых нет в плане), коп.
 */
export function planAutoAllocations(payments: PlanPayment[], orders: Map<string, PlanOrder>, existing: Map<string, number>): PlanResult[] {
  const used = new Map(existing);
  const sorted = [...payments].sort((a, b) => a.paidAt - b.paidAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return sorted.map((p) => {
    const linked = p.linkedOrderIds.map((id) => orders.get(id)).filter((o): o is PlanOrder => !!o && o.live);
    if (linked.length === 0) return { paymentId: p.id, lines: [], unallocatedCents: p.amountCents, why: p.linkedOrderIds.length === 0 ? "платёж не привязан к ТЗ" : "нет действующих ТЗ в наборе" };
    if (!linked.some((o) => o.workCents > 0)) return { paymentId: p.id, lines: [], unallocatedCents: p.amountCents, why: "у ТЗ набора не задана цена работы" };
    const items = linked.map((o) => ({ id: o.id, weight: o.workCents, cap: Math.max(0, o.workCents - (used.get(o.id) ?? 0)) }));
    const split = splitByWeights(p.amountCents, items);
    const lines: AllocLine[] = [];
    let sum = 0;
    for (const o of linked) {
      const c = split.get(o.id) ?? 0;
      if (c > 0) {
        lines.push({ orderId: o.id, amountCents: c });
        used.set(o.id, (used.get(o.id) ?? 0) + c);
        sum += c;
      }
    }
    const rest = p.amountCents - sum;
    return { paymentId: p.id, lines, unallocatedCents: rest, why: rest > EPS_CENTS ? "платёж больше остатка работы набора ТЗ" : "разнесён полностью" };
  });
}

/** Разнесено на ТЗ от платежей, КРОМЕ указанного: копейки по ТЗ (платежи не отменены). */
export async function allocatedCentsByOrder(db: Db, orgId: string, orderIds: string[], exceptPaymentId?: string): Promise<Map<string, number>> {
  const rows: { productionOrderId: string; amount: Decimal }[] = await db.paymentAllocation.findMany({
    where: {
      organizationId: orgId,
      productionOrderId: { in: orderIds },
      productionPayment: { status: { not: "CANCELLED" } },
      ...(exceptPaymentId ? { productionPaymentId: { not: exceptPaymentId } } : {}),
    },
    select: { productionOrderId: true, amount: true },
  });
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.productionOrderId, (m.get(r.productionOrderId) ?? 0) + toCents(r.amount));
  return m;
}

export type AutoAllocResult = { status: "created" | "skipped" | "none"; lines: AllocLine[]; unallocatedCents: number; why: string };

/**
 * Разнести ОДИН платёж по набору ТЗ, к которым он привязан (ProductionPaymentOrder). Вызывается после создания платежа и при правке набора ТЗ.
 * Ручные строки (MANUAL) не трогаются: если они есть — платёж пропускается. Строки AUTO пересчитываются.
 */
export async function autoAllocatePayment(db: Db, orgId: string, paymentId: string): Promise<AutoAllocResult> {
  const pay = await db.productionPayment.findFirst({
    where: { id: paymentId, organizationId: orgId },
    select: {
      id: true, amount: true, status: true, paidAt: true, createdAt: true,
      orders: { select: { productionOrderId: true } },
      allocations: { select: { id: true, source: true } },
    },
  });
  if (!pay || pay.status === "CANCELLED") return { status: "skipped", lines: [], unallocatedCents: 0, why: "платёж не найден или отменён" };
  if (pay.allocations.some((a: { source: string }) => a.source === "MANUAL")) return { status: "skipped", lines: [], unallocatedCents: 0, why: "есть ручное разнесение" };
  const ids: string[] = pay.orders.map((o: { productionOrderId: string }) => o.productionOrderId);
  const orders: { id: string; status: string; plannedQuantity: Decimal; producedQuantity: Decimal; clientWorkPricePerUnit: Decimal | null }[] = ids.length
    ? await db.productionOrder.findMany({ where: { id: { in: ids }, organizationId: orgId }, select: { id: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true } })
    : [];
  const existing = await allocatedCentsByOrder(db, orgId, ids, paymentId);
  const map = new Map(orders.map((o) => [o.id, { id: o.id, workCents: orderWorkCents(o), live: o.status !== "CANCELLED" }]));
  const [r] = planAutoAllocations(
    [{ id: pay.id, amountCents: toCents(pay.amount), paidAt: new Date(pay.paidAt).getTime(), createdAt: new Date(pay.createdAt).getTime(), linkedOrderIds: ids }],
    map,
    existing,
  );
  if (pay.allocations.length) await db.paymentAllocation.deleteMany({ where: { productionPaymentId: paymentId, source: "AUTO" } });
  if (r.lines.length === 0) return { status: "none", lines: [], unallocatedCents: r.unallocatedCents, why: r.why };
  await db.paymentAllocation.createMany({
    data: r.lines.map((l) => ({ organizationId: orgId, productionPaymentId: paymentId, productionOrderId: l.orderId, amount: fromCents(l.amountCents), source: "AUTO", note: AUTO_NOTE })),
  });
  return { status: "created", lines: r.lines, unallocatedCents: r.unallocatedCents, why: r.why };
}

// ---------- Неразнесённые остатки платежей ----------

export type UnallocatedPayment = {
  id: string;
  clientId: string | null;
  clientName: string | null;
  paidAt: Date;
  amount: Decimal;
  allocated: Decimal;
  rest: Decimal;
  paymentType: string;
  docRef: string | null;
  notes: string | null;
  linkedOrders: number;
  kind: UnallocatedKind;
};

/** Платежи (проведённые) с неразнесённым остатком. Разнесение на отменённые ТЗ не считается. */
export async function loadUnallocatedPayments(db: Db, orgId: string, opts: { clientId?: string } = {}): Promise<UnallocatedPayment[]> {
  const pays = await db.productionPayment.findMany({
    where: { organizationId: orgId, status: "COMPLETED", ...(opts.clientId ? { clientId: opts.clientId } : {}) },
    select: {
      id: true, clientId: true, paidAt: true, amount: true, paymentType: true, docRef: true, notes: true,
      client: { select: { name: true } },
      orders: { select: { productionOrderId: true } },
      allocations: { select: { amount: true, productionOrder: { select: { status: true } } } },
    },
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
  });
  const out: UnallocatedPayment[] = [];
  for (const p of pays) {
    const allocated = p.allocations
      .filter((a: { productionOrder: { status: string } }) => a.productionOrder.status !== "CANCELLED")
      .reduce((s: Decimal, a: { amount: Decimal }) => s.add(a.amount), new Decimal(0));
    const rest = new Decimal(p.amount).sub(allocated);
    if (rest.mul(100).lessThanOrEqualTo(EPS_CENTS)) continue;
    out.push({
      id: p.id, clientId: p.clientId, clientName: p.client?.name ?? null, paidAt: p.paidAt, amount: new Decimal(p.amount), allocated, rest,
      paymentType: p.paymentType, docRef: p.docRef, notes: p.notes, linkedOrders: p.orders.length,
      kind: unallocatedKind({ paymentType: p.paymentType, linkedOrders: p.orders.length }),
    });
  }
  return out;
}

// ---------- Долг заказчиков ----------

export type ClientDebtRow = {
  clientId: string;
  clientName: string;
  billable: number;
  /** Оплачено всего в этой строке = разнесено на выбранные ТЗ + неразнесённые авансы (если они учитываются). */
  paid: number;
  allocated: number;
  unallocated: number;
  balance: number;
  unpricedOrders: number;
  orders: number;
};

export type ClientDebt = {
  rows: ClientDebtRow[];
  billable: number;
  allocated: number;
  /** Неразнесённые авансы, вошедшие в «оплачено» (0, если включён фильтр по ТЗ — тогда они не относятся к выбранным ТЗ). */
  unallocated: number;
  /** Неразнесённые авансы всех платежей выбранного года — для подписи, даже если в остаток они не вошли. */
  unallocatedAll: number;
  /** Учтены ли неразнесённые авансы в остатке: нет, когда включены фильтры по ТЗ (сырьё, статус, партия). */
  unallocatedApplied: boolean;
  paid: number;
  balance: number;
  /** Разбивка неразнесённого: аванс без разнесения / платёж сверх работы ТЗ (напр. шкуры подрядчика). */
  unallocatedByKind: { advance: number; excess: number };
  payments: UnallocatedPayment[];
};

export type ClientDebtScope = {
  year: YearFilterLike;
  /** ТЗ, по которым считается работа (уже отфильтрованы по году и фильтрам). Нет — все действующие ТЗ заказчиков (при году — ТЗ, платежи которых — см. ниже). */
  orderIds?: string[];
  /** Включены ли фильтры по составу ТЗ (сырьё, цвет, НДС, статус, партия): тогда неразнесённые авансы в остаток не входят. */
  orderFiltersActive?: boolean;
};

const n2 = (d: Decimal) => Math.round(d.toNumber() * 100) / 100;

/**
 * Долг заказчиков = работа выбранных ТЗ − оплачено, где оплачено = разнесено на эти ТЗ + неразнесённые авансы выбранного года.
 * Без фильтров и при «все годы» результат равен прежнему «Σ работ − Σ всех платежей заказчика».
 */
export async function loadClientDebt(db: Db, orgId: string, scope: ClientDebtScope): Promise<ClientDebt> {
  const year = scope.year;
  const filtersActive = Boolean(scope.orderFiltersActive);
  const orders: (OrderQty & { id: string; clientId: string; client: { name: string } })[] = await db.productionOrder.findMany({
    where: { organizationId: orgId, clientId: { not: null }, status: { not: "CANCELLED" }, ...(scope.orderIds ? { id: { in: scope.orderIds } } : {}) },
    select: { id: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, clientId: true, client: { select: { name: true } } },
  });
  const orderIds = new Set(orders.map((o) => o.id));
  const rows = new Map<string, { clientId: string; clientName: string; billable: Decimal; allocated: Decimal; unallocated: Decimal; unpricedOrders: number; orders: number }>();
  const ensure = (clientId: string, clientName: string) => {
    let e = rows.get(clientId);
    if (!e) {
      e = { clientId, clientName, billable: new Decimal(0), allocated: new Decimal(0), unallocated: new Decimal(0), unpricedOrders: 0, orders: 0 };
      rows.set(clientId, e);
    }
    return e;
  };
  const orderClient = new Map<string, string>();
  for (const o of orders) {
    const e = ensure(o.clientId, o.client.name);
    orderClient.set(o.id, o.clientId);
    e.orders += 1;
    if (o.clientWorkPricePerUnit) e.billable = e.billable.add(new Decimal(o.clientWorkPricePerUnit.toString()).mul(new Decimal(orderUnits({ status: o.status, plannedQuantity: o.plannedQuantity.toString(), producedQuantity: o.producedQuantity.toString() }).toFixed(3))));
    else e.unpricedOrders += 1;
  }

  // Разнесено на выбранные ТЗ (любой год платежа): платёж не отменён.
  const shares: { productionOrderId: string; amount: Decimal }[] = orderIds.size
    ? await db.paymentAllocation.findMany({
        where: { organizationId: orgId, productionOrderId: { in: [...orderIds] }, productionPayment: { status: "COMPLETED" } },
        select: { productionOrderId: true, amount: true },
      })
    : [];
  for (const s of shares) {
    const cid = orderClient.get(s.productionOrderId);
    if (cid) rows.get(cid)!.allocated = rows.get(cid)!.allocated.add(s.amount);
  }

  // Неразнесённые авансы: остаток платежей, не отнесённый ни к одному действующему ТЗ. По году — по дате оплаты.
  const payments = await loadUnallocatedPayments(db, orgId);
  const inYear = (d: Date) => year === "all" || new Date(d).getUTCFullYear() === Number(year);
  const yearPayments = payments.filter((p) => inYear(p.paidAt));
  let unallocatedAll = 0;
  const byKind = { advance: 0, excess: 0 };
  for (const p of yearPayments) {
    unallocatedAll += p.rest.toNumber();
    byKind[p.kind] += p.rest.toNumber();
    if (!filtersActive && p.clientId) {
      const e = rows.get(p.clientId);
      if (e) e.unallocated = e.unallocated.add(p.rest);
    }
  }

  const list: ClientDebtRow[] = Array.from(rows.values())
    .map((c) => {
      const paid = c.allocated.add(c.unallocated);
      return {
        clientId: c.clientId, clientName: c.clientName, billable: n2(c.billable), paid: n2(paid), allocated: n2(c.allocated), unallocated: n2(c.unallocated),
        balance: n2(c.billable.sub(paid)), unpricedOrders: c.unpricedOrders, orders: c.orders,
      };
    })
    .sort((a, b) => b.balance - a.balance);
  const sum = (f: (r: ClientDebtRow) => number) => Math.round(list.reduce((s, r) => s + f(r), 0) * 100) / 100;
  return {
    rows: list,
    billable: sum((r) => r.billable),
    allocated: sum((r) => r.allocated),
    unallocated: sum((r) => r.unallocated),
    unallocatedAll: Math.round(unallocatedAll * 100) / 100,
    unallocatedApplied: !filtersActive,
    paid: sum((r) => r.paid),
    balance: sum((r) => r.balance),
    unallocatedByKind: { advance: Math.round(byKind.advance * 100) / 100, excess: Math.round(byKind.excess * 100) / 100 },
    payments: yearPayments,
  };
}
