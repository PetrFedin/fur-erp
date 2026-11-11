// Перенос scripts/test-weighted.ts: средневзвешенное и сортировка таблицы лотов (чистые функции).
import { describe, expect, it } from "vitest";
import { safeRatio, weightedAvg, weightedPercent } from "@/lib/weighted";
import { computeTotals, sortRows, type LotRow } from "@/lib/lot-table";

const row = (id: string, o: Partial<LotRow>): LotRow => ({
  id, purchaseId: "p1", materialId: "m", material: "Соболь", lotNumber: id, size: "", op: "", qty: 0, unit: "шт.", price: 0,
  currency: "USD", rate: 1, unitIncl: 0, unitExcl: 0, totalIncl: 0, totalExcl: 0, priceIncl: 0, priceExcl: 0, source: "lot",
  onStock: false, remaining: 0, usages: [], parts: [], expIncl: 0, extra: {}, breakdown: null, editor: null, ...o,
});
const rows = [row("a", { qty: 1, price: 100, rate: 90, totalIncl: 100 }), row("b", { qty: 3, price: 200, rate: 100, totalIncl: 900 })];
const lbl = (id: string) => id;

describe("средневзвешенное", () => {
  it("пустые и нулевые веса дают null", () => {
    expect(weightedAvg([])).toBeNull();
    expect(weightedAvg([{ value: 10, weight: 0 }])).toBeNull();
  });
  it("NaN пропускается, среднее взвешенное, а не простое", () => {
    expect(weightedAvg([{ value: NaN, weight: 1 }, { value: 5, weight: 2 }])).toBe(5);
    expect(weightedAvg([{ value: 10, weight: 1 }, { value: 20, weight: 3 }])).toBe(17.5);
    expect(weightedPercent([{ percent: 10, base: 100 }, { percent: 20, base: 300 }])).toBe(17.5);
  });
  it("safeRatio не делит на ноль и бесконечность", () => {
    expect(safeRatio(5, 0)).toBeNull();
    expect(safeRatio(Infinity, 2)).toBeNull();
    expect(safeRatio(6, 3)).toBe(2);
  });
});

describe("итоги таблицы лотов", () => {
  it("средняя цена и курс взвешены", () => {
    const t = computeTotals(rows, [], () => undefined);
    expect(t.avgPrice).toBe(175); // (100*1+200*3)/4, не простое 150
    expect(t.rateAvg).toBe((90 * 100 + 100 * 600) / 700);
  });
  it("нулевой вес — null, не NaN", () => {
    const z = computeTotals([row("z", { qty: 0, price: 0, rate: 5 })], [{ id: "f", name: "x", type: "NUMBER", position: 0 }], () => 7);
    expect(z.avgPrice).toBeNull();
    expect(z.rateAvg).toBeNull();
    expect(z.custom.f.wavg).toBeNull();
    const empty = computeTotals([], [], () => undefined);
    expect(empty.avgPrice).toBeNull();
    expect(empty.rateAvg).toBeNull();
  });
});

describe("сортировка лотов", () => {
  it("по убыванию количества и без сортировки", () => {
    expect(sortRows(rows, { key: "qty", dir: "desc" }, "incl", () => undefined, lbl).map((r) => r.id)).toEqual(["b", "a"]);
    expect(sortRows(rows, null, "incl", () => undefined, lbl).map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("пустые значения всегда в конце", () => {
    const s = sortRows([row("x", { size: "" }), row("y", { size: "A" })], { key: "size", dir: "desc" }, "incl", () => undefined, lbl);
    expect(s.map((r) => r.id)).toEqual(["y", "x"]);
  });
});
