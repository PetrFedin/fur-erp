/**
 * Проверка разнесения оплат производства по ТЗ на КОПИИ БД (scratch). Отказывается работать, если в адресе нет «alloc_test».
 *
 *   BASE=postgresql://fur_erp:<пароль>@localhost:5436        # сервер из DATABASE_URL (.env)
 *   psql "$BASE/postgres" -c 'create database fur_erp_alloc_test'
 *   pg_dump --no-owner "$DATABASE_URL" | psql -q "$BASE/fur_erp_alloc_test"
 *   ALLOC_TEST_URL=$BASE/fur_erp_alloc_test node --env-file=.env node_modules/.bin/tsx scripts/test-payment-allocation.ts
 *   psql "$BASE/postgres" -c 'drop database fur_erp_alloc_test'
 *
 * Проверяется: чистая арифметика (Σ = сумме, потолки, копейки); планировщик; скрипт allocate-production-payments (сухой прогон,
 * применение, идемпотентность, откат; долг заказчиков не меняется); авторазнесение при создании/правке платежа; ручное разнесение
 * (Σ <= платежа, превышение работы — по подтверждению); изоляция организаций.
 */
import Module from "module";
import { join } from "path";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";

const url = process.env.ALLOC_TEST_URL ?? "";
if (!url.includes("alloc_test")) {
  console.error("Задайте ALLOC_TEST_URL на scratch-базу (имя содержит alloc_test).");
  process.exit(2);
}
process.env.DATABASE_URL = url;
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
const stub = (n: string) => join(__dirname, "stubs", n);
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return stub("empty.js");
  if (req === "next/cache") return stub("next-cache.js");
  if (req === "next/navigation") return stub("next-navigation.js");
  if (req === "@/lib/session") return stub("session-stub.js");
  return orig.call(this, req, ...rest);
};
type G = { __TEST_SESSION?: unknown };
const as = (role: string, organizationId: string) => {
  (globalThis as G).__TEST_SESSION = { user: { id: "u-test", role, organizationId, name: "Тест" } };
};
const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
let fails = 0;
const ok = (c: unknown, m: string) => {
  console.log(`${c ? "ok  " : "FAIL"} ${m}`);
  if (!c) fails++;
};
const errOf = (r: unknown) => ((r as { error?: string } | undefined)?.error ?? "");

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const core = await import("../src/lib/payment-alloc-core");
  const A = await import("../src/lib/payment-alloc");
  const PR = await import("../src/app/(app)/production/actions");
  const MK = await import("../src/app/(app)/production/mark-actions");
  const { toCents, fromCents, splitByWeights, checkAllocation } = core;

  // ---------- 1. Чистая арифметика ----------
  {
    const items = [{ id: "a", weight: 100, cap: 100 }, { id: "b", weight: 200, cap: 200 }, { id: "c", weight: 300, cap: 300 }];
    const s = splitByWeights(100, items);
    ok([...s.values()].reduce((x, y) => x + y, 0) === 100, "split: Σ долей = сумме (100 коп. на 3 ТЗ)");
    const big = splitByWeights(10_000, items);
    ok([...big.values()].reduce((x, y) => x + y, 0) === 600 && big.get("c") === 300, "split: сумма больше Σпотолков — каждый получает потолок, остаток не раздаётся");
    const capped = splitByWeights(500, [{ id: "a", weight: 1, cap: 10 }, { id: "b", weight: 1, cap: 1000 }]);
    ok(capped.get("a") === 10 && capped.get("b") === 490, "split: упёршийся в потолок отдаёт излишек остальным");
    ok(splitByWeights(100, [{ id: "a", weight: 0, cap: 100 }]).size === 0, "split: нулевой вес — ничего не делится");
    ok(checkAllocation(1000, [{ orderId: "a", amountCents: 600 }, { orderId: "b", amountCents: 500 }]) !== null, "check: Σ > платежа отклоняется");
    ok(checkAllocation(1000, [{ orderId: "a", amountCents: 600 }, { orderId: "b", amountCents: 400 }]) === null, "check: Σ = платежу допустима");
    ok(checkAllocation(1000, [{ orderId: "a", amountCents: 100 }, { orderId: "a", amountCents: 100 }]) !== null, "check: одно ТЗ дважды отклоняется");
    ok(checkAllocation(1000, [{ orderId: "a", amountCents: 0 }]) !== null, "check: нулевая сумма отклоняется");
    ok(toCents("1234.56") === 123456 && fromCents(123456) === "1234.56", "копейки: туда-обратно");
    // планировщик: два платежа на два ТЗ — второй добирает остаток, потолок работы не превышен
    const orders = new Map([["x", { id: "x", workCents: 1000, live: true }], ["y", { id: "y", workCents: 3000, live: true }]]);
    const plan = A.planAutoAllocations(
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
    ok(plan[0].paymentId === "p1" && sum("p1") === 2000 && sum("p2") === 2000 && plan.find((r) => r.paymentId === "p2")!.unallocatedCents === 1000, "план: платежи по порядку оплаты, второй получает остаток работы 2000 из 3000");
    ok(perOrder("x") <= 1000 && perOrder("y") <= 3000, "план: на ТЗ не больше работы");
    ok(plan.find((r) => r.paymentId === "p3")!.unallocatedCents === 500, "план: платёж без ТЗ целиком — неразнесённый аванс");
  }

  // ---------- Подготовка: боевая копия, разнесение сброшено ----------
  const org = await prisma.organization.findFirstOrThrow();
  const orgId = org.id;
  await prisma.paymentAllocation.deleteMany({});
  const debtOf = async (id = orgId) => (await A.loadClientDebt(prisma, id, { year: "all" }));
  const base = await debtOf();
  ok(Math.abs(base.balance - 3377754.61) < 0.005, `исходный долг заказчиков без фильтров = 3 377 754,61 (получено ${base.balance})`);

  // ---------- 2. Скрипт allocate-production-payments ----------
  const out = mkdtempSync(join(tmpdir(), "alloc-"));
  const run = (...args: string[]) =>
    execFileSync("node", ["--env-file=.env", "node_modules/.bin/tsx", "scripts/allocate-production-payments.ts", ...args], {
      env: { ...process.env, DATABASE_URL: url, ALLOC_OUT_DIR: out }, encoding: "utf8", cwd: join(__dirname, ".."),
    });
  const nAlloc = () => prisma.paymentAllocation.count();
  run();
  ok((await nAlloc()) === 0, "сухой прогон: БД не изменена");
  const o1 = run("--apply", "--no-backup");
  const n1 = await nAlloc();
  ok(n1 > 0 && /Применено/.test(o1), `--apply: создано ${n1} строк`);
  const d1 = await debtOf();
  ok(Math.abs(d1.balance - base.balance) < 0.005, "после --apply долг заказчиков не изменился");
  ok(d1.allocated > 0 && Math.abs(d1.allocated + d1.unallocated - d1.paid) < 0.005, "разнесено + неразнесённые = оплачено");
  // правило Σ <= сумма платежа и потолок работы по ТЗ
  const pays = await prisma.productionPayment.findMany({ include: { allocations: true } });
  ok(pays.every((p) => p.allocations.reduce((s, a) => s + toCents(a.amount), 0) <= toCents(p.amount)), "Σ разнесений каждого платежа <= суммы платежа");
  const ords = await prisma.productionOrder.findMany({ include: { payShares: true } });
  ok(ords.every((o) => o.payShares.reduce((s, a) => s + toCents(a.amount), 0) <= A.orderWorkCents(o) + 1), "разнесено на ТЗ не больше его работы");
  const o2 = run("--apply", "--no-backup");
  ok((await nAlloc()) === n1 && /Нечего применять/.test(o2), "повторный --apply идемпотентен (0 новых строк)");
  const jr = JSON.parse(readFileSync(join(out, "corrections-journal-payment-allocation.json"), "utf8"));
  ok(jr.status === "applied" && jr.created.length === n1, "журнал: статус applied и id всех созданных строк");
  // ручная строка не откатывается скриптом
  const someAlloc = await prisma.paymentAllocation.findFirstOrThrow();
  await prisma.paymentAllocation.update({ where: { id: someAlloc.id }, data: { source: "MANUAL" } });
  run("--rollback");
  ok((await nAlloc()) === 1, "--rollback удаляет только авто-строки из журнала (ручная осталась)");
  ok(Math.abs((await debtOf()).balance - base.balance) < 0.005, "после отката долг заказчиков не изменился");
  await prisma.paymentAllocation.deleteMany({});
  ok(existsSync(join(out, "payment-allocation-report.md")), "отчёт записан");
  run("--apply", "--no-backup");

  // ---------- 3. Авторазнесение при создании платежа ----------
  const client = await prisma.client.findFirstOrThrow({ where: { organizationId: orgId } });
  const free = await prisma.productionOrder.findMany({
    where: { organizationId: orgId, clientId: client.id, status: { not: "CANCELLED" }, clientWorkPricePerUnit: { not: null }, payShares: { none: {} } },
    take: 3, orderBy: { createdAt: "asc" },
  });
  ok(free.length === 3, `есть 3 ТЗ без оплат для проверки (найдено ${free.length})`);
  const work = free.map((o) => A.orderWorkCents(o));
  const sumWork = work.reduce((a, b) => a + b, 0);
  as("OWNER", orgId);
  const half = Math.floor(sumWork / 2);
  let r = await PR.addProductionPayment(free[0].id, fd({ amount: fromCents(half), paymentType: "PARTIAL", method: "BANK_TRANSFER", paidAt: "2026-09-01", orderIds: free.slice(1).map((o) => o.id) }));
  ok(!errOf(r), "addProductionPayment создал платёж на 3 ТЗ " + errOf(r));
  const pay = await prisma.productionPayment.findFirstOrThrow({ where: { organizationId: orgId, paidAt: new Date("2026-09-01") }, include: { allocations: true, orders: true } });
  const sA = pay.allocations.reduce((s, a) => s + toCents(a.amount), 0);
  ok(pay.orders.length === 3 && pay.allocations.length === 3 && sA === half, "платёж разнесён по 3 ТЗ, Σ = сумме платежа");
  ok(pay.allocations.every((a) => a.source === "AUTO"), "строки помечены AUTO");
  const ratio = free.map((o, i) => (toCents(pay.allocations.find((a) => a.productionOrderId === o.id)!.amount) / half) - work[i] / sumWork);
  ok(ratio.every((x) => Math.abs(x) < 0.0001), "доли пропорциональны работе ТЗ");
  // платёж больше всей работы набора → потолок, остаток неразнесён
  r = await PR.addProductionPayment(free[0].id, fd({ amount: fromCents(sumWork * 2), paymentType: "FINAL", method: "BANK_TRANSFER", paidAt: "2026-09-02", orderIds: free.slice(1).map((o) => o.id) }));
  const pay2 = await prisma.productionPayment.findFirstOrThrow({ where: { organizationId: orgId, paidAt: new Date("2026-09-02") }, include: { allocations: true } });
  const s2 = pay2.allocations.reduce((s, a) => s + toCents(a.amount), 0);
  ok(s2 === sumWork - half, `второй платёж: разнесено только остаток работы набора (${fromCents(s2)} из ${fromCents(sumWork * 2)})`);
  const after = await prisma.productionOrder.findMany({ where: { id: { in: free.map((o) => o.id) } }, include: { payShares: true } });
  ok(after.every((o, i) => o.payShares.reduce((s, a) => s + toCents(a.amount), 0) === A.orderWorkCents(free.find((f) => f.id === o.id)!)), "потолок: по каждому ТЗ разнесено ровно его работа, не больше");
  const unal = await A.loadUnallocatedPayments(prisma, orgId);
  ok(unal.some((u) => u.id === pay2.id && Math.abs(u.rest.toNumber() - (sumWork * 2 - s2) / 100) < 0.005), "остаток второго платежа виден как неразнесённый");

  // ---------- 4. Правка платежа ----------
  const ppRow = await prisma.productionPayment.findFirstOrThrow({ where: { id: pay.id } });
  r = await PR.updateProductionPayment(free[0].id, pay.id, fd({ amount: fromCents(half + 10000), paymentType: "PARTIAL", method: "BANK_TRANSFER", paidAt: "2026-09-01", orderIds: free.map((o) => o.id) }));
  const pAfter = await prisma.productionPayment.findFirstOrThrow({ where: { id: pay.id }, include: { allocations: true } });
  ok(!errOf(r) && pAfter.allocations.reduce((s, a) => s + toCents(a.amount), 0) <= toCents(pAfter.amount), "правка суммы пересчитывает AUTO-разнесение, Σ <= платежа " + errOf(r));
  // убрали ТЗ из набора — его строка снимается
  r = await PR.updateProductionPayment(free[0].id, pay.id, fd({ amount: fromCents(half), paymentType: "PARTIAL", method: "BANK_TRANSFER", paidAt: "2026-09-01", orderIds: [free[0].id, free[1].id] }));
  const pAfter2 = await prisma.productionPayment.findFirstOrThrow({ where: { id: pay.id }, include: { allocations: true } });
  ok(!pAfter2.allocations.some((a) => a.productionOrderId === free[2].id), "ТЗ убрано из набора — его разнесение снято");
  void ppRow;

  // ---------- 5. Ручное разнесение ----------
  const lines = (arr: [string, number][]) => JSON.stringify(arr.map(([orderId, c]) => ({ orderId, amount: fromCents(c) })));
  const amt = toCents(pAfter2.amount);
  r = await MK.saveProductionPaymentAllocation(pay.id, fd({ lines: lines([[free[0].id, amt], [free[1].id, 100]]) }));
  ok(/больше суммы платежа/.test(errOf(r)), "ручное: Σ > платежа отклонено: " + errOf(r));
  r = await MK.saveProductionPaymentAllocation(pay.id, fd({ lines: lines([[free[0].id, 100], [free[0].id, 100]]) }));
  ok(errOf(r) !== "", "ручное: одно ТЗ дважды отклонено");
  // превышение работы ТЗ: платёж pay2 (2×работа набора) — на ТЗ №1 больше его свободной работы
  r = await MK.saveProductionPaymentAllocation(pay2.id, fd({ lines: lines([[free[0].id, work[0] + 500]]) }));
  ok(/больше работы/.test((r as { confirm?: string }).confirm ?? ""), "ручное: превышение работы ТЗ просит подтверждение");
  ok((await prisma.paymentAllocation.count({ where: { productionPaymentId: pay2.id, source: "MANUAL" } })) === 0, "ручное: без подтверждения ничего не записано");
  const f2 = fd({ lines: lines([[free[0].id, work[0] + 500]]) });
  f2.set("confirmOverpay", "1");
  r = await MK.saveProductionPaymentAllocation(pay2.id, f2);
  ok(!errOf(r) && (await prisma.paymentAllocation.count({ where: { productionPaymentId: pay2.id, source: "MANUAL" } })) === 1, "ручное: с подтверждением сохранено");
  await MK.saveProductionPaymentAllocation(pay2.id, fd({ lines: "[]" }));
  r = await MK.saveProductionPaymentAllocation(pay.id, fd({ lines: lines([[free[0].id, 1000], [free[1].id, 2000]]) }));
  const man = await prisma.paymentAllocation.findMany({ where: { productionPaymentId: pay.id } });
  ok(!errOf(r) && man.length === 2 && man.every((a) => a.source === "MANUAL") && man.reduce((s, a) => s + toCents(a.amount), 0) === 3000, "ручное: сохранено 2 строки MANUAL, Σ = 3000 коп.");
  r = await PR.updateProductionPayment(free[0].id, pay.id, fd({ amount: "20", paymentType: "PARTIAL", method: "BANK_TRANSFER", paidAt: "2026-09-01", orderIds: [free[0].id, free[1].id] }));
  ok(/меньше уже разнесённого/.test(errOf(r)), "правка суммы ниже ручного разнесения отклонена: " + errOf(r));
  r = await MK.saveProductionPaymentAllocation(pay.id, fd({ lines: "[]" }));
  ok(!errOf(r) && (await prisma.paymentAllocation.count({ where: { productionPaymentId: pay.id } })) === 0, "ручное: пустой список снимает разнесение (весь платёж — неразнесённый аванс)");

  // ---------- 6. Изоляция организаций ----------
  const orgB = await prisma.organization.create({ data: { name: "ТЕСТ-ОРГ-Б", slug: "alloc-test-b" } });
  const payB = await prisma.productionPayment.create({ data: { organizationId: orgB.id, amount: "1000", paymentType: "ADVANCE", method: "BANK_TRANSFER", status: "COMPLETED", paidAt: new Date("2026-09-03") } });
  const resB = await A.autoAllocatePayment(prisma, orgId, payB.id);
  ok(resB.status === "skipped", "авторазнесение чужого платежа (другая организация) пропущено");
  r = await MK.saveProductionPaymentAllocation(payB.id, fd({ lines: lines([[free[0].id, 100]]) }));
  ok(/не найдена/.test(errOf(r)), "ручное разнесение платежа чужой организации отклонено: " + errOf(r));
  as("OWNER", orgB.id);
  r = await MK.saveProductionPaymentAllocation(payB.id, fd({ lines: lines([[free[0].id, 100]]) }));
  ok(/ТЗ не найдено/.test(errOf(r)), "разнести на ТЗ чужой организации нельзя: " + errOf(r));
  ok((await A.loadClientDebt(prisma, orgB.id, { year: "all" })).rows.length === 0, "долг заказчиков организации Б не видит данные А");
  ok((await prisma.paymentAllocation.count({ where: { organizationId: orgB.id } })) === 0, "у организации Б нет строк разнесения");
  as("VIEWER", orgId);
  let denied = false;
  try { await MK.saveProductionPaymentAllocation(pay.id, fd({ lines: "[]" })); } catch { denied = true; }
  ok(denied, "роль без прав на производство не может менять разнесение");

  // уборка scratch-данных организации Б (сама база удаляется целиком)
  await prisma.productionPayment.delete({ where: { id: payB.id } });
  await prisma.organization.delete({ where: { id: orgB.id } });
  await prisma.$disconnect();
  console.log(fails === 0 ? "\nВсе проверки пройдены" : `\nПровалено: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
