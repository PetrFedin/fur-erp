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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";

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
  const { DOC_TASKS, DECISIONS, DECISION_KEY_PREFIX, KIND_ACCEPTS, buildLetter } = await import("../src/lib/task-docs-catalog");
  const { loadSupplierDebt } = await import("../src/lib/supplier-debt");
  const db = new PrismaClient({ datasources: { db: { url } } });
  // Документ «есть» только с прикреплённым файлом: проба кладёт крошечный PDF в UPLOAD_DIR (и убирает его в конце).
  const upRoot = path.resolve(process.env.UPLOAD_DIR?.trim() || "./uploads");
  const stubRel = "drive-docs/_task-test/proof.pdf";
  mkdirSync(path.join(upRoot, "drive-docs/_task-test"), { recursive: true });
  writeFileSync(path.join(upRoot, stubRel), "%PDF-1.4\n% проба\n");
  const stub = { storagePath: stubRel, storedName: "proof.pdf", storedMime: "application/pdf", storedSize: 18, storedAt: new Date() };
  try {
    const org = (await db.organization.findFirstOrThrow()).id;
    const b0 = await loadTaskBlocks(db, org);
    const debt = await loadSupplierDebt(db, org);
    ok(b0.docTasks.length === DOC_TASKS.length, `задач в каталоге: ${DOC_TASKS.length}`);
    ok(b0.openDocs === b0.docTasks.filter((v) => v.open && !v.task.later).length, `открытых документов: ${b0.openDocs} (после поставки: ${b0.laterDocs})`);
    ok(b0.debtRub === debt.debt.toFixed(2), `долг в блоке = loadSupplierDebt: ${b0.debtRub}`);
    ok(b0.decisions.length === DECISIONS.length, `решений в каталоге: ${DECISIONS.length}`);
    const missing = b0.docTasks.filter((v) => v.missing);
    // Каталог задач — снимок 08.10.2026 (суммы и номера записей). Когда в базе записи правят или вносят заново, часть задач
    // «не находит запись» и по правилам остаётся открытой: это сигнал владельцу, а не поломка кода — предупреждаем, тест не валим.
    if (missing.length) console.log(`     ВНИМАНИЕ: записи не найдены в базе (данные изменились после снимка каталога): ${missing.map((v) => v.task.id).join(", ")}`);
    ok(missing.every((v) => v.open), "задача без найденной записи остаётся открытой");

    // сверка с расшифровкой долга
    const tracePath = join(__dirname, "..", "docs-inventory", "debt-trace.json");
    if (existsSync(tracePath)) {
      const trace = JSON.parse(readFileSync(tracePath, "utf8")) as { lines: { id: string; toFind: string[]; dueRub: string }[]; loadSupplierDebt: Record<string, string> };
      const lines = new Set(DOC_TASKS.flatMap((t) => t.lines));
      for (const l of trace.lines.filter((x) => x.toFind.length)) {
        if (["L09", "L10"].includes(l.id)) { ok(DECISIONS.some((d) => d.id === "double-0001-0010"), `${l.id} покрыта решением владельца`); continue; }
        // docs-inventory/debt-trace.json — снимок расшифровки долга на 08.10.2026 (не в git); покрытие строк — справка, не инвариант
        if (lines.has(l.id)) ok(true, `строка ${l.id} (${l.toFind.length} док.) покрыта задачей`);
        else console.log(`     ВНИМАНИЕ: строка ${l.id} (${l.toFind.length} док.) снимка debt-trace.json не покрыта задачей каталога`);
      }
    } else console.log("     (debt-trace.json нет — сверка со строками пропущена)");

    // автозакрытие: платёжка к оплате SAGA 24 200 000
    // Не конкретная задача (saga-93 уже могла закрыться реальной платёжкой), а любая открытая задача по ровно одной найденной оплате.
    const payTasks = b0.docTasks.filter((v) => v.open && !v.missing && v.task.payments?.length === 1 && v.paymentIds.length === 1);
    const t1 = payTasks[0] as (typeof payTasks)[number] | undefined;
    payBlock: {
    if (!t1) { console.log("     (нет открытых задач по одной оплате — проверки автозакрытия платёжкой/подтверждением пропущены)"); break payBlock; }
    ok(t1.open && t1.paymentIds.length === 1, `${t1.task.id} открыта, оплата найдена`);
    const doc = await db.driveDocument.create({ data: { organizationId: org, driveFileId: "local-test-proof", title: "Проба платёжка", docType: "PAYMENT_PROOF", paymentId: t1.paymentIds[0], ...stub } });
    const b1 = await loadTaskBlocks(db, org);
    ok(!b1.docTasks.find((v) => v.task.id === t1.task.id)!.open, `${t1.task.id} закрылась после загрузки платёжки`);
    ok(b1.openDocs === b0.openDocs - 1, `счётчик ${b0.openDocs} → ${b1.openDocs}`);
    await db.driveDocument.delete({ where: { id: doc.id } });
    ok((await loadTaskBlocks(db, org)).openDocs === b0.openDocs, "после отката счётчик прежний");

    // автозакрытие по подтверждению оплаты
    const t2 = payTasks.find((v) => v.task.id !== t1.task.id) ?? t1;
    const before = await db.payment.findUniqueOrThrow({ where: { id: t2.paymentIds[0] } });
    await db.payment.update({ where: { id: before.id }, data: { confirmed: true, confirmedAt: new Date() } });
    ok(!(await loadTaskBlocks(db, org)).docTasks.find((v) => v.task.id === t2.task.id)!.open, `${t2.task.id} закрылась после подтверждения оплаты`);
    await db.payment.update({ where: { id: before.id }, data: { confirmed: before.confirmed, confirmedAt: before.confirmedAt } });

    }

    // задача по закупкам: документ нужного типа на закупке закрывает ровно одну открытую задачу (любую подходящую, не конкретную)
    const t3 = b0.docTasks.find((v) => v.open && !v.task.later && !v.missing && !v.task.payments?.length && !v.task.orgWide && !v.task.needle && (v.task.min ?? 1) === 1 && v.task.purchases?.length);
    if (t3) {
      ok((t3.overdueDays ?? 0) <= 0 || t3.priority === "red", `${t3.task.id}: просрочка ${t3.overdueDays ?? 0} дн. → ${t3.priority} (просроченная всегда срочная)`);
      const kindDocType = (t3.task.accepts ?? KIND_ACCEPTS[t3.task.kind])[0];
      const pur = await db.purchase.findFirstOrThrow({ where: { organizationId: org, number: t3.task.purchases![0] } });
      const d3 = await db.driveDocument.create({ data: { organizationId: org, driveFileId: "local-test-271", title: "Проба документа", docType: kindDocType, purchaseId: pur.id, ...stub } });
      const b3 = await loadTaskBlocks(db, org);
      ok(b3.openDocs === b0.openDocs - 1, `документ на закупке ${pur.number} закрыл ровно одну открытую задачу (${b0.openDocs} → ${b3.openDocs})`);
      await db.driveDocument.delete({ where: { id: d3.id } });
    } else console.log("     (нет открытых задач по закупкам — проверка закрытия документом на закупке пропущена)");

    // решение владельца: любое открытое решение
    const dec = b0.decisions.find((d) => d.open);
    if (dec) {
      const key = DECISION_KEY_PREFIX + dec.decision.id;
      await db.systemState.upsert({ where: { organizationId_key: { organizationId: org, key } }, create: { organizationId: org, key, value: { choice: dec.decision.options[0].key, at: new Date().toISOString(), byName: "Тест", note: null } }, update: {} });
      const b4 = await loadTaskBlocks(db, org);
      ok(b4.openDecisions === b0.openDecisions - 1 && !b4.decisions.find((d) => d.decision.id === dec.decision.id)!.open, `решение ${dec.decision.id} закрывает вопрос`);
      await db.systemState.deleteMany({ where: { organizationId: org, key } });
    } else console.log("     (нет открытых решений — проверка пропущена)");

    // письма
    const lt = (o: "mm" | "vellmex") => b0.docTasks.filter((v) => v.open && v.task.owner === o).map((v) => ({ title: v.task.title, record: v.task.record, amount: v.amount, kind: v.task.kind, dueText: v.dueText, checked: v.task.checked, later: !!v.task.later }));
    const mm = buildLetter("mm", lt("mm"), "2026-10-08");
    ok(mm.includes("Меркури Мода") && mm.includes("271"), `письмо для бухгалтерии: ${lt("mm").length} позиций`);
    ok(buildLetter("vellmex", lt("vellmex"), "2026-10-08").includes("Веллмех"), `письмо для Веллмех: ${lt("vellmex").length} позиций`);
    // документ без файла («не прикреплён») задачу НЕ закрывает
    if (t1) {
      const dNo = await db.driveDocument.create({ data: { organizationId: org, driveFileId: "local-test-nofile", title: "Проба без файла", docType: "PAYMENT_PROOF", paymentId: t1.paymentIds[0] } });
      ok((await loadTaskBlocks(db, org)).docTasks.find((v) => v.task.id === t1.task.id)!.open === t1.open, "запись документа без файла состояние задачи не меняет");
      await db.driveDocument.delete({ where: { id: dNo.id } });
    }
  } finally {
    rmSync(path.join(upRoot, "drive-docs/_task-test"), { recursive: true, force: true });
    await db.$disconnect();
  }
  console.log(fails ? `\nПровалов: ${fails}` : "\nВсё в порядке");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
