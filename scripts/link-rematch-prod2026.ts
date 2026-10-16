/**
 * Повторное сопоставление Drive «мех/Производство меховых изделий/2026/**» с записями производства (prod2026).
 * Привязываются ТОЛЬКО документы уровня exact, у которых ещё нет строки DriveDocument. Образец — link-drive-docs-remaining.ts.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-rematch-prod2026.ts            # DRY-RUN (по умолчанию)
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-rematch-prod2026.ts --apply
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-rematch-prod2026.ts --rollback docs-inventory/corrections-journal-prod2026.json
 *
 * ПЕРЕД --apply — бэкап базы (scripts/backup.sh).
 *
 * Результат повторного прохода 07.10.2026 (docs-inventory/rematch-prod2026.md): из 114 файлов 112 уже привязаны (по всем
 * ТЗ 113–168 — приложения, по партиям 14, 17–21 — расчёт, счёт, письмо), 2 файла — дубли привязанных (DUP), поэтому новых
 * привязок уровня exact нет: DECISIONS ниже пуст. Скрипт всё равно проверяет это на каждом запуске (каждый файл
 * списка либо имеет DriveDocument, либо числится дублем, либо лежит в очереди), и умеет создавать/откатывать привязки,
 * если сюда добавят решения (LINK: файл → ТЗ по workOrderNumber или партия по номеру; ключ идемпотентности —
 * organizationId + driveFileId + productionOrderId|productionBatchId|productionPaymentId).
 * Данные в БД не правятся — только таблица DriveDocument.
 */
import "./lib/drive-links-disabled";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ROOT = resolve(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const JOURNAL_PATH = join(INV, "corrections-journal-prod2026.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rbIdx = args.indexOf("--rollback");
const ROLLBACK = rbIdx >= 0 ? args[rbIdx + 1] : null;
const newId = () => "c" + Date.now().toString(36) + randomBytes(9).toString("hex");

type DocType = "AUCTION_INVOICE" | "UPD" | "CALC_SHEET" | "SPECIFICATION" | "CONTRACT" | "TZ_APPENDIX" | "PAYMENT_PROOF" | "PAYMENT_INVOICE" | "APPROVAL_EMAIL" | "BALANCE" | "OTHER";
type Target = { k: "tz"; wn: string } | { k: "batch"; n: number } | { k: "pp"; amount: string };
type Decision = { f: string; to: Target; type: DocType; num?: string; date?: string; note?: string };

// Новых exact-привязок нет (см. шапку). Формат записи, например:
// { f: "1abcdE", to: { k: "batch", n: 20 }, type: "PAYMENT_PROOF", num: "…", date: "2026-09-26", note: "платёжка №… на 1 892 430" }
const DECISIONS: Decision[] = [];

// Файлы, которые заведомо дубли привязанных (проверка: оригинал должен иметь DriveDocument)
const DUPS: { f: string; of: string; why: string }[] = [
  { f: "1-WUQ_", of: "1UkQer", why: "письмо «оплата пошива за 82 ед + аванс за все аксессуары»: тот же размер 118 272 б и имя" },
  { f: "1QCq8H", of: "13ahBd", why: "расчёт доплаты за 14 г-у (партия 14): тот же размер 11 675 б и имя" },
];

const journalAppend = (entries: unknown[]) => {
  const prev: unknown[] = existsSync(JOURNAL_PATH) ? JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) : [];
  writeFileSync(JOURNAL_PATH, JSON.stringify([...prev, ...entries], null, 2));
};

async function rollback(file: string) {
  const entries = JSON.parse(readFileSync(resolve(file), "utf-8")) as { entity: string; id: string; field: string }[];
  const creates = entries.filter((e) => e.entity === "DriveDocument" && e.field === "__create__");
  console.log(`Откат по журналу ${file}: ${creates.length} созданных строк DriveDocument.`);
  const r = await prisma.driveDocument.deleteMany({ where: { id: { in: creates.map((e) => e.id) } } });
  console.log(`Удалено ${r.count}, уже отсутствовало ${creates.length - r.count}.`);
}

async function main() {
  const url = (process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@");
  console.log(`${APPLY ? "ПРИМЕНЕНИЕ" : ROLLBACK ? "ОТКАТ" : "DRY-RUN (в БД не пишем)"}; БД: ${url}`);
  if (ROLLBACK) return rollback(ROLLBACK);

  // живой список Drive (на 06.10.2026): мои файлы — 2026 «Производство меховых изделий» + письмо МТО в корне
  const live: { id: string; title: string; path: string; size?: string; url?: string; mime_type?: string }[] = [];
  for (let i = 0; i <= 60; i += 12) {
    const p = join(INV, `drive-live-batch-${i}.json`);
    if (existsSync(p)) live.push(...JSON.parse(readFileSync(p, "utf-8")));
  }
  const mine = live.filter((x) => /^мех\/Производство меховых изделий\/2026\//.test(x.path) || x.path === "мех/Производство меховых изделий/RE согласование МТО мехового проекта MVST (сторонее сырье) .msg");
  const byPrefix = (p: string) => {
    const h = mine.filter((m) => m.id.startsWith(p));
    if (h.length !== 1) throw new Error(`Префикс «${p}» даёт ${h.length} совпадений среди файлов части prod2026`);
    return h[0];
  };

  const org = await prisma.organization.findFirstOrThrow();
  const existing = await prisma.driveDocument.findMany({
    where: { organizationId: org.id },
    select: { driveFileId: true, productionOrderId: true, productionBatchId: true, productionPaymentId: true },
  });
  const linkedFiles = new Set(existing.map((e) => e.driveFileId));
  const keys = new Set(existing.map((e) => `${e.driveFileId}|${e.productionOrderId ?? ""}|${e.productionBatchId ?? ""}|${e.productionPaymentId ?? ""}`));

  const dupIds = new Set(DUPS.map((d) => byPrefix(d.f).id));
  for (const d of DUPS) {
    const orig = byPrefix(d.of);
    if (!linkedFiles.has(orig.id)) console.log(`  ! дубль ${d.f}: оригинал ${d.of} не привязан — файл не считается дублем`);
  }
  const decidedIds = new Set(DECISIONS.map((d) => byPrefix(d.f).id));
  const unlinked = mine.filter((m) => !linkedFiles.has(m.id) && !decidedIds.has(m.id) && !dupIds.has(m.id));
  console.log(`Файлов части prod2026: ${mine.length}; с привязкой в БД: ${mine.filter((m) => linkedFiles.has(m.id)).length}; дублей: ${dupIds.size}; без решения: ${unlinked.length}`);
  unlinked.forEach((u) => console.log(`  БЕЗ ПРИВЯЗКИ И РЕШЕНИЯ: ${u.id} ${u.path}`));

  type Row = { data: Record<string, unknown>; label: string };
  const rows: Row[] = [];
  for (const d of DECISIONS) {
    const m = byPrefix(d.f);
    const data: Record<string, unknown> = {
      id: newId(), organizationId: org.id, driveFileId: m.id, title: m.title, docType: d.type,
      mimeType: m.mime_type ?? null, sizeBytes: m.size ? Number(m.size) : null, drivePath: m.path ?? null, viewUrl: m.url ?? null,
      docDate: d.date ? new Date(d.date + "T00:00:00Z") : null, docNumber: d.num ?? null, year: 2026,
      notes: [d.note, "Привязка скриптом link-rematch-prod2026 (по документам Drive)"].filter(Boolean).join(". "),
      productionOrderId: null, productionBatchId: null, productionPaymentId: null,
    };
    let label = "";
    if (d.to.k === "tz") {
      const os = await prisma.productionOrder.findMany({ where: { organizationId: org.id, workOrderNumber: d.to.wn }, select: { id: true, number: true } });
      if (os.length !== 1) { console.log(`  ! ТЗ ${d.to.wn}: найдено ${os.length}, пропуск ${d.f}`); continue; }
      data.productionOrderId = os[0].id; label = `ТЗ ${d.to.wn}`;
    } else if (d.to.k === "batch") {
      const b = await prisma.productionBatch.findFirst({ where: { organizationId: org.id, number: d.to.n }, select: { id: true } });
      if (!b) { console.log(`  ! партия ${d.to.n} не найдена, пропуск ${d.f}`); continue; }
      data.productionBatchId = b.id; label = `Партия ${d.to.n}`;
    } else {
      const ps = await prisma.productionPayment.findMany({ where: { organizationId: org.id, amount: d.to.amount }, select: { id: true } });
      if (ps.length !== 1) { console.log(`  ! платёж ${d.to.amount}: найдено ${ps.length}, пропуск ${d.f}`); continue; }
      data.productionPaymentId = ps[0].id; label = `Платёж ${d.to.amount}`;
    }
    const key = `${m.id}|${data.productionOrderId ?? ""}|${data.productionBatchId ?? ""}|${data.productionPaymentId ?? ""}`;
    console.log(`${keys.has(key) ? "[уже есть]" : "[+]"} ${d.type.padEnd(15)} ${m.title} → ${label}`);
    if (!keys.has(key)) rows.push({ data, label });
  }
  console.log(`Строк DriveDocument к созданию: ${rows.length}`);
  if (!APPLY) { console.log("\nDRY-RUN: ничего не записано. Для применения добавьте --apply (сначала scripts/backup.sh!)."); return; }
  if (!rows.length) {
    journalAppend([{ time: new Date().toISOString(), entity: "meta", id: "prod2026", field: "__noop__", before: null, after: { filesInPart: mine.length, linked: mine.filter((m) => linkedFiles.has(m.id)).length, dups: dupIds.size, created: 0 }, source: "link-rematch-prod2026: новых exact-привязок нет" }]);
    console.log(`Нечего применять — всё уже привязано. Журнал ${JOURNAL_PATH}.`);
    return;
  }
  let created = 0, already = 0;
  const time = new Date().toISOString();
  const made: Row[] = [];
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      const dd = r.data as any;
      const dup = await tx.driveDocument.findFirst({ where: { organizationId: dd.organizationId, driveFileId: dd.driveFileId, productionOrderId: dd.productionOrderId, productionBatchId: dd.productionBatchId, productionPaymentId: dd.productionPaymentId }, select: { id: true } });
      if (dup) { already++; continue; }
      await tx.driveDocument.create({ data: dd });
      made.push(r);
    }
  }, { timeout: 120_000, maxWait: 60_000 });
  created = made.length;
  journalAppend(made.map((r) => ({
    time, entity: "DriveDocument", id: r.data.id, field: "__create__", before: null,
    after: { ...r.data, docDate: r.data.docDate ? (r.data.docDate as Date).toISOString() : null }, source: `link-rematch-prod2026; ${r.label}`,
  })));
  console.log(`\nГОТОВО: создано ${created}, уже было ${already}. Журнал ${JOURNAL_PATH}. Откат: --rollback ${JOURNAL_PATH}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
