// Перенос scripts/test-calc-presets.ts: форматы расчёта пересчитываются по контрольным строкам из реальных файлов до копейки.
import { describe, expect, it } from "vitest";
import { PRESETS, checkPreset, payloadFromPreset } from "@/lib/calc-presets";
import { calcAll } from "@/lib/supplier-calc";

describe("форматы расчёта (calc-presets.json)", () => {
  it("форматы есть", () => expect(PRESETS.length).toBeGreaterThan(0));
  it.each(PRESETS.map((p) => [p.id, p] as const))("%s: формулы без ошибок, контрольные значения сходятся", (_id, pr) => {
    const r = checkPreset(pr);
    const c = calcAll(payloadFromPreset(pr));
    expect(Object.entries(c.sheet.colErrors)).toEqual([]);
    expect(r.lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
