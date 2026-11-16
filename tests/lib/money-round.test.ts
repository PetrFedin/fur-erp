// Перенос свойств функций из scripts/test-rounding-rule.ts (раздел 1, без боевых данных): правило округления «вариант Б».
// Суммы считаются точно; на экране итог = round(точной суммы), а показанные части складываются в итог ровно до рубля.
import { describe, expect, it } from "vitest";
import { alignFlowMoney, alignKindsTop, alignSet, cellOf, lrAllocate, roundRub } from "@/lib/money-round";

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
function rnd(seed: number) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

describe("округление денег на экране", () => {
  it("случайные числа: части складываются в итог, строки — в итог, куплено = использовано + остаток", () => {
    const r = rnd(7);
    for (let it = 0; it < 3000; it++) {
      const n = 1 + Math.floor(r() * 12);
      const vals = Array.from({ length: n }, () => (r() < 0.15 ? 0 : (r() - 0.1) * 10 ** (1 + Math.floor(r() * 8))));
      const tot = roundRub(sum(vals));
      const al = lrAllocate(vals, tot);
      expect(sum(al)).toBe(tot);
      al.forEach((v, i) => expect(Math.abs(v - vals[i])).toBeLessThanOrEqual(2));
      const cells = Array.from({ length: n }, () => { const u = r() * 1e6, m = r() * 1e6; return cellOf({ r: u + m, u, m, p: r() * 1e5, d: r() * 1e4 }); });
      const a = alignSet(cells);
      for (const k of ["r", "u", "m", "p", "d"] as const) expect(sum(a.parts.map((c) => c[k]))).toBe(a.total[k]);
      a.parts.forEach((c) => expect(c.r).toBe(c.u + c.m));
      expect(a.total.r).toBe(a.total.u + a.total.m);
      expect(a.total.r).toBe(roundRub(sum(cells.map((c) => c.r))));
    }
  });

  it("повторное выравнивание целых ничего не меняет; пример владельца", () => {
    const f = { recvValue: 583498701.742578, usedValue: 193989744.63, usedValueOther: 187113975.27, remValue: 396384726.47257805 };
    const once = alignFlowMoney(f, true), twice = alignFlowMoney(once, true);
    expect(twice.recvValue).toBe(once.recvValue);
    expect(twice.remValue).toBe(once.remValue);
    expect(once.recvValue).toBe(583498702);
    expect(once.usedValueOther + once.remValue).toBe(once.recvValue);
  });

  it("подкладка и мех + подкладка = всего", () => {
    const lin = alignFlowMoney({ recvValue: 6820117.5, usedValue: 1884758.38, usedValueOther: 1812769.75, remValue: 5007347.75 }, true);
    expect(lin.usedValueOther + lin.remValue).toBe(lin.recvValue);
    const top = alignKindsTop(cellOf({ r: 583498701.742578, u: 187113975.27, m: 396384726.47257805 }), cellOf({ r: 6820117.5, u: 1812769.75, m: 5007347.75 }));
    expect(top.fur.r + top.lin.r).toBe(top.all.r);
    expect(top.all.r).toBe(590318819);
  });
});
