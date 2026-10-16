// Проверка «к оплате по счёту Веллмеха» для статуса оплаты сырья: чистые правила + реальные расчёты СП 09-26 и SAGA 03-26.
// Живая база только читается (ничего не пишется); без DATABASE_URL проверяются одни чистые правила.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-supplier-invoice-due.ts
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { calcAll, emptyPayload, newId, type CalcPayload } from "../src/lib/supplier-calc";
import { allocateDue, calcInvoiceDue, dueInvoiceKey, type InvoiceDue } from "../src/lib/supplier-invoice-due";
import { PAY_STATE_LABEL, rawPayInfo, type PayLine } from "../src/lib/supplier-pay-core";

let fails = 0, total = 0;
const ok = (c: unknown, m: string) => { total++; if (!c) fails++; console.log(`${c ? "ok  " : "FAIL"} ${m}`); };
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;
const L = (a: number, d = "2026-10-05"): PayLine => ({ kind: "ADVANCE", amount: a, paidAt: new Date(d) });

// ---------- 1. статус от суммы счёта ----------
console.log("== 1. rawPayInfo: допуск, переплата, «нет счёта»");
ok(rawPayInfo(null, []).state === "NOINVOICE" && rawPayInfo(0, []).state === "NOINVOICE", "нет суммы счёта (null / 0) без оплат — «Нет счёта», а не «Не оплачено»");
ok(rawPayInfo(null, [L(500)]).state === "NOINVOICE" && rawPayInfo(null, [L(500)]).paid === 500, "нет суммы счёта, но оплата есть — «Нет счёта», оплата показана");
ok(PAY_STATE_LABEL.NOINVOICE === "Нет счёта", "подпись «Нет счёта»");
ok(rawPayInfo(1000, []).state === "UNPAID", "счёт есть, оплат нет — «Не оплачено»");
ok(rawPayInfo(1000, [L(400)]).state === "PARTIAL", "часть счёта — «Частично»");
ok(rawPayInfo(1000, [L(999.5)]).state === "PAID" && rawPayInfo(1000, [L(999.01)]).state === "PAID", "недоплата меньше 1 ₽ — «Оплачено» (как STATUS_EPS у нас)");
ok(rawPayInfo(1000, [L(998)]).state === "PARTIAL", "недоплата 2 ₽ — «Частично»");
ok(rawPayInfo(1000, [L(1036.13)]).state === "PAID" && rawPayInfo(1000, [L(5000)]).state === "PAID", "переплата — «Оплачено»");

// ---------- 2. сумма счёта из таблицы расчёта ----------
console.log("\n== 2. calcInvoiceDue / allocateDue на синтетическом расчёте");
const mk = (cols: { id: string; title: string; f: string; unit?: string }[]): CalcPayload => {
  const q = emptyPayload("SHEET");
  q.rows = [
    { _id: newId(), invoice: "№ 083", fur: "соболь", size: "", lot: "1", p: "100", n: "10" },
    { _id: newId(), invoice: "83", fur: "соболь", size: "", lot: "2", p: "200", n: "10" },
    { _id: newId(), invoice: "084", fur: "соболь", size: "", lot: "3", p: "50", n: "10" },
  ];
  q.customColumns = [
    { id: "p", letter: "", title: "Цена", unit: "₽", formula: "", kind: "input" },
    { id: "n", letter: "", title: "Количество", unit: "шт", formula: "", kind: "input" },
    ...cols.map((c) => ({ id: c.id, letter: "", title: c.title, unit: c.unit ?? "₽", formula: c.f })),
  ];
  return q;
};
{
  // колонки: A Мех, B Описание, C Лот, D Цена, E Количество, F…
  const unit = { id: "u", title: "Себестоимость за единицу", f: "=D*1,5" };
  const q = mk([unit, { id: "pay", title: "К оплате: аванс 1", f: "=D" }]);
  q.unitCostColumn = "u"; q.qtyColumn = "n";
  const t = calcAll(q);
  const d = calcInvoiceDue(q);
  ok(!!d && d.source === "PAY_COLUMNS", "столбец «К оплате…» найден");
  ok(!!d && near(d.total, 100 + 200 + 50), `к оплате = сумма столбца «К оплате» по строкам (${d?.total}), а не вся себестоимость (${t.totalRub})`);
  ok(!!d && d.calcTotal > d.total, "вся себестоимость расчёта больше суммы счёта");
  ok(!!d && near(d.byInvoice.get("83") ?? 0, 300) && near(d.byInvoice.get("84") ?? 0, 50), "суммы разложены по номерам счетов («№ 083» = «83»)");
  const q2 = mk([unit, { id: "pay", title: "К оплате: аванс 1", f: "=D" }, { id: "tot", title: "Итого к оплате", f: "=D*2" }]);
  q2.unitCostColumn = "u"; q2.qtyColumn = "n";
  const d2 = calcInvoiceDue(q2);
  ok(!!d2 && d2.source === "TOTAL_COLUMN" && near(d2.total, 700), "есть «Итого к оплате» — берётся он один, без сложения с «аванс 1»");
  const q3 = mk([unit]);
  q3.unitCostColumn = "u"; q3.qtyColumn = "n";
  const d3 = calcInvoiceDue(q3);
  ok(!!d3 && d3.source === "CALC_TOTAL" && near(d3.total, calcAll(q3).totalRub), "нет столбца «К оплате» — счёт покрывает весь расчёт");
  ok(dueInvoiceKey("№ 083") === "83" && dueInvoiceKey("0534-002") === "534-002", "ключ номера счёта");
}
{
  const due: InvoiceDue = { total: 600, byInvoice: new Map([["83", 300], ["84", 50], ["", 250]]), source: "PAY_COLUMNS", columns: [], calcTotal: 900 };
  const a = allocateDue(due, [{ id: "a", invoice: "083", weight: 10 }, { id: "b", invoice: "84", weight: 10 }]);
  ok(near(a.get("a")! + a.get("b")!, 600), "строки без номера счёта не теряются: сумма по закупкам = сумма счёта");
  const b = allocateDue(due, [{ id: "a", invoice: "103", weight: 3 }, { id: "b", invoice: "", weight: 1 }]);
  ok(near(b.get("a")!, 450) && near(b.get("b")!, 150), "номера не нашлись — сумма делится по весу");
  const c = allocateDue(due, [{ id: "a", invoice: "83", weight: 1 }, { id: "b", invoice: "83", weight: 3 }]);
  ok(near(c.get("a")! + c.get("b")!, 600) && near(c.get("a")!, 150), "два счёта с одним номером делят его сумму, ничего не удваивается");
}

// ---------- 3. реальные данные (только чтение) ----------
(async () => {
  if (!process.env.DATABASE_URL) { console.log("\n(нет DATABASE_URL — раздел с реальными данными пропущен)"); return; }
  console.log("\n== 3. Реальные расчёты (чтение): СП 09-26 и SAGA 03-26");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.supplierInbox.findMany({ where: { kind: "AUCTION_CALC", status: "ACCEPTED", OR: [{ title: { startsWith: "СП 09-26" } }, { title: { startsWith: "SAGA 03-26" } }] }, select: { title: true, payload: true, createdEntityId: true } });
    const sp = rows.find((r) => r.title.startsWith("СП 09-26")), saga = rows.find((r) => r.title.startsWith("SAGA 03-26"));
    if (!sp || !saga) { console.log("(расчётов СП 09-26 / SAGA 03-26 в этой базе нет — раздел пропущен)"); return; }
    const dSp = calcInvoiceDue(sp.payload as unknown as CalcPayload)!;
    const dSaga = calcInvoiceDue(saga.payload as unknown as CalcPayload)!;
    // СП 09-26: счёт Веллмеха № 271 на 60 831 100,00; в расчёте «К оплате: аванс 1» = 60 831 063,87 (счёт округлён)
    ok(dSp.source === "PAY_COLUMNS" && /к оплате/i.test(dSp.columns[0]), "СП 09-26: сумма берётся из столбца «К оплате: аванс 1»");
    ok(Math.abs(dSp.total - 60831100) < 50, `СП 09-26: к оплате по счёту ${dSp.total.toFixed(2)} ≈ счёт № 271 (60 831 100,00)`);
    ok(near(dSp.calcTotal - dSp.total, 3627086.53, 1), `СП 09-26: вне счёта осталось ${(dSp.calcTotal - dSp.total).toFixed(2)} ₽ (брокерские 2 090 077,54 + выделка 1 511 589,00 + перевозка 25 420,00)`);
    ok(rawPayInfo(dSp.total, [L(60831100)]).state === "PAID", "СП 09-26: оплата счёта № 271 (60 831 100,00, переплата 36 ₽ на округление) — «Оплачено»");
    ok(rawPayInfo(dSp.total, []).state === "UNPAID" && rawPayInfo(dSp.total, [L(30000000)]).state === "PARTIAL", "СП 09-26: без оплаты «Не оплачено», с половиной «Частично»");
    // «до»: вся себестоимость 64 458 150,40 → оплата 60 831 100 давала «Частично»
    ok(rawPayInfo(dSp.calcTotal, [L(60831100)]).state === "PARTIAL", "СП 09-26 «до» исправления: против себестоимости 64 458 150,40 было «Частично»");
    // SAGA 03-26: УПД = «Всего в руб.»; оплаты 1–3 (Оплата 1/2/3 в файле) 49 472 300, переплата 83 875,37 числится зачётом
    ok(dSaga.source === "CALC_TOTAL", "SAGA 03-26: столбца «К оплате» нет — счёт покрывает весь расчёт («Всего в руб.»)");
    ok(near(dSaga.total, 49388424.63, 0.01), `SAGA 03-26: к оплате по счёту ${dSaga.total.toFixed(2)}`);
    ok(rawPayInfo(dSaga.total, [L(24200000), L(22891800), L(2380500)]).state === "PAID", "SAGA 03-26: оплаты 24 200 000 + 22 891 800 + 2 380 500 — «Оплачено» (переплата 83 875,37)");
    ok(rawPayInfo(dSaga.total, [L(24200000), L(22891800)]).state === "PARTIAL", "SAGA 03-26: только аванс 1 и 2 — «Частично» (не хватает 2 296 624,63)");
  } finally { await prisma.$disconnect(); }
})().finally(() => { console.log(`\n${total - fails}/${total}${fails ? ` — ПРОВАЛЕНО ${fails}` : " — всё сошлось"}`); process.exit(fails ? 1 : 0); });
