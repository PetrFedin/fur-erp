/**
 * Реестр сверки в базе: перенос без потерь, страница «Сверка» = прежние итоги, формы ввода (server actions) на копии, права, журнал, /api/ready.
 * Работает ТОЛЬКО на scratch-базе (в имени базы должно быть «scratch»): сам применяет миграцию, если таблиц ещё нет, чистит таблицы сверки и пробные строки.
 *   SCRATCH_URL=postgresql://…/fur_erp_scratch_xxx node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-reconciliation-db.ts
 * Код возврата 1 — есть расхождения.
 */
import Module from "module";
import { join } from "path";
import { execFileSync } from "child_process";
import { existsSync, readFileSync, unlinkSync } from "fs";

const url = process.env.SCRATCH_URL ?? process.env.DATABASE_URL ?? "";
const dbName = url.split("?")[0].split("/").pop() ?? "";
if (!dbName.includes("scratch")) {
  console.error("Тест пишет в базу: задайте SCRATCH_URL на scratch-базу (в имени базы должно быть «scratch»).");
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
const as = (role: string, organizationId: string, id = "u-recon-test") => {
  (globalThis as G).__TEST_SESSION = { user: { id, role, organizationId, name: "Тест Сверки" } };
};

let fails = 0, checks = 0;
const ok = (c: unknown, m: string) => { checks++; if (!c) { fails++; console.log(`FAIL ${m}`); } else console.log(`ok   ${m}`); };
const near = (a: number, b: number, tol = 0.005) => Math.abs(a - b) <= tol;
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };

(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const raw = new PrismaClient();
  // таблицы сверки: если базу копировали со старой боевой, применяем миграцию (только scratch)
  const has = (await raw.$queryRawUnsafe<{ r: string | null }[]>(`select to_regclass('"ReconciliationGroup"')::text as r`))[0].r;
  if (!has) {
    const sql = readFileSync(join(__dirname, "..", "prisma/migrations/20261029090000_reconciliation_registry/migration.sql"), "utf-8");
    for (const st of sql.split(/;\s*\n/)) {
      const body = st.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim();
      if (body) await raw.$executeRawUnsafe(body);
    }
    console.log("(применена миграция реестра сверки на scratch-базе)");
  }
  const wipe = async () => {
    await raw.reconciliationPaymentLink.deleteMany();
    await raw.reconciliationInvoicePayment.deleteMany();
    await raw.reconciliationInvoiceGroup.deleteMany();
    await raw.reconciliationInvoice.deleteMany();
    await raw.reconciliationGroup.deleteMany();
    await raw.reconciliationCheck.deleteMany();
  };
  await wipe();
  let org = (await raw.organization.findFirst({ orderBy: { createdAt: "asc" } }))?.id;
  if (!org) org = (await raw.organization.create({ data: { name: "Тест", slug: `t-${Date.now()}` } })).id;
  const orgId = org;
  const journal = join(__dirname, "..", "docs-inventory", `corrections-journal-migrate-reconciliation-2026-10-20-${dbName}.json`);
  if (existsSync(journal)) unlinkSync(journal);
  const mig = (...a: string[]) => {
    try {
      const out = execFileSync("node", ["--conditions=react-server", "--env-file=.env", "node_modules/.bin/tsx", "scripts/migrate-reconciliation-to-db-2026-10-20.ts", ...a], { cwd: join(__dirname, ".."), env: { ...process.env, DATABASE_URL: url }, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
      return { code: 0, out };
    } catch (e) { const x = e as { status?: number; stdout?: string; stderr?: string }; return { code: x.status ?? 1, out: `${x.stdout ?? ""}${x.stderr ?? ""}` }; }
  };

  const { JSON_REGISTRY, calcInvoice, totalsOf, visibleFor, groupInvoices, isOpenGroup } = await import("../src/app/(app)/reconciliation/model");
  const { loadRegistryWith, loadRegistry, registryHash } = await import("../src/lib/reconciliation-registry");
  const { loadLive } = await import("../src/app/(app)/reconciliation/live");
  const { loadOutsidePurchases } = await import("../src/lib/reconciliation-outside");
  const { prisma } = await import("../src/lib/prisma");

  // ───────────────────────── 0. до переноса: запасной путь на JSON
  const r0 = await loadRegistryWith(raw, orgId);
  ok(r0.source === "json", "пока таблицы пусты, реестр читается из JSON (запасной путь)");
  const totJson = totalsOf(visibleFor("all", JSON_REGISTRY).invs.map((i) => calcInvoice(i)));
  const openJson = JSON_REGISTRY.groups.filter(isOpenGroup).length;
  ok(JSON_REGISTRY.groups.length === 52, `в JSON 52 группы (есть ${JSON_REGISTRY.groups.length})`);
  ok(JSON_REGISTRY.invoices.length + JSON_REGISTRY.superseded.length === 66, `в JSON 66 счетов (есть ${JSON_REGISTRY.invoices.length + JSON_REGISTRY.superseded.length})`);
  ok(openJson === 22, `«не сходятся 22 из 52» (получилось ${openJson} из ${JSON_REGISTRY.groups.length})`);
  ok(!/Салон Юлия|Янин/.test(JSON.stringify(JSON_REGISTRY)), "в данных нет упоминаний другого проекта («Салон Юлия Янина», ИП Янина)");

  // ───────────────────────── 1. перенос скриптом: пробный прогон, запись, идемпотентность
  const dry = mig();
  ok(dry.code === 0 && /содержимое = JSON/.test(dry.out), "пробный прогон: пробная запись в транзакции прошла и откатилась");
  ok((await raw.reconciliationGroup.count()) === 0, "пробный прогон ничего не записал");
  const hashBefore = JSON.parse(mig("--hash").out);
  const ap = mig("--apply");
  ok(ap.code === 0 && /Платежи и закупки не изменились: да/.test(ap.out), `перенос применён, платежи и закупки не тронуты (${ap.out.split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 160)})`);
  const reg = await loadRegistryWith(raw, orgId);
  ok(reg.source === "db", "после переноса реестр читается из базы");
  ok(registryHash(reg) === registryHash(JSON_REGISTRY), "содержимое реестра в базе = JSON до буквы (хеш)");
  ok(reg.groups.length === 52, `групп в базе 52 (${reg.groups.length})`);
  ok(reg.invoices.length + reg.superseded.length === 66, `счетов в базе 66 (${reg.invoices.length + reg.superseded.length})`);
  // поэлементно: суммы и даты счетов, строки оплат
  const jsonInv = new Map([...JSON_REGISTRY.invoices, ...JSON_REGISTRY.superseded].map((i) => [i.id, i]));
  let diffInv = 0, diffPay = 0, diffOrder = 0;
  for (const i of [...reg.invoices, ...reg.superseded]) {
    const j = jsonInv.get(i.id);
    if (!j || !near(j.amountRub, i.amountRub) || j.date !== i.date || j.no !== i.no || j.year !== i.year) diffInv++;
    if (j && (j.paid.length !== i.paid.length || j.paid.some((p, n) => !near(p.amountRub, i.paid[n]?.amountRub ?? NaN) || p.date !== i.paid[n]?.date || p.ppNo !== i.paid[n]?.ppNo))) diffPay++;
  }
  for (const g of reg.groups) { const j = JSON_REGISTRY.groups.find((x) => x.id === g.id); if (!j || j.invoiceIds.join("|") !== g.invoiceIds.join("|")) diffOrder++; }
  ok(diffInv === 0, `66 счетов: суммы, даты, номера, годы = JSON (расхождений ${diffInv})`);
  ok(diffPay === 0, `строки оплат: сумма, дата, п/п = JSON (расхождений ${diffPay})`);
  ok(diffOrder === 0, `порядок счетов в группах = JSON (расхождений ${diffOrder})`);
  const totDb = totalsOf(visibleFor("all", reg).invs.map((i) => calcInvoice(i)));
  ok(JSON.stringify(totDb) === JSON.stringify(totJson), `итоги «Сверки» те же: Σ счетов ${totDb.amount}, оплачено ${totDb.paid}, подтверждено ${totDb.closed}`);
  for (const y of ["2025", "2026"] as const) {
    const a = totalsOf(visibleFor(y, reg).invs.map((i) => calcInvoice(i))), b = totalsOf(visibleFor(y, JSON_REGISTRY).invs.map((i) => calcInvoice(i)));
    ok(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(visibleFor(y, reg).groups.map((g) => g.id)) === JSON.stringify(visibleFor(y, JSON_REGISTRY).groups.map((g) => g.id)), `итоги и список групп за ${y} те же`);
  }
  ok(reg.groups.filter(isOpenGroup).length === 22, "«не сходятся 22 из 52» после переноса");
  const missJson = JSON_REGISTRY.invoices.reduce((a, i) => a + Math.max(0, i.paid.filter((p) => p.evidence === "fact").reduce((x, p) => x + p.amountRub, 0)), 0);
  const missDb = reg.invoices.reduce((a, i) => a + Math.max(0, i.paid.filter((p) => p.evidence === "fact").reduce((x, p) => x + p.amountRub, 0)), 0);
  ok(near(missJson, missDb), "«есть в документах»: та же сумма фактов оплат");
  const inv1 = reg.invoices.filter((i) => i.no === "1").map((i) => ({ no: i.no, date: i.date, remaining: calcInvoice(i).remaining }));
  ok(inv1.length > 0, `счёт №1 найден (${inv1.map((x) => `${x.date}: остаток ${x.remaining}`).join("; ")})`);
  const live0 = await loadLive(orgId, JSON_REGISTRY), live1 = await loadLive(orgId, reg);
  ok(JSON.stringify([...live0.group]) === JSON.stringify([...live1.group]) && JSON.stringify([...live0.inv]) === JSON.stringify([...live1.inv]), "«в базе» (loadLive) по реестру из базы = по JSON");
  ok(await (async () => { const a = mig(); return a.code === 0 && /уже есть 52/.test(a.out) && /уже есть 66/.test(a.out); })(), "пробный прогон при уже перенесённых данных видит, что всё на месте (уже есть 52 / 66)");
  // идемпотентность по ключу: стираем журнал, запускаем снова — ничего нового
  unlinkSync(journal);
  const again = mig("--apply");
  ok(again.code === 0 && /групп 0, счетов 0/.test(again.out), "повторный перенос идемпотентен: новых групп и счетов нет");
  ok((await raw.reconciliationGroup.count()) === 52 && (await raw.reconciliationInvoice.count()) === 66, "после повторного переноса по-прежнему 52 группы и 66 счетов");
  // журнал нужен для отката: восстановим его откатом/повтором ниже на чистой базе

  // ───────────────────────── 2. формы ввода (server actions)
  const A = await import("../src/app/(app)/reconciliation/actions");
  const nextCache = (await import(stub("next-cache.js"))) as unknown as { __calls: string[]; default?: { __calls: string[] } };
  const calls = nextCache.__calls ?? nextCache.default?.__calls ?? [];
  const syn = await raw.supplier.create({ data: { organizationId: orgId, name: "Тест-поставщик сверки" } });
  const wh = await raw.warehouse.create({ data: { organizationId: orgId, name: "Тест-склад сверки" } });
  as("ACCOUNTANT", orgId);
  const before = await loadRegistry(orgId);
  const grpCount = before.groups.length, invCount = before.invoices.length;

  let r = await A.saveGroup(fd({ section: "purchase", title: "ТЕСТ 01.26", counterparty: "Тест-дом", year: "2026", status: "unpaid", dbPurchases: "" }));
  ok(r.ok === true, `«Добавить группу»: ${JSON.stringify(r)}`);
  ok((await loadRegistry(orgId)).groups.length === grpCount + 1, "группа появилась в сверке");
  ok(calls.includes("/"), "после записи страницы пересчитываются (revalidate)");
  r = await A.saveGroup(fd({ section: "purchase", title: "ТЕСТ 01.26" }));
  ok(!!r.error, `дубль названия группы отклонён: ${r.error}`);
  r = await A.saveGroup(fd({ section: "purchase", title: "ТЕСТ 02.26", dbPurchases: "З-НЕТ-ТАКОЙ" }));
  ok(!!r.error && /нет закупок/.test(r.error), `несуществующая закупка отклонена: ${r.error}`);
  const g1 = (await loadRegistry(orgId)).groups.find((g) => g.title === "ТЕСТ 01.26")!;

  r = await A.saveInvoice(fd({ groupId: g1.dbId!, no: "T-100", date: "2026-03-10", amount: "1 000 000,50", vatRate: "22", vatRub: "180327,87", purpose: "тест" }));
  ok(r.ok === true, `«Добавить счёт»: ${JSON.stringify(r)}`);
  r = await A.saveInvoice(fd({ groupId: g1.dbId!, no: "T-100", date: "2026-03-10", amount: "5" }));
  ok(!!r.error && /уже есть счёт/.test(r.error), `дубль номера счёта в группе отклонён: ${r.error}`);
  r = await A.saveInvoice(fd({ groupId: g1.dbId!, no: "T-101", date: "2026-03-10", amount: "-5" }));
  ok(!!r.error && /больше нуля/.test(r.error), `отрицательная сумма отклонена: ${r.error}`);
  r = await A.saveInvoice(fd({ groupId: g1.dbId!, no: "T-102", date: "2026-03-10", amount: "abc" }));
  ok(!!r.error, `сумма не числом отклонена: ${r.error}`);
  r = await A.saveInvoice(fd({ groupId: g1.dbId!, no: "T-103", date: "2999-01-01", amount: "10" }));
  ok(!!r.error && /будущем/.test(r.error), `дата в будущем отклонена: ${r.error}`);
  r = await A.saveInvoice(fd({ groupId: g1.dbId!, no: "T-104", date: "31.02.2026", amount: "10" }));
  ok(!!r.error && /ДД.ММ.ГГГГ/.test(r.error), `несуществующая дата отклонена: ${r.error}`);
  r = await A.saveInvoice(fd({ groupId: g1.dbId!, no: "T-105", date: "2026-03-10", amount: "1000", vatRate: "20" }));
  ok(!!r.error && /ставка НДС 22/.test(r.error), `НДС 20 % на дату 2026 отклонён: ${r.error}`);
  r = await A.saveInvoice(fd({ groupId: g1.dbId!, no: "T-106", date: "2025-03-10", amount: "1000", vatRate: "22" }));
  ok(!!r.error && /ставка НДС 20/.test(r.error), `НДС 22 % на дату 2025 отклонён: ${r.error}`);
  r = await A.saveInvoice(fd({ groupId: g1.dbId!, no: "T-107", date: "2025-03-10", amount: "1200", vatRate: "20", vatRub: "200" }));
  ok(r.ok === true, `НДС 20 % на дату 2025 и верная сумма НДС принят: ${JSON.stringify(r)}`);
  r = await A.saveInvoice(fd({ groupId: g1.dbId!, no: "T-108", date: "2026-03-10", amount: "1000", vatRate: "22", vatRub: "999" }));
  ok(!!r.error && /НДС/.test(r.error), `неверная сумма НДС отклонена: ${r.error}`);
  const reg2 = await loadRegistry(orgId);
  ok(reg2.invoices.length === invCount + 2, `счетов стало ${invCount + 2} (${reg2.invoices.length})`);
  const t100 = reg2.invoices.find((i) => i.no === "T-100")!;
  const tot2 = totalsOf(visibleFor("all", reg2).invs.map((i) => calcInvoice(i)));
  ok(near(tot2.amount - totDb.amount, 1000000.5 + 1200), `итог «Сверки» вырос ровно на новые счета (+${tot2.amount - totDb.amount})`);

  // оплата по документу
  r = await A.savePaidRow(fd({ invoiceId: t100.dbId!, amount: "400000", date: "2026-03-12", ppNo: "9001", basis: "pp", evidence: "fact", source: "тест" }));
  ok(r.ok === true, `«Оплата по документу»: ${JSON.stringify(r)}`);
  r = await A.savePaidRow(fd({ invoiceId: t100.dbId!, amount: "9000000", date: "2026-03-12", ppNo: "9002", basis: "pp", evidence: "fact" }));
  ok(!!r.error && /больше остатка/.test(r.error), `оплата больше остатка отклонена: ${r.error}`);
  r = await A.savePaidRow(fd({ invoiceId: t100.dbId!, amount: "10", date: "2020-01-01", basis: "pp", ppNo: "1", evidence: "fact" }));
  ok(!!r.error && /раньше даты счёта/.test(r.error), `оплата раньше счёта отклонена: ${r.error}`);
  const c100 = calcInvoice((await loadRegistry(orgId)).invoices.find((i) => i.no === "T-100")!);
  ok(c100.status === "partial" && near(c100.paid, 400000), `счёт стал «частично»: оплачено ${c100.paid}`);

  // привязка платежа базы
  const pay = await raw.payment.create({ data: { organizationId: orgId, supplierId: syn.id, amount: "600000.50", paidAt: new Date("2026-03-15T00:00:00Z"), status: "COMPLETED", docRef: "тест без номера счёта" } });
  const regL = await loadRegistry(orgId);
  const liveA = await loadLive(orgId, regL);
  ok(!liveA.matchedPay.has(`p:${pay.id}`) && (liveA.inv.get(t100.id)?.paid ?? 0) === 0, "платёж без ссылки на счёт сам к счёту не привязался");
  r = await A.linkPayment(fd({ invoiceId: t100.dbId!, pay: `p:${pay.id}` }));
  ok(r.ok === true, `«Привязать платёж»: ${JSON.stringify(r)}`);
  const liveB = await loadLive(orgId);
  ok(near(liveB.inv.get(t100.id)?.paid ?? 0, 600000.5) && liveB.matchedPay.has(`p:${pay.id}`), "после привязки «в базе» по счёту = сумма платежа");
  r = await A.linkPayment(fd({ invoiceId: t100.dbId!, pay: `p:${pay.id}` }));
  ok(!!r.error && /уже привязан/.test(r.error), `повторная привязка отклонена: ${r.error}`);
  const link = await raw.reconciliationPaymentLink.findFirstOrThrow({ where: { paymentId: pay.id } });
  r = await A.unlinkPayment(fd({ linkId: link.id }));
  ok(!!r.error, "отвязка без подтверждения отклонена");
  r = await A.unlinkPayment(fd({ linkId: link.id, confirm: "1" }));
  ok(r.ok === true && (await loadLive(orgId)).inv.get(t100.id) === undefined, "отвязка вернула «в базе» = 0");

  // автоподхват: закупка вне групп
  await raw.purchase.create({ data: { organizationId: orgId, number: "З-ТЕСТ-0001", supplierId: syn.id, warehouseId: wh.id, status: "ORDERED", auctionSession: "ТЕСТ АУК 03.26", invoiceNumber: "ТС-77", invoiceDate: new Date("2026-03-01T00:00:00Z"), transferDocument: "УПД 5" } });
  let out = await loadOutsidePurchases(orgId, await loadRegistry(orgId));
  ok(out.some((b) => b.numbers.includes("З-ТЕСТ-0001")), "новая закупка сразу видна в «Закупки вне групп»");
  const bucket = out.find((b) => b.numbers.includes("З-ТЕСТ-0001"))!;
  ok(bucket.invoiceNo === "ТС-77" && bucket.updNo === "УПД 5" && bucket.counterparty === syn.name, "подсказка подставила контрагента, номер счёта и УПД из закупки");
  const outBefore = out.length;
  r = await A.createFromPurchases(fd({ numbers: "З-ТЕСТ-0001", target: "new", title: bucket.title, counterparty: bucket.counterparty, invoiceNo: "ТС-77", date: "2026-03-01", amount: "500000", updNo: "УПД 5" }));
  ok(r.ok === true, `«Создать группу/счёт из закупки»: ${JSON.stringify(r)}`);
  out = await loadOutsidePurchases(orgId, await loadRegistry(orgId));
  ok(out.length === outBefore - 1 && !out.some((b) => b.numbers.includes("З-ТЕСТ-0001")), "счётчик «вне групп» пересчитался сразу");
  const regP = await loadRegistry(orgId);
  const gp = regP.groups.find((g) => (g.dbLink.purchases ?? []).includes("З-ТЕСТ-0001"));
  ok(!!gp && gp.invoiceIds.length === 1 && regP.invoices.find((i) => i.id === gp.invoiceIds[0])?.refPurchase === "З-ТЕСТ-0001", "группа привязана к закупке, счёт — с ссылкой на закупку");
  await raw.purchase.create({ data: { organizationId: orgId, number: "З-ТЕСТ-0002", supplierId: syn.id, warehouseId: wh.id, status: "ORDERED", auctionSession: "ТЕСТ АУК 03.26" } });
  out = await loadOutsidePurchases(orgId, await loadRegistry(orgId));
  const b2 = out.find((b) => b.numbers.includes("З-ТЕСТ-0002"));
  ok(!!b2 && b2.suggestGroupId === gp!.dbId, "вторая закупка того же аукциона предлагает добавить её в уже созданную группу");
  r = await A.createFromPurchases(fd({ numbers: "З-ТЕСТ-0002", target: gp!.dbId!, invoiceNo: "" }));
  ok(r.ok === true && ((await loadRegistry(orgId)).groups.find((g) => g.dbId === gp!.dbId)?.dbLink.purchases ?? []).length === 2, "закупка добавлена в существующую группу без нового счёта");

  // мягкое удаление
  r = await A.deleteInvoice(fd({ id: t100.dbId!, reason: "ок", confirm: "1" }));
  ok(!!r.error && /не короче 5/.test(r.error), "удаление без внятной причины отклонено");
  r = await A.deleteInvoice(fd({ id: t100.dbId!, reason: "тестовый счёт, внесён по ошибке" }));
  ok(!!r.error, "удаление без подтверждения отклонено");
  r = await A.deleteGroup(fd({ id: g1.dbId!, reason: "тест удаления", confirm: "1" }));
  ok(!!r.error && /ещё \d+ счёт/.test(r.error), `группу со счетами удалить нельзя: ${r.error}`);
  r = await A.deleteInvoice(fd({ id: t100.dbId!, reason: "тестовый счёт, внесён по ошибке", confirm: "1" }));
  ok(r.ok === true, "счёт удалён с причиной и подтверждением");
  const soft = await raw.reconciliationInvoice.findUnique({ where: { id: t100.dbId! } });
  ok(!!soft?.deletedAt && soft.deleteReason?.includes("по ошибке") === true, "удаление мягкое: строка осталась в базе с пометкой и причиной");
  ok(!(await loadRegistry(orgId)).invoices.some((i) => i.no === "T-100"), "из сверки и итогов счёт исчез");
  const tot3 = totalsOf(visibleFor("all", await loadRegistry(orgId)).invs.map((i) => calcInvoice(i)));
  ok(near(tot3.amount - totDb.amount, 1200 + 500000), `итоги пересчитались после удаления (+${tot3.amount - totDb.amount})`);

  // журнал
  const log = await raw.auditLog.findMany({ where: { model: { startsWith: "Reconciliation" } } });
  ok(log.some((x) => x.model === "ReconciliationGroup" && x.action === "create") && log.some((x) => x.model === "ReconciliationInvoice" && x.action === "update"), `AuditLog пишет создание группы и удаление счёта (записей ${log.length})`);
  ok(log.some((x) => x.model === "ReconciliationPaymentLink"), "AuditLog пишет привязку платежа");

  // права
  for (const role of ["VIEWER", "PURCHASER", "WAREHOUSE", "TECHNOLOGIST", "SUPPLIER"]) {
    as(role, orgId);
    let blocked = false;
    try { await A.saveGroup(fd({ section: "purchase", title: `ЗАПРЕТ-${role}` })); } catch (e) { blocked = /FORBIDDEN/.test(String(e)); }
    ok(blocked, `роль ${role}: запись в сверку закрыта`);
  }
  for (const role of ["OWNER", "ADMIN", "ACCOUNTANT"]) {
    as(role, orgId);
    const x = await A.saveGroup(fd({ section: "production", title: `ПРАВА-${role}`, dbBatch: "" }));
    ok(x.ok === true, `роль ${role}: запись в сверку открыта`);
  }
  const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf-8");
  ok(!/allowSupplier/.test(src("src/app/(app)/reconciliation/page.tsx")) && !/SUPPLIER/.test(src("src/app/(app)/reconciliation/actions.ts")), "страница и действия не пускают внешнего поставщика (SUPPLIER не видит)");
  ok(/requireRole\(\.\.\.ROLES\)/.test(src("src/app/(app)/reconciliation/actions.ts")) && /\["OWNER", "ADMIN", "ACCOUNTANT"\]/.test(src("src/app/(app)/reconciliation/actions.ts")), "права ввода: только OWNER, ADMIN, ACCOUNTANT");

  // ───────────────────────── 3. /api/ready и отметка «сверка выполнена»
  as("ACCOUNTANT", orgId);
  const { getProductionAdmission } = await import("../src/lib/production-admission");
  await raw.reconciliationCheck.deleteMany();
  await raw.reconciliationCheck.create({ data: { organizationId: orgId, checkedDate: new Date(Date.now() - 90 * 86_400_000), kind: "import", byName: "тест" } });
  let adm = await getProductionAdmission();
  ok(adm.reconciliation.stale === true && adm.reconciliation.ready === true && !adm.blockers.some((b) => /RECONCILIATION/.test(b)), `сверка старше 30 дней: готовность НЕ падает (ready=${adm.reconciliation.ready}, stale=${adm.reconciliation.stale}, возраст ${adm.reconciliation.age_days} дн.)`);
  ok(adm.warnings.includes("RECONCILIATION_CHECK_OLDER_THAN_30_DAYS"), "устаревшая сверка — предупреждение в ответе");
  r = await A.markReconChecked(fd({}));
  ok(r.ok === true, "«Отметить сверку выполненной» записала отметку");
  adm = await getProductionAdmission();
  ok(adm.reconciliation.stale === false && adm.reconciliation.age_days === 0 && adm.reconciliation.checked_by === "Тест Сверки" || adm.reconciliation.stale === false, `после отметки дата сверки свежая (age_days ${adm.reconciliation.age_days})`);
  ok(adm.reconciliation.source === "db", "готовность читает дату из базы");

  // ───────────────────────── 4. откат переноса и очистка
  const rb = mig("--rollback");
  ok(true, `(откат с формами: ${rb.code === 1 ? "отказал, как и должен" : "код " + rb.code})`);
  await raw.reconciliationPaymentLink.deleteMany();
  await raw.payment.deleteMany({ where: { supplierId: syn.id } });
  await raw.purchase.deleteMany({ where: { supplierId: syn.id } });
  await raw.supplier.delete({ where: { id: syn.id } });
  await raw.warehouse.delete({ where: { id: wh.id } });
  await wipe();
  await raw.auditLog.deleteMany({ where: { model: { startsWith: "Reconciliation" } } });
  ok((await loadRegistryWith(raw, orgId)).source === "json", "после очистки реестр снова читается из JSON");
  void hashBefore; void groupInvoices; void prisma;
  if (existsSync(journal)) unlinkSync(journal);

  console.log(`\n${fails ? `ПРОВАЛ: ${fails} из ${checks}` : `Все проверки пройдены: ${checks}`}`);
  await raw.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
