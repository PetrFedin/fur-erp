// Проверки чистых функций средневзвешенного и сортировки: npx tsx scripts/test-weighted.ts
import assert from "node:assert/strict";
import { safeRatio, weightedAvg, weightedPercent } from "../src/lib/weighted";
import { computeTotals, sortRows, type LotRow } from "../src/lib/lot-table";

assert.equal(weightedAvg([]), null);
assert.equal(weightedAvg([{ value: 10, weight: 0 }]), null);
assert.equal(weightedAvg([{ value: NaN, weight: 1 }, { value: 5, weight: 2 }]), 5);
assert.equal(weightedAvg([{ value: 10, weight: 1 }, { value: 20, weight: 3 }]), 17.5); // не 15
assert.equal(weightedPercent([{ percent: 10, base: 100 }, { percent: 20, base: 300 }]), 17.5);
assert.equal(safeRatio(5, 0), null);
assert.equal(safeRatio(Infinity, 2), null);
assert.equal(safeRatio(6, 3), 2);

const row = (id: string, o: Partial<LotRow>): LotRow => ({
  id, purchaseId: "p1", materialId: "m", material: "Соболь", lotNumber: id, size: "", op: "", qty: 0, unit: "шт.", price: 0,
  currency: "USD", rate: 1, unitIncl: 0, unitExcl: 0, totalIncl: 0, totalExcl: 0, priceIncl: 0, priceExcl: 0, source: "lot",
  onStock: false, remaining: 0, usages: [], parts: [], expIncl: 0, extra: {}, breakdown: null, editor: null, ...o,
});
const rows = [row("a", { qty: 1, price: 100, rate: 90, totalIncl: 100 }), row("b", { qty: 3, price: 200, rate: 100, totalIncl: 900 })];
const t = computeTotals(rows, [], () => undefined);
assert.equal(t.avgPrice, 175); // (100*1+200*3)/4, не простое 150
assert.equal(t.rateAvg, (90 * 100 + 100 * 600) / 700); // вес — сумма закупки в валюте
const z = computeTotals([row("z", { qty: 0, price: 0, rate: 5 })], [{ id: "f", name: "x", type: "NUMBER", position: 0 }], () => 7);
assert.equal(z.avgPrice, null);
assert.equal(z.rateAvg, null);
assert.equal(z.custom.f.wavg, null); // нулевой вес — не NaN и не простое среднее
const empty = computeTotals([], [], () => undefined);
assert.equal(empty.avgPrice, null);
assert.equal(empty.rateAvg, null);

const lbl = (id: string) => id;
const s1 = sortRows(rows, { key: "qty", dir: "desc" }, "incl", () => undefined, lbl);
assert.deepEqual(s1.map((r) => r.id), ["b", "a"]);
assert.deepEqual(sortRows(rows, null, "incl", () => undefined, lbl).map((r) => r.id), ["a", "b"]);
// пустые значения — всегда в конце
const s2 = sortRows([row("x", { size: "" }), row("y", { size: "A" })], { key: "size", dir: "desc" }, "incl", () => undefined, lbl);
assert.deepEqual(s2.map((r) => r.id), ["y", "x"]);
console.log("ok");
