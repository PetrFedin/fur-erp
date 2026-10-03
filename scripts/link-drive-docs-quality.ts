/**
 * Проверка качества привязок: «ложные пробелы» страницы /documents (docs-inventory/quality-check.md).
 * Привязывает ТОЛЬКО однозначные находки: расчёт доплаты партии производства, в котором прямо учтены шкуры
 * подрядчика, заведённые отдельной закупкой «Доп закупк сырья партия N» / «лиса» (З-2026-0001, 0010, 0011, 0013).
 * Файл расчёта уже привязан к партии производства — здесь добавляется строка на закупку (одна строка на закупку,
 * как в link-drive-docs-purchases.ts), чтобы ячейка «Расчёт» закупки увидела документ.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-drive-docs-quality.ts            # DRY-RUN (по умолчанию, в БД не пишет)
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-drive-docs-quality.ts --apply    # запись
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-drive-docs-quality.ts --rollback docs-inventory/corrections-journal-drive-links-3.json
 *
 * ПЕРЕД --apply — бэкап базы (scripts/backup.sh).
 *
 * Защиты (скрипт останавливается / пропускает пару, если что-то не сходится):
 *   1. Префикс fileId даёт ровно одну запись манифеста.
 *   2. Файл-источник уже имеет строку DriveDocument в базе (то есть это не «новый» файл, а уже известный и привязанный к партии).
 *   3. Закупка найдена по номеру, не отменена, и её сумма с НДС (Σ subtotal × (1 + НДС%)) равна ожидаемой из расчёта (±1 ₽).
 *      Не сошлось — пара НЕ привязывается (ждёт решения), причина в плане.
 *   4. Ключ идемпотентности: organizationId + driveFileId + purchaseId. Если такая строка (на закупку, без оплаты/лота/ТЗ/партии/
 *      поставщика) уже есть — пара пропускается. Повторный запуск ничего не создаёт.
 *   5. Одна и та же пара (файл × закупка) в таблице решений дважды — ошибка.
 * Журнал: docs-inventory/corrections-journal-drive-links-3.json (только __create__; откат удаляет созданные строки по id).
 * План: docs-inventory/drive-links-plan-quality.txt
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ROOT = resolve(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const JOURNAL_PATH = join(INV, "corrections-journal-drive-links-3.json");
const PLAN_PATH = join(INV, "drive-links-plan-quality.txt");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rbIdx = args.indexOf("--rollback");
const ROLLBACK = rbIdx >= 0 ? args[rbIdx + 1] : null;
const newId = () => "c" + Date.now().toString(36) + randomBytes(9).toString("hex");

type DocType = "AUCTION_INVOICE" | "UPD" | "CALC_SHEET" | "SPECIFICATION" | "PAYMENT_INVOICE" | "APPROVAL_EMAIL" | "OTHER";
type Decision = {
  f: string; // префикс fileId
  purchase: string; // номер закупки
  type: DocType;
  /** Сумма закупки с НДС, которая прямо названа в файле (проверка по базе). */
  expectTotal: number;
  note: string;
};

const DECISIONS: Decision[] = [
  {
    f: "1YNG5E", purchase: "З-2026-0010", type: "CALC_SHEET", expectTotal: 4584500,
    note: "Расчёт доплаты за 5-ю партию (04.12.2025): строка «Стоимость шкур» = 4 584 500 ₽ — это шкуры подрядчика «Доп закупк сырья партия 5» (счёт №235 партии 5 на 5 669 120 ₽ включает их)",
  },
  {
    f: "1U5Y74", purchase: "З-2026-0011", type: "CALC_SHEET", expectTotal: 463750,
    note: "Расчёт доплаты за 6-ю партию (18.12.2025): «Стоимость шкур» 463 750 ₽ = 35 шк. × 13 250 — шкуры подрядчика «Доп закупк сырья партия 6» (счёт №239 партии 6)",
  },
  {
    f: "1rZoiA", purchase: "З-2026-0013", type: "CALC_SHEET", expectTotal: 431040,
    note: "Расчёт доплаты за пошив партия 9 (29.01.2026): «Стоимость шкур /НДС22%» 431 040 ₽ — шкуры подрядчика «Доп закупк сырья партия 9» (счёт №7 партии 9)",
  },
  {
    f: "1MGyky", purchase: "З-2026-0001", type: "CALC_SHEET", expectTotal: 880000,
    note: "Расчёт доплаты партии 18: у ТЗ 121 (М029) колонка «доп. закупка» 176 000 ₽ × 5 ед. = 880 000 ₽ — сырьё подрядчика, 55 шкур красной лисы × 16 000 (счёт №237 партии 18)",
  },
  // З-2026-0012 («Доп закупк сырья партия 7», 927 500 ₽) НЕ привязывается: в расчёте партии 7 шкуры 952 540 / 1 117 463,70 — суммы не сходятся (см. quality-check.md).
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

  const manifest: any[] = JSON.parse(readFileSync(join(INV, "drive-manifest.json"), "utf-8"));
  const byPrefix = (p: string) => {
    const h = manifest.filter((m) => m.id.startsWith(p));
    if (h.length !== 1) throw new Error(`Префикс «${p}» даёт ${h.length} совпадений в манифесте`);
    return h[0];
  };
  const seenPairs = new Set<string>();
  for (const d of DECISIONS) {
    const k = `${byPrefix(d.f).id}|${d.purchase}`;
    if (seenPairs.has(k)) throw new Error("пара файл×закупка задана дважды: " + k);
    seenPairs.add(k);
  }

  const org = await prisma.organization.findFirstOrThrow();
  const purchases = await prisma.purchase.findMany({
    where: { organizationId: org.id },
    select: { id: true, number: true, status: true, items: { select: { subtotal: true, vatRate: true } } },
  });
  const existing = await prisma.driveDocument.findMany({
    where: { organizationId: org.id },
    select: { driveFileId: true, purchaseId: true, lotId: true, paymentId: true, productionOrderId: true, productionBatchId: true, productionPaymentId: true, clientId: true, supplierId: true },
  });
  const sourceLinked = new Set(existing.map((e) => e.driveFileId));
  // строка «только на закупку» — ровно то, что создаёт этот скрипт
  const purchaseOnly = (e: (typeof existing)[number]) =>
    e.purchaseId && !e.lotId && !e.paymentId && !e.productionOrderId && !e.productionBatchId && !e.productionPaymentId && !e.clientId && !e.supplierId;
  const keys = new Set(existing.filter(purchaseOnly).map((e) => `${e.driveFileId}|${e.purchaseId}`));

  type Row = { data: Record<string, unknown>; label: string };
  const rows: Row[] = [];
  const skipped: string[] = [];
  const plan: string[] = [];

  for (const d of DECISIONS) {
    const m = byPrefix(d.f);
    const label = `${d.type.padEnd(11)} ${m.title}  →  ${d.purchase}`;
    if (!sourceLinked.has(m.id)) { skipped.push(`${label}: файл-источник не привязан в этой базе (нет строки DriveDocument)`); continue; }
    const p = purchases.find((x) => x.number === d.purchase);
    if (!p) { skipped.push(`${label}: закупка не найдена`); continue; }
    if (p.status === "CANCELLED") { skipped.push(`${label}: закупка отменена`); continue; }
    const total = p.items.reduce((s, i) => s + Number(i.subtotal) * (1 + Number(i.vatRate) / 100), 0);
    if (Math.abs(total - d.expectTotal) > 1) { skipped.push(`${label}: сумма закупки с НДС ${total.toFixed(2)} ≠ ${d.expectTotal} из расчёта — не привязано`); continue; }
    const key = `${m.id}|${p.id}`;
    if (keys.has(key)) { plan.push(`[уже есть] ${label}`); continue; }
    keys.add(key); // защита от дубля внутри одного запуска
    plan.push(`[+] ${label}`);
    rows.push({
      label: p.number,
      data: {
        id: newId(), organizationId: org.id, driveFileId: m.id, title: m.title, docType: d.type,
        mimeType: m.mimeType ?? null, sizeBytes: m.size ?? null, drivePath: m.path ?? null, viewUrl: m.viewUrl ?? null,
        docDate: null, docNumber: null,
        year: /2026/.test(m.path) ? 2026 : /2025/.test(m.path) ? 2025 : null,
        notes: [d.note, "Привязка скриптом link-drive-docs-quality (проверка пробелов /documents; сумма закупки сверена с расчётом)"].join(". "),
        purchaseId: p.id,
      },
    });
  }

  plan.push("", "=== НЕ ПРИВЯЗАНО (причина) ===", ...skipped.map((s) => "  " + s));
  writeFileSync(PLAN_PATH, plan.join("\n") + "\n");
  console.log(plan.join("\n"));
  console.log(`\nК созданию строк DriveDocument: ${rows.length}; пропущено по защитам: ${skipped.length}. План: ${PLAN_PATH}`);
  if (!APPLY) { console.log("DRY-RUN: ничего не записано. Для применения добавьте --apply (сначала бэкап!)."); return; }
  if (!rows.length) { console.log("Нечего применять — всё уже привязано."); return; }

  let created = 0, already = 0;
  for (const r of rows) {
    const dd = r.data as any;
    const time = new Date().toISOString();
    let made = false;
    await prisma.$transaction(async (tx) => {
      const dup = await tx.driveDocument.findFirst({
        where: { organizationId: dd.organizationId, driveFileId: dd.driveFileId, purchaseId: dd.purchaseId, paymentId: null, lotId: null, productionOrderId: null, productionBatchId: null, productionPaymentId: null, clientId: null, supplierId: null },
        select: { id: true },
      });
      if (dup) { already++; return; }
      await tx.driveDocument.create({ data: dd });
      made = true;
    });
    if (made) {
      created++;
      journalAppend([{
        time, entity: "DriveDocument", id: dd.id, field: "__create__", before: null,
        after: { ...dd }, source: `link-drive-docs-quality; ${r.label}`,
      }]);
    }
  }
  console.log(`\nГОТОВО: создано ${created}, уже было ${already}. Журнал ${JOURNAL_PATH}. Откат: --rollback ${JOURNAL_PATH}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
