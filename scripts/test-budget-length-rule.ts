// Правило длин бюджета: разбивка остаётся, только если по каждой длине есть свои данные; иначе — итог по категории.
import { blankNode, collapseUnknownLengths, DEFAULT_PARAMS, type BudgetStat } from "../src/lib/budget-calc";
let fails = 0;
const eq = (what: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? "ОК " : "НЕТ"} ${what}: ${JSON.stringify(got)}${ok ? "" : ` (ждали ${JSON.stringify(want)})`}`); };
const st = (key: string, fur: string, cat: string, qty: number, h: number, len?: string): BudgetStat => ({ key, fur, cat, qty, orders: 3, hidesPer: h, hidePrice: 10000, metersPer: 1, meterPrice: 4000, workPer: 100000, len });
const stats: BudgetStat[] = [st("Лиса|Шубы", "Лиса", "Шубы", 18, 8.6), st("Лиса|Шубы|len:Short", "Лиса", "Шубы", 18, 8.6, "Short"), st("Соболь|Шубы", "Соболь", "Шубы", 30, 60), st("Соболь|Шубы|len:Short", "Соболь", "Шубы", 17, 55, "Short"), st("Соболь|Шубы|len:Long", "Соболь", "Шубы", 13, 94, "Long")];
const fur = (n: string) => blankNode("fur", null, n, { id: "f-" + n });
const f1 = fur("Лиса"), c1 = blankNode("cat", f1.id, "Шубы", { id: "c1", pcs: 70 }), l1 = blankNode("len", c1.id, "Short", { id: "l1", pcs: 55, src: "len", sample: 18 }), l2 = blankNode("len", c1.id, "Long", { id: "l2", pcs: 15, src: "pair", sample: 18 });
const f2 = fur("Соболь"), c2 = blankNode("cat", f2.id, "Шубы", { id: "c2", pcs: 40 }), m1 = blankNode("len", c2.id, "Short", { id: "m1", pcs: 25, src: "len", sample: 17 }), m2 = blankNode("len", c2.id, "Long", { id: "m2", pcs: 15, src: "len", sample: 13 });
const r = collapseUnknownLengths([f1, c1, l1, l2, f2, c2, m1, m2], stats, DEFAULT_PARAMS);
eq("свёрнута только лиса", r.collapsed, ["c1"]);
eq("лиса: длин нет", r.nodes.filter((n) => n.parentId === "c1").length, 0);
eq("лиса: штуки сложены", r.nodes.find((n) => n.id === "c1")!.pcs, 70);
eq("лиса: шкур по категории", Math.round(r.nodes.find((n) => n.id === "c1")!.hides * 10) / 10, 8.6);
eq("соболь: обе длины остались", r.nodes.filter((n) => n.parentId === "c2").map((n) => n.name), ["Short", "Long"]);
console.log(fails ? `ПРОВАЛОВ: ${fails}` : "Все проверки пройдены"); process.exitCode = fails ? 1 : 0;
