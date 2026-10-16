/**
 * Разнесение оплат производства по ТЗ (PaymentAllocation) на основе planAutoAllocations (src/lib/payment-alloc.ts).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/allocate-production-payments.ts            # сухой прогон: БД не меняется, пишет отчёт
 *   node --env-file=.env node_modules/.bin/tsx scripts/allocate-production-payments.ts --apply    # применить (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --env-file=.env node_modules/.bin/tsx scripts/allocate-production-payments.ts --rollback # откат по журналу
 *
 * Что делает:
 *  • Берёт проведённые платежи производства БЕЗ строк разнесения и делит каждый между ТЗ из его набора (ProductionPaymentOrder)
 *    пропорционально работе ТЗ, но не больше остатка работы ТЗ; платежи — по порядку оплаты. Остаток платежа остаётся «неразнесённым»
 *    (аванс без разнесения / платёж сверх работы, например шкуры подрядчика).
 *  • Правило: Σ разнесений платежа <= сумма платежа (проверяется checkAllocation; нарушение — прерывание без записи).
 *  • Идемпотентно: платёж, у которого уже есть строки разнесения (авто или ручные), не трогается; повторный прогон ничего не создаёт.
 *  • Безопасность: и сухой прогон, и --apply выполняются внутри транзакции; в ней считаются «долг заказчиков без фильтров» и итоги партий
 *    ДО и ПОСЛЕ. Если долг или работа/себестоимость партий изменились — транзакция откатывается. Сухой прогон всегда откатывается.
 *  • Журнал: docs-inventory/corrections-journal-payment-allocation.json (id созданных строк). Откат удаляет только эти строки (если они
 *    всё ещё AUTO). Отчёт: docs-inventory/payment-allocation-report.md.
 */
import Module from "module";
import { join } from "path";
import { writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { randomBytes } from "crypto";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");

type Journal = { script: string; status: "applying" | "applied" | "rolled-back"; at: string; created: { id: string; paymentId: string; orderId: string; amount: string }[] };
class DryRun extends Error {}

const rub = (c: number) => (c / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ");

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { planAutoAllocations, orderWorkCents, loadClientDebt, AUTO_NOTE } = await import("../src/lib/payment-alloc");
  const { checkAllocation, fromCents, toCents } = await import("../src/lib/payment-alloc-core");
  const { batchOrderInclude, batchTotals } = await import("../src/lib/batch-stats");
  const prisma = new PrismaClient();
  // ALLOC_OUT_DIR — для теста на scratch-базе: журнал и отчёт не затирают боевые
  const OUT = process.env.ALLOC_OUT_DIR ?? INV;
  const JOURNAL = join(OUT, "corrections-journal-payment-allocation.json");
  const REPORT = join(OUT, "payment-allocation-report.md");

  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || !j.created?.length) { console.log("Журнал пуст — откатывать нечего."); return; }
    const del = await prisma.paymentAllocation.deleteMany({ where: { id: { in: j.created.map((c) => c.id) }, source: "AUTO" } });
    console.log(`Откат: удалено ${del.count} из ${j.created.length} строк разнесения (ручные правки не трогались).`);
    writeJson(JOURNAL, { ...j, status: "rolled-back", rolledBackAt: new Date().toISOString(), created: [] });
    return;
  }

  const prior = readJson<Journal | null>(JOURNAL, null);
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  const out: string[] = [`# Разнесение оплат производства по ТЗ — ${APPLY ? "ПРИМЕНЕНИЕ" : "сухой прогон"}`, "", `Дата: ${new Date().toISOString()}`, ""];
  const created: Journal["created"] = [];
  let failure: string | null = null;
  let backupDone = false;

  for (const org of orgs) {
    const run = async (tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">, write: boolean) => {
      // ---- ДО ----
      const snap = async () => {
        const debt = await loadClientDebt(tx, org.id, { year: "all" });
        const batches = await tx.productionBatch.findMany({ where: { organizationId: org.id }, include: { orders: { include: batchOrderInclude } }, orderBy: { number: "asc" } });
        return { debt, batches: batches.map((b) => ({ number: b.number, t: batchTotals(b.orders) })) };
      };
      const before = await snap();

      const pays = await tx.productionPayment.findMany({
        where: { organizationId: org.id, status: "COMPLETED" },
        select: { id: true, amount: true, paidAt: true, createdAt: true, paymentType: true, docRef: true, notes: true, client: { select: { name: true } }, orders: { select: { productionOrderId: true } }, allocations: { select: { productionOrderId: true, amount: true } } },
      });
      const ords = await tx.productionOrder.findMany({
        where: { organizationId: org.id },
        select: { id: true, number: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, batch: { select: { number: true } } },
      });
      const ordMap = new Map(ords.map((o) => [o.id, { id: o.id, workCents: orderWorkCents(o), live: o.status !== "CANCELLED" }]));
      const label = new Map(ords.map((o) => [o.id, `ТЗ ${o.number}${o.batch ? ` (п.${o.batch.number})` : ""}`]));

      // уже разнесённые суммы по ТЗ — от платежей, которых нет в плане (у них уже есть строки)
      const todo = pays.filter((p) => p.allocations.length === 0);
      const done = pays.filter((p) => p.allocations.length > 0);
      const existing = new Map<string, number>();
      for (const p of done) for (const a of p.allocations) existing.set(a.productionOrderId, (existing.get(a.productionOrderId) ?? 0) + toCents(a.amount));

      const plan = planAutoAllocations(
        todo.map((p) => ({ id: p.id, amountCents: toCents(p.amount), paidAt: p.paidAt.getTime(), createdAt: p.createdAt.getTime(), linkedOrderIds: p.orders.map((o) => o.productionOrderId), docRef: p.docRef, notes: p.notes })),
        ordMap,
        existing,
      );
      const byId = new Map(pays.map((p) => [p.id, p]));
      for (const r of plan) {
        const err = checkAllocation(toCents(byId.get(r.paymentId)!.amount), r.lines);
        if (err) throw new Error(`Платёж ${r.paymentId}: ${err}`);
      }

      const lines = plan.filter((r) => r.lines.length > 0);
      if (write && lines.length) {
        const rows = lines.flatMap((r) => r.lines.map((l) => ({ id: "c" + randomBytes(12).toString("hex"), organizationId: org.id, productionPaymentId: r.paymentId, productionOrderId: l.orderId, amount: fromCents(l.amountCents), source: "AUTO" as const, note: AUTO_NOTE })));
        await tx.paymentAllocation.createMany({ data: rows });
        for (const r of rows) created.push({ id: r.id, paymentId: r.productionPaymentId, orderId: r.productionOrderId, amount: r.amount });
      }
      // «после» считаем и в сухом прогоне: тогда строки создаём в транзакции, которую потом откатываем
      const after = await snap();

      // ---- проверки неизменности ----
      const problems: string[] = [];
      if (Math.abs(after.debt.balance - before.debt.balance) > 0.005) problems.push(`долг заказчиков изменился: ${before.debt.balance} → ${after.debt.balance}`);
      if (Math.abs(after.debt.billable - before.debt.billable) > 0.005) problems.push("работа заказчиков изменилась");
      for (const b of before.batches) {
        const a = after.batches.find((x) => x.number === b.number)!;
        if (!a.t.work.equals(b.t.work) || !a.t.cost.equals(b.t.cost)) problems.push(`партия ${b.number}: изменилась работа/себестоимость`);
      }
      return { before, after, plan, todo, done, label, byId, problems };
    };

    // Сначала пробный прогон в транзакции с откатом (без записи в журнал); при --apply — повтор «набело».
    let res: Awaited<ReturnType<typeof run>> | null = null;
    try {
      await prisma.$transaction(async (tx) => {
        created.length = 0;
        res = await run(tx, true);
        throw new DryRun();
      }, { timeout: 180000, maxWait: 30000 });
    } catch (e) {
      if (!(e instanceof DryRun)) throw e;
    }
    const r = res as unknown as Awaited<ReturnType<typeof run>>;
    const planned = created.slice();
    const sumPlanned = planned.reduce((s, c) => s + toCents(c.amount), 0);

    out.push(`## ${org.name}`, "");
    out.push(`Платежей проведено: ${r.byId.size}; уже с разнесением: ${r.done.length}; к разнесению: ${r.todo.length}.`);
    const auto = r.plan.filter((x) => x.lines.length > 0);
    const rest = r.plan.reduce((s, x) => s + x.unallocatedCents, 0);
    out.push(`Разнесётся автоматически: ${auto.length} плат., ${rub(sumPlanned)} ₽ в ${planned.length} строк. Останется неразнесённым: ${rub(rest)} ₽.`, "");
    out.push("| Платёж | Дата | Вид | Сумма | Разнесено | Остаток | Комментарий |", "|---|---|---|---:|---:|---:|---|");
    for (const x of r.plan) {
      const p = r.byId.get(x.paymentId)!;
      const al = x.lines.reduce((s, l) => s + l.amountCents, 0);
      out.push(`| ${x.paymentId.slice(-6)} | ${p.paidAt.toISOString().slice(0, 10)} | ${p.paymentType} | ${rub(toCents(p.amount))} | ${rub(al)} | ${rub(x.unallocatedCents)} | ${x.why}${p.client ? "; " + p.client.name : ""} |`);
    }
    out.push("", "### Остатки (что не разнесено)", "");
    for (const x of r.plan.filter((y) => y.unallocatedCents > 1)) {
      const p = r.byId.get(x.paymentId)!;
      out.push(`- ${x.paymentId.slice(-6)} · ${p.paidAt.toISOString().slice(0, 10)} · ${p.paymentType} · ${rub(x.unallocatedCents)} ₽ — ${x.why}${p.orders.length ? ` (${p.orders.length} ТЗ в наборе)` : ""}`);
    }
    out.push("", "### Итоги ДО → ПОСЛЕ", "");
    out.push(`- Долг заказчиков без фильтров: ${r.before.debt.balance.toFixed(2)} → ${r.after.debt.balance.toFixed(2)}`);
    out.push(`- Работа: ${r.before.debt.billable.toFixed(2)} → ${r.after.debt.billable.toFixed(2)}; оплачено: ${r.before.debt.paid.toFixed(2)} → ${r.after.debt.paid.toFixed(2)}`);
    out.push(`- Из оплаченного: разнесено ${r.before.debt.allocated.toFixed(2)} → ${r.after.debt.allocated.toFixed(2)}; неразнесённые авансы ${r.before.debt.unallocated.toFixed(2)} → ${r.after.debt.unallocated.toFixed(2)}`);
    out.push("", "| Партия | Работа | Себест. | Оплачено до | Оплачено после | Остаток после | Неразнесено после |", "|---:|---:|---:|---:|---:|---:|---:|");
    for (const b of r.before.batches) {
      const a = r.after.batches.find((x) => x.number === b.number)!;
      if (b.t.orders === 0) continue;
      out.push(`| ${b.number} | ${b.t.work.toFixed(2)} | ${b.t.cost.toFixed(2)} | ${b.t.paid.toFixed(2)} | ${a.t.paid.toFixed(2)} | ${a.t.remaining.toFixed(2)} | ${a.t.unallocated.toFixed(2)} |`);
    }
    if (r.problems.length) { out.push("", "### ПРОБЛЕМЫ — применять нельзя", ...r.problems.map((p) => `- ${p}`)); failure = r.problems.join("; "); }

    console.log(`[${org.name}] к разнесению ${r.todo.length} плат.; авто: ${auto.length} плат. / ${rub(sumPlanned)} ₽ / ${planned.length} строк; остаток ${rub(rest)} ₽`);
    console.log(`  долг: ${r.before.debt.balance.toFixed(2)} → ${r.after.debt.balance.toFixed(2)}`);
    for (const x of r.plan.filter((y) => y.unallocatedCents > 1)) console.log(`  остаток ${x.paymentId.slice(-6)} ${rub(x.unallocatedCents)} ₽ — ${x.why}`);
    if (r.problems.length) console.log("  ПРОБЛЕМЫ: " + r.problems.join("; "));

    if (APPLY && !r.problems.length && planned.length) {
      if (!NO_BACKUP && !backupDone) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); backupDone = true; }
      const j: Journal = { script: "allocate-production-payments.ts", status: "applying", at: new Date().toISOString(), created: [] };
      const live: Journal["created"] = [];
      await prisma.$transaction(async (tx) => {
        created.length = 0;
        const r2 = await run(tx, true);
        if (r2.problems.length) throw new Error(r2.problems.join("; "));
        live.push(...created);
        writeJson(JOURNAL, { ...j, created: live });
      }, { timeout: 180000, maxWait: 30000 });
      writeJson(JOURNAL, { ...j, status: "applied", created: live });
      console.log(`Применено: создано ${live.length} строк разнесения. Журнал: ${JOURNAL}`);
      out.push("", `Применено: ${live.length} строк. Журнал: corrections-journal-payment-allocation.json`);
    } else if (APPLY && !planned.length) {
      console.log("Нечего применять: все платежи уже разнесены (идемпотентно).");
      out.push("", "Нечего применять: все платежи уже разнесены.");
    } else if (!APPLY) {
      console.log("Сухой прогон: БД не изменена. Для применения: --apply");
    }
  }
  void prior;
  // повторный прогон «нечего применять» не затирает отчёт предыдущего применения
  if (created.length || !existsSync(REPORT)) writeFileSync(REPORT, out.join("\n"));
  console.log(`Отчёт: ${REPORT}`);
  await prisma.$disconnect();
  if (failure) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
