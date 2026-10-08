/**
 * Центр задач «Контроль → Задачи»: документы для поиска и решения владельца. Работает ТОЛЬКО на КОПИИ БД:
 *   createdb fur_erp_task_test  (psql -h localhost -p 5436 -U fur_erp -d postgres -c 'CREATE DATABASE fur_erp_task_test')
 *   pg_dump -h localhost -p 5436 -U fur_erp --no-owner fur_erp | psql -q -h localhost -p 5436 -U fur_erp -d fur_erp_task_test
 *   TASK_TEST_URL=postgresql://fur_erp:fur_erp@localhost:5436/fur_erp_task_test \
 *     node --env-file=.env node_modules/.bin/tsx scripts/test-task-center.ts
 *   psql ... -c 'DROP DATABASE fur_erp_task_test'
 * Проверяет: задачи формируются и совпадают с расшифровкой долга (docs-inventory/debt-trace.json, если файл есть);
 * закрываются сами при загрузке платёжки / подтверждении оплаты (проба с откатом); решение владельца считается и пишется в журнал;
 * письма собираются; число открытых = сумма блоков.
 */
import Module from "module";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const url = process.env.TASK_TEST_URL ?? "";
if (!url.includes("task_test")) {
  console.error("Задайте TASK_TEST_URL на scratch-базу (имя содержит task_test).");
  process.exit(2);
}
let fails = 0;
const ok = (c: unknown, m: string) => { console.log(`${c ? "OK  " : "FAIL"} ${m}`); if (!c) fails++; };

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { loadTaskBlocks } = await import("../src/lib/task-docs");
  const { DOC_TASKS, DECISIONS, DECISION_KEY_PREFIX, buildLetter } = await import("../src/lib/task-docs-catalog");
  const { loadSupplierDebt } = await import("../src/lib/supplier-debt");
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const org = (await db.organization.findFirstOrThrow()).id;
    const b0 = await loadTaskBlocks(db, org);
    const debt = await loadSupplierDebt(db, org);
    ok(b0.docTasks.length === DOC_TASKS.length, `задач в каталоге: ${DOC_TASKS.length}`);
    ok(b0.openDocs === b0.docTasks.filter((v) => v.open && !v.task.later).length, `открытых документов: ${b0.openDocs} (после поставки: ${b0.laterDocs})`);
    ok(b0.debtRub === debt.debt.toFixed(2), `долг в блоке = loadSupplierDebt: ${b0.debtRub}`);
    ok(b0.decisions.length === DECISIONS.length, `решений в каталоге: ${DECISIONS.length}`);
    const missing = b0.docTasks.filter((v) => v.missing);
    ok(missing.length === 0, `записи всех задач найдены в базе${missing.length ? ": " + missing.map((v) => v.task.id).join(", ") : ""}`);

    // сверка с расшифровкой долга
    const tracePath = join(__dirname, "..", "docs-inventory", "debt-trace.json");
    if (existsSync(tracePath)) {
      const trace = JSON.parse(readFileSync(tracePath, "utf8")) as { lines: { id: string; toFind: string[]; dueRub: string }[]; loadSupplierDebt: Record<string, string> };
      const lines = new Set(DOC_TASKS.flatMap((t) => t.lines));
      for (const l of trace.lines.filter((x) => x.toFind.length)) {
        if (["L09", "L10"].includes(l.id)) { ok(DECISIONS.some((d) => d.id === "double-0001-0010"), `${l.id} покрыта решением владельца`); continue; }
        ok(lines.has(l.id), `строка ${l.id} (${l.toFind.length} док.) покрыта задачей`);
      }
    } else console.log("     (debt-trace.json нет — сверка со строками пропущена)");

    // автозакрытие: платёжка к оплате SAGA 24 200 000
    const t1 = b0.docTasks.find((v) => v.task.id === "saga-93")!;
    ok(t1.open && t1.paymentIds.length === 1, "saga-93 открыта, оплата найдена");
    const doc = await db.driveDocument.create({ data: { organizationId: org, driveFileId: "local-test-proof", title: "Проба платёжка", docType: "PAYMENT_PROOF", paymentId: t1.paymentIds[0] } });
    const b1 = await loadTaskBlocks(db, org);
    ok(!b1.docTasks.find((v) => v.task.id === "saga-93")!.open, "saga-93 закрылась после загрузки платёжки");
    ok(b1.openDocs === b0.openDocs - 1, `счётчик ${b0.openDocs} → ${b1.openDocs}`);
    await db.driveDocument.delete({ where: { id: doc.id } });
    ok((await loadTaskBlocks(db, org)).openDocs === b0.openDocs, "после отката счётчик прежний");

    // автозакрытие по подтверждению оплаты
    const t2 = b0.docTasks.find((v) => v.task.id === "ame-167")!;
    const before = await db.payment.findUniqueOrThrow({ where: { id: t2.paymentIds[0] } });
    await db.payment.update({ where: { id: before.id }, data: { confirmed: true, confirmedAt: new Date() } });
    ok(!(await loadTaskBlocks(db, org)).docTasks.find((v) => v.task.id === "ame-167")!.open, "ame-167 закрылась после подтверждения оплаты");
    await db.payment.update({ where: { id: before.id }, data: { confirmed: before.confirmed, confirmedAt: before.confirmedAt } });

    // задача по закупкам: счёт №271 закрывается платёжкой на закупке СП 09.26
    const t3 = b0.docTasks.find((v) => v.task.id === "sp0926-271")!;
    ok(t3.open && (t3.overdueDays ?? 0) > 0 && t3.priority === "red", `sp0926-271: просрочена на ${t3.overdueDays} дн., срочная`);
    const p57 = await db.purchase.findFirstOrThrow({ where: { organizationId: org, number: "З-2026-0050" } });
    const d3 = await db.driveDocument.create({ data: { organizationId: org, driveFileId: "local-test-271", title: "Проба п/п 271", docType: "PAYMENT_PROOF", purchaseId: p57.id } });
    ok(!(await loadTaskBlocks(db, org)).docTasks.find((v) => v.task.id === "sp0926-271")!.open, "sp0926-271 закрылась по документу на закупке");
    await db.driveDocument.delete({ where: { id: d3.id } });

    // решение владельца
    const key = DECISION_KEY_PREFIX + "lot-728026";
    await db.systemState.upsert({ where: { organizationId_key: { organizationId: org, key } }, create: { organizationId: org, key, value: { choice: "grey", at: new Date().toISOString(), byName: "Тест", note: null } }, update: {} });
    const b4 = await loadTaskBlocks(db, org);
    ok(b4.openDecisions === b0.openDecisions - 1 && !b4.decisions.find((d) => d.decision.id === "lot-728026")!.open, "решение закрывает вопрос");
    await db.systemState.deleteMany({ where: { organizationId: org, key } });

    // письма
    const lt = (o: "mm" | "vellmex") => b0.docTasks.filter((v) => v.open && v.task.owner === o).map((v) => ({ title: v.task.title, record: v.task.record, amount: v.amount, kind: v.task.kind, dueText: v.dueText, checked: v.task.checked, later: !!v.task.later }));
    const mm = buildLetter("mm", lt("mm"), "2026-10-08");
    ok(mm.includes("Меркури Мода") && mm.includes("271"), `письмо для бухгалтерии: ${lt("mm").length} позиций`);
    ok(buildLetter("vellmex", lt("vellmex"), "2026-10-08").includes("Веллмех"), `письмо для Веллмех: ${lt("vellmex").length} позиций`);
  } finally {
    await db.$disconnect();
  }
  console.log(fails ? `\nПровалов: ${fails}` : "\nВсё в порядке");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
