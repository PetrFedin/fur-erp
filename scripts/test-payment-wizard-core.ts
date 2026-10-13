/**
 * Правила предложения разнесения мастера оплаты (чистые функции, без БД):
 *   node --conditions=react-server node_modules/.bin/tsx scripts/test-payment-wizard-core.ts
 * Случаи взяты из реальных оплат Веллмех / Меркури Мода (счета №83, №197, №117 двух лет, партия 3, «34 ед.»).
 */
import { orderRefsOf, suggestSupplierAlloc, suggestWorkAlloc, normRef, type SupTarget, type WorkTarget } from "../src/lib/payment-wizard-core";

let fails = 0;
const ok = (c: unknown, m: string) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) fails++; };
const sup = (key: string, total: number, paid: number, refs: string[], date = "2026-01-01"): SupTarget => ({ key, label: key, supplierIds: ["s"], totalCents: total * 100, paidCents: paid * 100, refs: refs.map(normRef), date });
const wk = (id: string, num: string, batch: number | null, work: number, paid = 0): WorkTarget => ({ id, label: "ТЗ " + num, clientId: "c", batch, workCents: work * 100, paidCents: paid * 100, refs: [normRef(num), normRef("П-2026-0" + id)] });

// ТЗ называются только явно
ok([...orderRefsOf("Доплата за пошив, партия 3 (34 ед.), счёт №181")].length === 0, "голые числа («34 ед.», «№181») ТЗ не называют");
ok([...orderRefsOf("ТЗ 97–100 и 105, заказ 7")].sort().join() === ["100", "105", "7", "97", "98", "99"].sort().join(), "диапазон «ТЗ 97–100», список и «заказ N»");
ok(orderRefsOf("П-2026-0183").has(normRef("П-2026-0183")), "системный номер П-2026-…");

// «34 ед.» не должно подтягивать ТЗ 34, партия делится пропорционально работе
const batch3 = [wk("1", "24", 3, 300), wk("2", "34", 3, 100), wk("3", "81", 9, 500)];
const r1 = suggestWorkAlloc(200 * 100, batch3, "Доплата за пошив, партия 3 (34 ед.)");
ok(r1.parts.length === 2 && r1.parts.find((p) => p.id === "1")!.cents === 150 * 100 && r1.parts.find((p) => p.id === "2")!.cents === 50 * 100, "партия 3: пропорционально работе, ТЗ 81 из партии 9 не тронут");
const r2 = suggestWorkAlloc(60 * 100, [wk("1", "10", 1, 100), wk("2", "11", 1, 200)], "Аванс 70%, ТЗ 10, 11");
ok(r2.parts.find((p) => p.id === "1")!.cents === 20 * 100 && r2.parts.find((p) => p.id === "2")!.cents === 40 * 100 && r2.restCents === 0, "несколько названных ТЗ — пропорционально работе");
const r3 = suggestWorkAlloc(500 * 100, [wk("1", "10", 1, 100, 30)], "ТЗ 10");
ok(r3.parts[0].cents === 70 * 100 && r3.restCents === 430 * 100, "остаток по работе = работа − разнесено, лишнее не разнесено (4% в расчёте не участвует)");

// поставщик
const a = sup("a:РП 04.26", 8_000_000, 2_000_000, ["4085", "117@2026"], "2026-04-22");
const b = sup("a:СП 05.26", 3_000_000, 1_000_000, ["2020", "117@2026"], "2026-05-20");
const old = sup("a:КФХ 07.25", 3_488_644, 3_488_644, ["117@2025"], "2025-07-29");
const s1 = suggestSupplierAlloc(2_000_000 * 100, [a, b, old], "счёт Веллмех №117 от 13.04.2026");
ok(s1.parts.length === 2 && !s1.parts.some((p) => p.key === "a:КФХ 07.25") && Math.abs(s1.parts.reduce((s, p) => s + p.cents, 0) - 2_000_000 * 100) <= 1, "счёт №117 за 2026 не уходит на аукцион за 2025; делится между двумя аукционами");
ok(s1.hint?.includes("нескольким аукционам"), "для счёта на несколько аукционов есть пояснение");
const s2 = suggestSupplierAlloc(500_000 * 100, [a, b], "счёт Веллмех №999");
ok(s2.parts.length === 0 && s2.restCents === 500_000 * 100 && !!s2.hint, "документ из основания не найден — не угадываем «самый старый», вся сумма авансом с пояснением");
const s3 = suggestSupplierAlloc(500_000 * 100, [a, b, sup("a:хвост", 100, 0, [], "2020-01-01")], "");
ok(s3.parts[0]?.key === "a:РП 04.26", "пустое основание: самый старый остаток, хвост 100 ₽ пропущен");
const s4 = suggestSupplierAlloc(5_400_000 * 100, [sup("a:П", 5_344_405, 0, ["157"])], "счёт №157");
ok(s4.parts[0].cents === 5_344_405 * 100 && s4.restCents === 55_595 * 100 && !!s4.hint?.includes("Сумма больше остатка"), "платёж больше остатка цели: разница авансом с пояснением");
console.log(fails ? `ПРОВАЛЕНО: ${fails}` : "все проверки пройдены");
process.exit(fails ? 1 : 0);
