/**
 * Привязка неразнесённых авансов к закупкам и ТЗ — по реестру списаний 1С (ММ → Веллмех), решение владельца 15.10.2026.
 * Привязываем ТОЛЬКО при однозначности по документам; всё спорное — в отчёт с вариантами, без записи.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/allocate-advances-2026-10-15.ts                  # пробный прогон (БД не меняется)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/allocate-advances-2026-10-15.ts --apply --live   # боевая: сам делает bash scripts/backup.sh
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/allocate-advances-2026-10-15.ts --rollback --apply [--live]
 *   (на копии базы: DATABASE_URL на копию, --apply без --live; бэкап не делается)
 *
 * Разнесение — теми же средствами, что мастер оплаты:
 *   • поставщику: Payment без закупки и аукциона («аванс без привязки») получает purchaseId (закупка вне аукциона) либо auctionSession
 *     (закупки аукциона) — как allocateAdvance в payments/actions.ts; сумма платежа не меняется; переплату не допускаем;
 *   • подрядчику (договор №1605): строки PaymentAllocation (+ ProductionPaymentOrder) по ТЗ — как autoAllocatePayment; Σ ≤ сумма платежа.
 * Правила однозначности:
 *   • счёт реестра определяет закупки (Invoice.number поставщика или Purchase.invoiceNumber) в ОДНОМ аукционе или это ОДНА закупка вне аукциона;
 *   • сумма оплаты ≤ неоплаченной части цели (не создаёт переплату); документы спецификации цели не называют другой номер спецификации;
 *   • для работы — привязка только к ТЗ, уже связанным с этой же оплатой (ProductionPaymentOrder) и ещё не оплаченным по работе;
 *     догадки по сумме (совпало 70% работы какого-то ТЗ) — только в отчёте, не основание.
 * Журнал отката: docs-inventory/corrections-journal-allocate-2026-10-15.json (было/стало). Запись — createAuditedClient("script:allocate-advances").
 */
import "./stubs/server-only-shim";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const SCRIPT = "allocate-advances-2026-10-15";
const ACTOR = "script:allocate-advances";

/** Реестр 1С: [строка, дата, сумма, п/п, счёт Веллмеха, спецификация, договор]. */
const REGISTRY: [number, string, number, string, string, string, number][] = [
  [1, "28.02.2025", 34825000.0, "440", "31", "1 от 26.02.2025", 2502],
  [2, "14.03.2025", 24556500.0, "33979", "40", "2 от 10.03.2025", 2502],
  [3, "14.03.2025", 79898902.0, "33980", "37", "1 от 26.02.2025", 2502],
  [4, "26.03.2025", 11950000.0, "36343", "46", "2 от 10.03.2025", 2502],
  [5, "16.05.2025", 10924000.0, "45675", "76", "2 от 10.03.2025", 2502],
  [6, "16.05.2025", 11146950.0, "45637", "75", "1 от 26.02.2025", 2502],
  [7, "30.05.2025", 1632000.0, "48466", "81", "3 от 26.05.2025", 2502],
  [8, "04.06.2025", 1718400.0, "49288", "80", "без спецификации", 2502],
  [9, "19.06.2025", 1210000.0, "51723", "92", "5 от 11.06.2025", 2502],
  [10, "27.06.2025", 30666300.0, "53423", "83", "4 от 26.05.2025", 2502],
  [11, "03.07.2025", 1455842.0, "54214", "100", "7 от 01.07.2025", 2502],
  [12, "03.07.2025", 1537404.0, "54215", "95", "6 от 24.06.2025", 2502],
  [13, "15.07.2025", 2000000.0, "56327", "103", "без спецификации", 2502],
  [14, "04.08.2025", 1695778.0, "60611", "103", "2 от 10.03.2025", 2502],
  [15, "04.08.2025", 21627900.0, "60610", "110", "без спецификации", 1605],
  [16, "22.08.2025", 195404.0, "64015", "117", "3 от 26.05.2025", 2502],
  [17, "22.08.2025", 1061306.0, "64014", "127", "5 от 11.06.2025", 2502],
  [18, "26.08.2025", 123836.0, "64499", "122", "6 от 24.06.2025", 2502],
  [19, "01.10.2025", 2533779.2, "70941", "143", "4 от 26.05.2025", 2502],
  [20, "25.11.2025", 27960.0, "81455", "", "без спецификации", 2502],
  [21, "04.12.2025", 24500.0, "83556", "", "без спецификации", 2502],
  [22, "24.12.2025", 4836327.52, "88105", "241", "8 от 22.12.2025", 2502],
  [23, "02.03.2026", 19600.0, "30413", "", "без спецификации", 2502],
  [24, "30.03.2026", 24200000.0, "36054", "93", "9 от 25.03.2026", 2502],
  [25, "13.04.2026", 22891800.0, "38692", "105", "9 от 25.03.2026", 2502],
  [26, "22.04.2026", 27912500.0, "40593", "117", "10 от 13.04.2026", 2502],
  [27, "12.05.2026", 60271506.34, "43831", "131", "10 от 13.04.2026", 2502],
  [28, "28.05.2026", 19628147.54, "46540", "149", "8 от 22.12.2025", 2502],
  [29, "28.05.2026", 30660000.0, "46538", "155", "12 от 22.05.2026", 2502],
  [30, "28.05.2026", 761250.0, "46539", "153", "11 от 21.05.2026", 2502],
  [31, "01.06.2026", 5400000.0, "46963", "157", "13 от 26.05.2026", 2502],
  [32, "04.06.2026", 2466573.0, "47668", "167", "11 от 21.05.2026", 2502],
  [33, "11.06.2026", 85063078.0, "48642", "173", "12 от 22.05.2026", 2502],
  [34, "15.06.2026", 416570.1, "48847", "171", "14 от 02.06.2026", 2502],
  [35, "01.07.2026", 19870.0, "51258", "181", "16 от 16.06.2026", 2502],
  [36, "20.07.2026", 2380500.0, "53718", "195", "18 от 01.07.2026", 2502],
  [37, "20.07.2026", 7236812.03, "53717", "197", "10 от 13.04.2026", 2502],
];

const r2 = (n: number) => Math.round(n * 100) / 100;
const rub = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
const dayOf = (x: Date) => x.toISOString().slice(0, 10);

type SupplierBind = { kind: "supplier"; paymentId: string; target: { purchaseId: string | null; auctionSession: string | null }; label: string; amount: number; before: { purchaseId: null; auctionSession: null; notes: string | null }; after: { purchaseId: string | null; auctionSession: string | null; notes: string } };
type ProdBind = { kind: "prod"; paymentId: string; lines: { orderId: string; label: string; amount: number }[] };
type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string;
  supplier: { paymentId: string; before: SupplierBind["before"]; after: SupplierBind["after"] }[];
  prod: { paymentId: string; allocationIds: string[]; linkIdsCreated: string[] }[];
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { Decimal } = await import("@prisma/client/runtime/library");
  const { loadSupplierDebt } = await import("../src/lib/supplier-debt");
  const { loadClientDebt, loadUnallocatedPayments, isContractorHidesRest } = await import("../src/lib/payment-alloc");
  const { splitByWeights, toCents, fromCents } = await import("../src/lib/payment-alloc-core");
  const { auctionName, loadAuctionSummaries, lockAuction, PAY_EPS } = await import("../src/lib/auction-payments");
  const { purchaseTotalInclVat } = await import("../src/lib/purchase-totals");
  const prisma = createAuditedClient(ACTOR);
  const JOURNAL = join(INV, "corrections-journal-allocate-2026-10-15.json");
  const url = process.env.DATABASE_URL ?? "";
  const isLive = /\/fur_erp(\?|$)/.test(url);
  const dbName = /\/([^/?]+)(\?|$)/.exec(url)?.[1] ?? "?";
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const orgId = org.id;
  console.log(`База: ${dbName}${isLive ? " (БОЕВАЯ)" : ""}; режим: ${ROLLBACK ? "откат" : "привязка"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}`);
  if (APPLY && isLive && !LIVE) { console.log("Это боевая база: для записи нужен флаг --live (он сам сделает бэкап). Ничего не изменено."); process.exitCode = 1; await prisma.$disconnect(); return; }
  const backup = () => { console.log("Копия базы перед записью: bash scripts/backup.sh …"); execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") }); };

  // ----- Откат -----
  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат: оплат поставщику ${j.supplier.length}, оплат подрядчику ${j.prod.length}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    const problems: string[] = [];
    for (const s of j.supplier) {
      const cur = await prisma.payment.findUnique({ where: { id: s.paymentId }, select: { purchaseId: true, auctionSession: true } });
      if (!cur) problems.push(`оплата ${s.paymentId} удалена после скрипта`);
      else if (cur.purchaseId !== s.after.purchaseId || cur.auctionSession !== s.after.auctionSession) problems.push(`привязка оплаты ${s.paymentId} изменена после скрипта`);
    }
    if (problems.length) { console.log("ОТКАТ НЕВОЗМОЖЕН:"); problems.forEach((x) => console.log(`  - ${x}`)); process.exitCode = 1; await prisma.$disconnect(); return; }
    if (APPLY) {
      if (isLive) backup();
      await prisma.$transaction(async (tx) => {
        for (const s of j.supplier) await tx.payment.update({ where: { id: s.paymentId }, data: { purchaseId: s.before.purchaseId, auctionSession: s.before.auctionSession, notes: s.before.notes } });
        for (const p of j.prod) {
          if (p.allocationIds.length) await tx.paymentAllocation.deleteMany({ where: { id: { in: p.allocationIds } } });
          if (p.linkIdsCreated.length) await tx.productionPaymentOrder.deleteMany({ where: { id: { in: p.linkIdsCreated } } });
        }
      }, { timeout: 60000 });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  const problems: string[] = [];
  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") problems.push("журнал уже содержит применённую привязку — сначала --rollback --apply");

  // ----- Состояние «до» -----
  const snapshot = async (db: typeof prisma) => {
    const sup = await loadSupplierDebt(db as never, orgId, "all");
    const cd = await loadClientDebt(db as never, orgId, { year: "all" });
    const uPay = await loadUnallocatedPayments(db as never, orgId);
    const advRows = await db.payment.findMany({ where: { organizationId: orgId, status: "COMPLETED", purchaseId: null, auctionSession: null }, select: { amount: true, supplier: { select: { name: true } } } });
    const bySupplier = new Map<string, number>();
    for (const a of advRows) bySupplier.set(a.supplier.name, r2((bySupplier.get(a.supplier.name) ?? 0) + Number(a.amount)));
    const prodRest = r2(uPay.reduce((s, p) => s + p.rest.toNumber(), 0));
    const prodHides = r2(uPay.filter(isContractorHidesRest).reduce((s, p) => s + p.rest.toNumber(), 0));
    return { supDebt: r2(sup.debt.toNumber()), supUnlinked: r2(sup.unlinkedAdvances.toNumber()), bySupplier, prodRest, prodHides, prodAdv: r2(prodRest - prodHides), clientBalance: r2(cd.balance), uPay };
  };
  const before = await snapshot(prisma);

  const supplier = await prisma.supplier.findFirstOrThrow({ where: { organizationId: orgId, name: { contains: "Веллмех" } } });

  // ----- Поставщик: сопоставление реестра и неразнесённых оплат -----
  const payRows = await prisma.payment.findMany({ where: { organizationId: orgId, supplierId: supplier.id, status: "COMPLETED" }, select: { id: true, amount: true, ppNo: true, invoiceNo: true, paidAt: true, notes: true, purchaseId: true, auctionSession: true, purchase: { select: { number: true } } } });
  const invoices = await prisma.invoice.findMany({ where: { organizationId: orgId, supplierId: supplier.id }, include: { purchases: { select: { id: true } } } });
  const purchases = await prisma.purchase.findMany({
    where: { organizationId: orgId, supplierId: supplier.id, status: { not: "CANCELLED" } },
    include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" }, select: { amount: true } }, documents: { select: { title: true } } },
  });
  const supplierBinds: SupplierBind[] = [];
  type Line = { row: number; pay: string; state: string; basis: string; conf: string; decision: string };
  const lines: Line[] = [];
  for (const [row, date, total, pp, invNo, spec, contract] of REGISTRY) {
    const mine = payRows.filter((p) => p.ppNo === pp);
    const sum = r2(mine.reduce((s, x) => s + Number(x.amount), 0));
    const head = `п/п ${pp} · ${date} · ${rub(total)} · счёт ${invNo ? "№" + invNo : "—"} · спец. ${spec} · дог. ${contract}`;
    if (contract === 1605) {
      lines.push({ row, pay: head, state: "оплата подрядчику (см. раздел «Работа»)", basis: "договор №1605: ProductionPayment", conf: "—", decision: "см. раздел производства" });
      continue;
    }
    if (!mine.length) { lines.push({ row, pay: head, state: "в базе нет оплаты с таким п/п", basis: "строки 20, 21, 23, 34 сознательно не внесены (решение владельца); остальные — п/п пуст/иной", conf: "—", decision: "не привязываю" }); continue; }
    if (Math.abs(sum - total) > 0.01) problems.push(`строка ${row}: в базе по п/п ${pp} ${rub(sum)}, в реестре ${rub(total)}`);
    const unl = mine.filter((p) => !p.purchaseId && !p.auctionSession);
    if (!unl.length) {
      const where = Array.from(new Set(mine.map((p) => p.purchase?.number ?? auctionName(p.auctionSession) ?? "?"))).join(", ");
      lines.push({ row, pay: head, state: `уже разнесена: ${where}`, basis: "—", conf: "—", decision: "ничего не менять" });
      continue;
    }
    // неразнесённые части: ищем цель по счёту
    const unlAmount = r2(unl.reduce((s, p) => s + Number(p.amount), 0));
    const ids = new Set<string>();
    for (const i of invoices.filter((x) => x.number.replace(/^№\s*/, "") === invNo)) i.purchases.forEach((pu) => ids.add(pu.id));
    for (const pu of purchases) if ((pu.invoiceNumber ?? "").replace(/^№\s*/, "") === invNo) ids.add(pu.id);
    const cand = purchases.filter((pu) => ids.has(pu.id));
    const auctions = Array.from(new Set(cand.map((pu) => auctionName(pu.auctionSession) ?? "")));
    let reason = "";
    let target: SupplierBind["target"] | null = null;
    let tLabel = "";
    if (!invNo) reason = "в реестре счёта нет";
    else if (!cand.length) reason = `счёту №${invNo} не соответствует ни одна закупка/Invoice`;
    else if (auctions.length > 1) reason = `счёт даёт закупки разных аукционов: ${auctions.join(", ") || "вне аукциона"}`;
    else if (auctions[0]) {
      const au = auctions[0];
      const s = (await loadAuctionSummaries(prisma as never, orgId, [au]))[0];
      if (!s) reason = `аукцион «${au}» не найден`;
      else if (unlAmount - s.remaining.toNumber() > PAY_EPS.toNumber()) reason = `переплата: сумма ${rub(unlAmount)} больше остатка аукциона «${au}» ${rub(s.remaining.toNumber())}`;
      else { target = { purchaseId: null, auctionSession: au }; tLabel = `аукцион «${au}» (остаток ${rub(s.remaining.toNumber())})`; }
    } else if (cand.length === 1) {
      const pu = cand[0];
      const left = purchaseTotalInclVat(pu).sub(pu.payments.reduce((x, y) => x.add(y.amount), new Decimal(0)));
      if (unlAmount - left.toNumber() > PAY_EPS.toNumber()) reason = `переплата: ${rub(unlAmount)} больше неоплаченной части ${pu.number} ${rub(left.toNumber())}`;
      else { target = { purchaseId: pu.id, auctionSession: null }; tLabel = `закупка ${pu.number} (не оплачено ${rub(left.toNumber())})`; }
    } else reason = `счёт даёт ${cand.length} закупок вне аукциона — не однозначно`;
    // спецификация цели не должна называть другой номер
    if (target) {
      const specNo = /^(\d+)/.exec(spec)?.[1];
      const named = new Set<string>();
      for (const pu of cand) for (const d of pu.documents) { const m = /спец\w*\.?\s*№?\s*(\d+)/i.exec(d.title); if (m) named.add(m[1]); }
      if (specNo && named.size && !named.has(specNo)) { reason = `спецификация в реестре №${specNo}, документы цели называют №${[...named].join(", №")}`; target = null; }
    }
    if (target) {
      for (const p of unl) {
        const note = [p.notes, `привязан к ${tLabel.replace(/ \(.*\)$/, "")} по счёту №${invNo} реестра 1С (${SCRIPT}.ts)`].filter(Boolean).join(" · ").slice(0, 1000);
        supplierBinds.push({ kind: "supplier", paymentId: p.id, target, label: tLabel, amount: Number(p.amount), before: { purchaseId: null, auctionSession: null, notes: p.notes }, after: { ...target, notes: note } });
      }
      lines.push({ row, pay: head, state: `НЕ разнесено ${rub(unlAmount)}`, basis: `счёт №${invNo} → ${tLabel}; сумма ≤ остатка; спецификации не противоречат`, conf: "высокая", decision: "ПРИВЯЗАТЬ" });
    } else lines.push({ row, pay: head, state: `НЕ разнесено ${rub(unlAmount)}`, basis: reason, conf: "низкая", decision: "не привязываю" });
  }
  // неразнесённые оплаты поставщиков, которых нет в реестре
  const regPp = new Set(REGISTRY.map((r) => r[3]));
  const extraUnl = payRows.filter((p) => !p.purchaseId && !p.auctionSession && !regPp.has(p.ppNo ?? ""));

  // ----- Производство -----
  const prodBinds: ProdBind[] = [];
  const prodLines: { pay: string; rest: number; basis: string; decision: string }[] = [];
  for (const u of before.uPay) {
    const pay = await prisma.productionPayment.findUniqueOrThrow({ where: { id: u.id }, include: { orders: { include: { productionOrder: true } }, allocations: true } });
    const head = `${dayOf(pay.paidAt)} · ${rub(Number(pay.amount))} · ${pay.docRef?.split(";")[0].slice(0, 60) ?? ""} (id ${pay.id.slice(-6)})`;
    if (isContractorHidesRest(u)) { prodLines.push({ pay: head, rest: u.rest.toNumber(), basis: "остаток назван в основании «шкурами подрядчика» — это сырьё, а не работа ТЗ; закупки на него в базе нет (в примечании платежа — «проверить»)", decision: "не привязываю" }); continue; }
    const allocatedHere = new Set(pay.allocations.map((a) => a.productionOrderId));
    const cands: { id: string; label: string; cap: number; weight: number }[] = [];
    for (const l of pay.orders) {
      const o = l.productionOrder;
      if (o.status === "CANCELLED" || allocatedHere.has(o.id) || !o.clientWorkPricePerUnit) continue;
      const work = toCents(new Decimal(o.clientWorkPricePerUnit.toString()).mul(o.plannedQuantity.toString()).toFixed(2));
      const paid = (await prisma.paymentAllocation.aggregate({ where: { productionOrderId: o.id, productionPayment: { status: "COMPLETED" } }, _sum: { amount: true } }))._sum.amount;
      const cap = work - toCents(paid ?? 0);
      if (cap > 0) cands.push({ id: o.id, label: `ТЗ ${o.workOrderNumber ?? o.number}`, cap, weight: work });
    }
    if (cands.length) {
      const restC = toCents(u.rest.toString());
      const capSum = cands.reduce((s, c) => s + c.cap, 0);
      if (restC <= capSum) {
        const split = splitByWeights(restC, cands.map((c) => ({ id: c.id, weight: c.weight, cap: c.cap })));
        const lns = cands.filter((c) => split.get(c.id)).map((c) => ({ orderId: c.id, label: c.label, amount: Number(fromCents(split.get(c.id)!)) }));
        prodBinds.push({ kind: "prod", paymentId: pay.id, lines: lns });
        prodLines.push({ pay: head, rest: u.rest.toNumber(), basis: `платёж уже связан с ТЗ без разнесения: ${cands.map((c) => c.label).join(", ")}; остаток ≤ их неоплаченной работы`, decision: "ПРИВЯЗАТЬ" });
        continue;
      }
    }
    // подсказки (не основание)
    const unpaid = await prisma.productionOrder.findMany({ where: { organizationId: orgId, clientId: pay.clientId, status: { not: "CANCELLED" }, clientWorkPricePerUnit: { not: null } }, select: { id: true, number: true, workOrderNumber: true, plannedQuantity: true, clientWorkPricePerUnit: true} });
    const allocated = new Set((await prisma.paymentAllocation.findMany({ where: { organizationId: orgId, productionPayment: { status: "COMPLETED" } }, select: { productionOrderId: true } })).map((x) => x.productionOrderId));
    const hints = unpaid
      .filter((o) => !allocated.has(o.id))
      .map((o) => ({ tz: o.workOrderNumber ?? o.number, work: r2(Number(o.plannedQuantity) * Number(o.clientWorkPricePerUnit)), qty: Number(o.plannedQuantity) }))
      .filter((h) => Math.abs(h.work * 0.7 - u.rest.toNumber()) < 0.01 || Math.abs(h.work - u.rest.toNumber()) < 0.01);
    const qtyNote = /(\d+)\s*(?:изделия|изделий|шт)/i.exec(`${pay.notes ?? ""}`)?.[1];
    prodLines.push({
      pay: head, rest: u.rest.toNumber(),
      basis: `у платежа нет связанных ТЗ без разнесения (связей ${pay.orders.length}, все уже разнесены); ТЗ в назначении/счёте не названы поимённо; ` +
        (hints.length ? `совпадение по сумме (70% работы) есть у ТЗ ${hints.map((h) => `${h.tz} (${h.qty} шт)`).join(", ")}, но это не документ-основание${qtyNote ? ` (в платеже ${qtyNote} изд.)` : ""}` : "ТЗ с подходящей суммой нет"),
      decision: "не привязываю",
    });
  }

  // ----- Состояние «после» (расчёт внутри транзакции с откатом) -----
  const applyPlan = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], journal: Journal | null) => {
    const lockKeys = [...new Set(supplierBinds.map((b) => b.target.auctionSession ?? "purchase:" + b.target.purchaseId))].sort();
    for (const k of lockKeys) await lockAuction(tx as never, orgId, k);
    for (const b of supplierBinds) {
      const cur = await tx.payment.findFirst({ where: { id: b.paymentId, purchaseId: null, auctionSession: null } });
      if (!cur) throw new Error(`оплата ${b.paymentId} уже привязана — прервано`);
      await tx.payment.update({ where: { id: b.paymentId }, data: { purchaseId: b.after.purchaseId, auctionSession: b.after.auctionSession, notes: b.after.notes } });
      journal?.supplier.push({ paymentId: b.paymentId, before: b.before, after: b.after });
    }
    for (const b of prodBinds) {
      const created: string[] = [], links: string[] = [];
      const pay = await tx.productionPayment.findUniqueOrThrow({ where: { id: b.paymentId }, include: { allocations: true, orders: true } });
      const sumNew = b.lines.reduce((s, l) => s + l.amount, 0);
      if (r2(pay.allocations.reduce((s, a) => s + Number(a.amount), 0) + sumNew) - Number(pay.amount) > 0.005) throw new Error(`разнесение платежа ${pay.id} превысит его сумму`);
      for (const l of b.lines) {
        const a = await tx.paymentAllocation.create({ data: { organizationId: orgId, productionPaymentId: pay.id, productionOrderId: l.orderId, amount: l.amount, source: "MANUAL", note: `Привязка по реестру 1С (${SCRIPT}.ts)` } });
        created.push(a.id);
        if (!pay.orders.some((o) => o.productionOrderId === l.orderId)) links.push((await tx.productionPaymentOrder.create({ data: { productionPaymentId: pay.id, productionOrderId: l.orderId } })).id);
      }
      journal?.prod.push({ paymentId: pay.id, allocationIds: created, linkIdsCreated: links });
    }
  };
  let after = before;
  if (supplierBinds.length || prodBinds.length) {
    const SIM = "__simulate_rollback__";
    try {
      await prisma.$transaction(async (tx) => {
        await applyPlan(tx, null);
        after = await snapshot(tx as never);
        throw new Error(SIM);
      }, { timeout: 60000 });
    } catch (e) { if (!(e instanceof Error) || e.message !== SIM) throw e; }
  }

  // ----- Отчёт -----
  const out: string[] = [];
  out.push("", "## 1. Оплаты поставщику (Веллмех) по реестру 1С", "", "| № | оплата | состояние в базе | основание | уверенность | решение |", "|---|---|---|---|---|---|");
  for (const l of lines) out.push(`| ${l.row} | ${l.pay} | ${l.state} | ${l.basis} | ${l.conf} | ${l.decision} |`);
  if (extraUnl.length) {
    out.push("", "Неразнесённые оплаты поставщика, которых нет в реестре (не привязываются — нет основания):");
    for (const p of extraUnl) out.push(`- ${dayOf(p.paidAt)} · ${rub(Number(p.amount))} · п/п ${p.ppNo ?? "—"}`);
  }
  out.push("", "## 2. Оплаты подрядчику (договор №1605) с неразнесённым остатком", "", "| оплата | остаток | основание | решение |", "|---|---:|---|---|");
  for (const l of prodLines) out.push(`| ${l.pay} | ${rub(l.rest)} | ${l.basis} | ${l.decision} |`);
  if (!prodLines.length) out.push("| — | | неразнесённых остатков нет | |");
  out.push("", "## 3. Итог: «не разнесено» и долг до / после", "", "| показатель | до | после |", "|---|---:|---:|");
  const row = (n: string, a: number, b: number) => out.push(`| ${n} | ${rub(a)} | ${rub(b)} |`);
  row("Авансы поставщикам без привязки (всего)", before.supUnlinked, after.supUnlinked);
  for (const [name, v] of before.bySupplier) row(`  из них ${name}`, v, after.bySupplier.get(name) ?? 0);
  if (!before.bySupplier.size) out.push("| (неразнесённых авансов поставщикам нет) | 0,00 ₽ | 0,00 ₽ |");
  row("Неразнесено по производству (всего)", before.prodRest, after.prodRest);
  row("  из них шкуры подрядчика (сырьё, не работа)", before.prodHides, after.prodHides);
  row("  из них авансы за работу без ТЗ", before.prodAdv, after.prodAdv);
  row("Долг поставщику (с НДС)", before.supDebt, after.supDebt);
  row("Баланс заказчика «За производство» (работа − оплаты)", before.clientBalance, after.clientBalance);
  out.push("", `Привязок: поставщику ${supplierBinds.length}, по работе ${prodBinds.length}.`);
  if (problems.length) out.push("", "## ПРОБЛЕМЫ — запись не выполняется", ...problems.map((x) => `- ${x}`));
  console.log(out.join("\n"));
  if (problems.length) { console.log(`\nНайдено проблем: ${problems.length}. Запись невозможна.`); process.exitCode = 1; await prisma.$disconnect(); return; }
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply (на боевой ещё --live)."); await prisma.$disconnect(); return; }
  if (!supplierBinds.length && !prodBinds.length) { console.log("\nНечего привязывать однозначно — запись не выполняется, журнал не создаётся."); await prisma.$disconnect(); return; }

  // ----- Применение -----
  mkdirSync(INV, { recursive: true });
  if (isLive) backup();
  const journal: Journal = { script: `${SCRIPT}.ts`, status: "applied", at: new Date().toISOString(), supplier: [], prod: [] };
  await prisma.$transaction(async (tx) => { await applyPlan(tx, journal); }, { timeout: 60000, maxWait: 15000 });
  writeJson(JOURNAL, journal);
  console.log(`\nПрименено: оплат поставщику ${journal.supplier.length}, оплат по работе ${journal.prod.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
