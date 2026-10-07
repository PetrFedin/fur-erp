/**
 * Короткие имена аукционов из справочника — в данные: подтверждает все предложения и переименовывает аукционы,
 * приводя во всех текстах (Purchase.auctionSession, Payment.auctionSession, PurchaseDocument.batch) старое написание
 * к короткому имени; старое написание остаётся в aliases (поиск по нему продолжает работать).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-auction-names.ts            # пробный прогон (в базу ничего не пишет)
 *   scripts/backup.sh                                                                     # обязательно перед --apply
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-auction-names.ts --apply     # применить (+ сверка сумм до/после)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-auction-names.ts --rollback  # откат по журналу
 *
 * Логика переименования — renameAuctionIn (src/lib/auction-ref-core.ts), одна транзакция на аукцион.
 * Служебные аукционы и «заглушечные» (без прежних написаний в текстах: «Белая норка №80», «Сырьё подрядчика…», «Без аукциона»)
 * только подтверждаются: их закупки в текстах остаются «Нет информации» и продолжают считаться «Без аукциона» —
 * иначе они стали бы настоящими аукционами и изменили бы разбивку долга и список недостающих документов.
 * Идемпотентен. Журнал: docs-inventory/corrections-journal-auction-names.json (старые тексты каждой изменённой строки).
 * Сверка до/после (Σ закупок, оплаты, долг, остаток меха, число записей): docs-inventory/auction-numbers-{before,after}.json.
 */
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import Module from "module";
import { PrismaClient } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";
import { auctionKey, firstLine, replaceFirstLine } from "../src/lib/auction-key";
import { auctionKeys, renameAuctionIn, confirmAuctionsIn } from "../src/lib/auction-ref-core";

const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const origResolve = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return origResolve.call(this, req, ...rest);
};

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(INV, "corrections-journal-auction-names.json");

type TextChange = { table: "purchase" | "payment" | "document"; id: string; old: string | null; new: string | null };
type AuctionBefore = { id: string; name: string; aliases: string[]; confirmed: boolean };
type Entry = { auction: AuctionBefore; afterName: string; mode: "rename" | "confirm"; texts: TextChange[] };
type Journal = { script: string; appliedAt?: string; rolledBackAt?: string; entries: Entry[]; numbers?: { before: unknown; after: unknown } };

/** Заглушка: служебный аукцион либо аукцион, чьи закупки записаны другим текстом («Нет информации») и прежних написаний нет. */
async function isStub(orgId: string, a: { id: string; name: string; aliases: string[]; isService: boolean }): Promise<boolean> {
  if (a.isService) return true;
  if (a.aliases.length) return false;
  const keys = auctionKeys(a);
  const ps = await prisma.purchase.findMany({ where: { organizationId: orgId, auctionId: a.id }, select: { auctionSession: true } });
  return !ps.some((p) => keys.has(auctionKey(p.auctionSession)));
}

/** Строки, которые затронет переименование аукциона (по тем же правилам, что syncAuctionTexts). */
async function affected(orgId: string, a: { id: string; name: string; aliases: string[] }) {
  const keys = auctionKeys(a);
  const purchases = await prisma.purchase.findMany({ where: { organizationId: orgId, OR: [{ auctionId: a.id }, { auctionSession: { not: null } }] }, select: { id: true, auctionSession: true, auctionId: true } });
  const pur = purchases.filter((p) => p.auctionId === a.id || keys.has(auctionKey(p.auctionSession)));
  const payments = (await prisma.payment.findMany({ where: { organizationId: orgId, auctionSession: { not: null } }, select: { id: true, auctionSession: true } })).filter((p) => keys.has(auctionKey(p.auctionSession)));
  const docs = (await prisma.purchaseDocument.findMany({ where: { organizationId: orgId, batch: { not: null } }, select: { id: true, batch: true } })).filter((d) => keys.has(auctionKey(d.batch)));
  return { pur, payments, docs };
}

async function plan() {
  const orgs = await prisma.organization.findMany();
  const rows: string[] = [];
  let toConfirm = 0;
  let toTexts = 0;
  for (const org of orgs) {
    const list = await prisma.auction.findMany({ where: { organizationId: org.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    for (const a of list) {
      if (!a.confirmed) toConfirm++;
      if (await isStub(org.id, a)) { rows.push(`${a.name.padEnd(34)} подтвердить (заглушка/служебный: тексты не трогаем)${a.confirmed ? " — уже подтверждён" : ""}`); continue; }
      const x = await affected(org.id, a);
      const fix = (t: string | null) => t != null && firstLine(t) !== a.name && replaceFirstLine(t, a.name) !== t;
      const np = x.pur.filter((p) => fix(p.auctionSession)).length;
      const ny = x.payments.filter((p) => fix(p.auctionSession)).length;
      const nd = x.docs.filter((d) => fix(d.batch)).length;
      toTexts += np + ny + nd;
      const olds = [...new Set([...x.pur.map((p) => firstLine(p.auctionSession)), ...x.payments.map((p) => firstLine(p.auctionSession)), ...x.docs.map((d) => firstLine(d.batch))].filter((t) => t && t !== a.name))];
      rows.push(`${a.name.padEnd(34)} закупок ${np}, оплат ${ny}, документов ${nd}${olds.length ? `  (было: ${olds.join(" | ")})` : ""}${a.confirmed ? "" : "  [+подтвердить]"}`);
    }
  }
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN (в базу ничего не записано) ==");
  console.log(rows.join("\n"));
  console.log(`\nПодтвердить аукционов: ${toConfirm}; текстов в записях к замене: ${toTexts}`);
}

function lastBackupAgeMin(): number | null {
  const dir = join(homedir(), "Backups", "fur-erp");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith("fur_erp_") && f.endsWith(".sql.gz"));
  if (!files.length) return null;
  const newest = Math.max(...files.map((f) => statSync(join(dir, f)).mtimeMs));
  return (Date.now() - newest) / 60000;
}

async function apply() {
  const age = lastBackupAgeMin();
  if (!process.argv.includes("--skip-backup-check") && (age == null || age > 60)) {
    throw new Error(`Нет свежей копии базы (последняя ${age == null ? "не найдена" : Math.round(age) + " мин назад"}). Сначала scripts/backup.sh.`);
  }
  const { collectNumbers } = await import("./check-auction-numbers");
  const before = await collectNumbers();
  writeJson(join(INV, "auction-numbers-before.json"), before);

  const journal = readJson<Journal>(JOURNAL, { script: "apply-auction-names.ts", entries: [] });
  journal.appliedAt = new Date().toISOString();
  journal.rolledBackAt = undefined;
  const flush = () => writeJson(JOURNAL, journal);
  const orgs = await prisma.organization.findMany();
  for (const org of orgs) {
    const list = await prisma.auction.findMany({ where: { organizationId: org.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    for (const a of list) {
      const entry: Entry = { auction: { id: a.id, name: a.name, aliases: a.aliases, confirmed: a.confirmed }, afterName: a.name, mode: (await isStub(org.id, a)) ? "confirm" : "rename", texts: [] };
      journal.entries.push(entry);
      flush();
      if (entry.mode === "confirm") {
        await confirmAuctionsIn(prisma, org.id, [a.id]);
        continue;
      }
      const x = await affected(org.id, a);
      const snap = {
        purchase: new Map(x.pur.map((p) => [p.id, p.auctionSession])),
        payment: new Map(x.payments.map((p) => [p.id, p.auctionSession])),
        document: new Map(x.docs.map((d) => [d.id, d.batch])),
      };
      await renameAuctionIn(prisma, org.id, a.id, a.name);
      const nowP = await prisma.purchase.findMany({ where: { id: { in: [...snap.purchase.keys()] } }, select: { id: true, auctionSession: true } });
      const nowY = await prisma.payment.findMany({ where: { id: { in: [...snap.payment.keys()] } }, select: { id: true, auctionSession: true } });
      const nowD = await prisma.purchaseDocument.findMany({ where: { id: { in: [...snap.document.keys()] } }, select: { id: true, batch: true } });
      for (const r of nowP) if (snap.purchase.get(r.id) !== r.auctionSession) entry.texts.push({ table: "purchase", id: r.id, old: snap.purchase.get(r.id) ?? null, new: r.auctionSession });
      for (const r of nowY) if (snap.payment.get(r.id) !== r.auctionSession) entry.texts.push({ table: "payment", id: r.id, old: snap.payment.get(r.id) ?? null, new: r.auctionSession });
      for (const r of nowD) if (snap.document.get(r.id) !== r.batch) entry.texts.push({ table: "document", id: r.id, old: snap.document.get(r.id) ?? null, new: r.batch });
      flush();
      console.log(`${a.name.padEnd(34)} изменено текстов: ${entry.texts.length}`);
    }
  }
  const after = await collectNumbers();
  writeJson(join(INV, "auction-numbers-after.json"), after);
  journal.numbers = { before, after };
  flush();
  // сверка: всё, кроме разбивки по названиям аукционов, обязано совпасть
  const strip = (o: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ...(v as object), byAuction: undefined, debtByAuctionCount: undefined, nonAuctionDebt: undefined, debtReceivedNet: undefined, debtInvoiced: undefined, debtExpected: undefined }])));
  const same = strip(before) === strip(after);
  console.log(same ? "\nСверка до/после: суммы, число закупок/оплат/документов, остаток меха — без изменений." : "\n!!! СВЕРКА: ЕСТЬ РАСХОЖДЕНИЯ — смотрите docs-inventory/auction-numbers-{before,after}.json и откатите (--rollback)");
  const b = before as Record<string, Record<string, unknown>>;
  const af = after as Record<string, Record<string, unknown>>;
  for (const org of Object.keys(b)) {
    for (const k of ["debt", "debtReceivedNet", "debtInvoiced", "debtExpected", "nonAuctionDebt"]) {
      if (b[org][k] !== af[org][k]) console.log(`  ${org}.${k}: ${b[org][k]} -> ${af[org][k]}`);
    }
  }
  if (!same) process.exitCode = 1;
}

async function rollback() {
  const j = readJson<Journal>(JOURNAL, { script: "apply-auction-names.ts", entries: [] });
  let done = 0;
  let skipped = 0;
  for (const e of [...j.entries].reverse()) {
    for (const t of [...e.texts].reverse()) {
      if (t.table === "purchase") {
        const cur = await prisma.purchase.findUnique({ where: { id: t.id }, select: { auctionSession: true } });
        if (!cur || cur.auctionSession !== t.new) { skipped++; continue; }
        await prisma.purchase.update({ where: { id: t.id }, data: { auctionSession: t.old } });
      } else if (t.table === "payment") {
        const cur = await prisma.payment.findUnique({ where: { id: t.id }, select: { auctionSession: true } });
        if (!cur || cur.auctionSession !== t.new) { skipped++; continue; }
        await prisma.payment.update({ where: { id: t.id }, data: { auctionSession: t.old } });
      } else {
        const cur = await prisma.purchaseDocument.findUnique({ where: { id: t.id }, select: { batch: true } });
        if (!cur || cur.batch !== t.new) { skipped++; continue; }
        await prisma.purchaseDocument.update({ where: { id: t.id }, data: { batch: t.old } });
      }
      done++;
    }
    const cur = await prisma.auction.findUnique({ where: { id: e.auction.id } });
    if (cur) {
      await prisma.auction.update({ where: { id: e.auction.id }, data: { name: e.auction.name, aliases: e.auction.aliases, confirmed: e.auction.confirmed } });
      done++;
    }
  }
  console.log(`Откат: восстановлено ${done} записей, пропущено ${skipped} (изменены после применения)`);
  writeJson(JOURNAL, { script: "apply-auction-names.ts", rolledBackAt: new Date().toISOString(), entries: [] });
}

async function main() {
  if (ROLLBACK) return rollback();
  await plan();
  if (APPLY) await apply();
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
