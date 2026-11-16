// Перенос scripts/test-payment-allocation.ts, раздел 1: чистая арифметика разнесения оплат (без базы).
import { describe, expect, it } from "vitest";
import { checkAllocation, fromCents, splitByWeights, toCents } from "@/lib/payment-alloc-core";
import { planAutoAllocations } from "@/lib/payment-alloc";

const items = [{ id: "a", weight: 100, cap: 100 }, { id: "b", weight: 200, cap: 200 }, { id: "c", weight: 300, cap: 300 }];
const total = (m: Map<string, number>) => [...m.values()].reduce((x, y) => x + y, 0);

describe("деление суммы по весам", () => {
  it("Σ долей = сумме (100 коп. на 3 ТЗ)", () => expect(total(splitByWeights(100, items))).toBe(100));
  it("сумма больше Σ потолков — каждый получает потолок", () => {
    const big = splitByWeights(10_000, items);
    expect(total(big)).toBe(600);
    expect(big.get("c")).toBe(300);
  });
  it("упёршийся в потолок отдаёт излишек остальным", () => {
    const c = splitByWeights(500, [{ id: "a", weight: 1, cap: 10 }, { id: "b", weight: 1, cap: 1000 }]);
    expect(c.get("a")).toBe(10);
    expect(c.get("b")).toBe(490);
  });
  it("нулевой вес — ничего не делится", () => expect(splitByWeights(100, [{ id: "a", weight: 0, cap: 100 }]).size).toBe(0));
});

describe("проверка разнесения", () => {
  it("Σ > платежа отклоняется, Σ = платежу допустима", () => {
    expect(checkAllocation(1000, [{ orderId: "a", amountCents: 600 }, { orderId: "b", amountCents: 500 }])).not.toBeNull();
    expect(checkAllocation(1000, [{ orderId: "a", amountCents: 600 }, { orderId: "b", amountCents: 400 }])).toBeNull();
  });
  it("одно ТЗ дважды и нулевая сумма отклоняются", () => {
    expect(checkAllocation(1000, [{ orderId: "a", amountCents: 100 }, { orderId: "a", amountCents: 100 }])).not.toBeNull();
    expect(checkAllocation(1000, [{ orderId: "a", amountCents: 0 }])).not.toBeNull();
  });
  it("копейки туда-обратно", () => {
    expect(toCents("1234.56")).toBe(123456);
    expect(fromCents(123456)).toBe("1234.56");
  });
});

describe("планировщик авторазнесения", () => {
  const orders = new Map([["x", { id: "x", workCents: 1000, live: true }], ["y", { id: "y", workCents: 3000, live: true }]]);
  const plan = planAutoAllocations(
    [
      { id: "p2", amountCents: 3000, paidAt: 2, createdAt: 2, linkedOrderIds: ["x", "y"] },
      { id: "p1", amountCents: 2000, paidAt: 1, createdAt: 1, linkedOrderIds: ["x", "y"] },
      { id: "p3", amountCents: 500, paidAt: 3, createdAt: 3, linkedOrderIds: [] },
    ],
    orders,
    new Map(),
  );
  const sum = (id: string) => plan.find((r) => r.paymentId === id)!.lines.reduce((s, l) => s + l.amountCents, 0);
  const perOrder = (o: string) => plan.flatMap((r) => r.lines).filter((l) => l.orderId === o).reduce((s, l) => s + l.amountCents, 0);

  it("платежи идут по порядку оплаты, второй получает остаток работы", () => {
    expect(plan[0].paymentId).toBe("p1");
    expect(sum("p1")).toBe(2000);
    expect(sum("p2")).toBe(2000);
    expect(plan.find((r) => r.paymentId === "p2")!.unallocatedCents).toBe(1000);
  });
  it("на ТЗ не больше его работы", () => {
    expect(perOrder("x")).toBeLessThanOrEqual(1000);
    expect(perOrder("y")).toBeLessThanOrEqual(3000);
  });
  it("платёж без ТЗ целиком — неразнесённый аванс", () => expect(plan.find((r) => r.paymentId === "p3")!.unallocatedCents).toBe(500));
});
