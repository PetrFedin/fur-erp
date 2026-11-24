// Основа самопроверки: типы, помощники, допуски. Сами проверки — по разделам в _checks/, сборка списка — checks.ts.
// ДВИЖОК САМОПРОВЕРКИ: набор инвариантов («что должно сходиться»). Каждая проверка только читает БД и возвращает расхождения
// со ссылкой «где исправлять». Данные не меняются. Известные объяснимые расхождения помечаются отдельно (known.ts).
//
// Допуски: ROUND_TOL_RUB = 50 ₽ — как в src/lib/verification.ts (округление лотов против УПД); остальные — копейки округления колонок БД.
import { Decimal } from "@prisma/client/runtime/library";
import { purchaseTotalInclVat } from "../purchase-totals";
import { auctionName } from "../auction-names";

import { type IntegrityData, type IPurchase, type IOrder } from "./data";
import type { Severity, Violation, EntityRef } from "./types";
import { formatNum } from "@/lib/utils";

/** Допуск на округление лотов против УПД (= ROUND_TOL_RUB из verification.ts). */
export const ROUND_TOL_RUB = 50;

export type Ctx = { d: IntegrityData; helpers: Helpers; prev: Map<string, Violation[]>; supplierDebt?: () => Promise<DebtProbe | null> };
export type DebtProbe = { debt: number; total: number; receivedNet: number; invoiced: number; expected: number; unlinkedAdvances: number };
export type CheckDef = {
  id: string;
  title: string;
  group: string;
  severity: Severity;
  tolerance: string;
  what: string;
  fix: string;
  run: (c: Ctx) => { checked: number; violations: Violation[] } | Promise<{ checked: number; violations: Violation[] }>;
};

// ───────────────────────── справочные функции ─────────────────────────

export type Helpers = ReturnType<typeof makeHelpers>;

export function makeHelpers(d: IntegrityData) {
  const lotById = new Map(d.lots.map((l) => [l.id, l]));
  const orderById = new Map(d.orders.map((o) => [o.id, o]));
  const purchaseById = new Map(d.purchases.map((p) => [p.id, p]));
  const batchById = new Map(d.batches.map((b) => [b.id, b]));
  const modelById = new Map(d.models.map((m) => [m.id, m]));
  const usagesByLot = new Map<string, typeof d.usages>();
  const usagesByOrder = new Map<string, typeof d.usages>();
  for (const u of d.usages) {
    (usagesByLot.get(u.lotId) ?? usagesByLot.set(u.lotId, []).get(u.lotId)!).push(u);
    (usagesByOrder.get(u.orderId) ?? usagesByOrder.set(u.orderId, []).get(u.orderId)!).push(u);
  }
  const lotsByPurchase = new Map<string, typeof d.lots>();
  for (const l of d.lots) if (l.purchaseId) (lotsByPurchase.get(l.purchaseId) ?? lotsByPurchase.set(l.purchaseId, []).get(l.purchaseId)!).push(l);

  const purchaseTotal = (p: IPurchase): number =>
    Number(
      purchaseTotalInclVat({
        exchangeRate: new Decimal(p.exchangeRate) as never,
        items: p.items.map((i) => ({ subtotal: new Decimal(i.subtotal) as never, vatRate: new Decimal(i.vatRate) as never, quantity: new Decimal(i.quantity) as never, costPlan: i.costPlan })),
        expenses: p.expenses.map((e) => ({ amount: new Decimal(e.amount) as never, vatRate: new Decimal(e.vatRate) as never })),
      }).toString(),
    );

  const ref = {
    purchase: (p: IPurchase): EntityRef => ({ kind: "purchase", id: p.id, label: `Закупка ${p.number}` }),
    order: (o: IOrder): EntityRef => ({ kind: "order", id: o.id, label: `ТЗ ${o.workOrderNumber?.trim() || o.number}` }),
    lot: (l: IntegrityData["lots"][number]): EntityRef => ({ kind: "lot", id: l.id, label: `Лот ${l.lotNumber ?? "без номера"} (${l.materialName})` }),
    batch: (b: IntegrityData["batches"][number]): EntityRef => ({ kind: "batch", id: b.id, label: `Партия ${b.number}` }),
  };
  const href = {
    purchase: (id: string) => `/purchases/${id}`,
    lot: (id: string) => `/analytics/raw/lot/${id}`,
    order: (id: string) => `/production/${id}`,
    batch: (n: number) => `/production/batches/${n}`,
    model: (id: string) => `/models/${id}`,
  };

  /** Количество изделий ТЗ для расчёта работы: выпуск у завершённого, план у ТЗ в работе (production-totals.ts). */
  const orderUnits = (o: IOrder) => (o.status === "COMPLETED" ? o.producedQuantity : o.status === "IN_PROGRESS" || o.status === "PLANNED" ? o.plannedQuantity : 0);

  /** Закупки аукциона по нормализованному имени. */
  const purchasesByAuction = new Map<string, IPurchase[]>();
  for (const p of d.purchases) {
    const n = auctionName(p.auctionSession);
    if (n) (purchasesByAuction.get(n) ?? purchasesByAuction.set(n, []).get(n)!).push(p);
  }
  return { lotById, orderById, purchaseById, batchById, modelById, usagesByLot, usagesByOrder, lotsByPurchase, purchaseTotal, ref, href, orderUnits, purchasesByAuction };
}

export const fmt = (v: number) => formatNum(v, 1).replace(/[  ]/g, " ");
export const money = (v: number) => `${fmt(v)} ₽`;
export const sgn = (v: number) => (v > 0 ? "+" : "") + fmt(v);

// ───────────────────────── проверки ─────────────────────────
