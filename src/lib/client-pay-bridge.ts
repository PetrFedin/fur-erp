import "server-only";
// Мост «Оплачено всего → разнесено на партии → не разнесено (аванс)» для страниц «Партии пошива».
// Только чтение; числа берёт тот же loadClientDebt (payment-alloc.ts), что и Главная («Долг заказчиков») и «Оплаты → От заказчиков».
import { prisma } from "@/lib/prisma";
import { loadClientDebt } from "@/lib/payment-alloc";
import type { YearFilter } from "@/lib/year-filter";

export type BridgePayment = {
  id: string; date: string; client: string | null; amount: number; rest: number; doc: string | null; notes: string | null;
  /** Остаток назван в основании «шкурами подрядчика»: это сырьё, а не оплата работы — в «Оплачено всего» не входит. */
  hides: boolean;
};

export type ClientPayBridge = {
  /** Работа заказчикам (как «Работа» в «Долг заказчиков» на Главной). */
  work: number;
  /** Оплачено всего = разнесено на ТЗ + неразнесённые авансы (Главная, «Оплаты»). */
  paid: number;
  /** К оплате = работа − оплачено. */
  balance: number;
  /** Разнесено на ТЗ (любые: в партиях и без партии). */
  allocated: number;
  /** Не разнесено на ТЗ (авансы заказчика), без шкур подрядчика. */
  advance: number;
  /** Шкуры подрядчика в платежах заказчика: сырьё, в «Оплачено всего» не входит. */
  hides: number;
  /** Платежи с неразнесённым остатком (за выбранный год), для списка. */
  payments: BridgePayment[];
};

export async function loadClientPayBridge(orgId: string, year: YearFilter, orderIds?: string[]): Promise<ClientPayBridge> {
  const d = await loadClientDebt(prisma, orgId, { year, ...(orderIds ? { orderIds } : {}) });
  const payments: BridgePayment[] = d.payments.map((p) => ({
    id: p.id,
    date: new Date(p.paidAt).toISOString().slice(0, 10),
    client: p.clientName,
    amount: p.amount.toNumber(),
    rest: p.rest.toNumber(),
    doc: p.docRef,
    notes: p.notes,
    hides: /шкур/i.test(`${p.docRef ?? ""} ${p.notes ?? ""}`) && p.rest.greaterThan(1),
  }));
  return { work: d.billable, paid: d.paid, balance: d.balance, allocated: d.allocated, advance: d.unallocated, hides: d.hides, payments };
}
