/**
 * Реестр сверки: перенос из src/data/reconciliation.json в таблицы базы (ReconciliationGroup / Invoice / InvoiceGroup / InvoicePayment / Check).
 * Решение владельца 20.10.2026: «Реестр сверки перенести в базу с формой — делай как правильно и логично».
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/migrate-reconciliation-to-db-2026-10-20.ts                  # пробный прогон: план + пробная запись в транзакции с откатом и сверка «таблицы = JSON»
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/migrate-reconciliation-to-db-2026-10-20.ts --apply          # записать на НЕ боевой базе (копия)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/migrate-reconciliation-to-db-2026-10-20.ts --apply --live   # записать на боевой базе fur_erp (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/migrate-reconciliation-to-db-2026-10-20.ts --rollback [--apply [--live]]   # откат: удалить то, что создал перенос
 *   ... --hash    контрольные суммы: таблицы сверки (до записи и после отката совпадают) и платежи/закупки (перенос их не трогает)
 *   ... --force   откат, даже если перенесённые строки уже правили формами (по умолчанию откат в этом случае отказывает)
 *
 * ПЕРЕДАЁТ БЕЗ ПОТЕРЬ: 52 группы, 66 счетов (в т. ч. заменённые), все строки оплат, согласования, примечания, доли общих счетов, блок «Перепроверка», дату сверки.
 * ИДЕМПОТЕНТНО: по ключу (группа «P:СП 03.25», счёт «purchase:31:2025-02-27»); уже существующие строки не перезаписываются.
 * НЕ ТРОГАЕТ платежи, закупки, ТЗ, партии (хеш до/после).
 * Журнал: docs-inventory/corrections-journal-migrate-reconciliation-2026-10-20.json (для копии — с суффиксом имени базы) + AuditLog (script:migrate-reconciliation-to-db-2026-10-20).
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
import { createHash, randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const APPLY = has("--apply");
const LIVE = has("--live");
const ROLLBACK = has("--rollback");
const NO_BACKUP = has("--no-backup");
const HASH = has("--hash");
const FORCE = has("--force");
const ACTOR = "script:migrate-reconciliation-to-db-2026-10-20";
const SRC = "import:reconciliation.json";

const ROOT = join(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const sha = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");
const money = (v: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Journal = { script: string; status: "applied" | "rolled-back"; at: string; db: string; groupIds: string[]; invoiceIds: string[]; checkIds: string[]; registryHash: string };
const readJson = <T,>(p: string, def: T): T => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf-8")) as T) : def);
const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 1));
class Rollback extends Error {}

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { groupToRow, invoiceToRow, payToRow, loadRegistryWith, registryHash } = await import("../src/lib/reconciliation-registry");
  const { JSON_REGISTRY, calcInvoice, totalsOf, isOpenGroup } = await import("../src/app/(app)/reconciliation/model");
  const url = process.env.DATABASE_URL ?? "";
  const dbName = url.split("?")[0].split("/").pop() ?? "";
  const isLive = dbName === "fur_erp";
  if (APPLY && isLive && !LIVE) throw new Error(`База «${dbName}» боевая: для записи нужен --live (для репетиции укажите копию через DATABASE_URL).`);
  if (APPLY && !isLive && LIVE) throw new Error(`--live указан, но DATABASE_URL смотрит на «${dbName}», а не на fur_erp.`);
  const prisma = createAuditedClient(ACTOR);
  const JOURNAL = join(INV, `corrections-journal-migrate-reconciliation-2026-10-20${isLive ? "" : `-${dbName}`}.json`);
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;

  const raw = [...JSON_REGISTRY.invoices, ...JSON_REGISTRY.superseded];
  // порядок счетов в исходном файле (superseded тоже стоят среди остальных)
  const data = JSON.parse(readFileSync(join(ROOT, "src/data/reconciliation.json"), "utf-8")) as { invoices: { id: string }[] };
  const order = new Map(data.invoices.map((i, n) => [i.id, n]));
  const invoices = raw.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const jsonHash = registryHash(JSON_REGISTRY);

  // ───────── контрольные суммы
  const stateHash = async () => {
    const t = {
      groups: await prisma.reconciliationGroup.findMany({ orderBy: { key: "asc" } }),
      invoices: await prisma.reconciliationInvoice.findMany({ orderBy: { key: "asc" } }),
      links: await prisma.reconciliationInvoiceGroup.findMany({ orderBy: { id: "asc" } }),
      pays: await prisma.reconciliationInvoicePayment.findMany({ orderBy: { id: "asc" } }),
      payLinks: await prisma.reconciliationPaymentLink.findMany({ orderBy: { id: "asc" } }),
      checks: await prisma.reconciliationCheck.findMany({ orderBy: { id: "asc" } }),
    };
    const core = {
      payments: await prisma.payment.findMany({ orderBy: { id: "asc" }, select: { id: true, amount: true, paidAt: true, docRef: true, status: true, purchaseId: true } }),
      prodPayments: await prisma.productionPayment.findMany({ orderBy: { id: "asc" }, select: { id: true, amount: true, paidAt: true, docRef: true, status: true } }),
      purchases: await prisma.purchase.findMany({ orderBy: { id: "asc" }, select: { id: true, number: true, status: true, auctionSession: true } }),
    };
    const reg = await loadRegistryWith(prisma, org);
    return {
      reconciliationTables: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { count: v.length, sha: sha(v) }])),
      corePaymentsPurchases: Object.fromEntries(Object.entries(core).map(([k, v]) => [k, { count: v.length, sha: sha(v) }])),
      registrySource: reg.source,
      registryContentSha: registryHash(reg),
      jsonContentSha: jsonHash,
    };
  };
  if (HASH) { console.log(JSON.stringify(await stateHash(), null, 1)); await prisma.$disconnect(); return; }

  // ───────── откат
  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал не содержит применённого переноса — откатывать нечего."); await prisma.$disconnect(); return; }
    const groups = await prisma.reconciliationGroup.findMany({ where: { id: { in: j.groupIds } } });
    const invs = await prisma.reconciliationInvoice.findMany({ where: { id: { in: j.invoiceIds } }, include: { payments: true, links: true } });
    const problems: string[] = [];
    for (const g of groups) if (g.updatedAt.getTime() - g.createdAt.getTime() > 3000) problems.push(`группа «${g.title}» правилась после переноса`);
    for (const i of invs) {
      if (i.updatedAt.getTime() - i.createdAt.getTime() > 3000) problems.push(`счёт №${i.no ?? "—"} правился после переноса`);
      if (i.links.length) problems.push(`к счёту №${i.no ?? "—"} привязаны платежи формой`);
    }
    const extraGroups = await prisma.reconciliationGroup.count({ where: { organizationId: org, id: { notIn: j.groupIds } } });
    if (extraGroups) problems.push(`в базе ${extraGroups} групп(ы), созданных не переносом (формами): при откате они останутся без счетов-основы`);
    console.log(`Откат: групп ${groups.length}, счетов ${invs.length}${problems.length ? "\nПредупреждения:\n - " + problems.join("\n - ") : ""}`);
    if (problems.length && !FORCE) { console.log("\nОткат отклонён: данные уже правили в базе. Повторите с --force, если это сознательно."); await prisma.$disconnect(); process.exitCode = 1; return; }
    if (!APPLY) { console.log("\nПробный прогон: ничего не удалено. Для отката — --rollback --apply (копия) или --rollback --apply --live."); await prisma.$disconnect(); return; }
    if (isLive && !NO_BACKUP) { console.log("Копия базы перед откатом: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
    await prisma.$transaction(async (tx) => {
      await tx.reconciliationCheck.deleteMany({ where: { id: { in: j.checkIds } } });
      await tx.reconciliationInvoice.deleteMany({ where: { id: { in: j.invoiceIds } } }); // строки оплат/долей/привязок уходят каскадом
      await tx.reconciliationGroup.deleteMany({ where: { id: { in: j.groupIds } } });
    });
    writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
    console.log("Откат выполнен. Реестр снова читается из JSON, пока в таблицах нет групп.");
    await prisma.$disconnect();
    return;
  }

  // ───────── план
  const existingGroups = new Map((await prisma.reconciliationGroup.findMany({ where: { organizationId: org }, select: { key: true } })).map((g) => [g.key, true]));
  const existingInvoices = new Map((await prisma.reconciliationInvoice.findMany({ where: { organizationId: org }, select: { key: true } })).map((g) => [g.key, true]));
  const newGroups = JSON_REGISTRY.groups.filter((g) => !existingGroups.has(g.id));
  const newInvoices = invoices.filter((i) => !existingInvoices.has(i.id));
  const calc = JSON_REGISTRY.invoices.map((i) => calcInvoice(i));
  const tot = totalsOf(calc);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  console.log("ИСТОЧНИК: src/data/reconciliation.json (дата сверки " + JSON_REGISTRY.checkedAt + ")");
  console.log(`  групп ${JSON_REGISTRY.groups.length}, счетов ${invoices.length} (учитываются ${JSON_REGISTRY.invoices.length}, заменённых ${JSON_REGISTRY.superseded.length}), строк оплат ${sum(invoices.map((i) => i.paid.length))}`);
  console.log(`  Σ счетов ${money(tot.amount)} ₽, оплачено по документам ${money(tot.paid)} ₽, не сходятся ${JSON_REGISTRY.groups.filter(isOpenGroup).length} из ${JSON_REGISTRY.groups.length} групп`);
  console.log(`ПЛАН для базы «${dbName}»: создать групп ${newGroups.length} (уже есть ${JSON_REGISTRY.groups.length - newGroups.length}), счетов ${newInvoices.length} (уже есть ${invoices.length - newInvoices.length})`);
  console.log("УПОМИНАНИЯ ДРУГОГО ПРОЕКТА («Салон Юлия Янина», ИП Янина): в данных реестра не найдены — убраны правкой 2bc6666 до переноса, переносить нечего.");
  const foreign = JSON.stringify(JSON_REGISTRY).match(/Салон Юлия|Янин/g);
  if (foreign) throw new Error(`В данных реестра ещё есть упоминание другого проекта (${foreign.length}): уберите перед переносом.`);

  // ───────── запись (одна функция для пробы и для настоящего применения)
  const writeAll = async (tx: typeof prisma) => {
    const gid = new Map<string, string>();
    const iid = new Map<string, string>();
    const groupRows = newGroups.map((g) => {
      const id = `rcg_${randomUUID()}`;
      gid.set(g.id, id);
      return { id, organizationId: org, source: SRC, createdByName: ACTOR, ...groupToRow(g, JSON_REGISTRY.groups.indexOf(g)) };
    });
    const invRows = newInvoices.map((i) => {
      const id = `rci_${randomUUID()}`;
      iid.set(i.id, id);
      return { id, organizationId: org, source: SRC, createdByName: ACTOR, ...invoiceToRow(i, order.get(i.id) ?? 0) };
    });
    const dbG = new Map((await tx.reconciliationGroup.findMany({ where: { organizationId: org }, select: { id: true, key: true } })).map((g) => [g.key, g.id]));
    const dbI = new Map((await tx.reconciliationInvoice.findMany({ where: { organizationId: org }, select: { id: true, key: true } })).map((g) => [g.key, g.id]));
    for (const [k, v] of gid) dbG.set(k, v);
    for (const [k, v] of iid) dbI.set(k, v);
    await tx.reconciliationGroup.createMany({ data: groupRows as never });
    await tx.reconciliationInvoice.createMany({ data: invRows as never });
    // связи «счёт ↔ группа» только для вновь созданных счетов
    const links = newInvoices.flatMap((i) =>
      i.groupIds.map((g, posInInvoice) => ({
        organizationId: org, invoiceId: iid.get(i.id)!, groupId: dbG.get(g)!,
        shareRub: i.shares[g] != null ? i.shares[g].toFixed(2) : null,
        posInGroup: Math.max(0, JSON_REGISTRY.groups.find((x) => x.id === g)?.invoiceIds.indexOf(i.id) ?? 0),
        posInInvoice,
      })),
    );
    if (links.some((l) => !l.groupId)) throw new Error("Счёт ссылается на группу, которой нет в реестре");
    await tx.reconciliationInvoiceGroup.createMany({ data: links as never });
    const pays = newInvoices.flatMap((i) => i.paid.map((p, n) => ({ organizationId: org, invoiceId: iid.get(i.id)!, ...payToRow(p, n) })));
    await tx.reconciliationInvoicePayment.createMany({ data: pays as never });
    const had = await tx.reconciliationCheck.count({ where: { organizationId: org, kind: "import" } });
    const checkIds: string[] = [];
    if (!had) {
      const c = await tx.reconciliationCheck.create({
        data: { organizationId: org, checkedDate: new Date(`${JSON_REGISTRY.checkedAt}T00:00:00Z`), kind: "import", byName: ACTOR, note: "Перенос реестра из reconciliation.json", details: { recheck: JSON_REGISTRY.recheck, note: JSON_REGISTRY.note } as never },
      });
      checkIds.push(c.id);
    }
    // проверка «таблицы = JSON»: содержимое реестра, прочитанное обратно, совпадает с файлом до буквы
    const back = await loadRegistryWith(tx as never, org);
    if (back.source !== "db") throw new Error("После записи реестр не читается из базы");
    const h = registryHash(back);
    if (h !== jsonHash) throw new Error(`Содержимое реестра в базе не совпало с JSON (sha ${h.slice(0, 12)} ≠ ${jsonHash.slice(0, 12)}): перенос отменён`);
    return { groupIds: groupRows.map((g) => g.id), invoiceIds: invRows.map((i) => i.id), checkIds, links: links.length, pays: pays.length };
  };

  if (!APPLY) {
    let res: Awaited<ReturnType<typeof writeAll>> | null = null;
    try {
      await prisma.$transaction(async (tx) => { res = await writeAll(tx as never); throw new Rollback(); }, { timeout: 120_000 });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }
    const r = res as Awaited<ReturnType<typeof writeAll>> | null;
    console.log(`ПРОБНАЯ ЗАПИСЬ в транзакции (откачена): групп ${r?.groupIds.length}, счетов ${r?.invoiceIds.length}, связей ${r?.links}, строк оплат ${r?.pays}; прочитано обратно — содержимое = JSON (sha ${jsonHash.slice(0, 12)})`);
    console.log("\nПробный прогон: БД не менялась. Для записи — --apply (копия) или --apply --live (боевая).");
    await prisma.$disconnect();
    return;
  }

  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённый перенос — повторно не применяю (сначала --rollback --apply)."); await prisma.$disconnect(); return; }
  if (isLive && !NO_BACKUP) { console.log("Копия базы перед записью: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  const before = await stateHash();
  const res = await prisma.$transaction(async (tx) => writeAll(tx as never), { timeout: 120_000 });
  mkdirSync(INV, { recursive: true });
  writeJson(JOURNAL, { script: "migrate-reconciliation-to-db-2026-10-20.ts", status: "applied", at: new Date().toISOString(), db: dbName, groupIds: res.groupIds, invoiceIds: res.invoiceIds, checkIds: res.checkIds, registryHash: jsonHash } satisfies Journal);
  const after = await stateHash();
  const sameCore = JSON.stringify(before.corePaymentsPurchases) === JSON.stringify(after.corePaymentsPurchases);
  console.log(`Применено на «${dbName}»: групп ${res.groupIds.length}, счетов ${res.invoiceIds.length}, связей ${res.links}, строк оплат ${res.pays}. Журнал: ${JOURNAL}`);
  console.log(`Платежи и закупки не изменились: ${sameCore ? "да (хеш до = хеш после)" : "НЕТ — проверьте!"}; содержимое реестра в базе = JSON: ${after.registryContentSha === after.jsonContentSha ? "да" : "НЕТ"}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
