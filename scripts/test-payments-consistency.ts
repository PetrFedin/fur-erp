// Сквозные тождества по оплатам (Главная ↔ Оплаты ↔ Закупки ↔ Сводка ↔ Сверка ↔ партии). Только чтение.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-payments-consistency.ts
// I16 (Cashflow) проверяется отдельным агентом: здесь только информация, в счётчик расхождений не входит.
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { loadDashboard } from "../src/lib/dashboard-data";
import { parseDashFilters } from "../src/lib/dashboard-calc";
import { loadPaymentsOverview, loadPaymentsLeft } from "../src/lib/payments-overview";
import { loadDebtInputs, supplierDebtFromInputs } from "../src/lib/supplier-debt";
import { loadAuctionSummaries, auctionName, purchasePaidShare } from "../src/lib/auction-payments";
import { loadSummary } from "../src/lib/purchase-summary";
import { loadClientDebt, orderWorkCents } from "../src/lib/payment-alloc";
import { loadBatchesWithOrders, batchTotals } from "../src/lib/batch-stats";
import { purchaseTotalInclVat } from "../src/lib/purchase-totals";
import { loadSupplierPayData } from "../src/lib/supplier-pay";
import { ALL_INVOICES } from "../src/app/(app)/reconciliation/model";
import { loadLive } from "../src/app/(app)/reconciliation/live";
const prisma = new PrismaClient();
const f = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
let fails = 0, checks = 0;
const eq = (what: string, got: number, want: number, tol = 0.02) => { checks++; const ok = Math.abs(got - want) <= tol; if (!ok) fails++; console.log(`${ok ? "OK  " : "FAIL"} ${what}: ${f(got)} ${ok ? "=" : "≠"} ${f(want)}${ok ? "" : ` (Δ ${f(got - want)})`}`); };
(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const [ov, left, inp, aus, cd, sm, dash] = await Promise.all([loadPaymentsOverview(org), loadPaymentsLeft(org), loadDebtInputs(prisma, org), loadAuctionSummaries(prisma, org), loadClientDebt(prisma, org, { year: "all" }), loadSummary(org), loadDashboard(org, "all", parseDashFilters({}), "on")]);
  const pays = await prisma.payment.findMany({ include: { purchase: { include: { items: true, expenses: true } } } });
  const pp = await prisma.productionPayment.findMany();
  const S = sum(pays.map((p) => p.amount.toNumber())), P = sum(pp.map((p) => p.amount.toNumber()));
  eq("I1 Σ платежей (поставщику + за работу) = Σ строк «Оплаты→Все»", S + P, sum(ov.map((r) => r.amount)));
  eq("I2a сырьё: Σ Payment = Σ строк kind=raw", S, sum(ov.filter((r) => r.kind === "raw").map((r) => r.amount)));
  eq("I2b работа: Σ ProductionPayment = Σ строк kind=prod", P, sum(ov.filter((r) => r.kind === "prod").map((r) => r.amount)));
  const A1 = sum(pays.filter((p) => !p.purchaseId).map((p) => p.amount.toNumber()));
  const A2 = sum(pays.filter((p) => p.purchaseId && auctionName(p.purchase?.auctionSession)).map((p) => p.amount.toNumber()));
  const A3 = sum(pays.filter((p) => p.purchaseId && !auctionName(p.purchase?.auctionSession)).map((p) => p.amount.toNumber()));
  eq("I3 оплаты аукциона целиком + по закупкам аукциона + по закупкам вне аукциона = Σ Payment", A1 + A2 + A3, S);
  eq("I4 Σ оплачено по аукционам (сводки) + Σ по закупкам вне аукциона = Σ Payment", sum(aus.map((a) => a.paid.toNumber())) + A3, S);
  const debt = supplierDebtFromInputs(inp, "all");
  eq("I5 Σ закупок − Σ оплат поставщику = долг поставщику", debt.total.toNumber() - S, debt.debt.toNumber(), 0.05);
  eq("I6 «оплачено» в подсказке долга (supplierCashPaid) = Σ оплат поставщику (переплаты зачтены в долг и показаны отдельно)", dash.supplierCashPaid, S, 0.05);
  eq("I6b закупки − «оплачено» в подсказке = долг поставщику; переплаты в подсказке показаны отдельно", dash.debt.total.toNumber() - dash.supplierCashPaid, dash.debt.debt.toNumber(), 0.05);
  eq("I7 ProductionPayment = разнесено на ТЗ + неразнесённое (с шкурами)", P, cd.allocated + cd.unallocatedAll, 0.02);
  eq("I7b неразнесённое: аванс подрядчику + шкуры = всё неразнесённое", dash.advance + cd.hides, cd.unallocatedAll, 0.02);
  const batches = await loadBatchesWithOrders(org);
  const bPaid = sum(batches.map((b) => batchTotals(b.orders).paid.toNumber())), bWork = sum(batches.map((b) => batchTotals(b.orders).work.toNumber()));
  const nb = await prisma.productionOrder.findMany({ where: { organizationId: org, batchId: null, status: { not: "CANCELLED" } }, include: { payShares: true } });
  eq("I8a Σ оплачено по партиям + ТЗ вне партий = разнесено на ТЗ", bPaid + sum(nb.flatMap((o) => o.payShares.map((s) => s.amount.toNumber()))), cd.allocated);
  eq("I8b Σ работа по партиям + ТЗ вне партий = работа заказчиков", bWork + sum(nb.map((o) => orderWorkCents(o) / 100)), cd.billable);
  const orders = await prisma.productionOrder.findMany({ where: { organizationId: org, status: { not: "CANCELLED" } }, include: { payShares: true } });
  const dueTz = sum(orders.map((o) => Math.max(0, orderWorkCents(o) / 100 - sum(o.payShares.map((s) => s.amount.toNumber())))));
  eq("I9a Σ max(работа ТЗ − разнесено) = «Долг по работе» (Главная)", dueTz, left.prod, 0.5);
  eq("I9b работа − оплачено(с авансом) = долг по работе − аванс подрядчику", cd.balance, left.prod - left.advance, 0.05);
  const w = (await prisma.supplier.findFirst({ where: { name: { contains: "Веллмех" } } }))!;
  const cdc = await loadClientDebt(prisma, org, { year: "all", contractorId: w.id });
  eq("I10 карточка подрядчика Веллмех: оплачено = общее по заказчику", cdc.paid, cd.paid);
  const leavesPaid = sum(sm.leaves.map((l) => l.paidIncl.toNumber()));
  const services = sum(ov.map((r) => r.services));
  eq("I11 «Сводка закупок»: Σ оплачено по лотам = Σ Payment − услуги по УПД (до 1 ₽ округления лотов)", leavesPaid, S - services, 1);
  const lm = Object.values(dash.lotMoney);
  const purs = await prisma.purchase.findMany({ where: { organizationId: org, status: { not: "CANCELLED" }, auctionSession: { not: null } }, select: { auctionSession: true, status: true } });
  const draftAuc = new Set([...new Set(purs.map((x) => auctionName(x.auctionSession)))].filter((n) => n && purs.filter((x) => auctionName(x.auctionSession) === n).every((x) => x.status !== "RECEIVED")) as string[]);
  const noLotsPaid = sum(aus.filter((a) => draftAuc.has(a.name)).map((a) => a.paid.toNumber()));
  console.log(`INFO I12 на страницах лотов «оплачено» меньше, чем на Главной, на ${f(noLotsPaid)} — оплаты по ещё не полученным аукционам (${[...draftAuc].join(", ")}): лотов у них нет`);
  eq("I12 оплачено по лотам + оплаты не полученных аукционов + шкуры подрядчика = мех+подкладка на Главной", sum(lm.map((x) => x.paid)) + noLotsPaid + sum(ov.map((r) => r.hides)), dash.paidByItem.fur + dash.paidByItem.lining, 1);
  const pd = await loadSupplierPayData(org, w.id);
  eq("I13 кабинет Веллмеха: прямые + пулы аукционов = Σ Payment", sum([...pd.direct.values()].flat().map((l) => l.amount)) + sum([...pd.pools.values()].flat().map((l) => l.amount)), S);
  // валюта и статусы
  checks++; const bad = pays.filter((p) => p.currency !== "RUB" || p.status !== "COMPLETED").length + pp.filter((p) => p.status !== "COMPLETED").length; if (bad) { fails++; console.log("FAIL I14 есть не-RUB/не-COMPLETED оплаты:", bad); } else console.log("OK   I14 все оплаты RUB и COMPLETED (иначе код по-разному считает PENDING/валюту)");
  checks++; const zero = pays.filter((p) => p.amount.toNumber() === 0).length + pp.filter((p) => p.amount.toNumber() === 0).length; console.log(`${zero ? "INFO" : "OK  "} I15 нулевых платежей: ${zero} (счётчики «Оплат: N» на карточках считают их, «Оплаты по годам» — нет)`);
  // года
  const cashY = (y: number) => sum(pays.filter((p) => p.paidAt.getUTCFullYear() === y).map((p) => p.amount.toNumber())) + sum(pp.filter((p) => p.paidAt.getUTCFullYear() === y).map((p) => p.amount.toNumber()));
  for (const y of [2025, 2026]) { const a = sum(ov.filter((r) => r.year === y).map((r) => r.amount)), b = cashY(y); console.log(`INFO I16 ${y}: «Оплаты по годам» ${f(a)} · по дате оплаты ${f(b)} (Δ ${f(a - b)}) — Cashflow проверяется отдельным агентом`); }
  // I17: карточка лота подкладки, «Закупки» и «Сводка закупок» считают «оплачено по закупке» одной функцией purchasePaidShare
  const allP = await prisma.purchase.findMany({ where: { status: { not: "CANCELLED" } }, include: { items: true, expenses: true, payments: true } });
  const shareOf = (p: (typeof allP)[number]) => purchasePaidShare(aus.find((x) => x.name === auctionName(p.auctionSession)), p.id, new Decimal(sum(p.payments.filter((x) => x.status === "COMPLETED").map((x) => x.amount.toNumber()))));
  const lin = allP.filter((p) => auctionName(p.auctionSession) && p.payments.length === 0);
  const linDebt = sum(lin.map((p) => Math.max(0, purchaseTotalInclVat(p).toNumber() - shareOf(p).toNumber())));
  console.log(`INFO I17 закупки аукционов без собственных оплат: ${lin.length}, ложного долга по формуле «своих оплат» не возникает (доля партии, долг ${f(linDebt)})`);
  // I18 (D5): по каждой закупке «Закупки» = «Сводка закупок»; Σ по партии не меняется
  const byPur = new Map<string, number>();
  for (const l of sm.leaves) byPur.set(l.purchaseId, (byPur.get(l.purchaseId) ?? 0) + l.paidIncl.toNumber());
  let worst = 0, worstNo = "";
  for (const p of allP) { if (!byPur.has(p.id)) continue; const d = Math.abs(byPur.get(p.id)! - shareOf(p).toNumber()); if (d > worst) { worst = d; worstNo = p.number; } }
  eq(`I18 «Оплачено» по каждой закупке: «Закупки» = «Сводка закупок» (макс. расхождение ${worstNo || "—"}, до 1 ₽ — округление лотов)`, worst, 0, 1);
  for (const a of aus) { const ps = allP.filter((p) => auctionName(p.auctionSession) === a.name); if (!ps.length) continue; eq(`I18b аукцион ${a.name}: Σ оплачено по закупкам = оплачено по аукциону`, sum(ps.map((p) => shareOf(p).toNumber())), a.paid.toNumber(), 0.05); }
  // I19 (D4): «Сверка» — оплаты шкур подрядчика нашли свои счета; ложной «базы без документов» нет
  const live = await loadLive(org);
  const cRaw = new Set((await prisma.purchase.findMany({ where: { isContractorRaw: true }, select: { number: true } })).map((x) => x.number));
  eq("I19 «Сверка»: платежи шкур подрядчика (закупки isContractorRaw) без счёта в реестре, ₽", sum(live.orphans.filter((o) => cRaw.has(o.label)).map((o) => o.amount)), 0, 0.01);
  const missing = sum(ALL_INVOICES.map((i) => Math.max(0, i.paid.filter((p) => p.evidence === "fact").reduce((a, p) => a + p.amountRub, 0) - (live.inv.get(i.id)?.paid ?? 0))).filter((m) => m > 1));
  eq("I19b «Сверка»: «есть в документах, нет в базе», ₽ (было 5 973 297,61 — ложная тревога по шкурам подрядчика)", missing, 0, 0.01);
  for (const i of ALL_INVOICES) { const d = i.paid.filter((p) => p.evidence === "fact").reduce((a, p) => a + p.amountRub, 0), b = live.inv.get(i.id)?.paid ?? 0; if (d > 1 && b - d > 1) console.log(`INFO I19c счёт №${i.no} (${i.section}): документы ${f(d)}, база ${f(b)} — база больше на ${f(b - d)}: расхождение с документом, решение владельца`); }
  console.log(`\nпроверок ${checks}, расхождений ${fails}`);
  if (fails) process.exitCode = 1;
})().finally(() => prisma.$disconnect());
