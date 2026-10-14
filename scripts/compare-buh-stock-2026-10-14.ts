/**
 * ТОЛЬКО ЧТЕНИЕ. Сверка ОСВ бухгалтерии по сч. 10.01 «Склад (Мех)» на 14.10.2026 с лотами системы.
 * Вход: JSON из xls (scratchpad/buh.json): name, art, inD, outC, endD, q_in, q_out, q_end.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/compare-buh-stock-2026-10-14.ts <buh.json>
 */
import "./stubs/server-only-shim";
import { readFileSync } from "fs";
type B = { name: string; art: string; inD: number | ""; outC: number | ""; endD: number | ""; q_in: number | ""; q_out: number | ""; q_end: number | "" };
const n = (x: number | "") => (x === "" ? 0 : x);
const r2 = (x: number) => Math.round(x * 100) / 100;
async function main() {
  const buh: B[] = JSON.parse(readFileSync(process.argv[2], "utf8")).slice(1).map((x: B) => x);
  const { prisma } = await import("../src/lib/prisma");
  const lots = await prisma.rawMaterialLot.findMany({ include: { rawMaterial: { select: { name: true } } } });
  const key = (name: string, art: string) => {
    const m = name.match(/лот\s+([A-Za-zА-Яа-я0-9.]+)/i);
    if (m) return m[1];
    const t = name.match(/ткань\s+№?\s*([\d/]+)/i);
    if (t) return "T" + t[1].replace(/^0+/, "");
    return art || name;
  };
  const ours = new Map<string, { n: string; rec: number; rem: number; cost: number; costIncl: number }>();
  for (const l of lots) {
    const nm = l.rawMaterial.name;
    const k = /ткань/i.test(nm) ? "T" + ((nm.match(/№\s*([\d/]+)/)?.[1] ?? "").replace(/^0+/, "")) : l.lotNumber ?? nm;
    const rem = Number(l.quantityRemaining);
    const e = ours.get(k) ?? { n: nm, rec: 0, rem: 0, cost: 0, costIncl: 0 };
    e.rec += Number(l.quantityReceived); e.rem += rem;
    e.costIncl += rem * Number(l.unitCost);
    e.cost += (rem * Number(l.unitCost) * 100) / (100 + Number(l.vatRate));
    ours.set(k, e);
  }
  // Строки ОСВ: ключ → наша запись; потом по неоставшимся — подбор по приходу/остатку/сумме.
  const items = buh.filter((b) => b.name !== "Итого" && !/^Итого/.test(b.name));
  const used = new Set<string>();
  const pairs: { b: B; k: string; how: string }[] = [];
  const left: B[] = [];
  for (const b of items) {
    const k = key(b.name, b.art);
    if (ours.has(k) && !used.has(k)) { used.add(k); pairs.push({ b, k, how: "ключ" }); } else left.push(b);
  }
  const left2: B[] = [];
  for (const b of left) {
    const cand = [...ours.entries()].filter(([k, o]) => !used.has(k) && Math.abs(o.rec - n(b.q_in)) < 0.01 && Math.abs(o.rem - n(b.q_end)) < 0.01 && Math.abs(o.cost - n(b.endD)) <= Math.max(5, n(b.endD) * 0.005));
    if (cand.length >= 1) { used.add(cand[0][0]); pairs.push({ b, k: cand[0][0], how: "по количеству и сумме" }); } else left2.push(b);
  }
  const rows: string[] = [];
  let sumB = 0, sumO = 0, sumQB = 0, sumQO = 0;
  for (const { b, k, how } of pairs) {
    const o = ours.get(k)!;
    sumB += n(b.endD); sumO += o.cost; sumQB += n(b.q_end); sumQO += o.rem;
    const dq = r2(o.rem - n(b.q_end)), dr = r2(o.rec - n(b.q_in)), dc = r2(o.cost - n(b.endD));
    if (dq || dr || Math.abs(dc) > 10) rows.push(`РАЗНИЦА [${how}] ${b.name.slice(0, 55)} ↔ ${k} | приход нас ${o.rec} / бух ${n(b.q_in)} | остаток нас ${o.rem} / бух ${n(b.q_end)} (${dq}) | ₽ без НДС нас ${r2(o.cost)} / бух ${n(b.endD)} (${dc})`);
  }
  for (const b of left2) { sumB += n(b.endD); sumQB += n(b.q_end); if (n(b.q_end) || n(b.endD)) rows.push(`ТОЛЬКО У БУХГ: ${b.name.slice(0, 80)} | остаток ${n(b.q_end)} шт., ${n(b.endD)} ₽ (приход ${n(b.q_in)})`); }
  for (const [k, o] of ours) if (!used.has(k) && (o.rem || o.cost > 1)) { sumO += o.cost; sumQO += o.rem; rows.push(`ТОЛЬКО У НАС: ${k} ${o.n} | остаток ${o.rem}, ${r2(o.cost)} ₽ без НДС`); }
  console.log(rows.join("\n"));
  console.log(`\nпар ${pairs.length} (по ключу ${pairs.filter((p) => p.how === "ключ").length}); бух строк ${items.length}; остаток шт. бух ${r2(sumQB)} / наш ${r2(sumQO)}; ₽ бух ${r2(sumB)} / наш ${r2(sumO)}`);
}
main().then(() => process.exit(0));
