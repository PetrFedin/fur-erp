// Разнесение оплат производства на ВРЕМЕННОЙ базе PostgreSQL (Testcontainers): пустая база + миграции Prisma + свои фикстуры.
// Перенос с чистой базой сценариев из scripts/test-payment-allocation.ts (разделы 3 и 6: авторазнесение, потолок, изоляция организаций).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoAllocatePayment, loadUnallocatedPayments, orderWorkCents } from "@/lib/payment-alloc";
import { toCents } from "@/lib/payment-alloc-core";
import { startTestDb, type TestDb } from "../helpers/db";

let db: TestDb;
let orgId: string;
let orders: { id: string; work: number }[];

beforeAll(async () => {
  db = await startTestDb();
  const p = db.prisma;
  orgId = (await p.organization.create({ data: { name: "Тест-А", slug: "alloc-a" } })).id;
  const wh = await p.warehouse.create({ data: { organizationId: orgId, name: "Склад" } });
  const model = await p.productModel.create({ data: { organizationId: orgId, name: "Пальто" } });
  const client = await p.client.create({ data: { organizationId: orgId, name: "Заказчик" } });
  // три ТЗ: работа = цена за единицу × план (ТЗ «запланировано»): 10×100=1000, 20×100=2000, 30×100=3000 ₽
  orders = [];
  for (const [i, qty] of [10, 20, 30].entries()) {
    const o = await p.productionOrder.create({
      data: {
        organizationId: orgId, number: `ТЗ-${i + 1}`, productModelId: model.id, rawWarehouseId: wh.id, finishedWarehouseId: wh.id,
        plannedQuantity: qty, clientId: client.id, clientWorkPricePerUnit: "100.00",
      },
    });
    orders.push({ id: o.id, work: orderWorkCents(o) });
  }
}, 240_000);

afterAll(async () => { await db?.stop(); });

const baseOrder = async () => {
  const any = await db.prisma.productionOrder.findFirstOrThrow({ where: { organizationId: orgId } });
  return { organizationId: orgId, productModelId: any.productModelId, rawWarehouseId: any.rawWarehouseId, finishedWarehouseId: any.finishedWarehouseId, clientId: any.clientId };
};
const makePayment = (amount: string, orderIds: string[], org = orgId) =>
  db.prisma.productionPayment.create({
    data: { organizationId: org, amount, paymentType: "PARTIAL", orders: { create: orderIds.map((productionOrderId) => ({ productionOrderId })) } },
  });
const allocOf = (paymentId: string) => db.prisma.paymentAllocation.findMany({ where: { productionPaymentId: paymentId } });

describe("авторазнесение платежа (временная БД)", () => {
  it("база временная: не порт и не адрес боевой", () => {
    const u = new URL(db.url);
    expect(u.port).not.toBe("5436");
    expect(process.env.DATABASE_URL).toBe(db.url);
  });

  it("работа ТЗ считается из цены и количества", () => expect(orders.map((o) => o.work)).toEqual([100_000, 200_000, 300_000]));

  it("платёж на 3 ТЗ делится пропорционально работе, Σ = сумме, строки AUTO", async () => {
    const pay = await makePayment("3000.00", orders.map((o) => o.id));
    const r = await autoAllocatePayment(db.prisma, orgId, pay.id);
    expect(r.status).toBe("created");
    const rows = await allocOf(pay.id);
    expect(rows).toHaveLength(3);
    expect(rows.reduce((s, a) => s + toCents(a.amount), 0)).toBe(300_000);
    expect(rows.every((a) => a.source === "AUTO")).toBe(true);
    for (const o of orders) {
      const got = toCents(rows.find((a) => a.productionOrderId === o.id)!.amount);
      expect(got).toBe(o.work / 2); // платёж = половина всей работы (6000 ₽)
    }
  });

  it("второй платёж больше остатка: разнесён только остаток работы, хвост — неразнесённый", async () => {
    const pay = await makePayment("9000.00", orders.map((o) => o.id));
    await autoAllocatePayment(db.prisma, orgId, pay.id);
    const rows = await allocOf(pay.id);
    expect(rows.reduce((s, a) => s + toCents(a.amount), 0)).toBe(300_000); // осталось 3000 ₽ из 6000 ₽ работы
    const unal = await loadUnallocatedPayments(db.prisma, orgId);
    const mine = unal.find((u) => u.id === pay.id)!;
    expect(mine.rest.toNumber()).toBe(6000);
  });

  it("повторный вызов не дублирует строки (идемпотентно)", async () => {
    // свежее ТЗ: у первых трёх работа уже полностью разнесена предыдущими платежами
    const fresh = await db.prisma.productionOrder.create({
      data: { ...(await baseOrder()), number: "ТЗ-свежее", plannedQuantity: 5, clientWorkPricePerUnit: "100.00" },
    });
    const pay = await makePayment("100.00", [fresh.id]);
    await autoAllocatePayment(db.prisma, orgId, pay.id);
    await autoAllocatePayment(db.prisma, orgId, pay.id);
    expect(await allocOf(pay.id)).toHaveLength(1);
  });

  it("платёж другой организации пропускается", async () => {
    const orgB = await db.prisma.organization.create({ data: { name: "Тест-Б", slug: "alloc-b" } });
    const payB = await makePayment("1000.00", [], orgB.id);
    const r = await autoAllocatePayment(db.prisma, orgId, payB.id);
    expect(r.status).toBe("skipped");
    expect(await db.prisma.paymentAllocation.count({ where: { organizationId: orgB.id } })).toBe(0);
  });
});
