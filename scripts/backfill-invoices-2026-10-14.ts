/**
 * Бэкфилл таблицы Invoice из закупок — 14.10.2026, НЕ ПРИМЕНЁН.
 * Нужна применённая миграция 20261014120000_payment_invoice_pp_invoice_table и `prisma generate`.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/backfill-invoices-2026-10-14.ts            # пробный прогон (БД не меняется)
 *   node --env-file=.env node_modules/.bin/tsx scripts/backfill-invoices-2026-10-14.ts --apply    # записать (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --env-file=.env node_modules/.bin/tsx scripts/backfill-invoices-2026-10-14.ts --rollback  # откат по журналу (пробный); с --apply — выполнить
 *
 * Из уникальных пар (поставщик, номер счёта) действующих и отменённых закупок создаёт Invoice (number — как cleanInvoiceNumber: без слова «счёт» и «№»;
 * date — invoiceDate закупки, если у закупок этого счёта она одна и та же) и проставляет Purchase.invoiceId.
 * Закупки без номера счёта не трогаются (Invoice не создаётся). Purchase.invoiceNumber/invoiceDate/transferDocument НЕ меняются.
 * Один счёт на две закупки (например №100: З-2026-0032 и З-2026-0060) получает один Invoice. Уже существующий Invoice (поставщик+номер) переиспользуется.
 * Журнал: docs-inventory/corrections-journal-invoices-2026-10-14.json (созданные Invoice и закупки, у которых проставлен invoiceId) — откат снимает invoiceId и удаляет созданные Invoice.
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");

type Journal = { script: string; status: "applied" | "rolled-back"; at: string; createdInvoices: string[]; linkedPurchases: string[] };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { cleanInvoiceNumber } = await import("../src/lib/invoice-sync");
  const prisma = createAuditedClient("script:backfill-invoices-2026-10-14");
  const JOURNAL = join(INV, "corrections-journal-invoices-2026-10-14.json");

  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат: снять invoiceId у ${j.linkedPurchases.length} закупок, удалить ${j.createdInvoices.length} созданных счетов.`);
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        await tx.purchase.updateMany({ where: { id: { in: j.linkedPurchases } }, data: { invoiceId: null } });
        await tx.invoice.deleteMany({ where: { id: { in: j.createdInvoices } } });
      });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    } else console.log("Пробный прогон отката: БД не менялась. Для отката — --rollback --apply.");
    await prisma.$disconnect();
    return;
  }

  const purchases = await prisma.purchase.findMany({
    where: { invoiceNumber: { not: null } },
    select: { id: true, number: true, organizationId: true, supplierId: true, invoiceNumber: true, invoiceDate: true, invoiceId: true },
    orderBy: { number: "asc" },
  });
  type Group = { org: string; supplier: string; number: string; purchases: typeof purchases };
  const groups = new Map<string, Group>();
  let noNumber = 0;
  for (const p of purchases) {
    const number = cleanInvoiceNumber(p.invoiceNumber);
    if (!number) { noNumber++; continue; }
    const key = `${p.organizationId}|${p.supplierId}|${number.toLowerCase()}`;
    const g = groups.get(key) ?? { org: p.organizationId, supplier: p.supplierId, number, purchases: [] };
    g.purchases.push(p);
    groups.set(key, g);
  }
  const existing = await prisma.invoice.findMany({ select: { id: true, organizationId: true, supplierId: true, number: true } });
  const exKey = (i: { organizationId: string; supplierId: string | null; number: string }) => `${i.organizationId}|${i.supplierId}|${i.number.toLowerCase()}`;
  const exMap = new Map(existing.map((i) => [exKey(i), i.id]));

  let toCreate = 0, toLink = 0, shared = 0;
  const dateOf = (g: Group) => {
    const ds = new Set(g.purchases.filter((p) => p.invoiceDate).map((p) => p.invoiceDate!.toISOString().slice(0, 10)));
    return ds.size === 1 ? [...ds][0] : null;
  };
  for (const [key, g] of groups) {
    if (!exMap.has(key)) toCreate++;
    toLink += g.purchases.filter((p) => p.invoiceId !== (exMap.get(key) ?? "__new")).length;
    if (g.purchases.length > 1) {
      shared++;
      console.log(`  Один счёт №${g.number} на ${g.purchases.length} закупок: ${g.purchases.map((p) => p.number).join(", ")}${dateOf(g) ? ` (дата ${dateOf(g)})` : ""}`);
    }
  }
  console.log(`Закупок со счётом: ${purchases.length - noNumber}; уникальных счетов (поставщик+номер): ${groups.size}; создать Invoice: ${toCreate}; проставить invoiceId у закупок: ${toLink}; счетов на несколько закупок: ${shared}; закупок без разбираемого номера (пропущены): ${noNumber}.`);
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply."); await prisma.$disconnect(); return; }

  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённый бэкфилл — повторно не применяю (сначала --rollback --apply)."); await prisma.$disconnect(); return; }
  if (!NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  const created: string[] = [];
  const linked: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const [key, g] of groups) {
      let id = exMap.get(key);
      if (!id) {
        const d = dateOf(g);
        const inv = await tx.invoice.create({ data: { organizationId: g.org, supplierId: g.supplier, number: g.number, date: d ? new Date(d) : null } });
        id = inv.id;
        created.push(id);
      }
      for (const p of g.purchases) {
        if (p.invoiceId === id) continue;
        await tx.purchase.update({ where: { id: p.id }, data: { invoiceId: id } });
        linked.push(p.id);
      }
    }
  }, { timeout: 120_000 });
  writeJson(JOURNAL, { script: "backfill-invoices-2026-10-14", status: "applied", at: new Date().toISOString(), createdInvoices: created, linkedPurchases: linked } satisfies Journal);
  console.log(`Создано счетов: ${created.length}, закупок привязано: ${linked.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
