/**
 * Повторное сопоставление Drive «закупка 2025» ↔ БД: привязки уровня exact, которых ещё не было
 * (docs-inventory/rematch-p2025.md). Только таблица DriveDocument, данные закупок/платежей не меняются.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-rematch-p2025.ts            # DRY-RUN
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-rematch-p2025.ts --apply    # после scripts/backup.sh
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-rematch-p2025.ts --rollback docs-inventory/corrections-journal-p2025.json
 *
 * Ключ идемпотентности: organizationId + driveFileId + (purchaseId | paymentId | supplierId).
 * Журнал: docs-inventory/corrections-journal-p2025.json (записи __create__; откат удаляет только созданные строки).
 *
 * Привязки (все exact — совпали номер документа, сумма/дата и сущность):
 *  - Сопроводительный лист (договоры №2502 и №1605 с ООО «Веллмех», 04.06.2025) → поставщик Веллмех (OTHER);
 *  - Счета.pdf (сводный файл: счета №75, 76, 80, 81, 83) → оплаты по счетам №75 (две части), 80, 81, 83 (счёт 76 уже был);
 *  - счета №40, №46 → закупка З-2026-0002 (SAGA 03-25; были привязаны только к оплатам);
 *  - счёт №81 → З-2026-0005, №92 → З-2026-0003, №96 → З-2026-0009 (были привязаны только к оплатам).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ROOT = resolve(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const JOURNAL_PATH = join(INV, "corrections-journal-p2025.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rbIdx = args.indexOf("--rollback");
const ROLLBACK = rbIdx >= 0 ? args[rbIdx + 1] : null;
const newId = () => "c" + Date.now().toString(36) + randomBytes(9).toString("hex");

type Target =
  | { k: "supplier" }
  | { k: "purchase"; number: string }
  | { k: "payment"; amount: string; paidAt: string; refIncludes: string };
type Link = { f: string; type: "OTHER" | "PAYMENT_INVOICE"; to: Target; num?: string; date?: string; note: string };

const SUMMARY = "Счета.pdf — сводный файл: счета Веллмех №75, 76, 80, 81, 83";
const LINKS: Link[] = [
  { f: "18aS3Zmp", type: "OTHER", to: { k: "supplier" }, date: "2025-06-04", note: "Сопроводительный лист (лист согласования печати ММ) от 04.06.2025: договоры КП №2502 от 26.02.2025 и подряда №1605 от 16.05.2025 с ООО «Веллмех»" },
  { f: "1Y8FPg7X", type: "PAYMENT_INVOICE", num: "75", to: { k: "payment", amount: "3935761.96", paidAt: "2025-05-16", refIncludes: "№75" }, note: `${SUMMARY}; здесь счёт №75 от 13.05.2025 на 11 146 950,00 (окончательный платёж по Спец. №1), оплата разнесена на РП/СП 03.25` },
  { f: "1Y8FPg7X", type: "PAYMENT_INVOICE", num: "75", to: { k: "payment", amount: "7211188.04", paidAt: "2025-05-16", refIncludes: "№75" }, note: `${SUMMARY}; здесь счёт №75 от 13.05.2025 на 11 146 950,00 (окончательный платёж по Спец. №1), оплата разнесена на РП/СП 03.25` },
  { f: "1Y8FPg7X", type: "PAYMENT_INVOICE", num: "80", date: "2025-05-26", to: { k: "payment", amount: "1718400", paidAt: "2025-06-04", refIncludes: "№80" }, note: `${SUMMARY}; здесь счёт №80 от 26.05.2025 на 1 718 400,00 (норка белая выделанная, 179 шт)` },
  { f: "1Y8FPg7X", type: "PAYMENT_INVOICE", num: "81", date: "2025-05-26", to: { k: "payment", amount: "1632000", paidAt: "2025-05-30", refIncludes: "№81" }, note: `${SUMMARY}; здесь счёт №81 от 26.05.2025 на 1 632 000,00 (аванс, норка коричневая, Спец. №3)` },
  { f: "1Y8FPg7X", type: "PAYMENT_INVOICE", num: "83", date: "2025-05-26", to: { k: "payment", amount: "30666300", paidAt: "2025-06-27", refIncludes: "№83" }, note: `${SUMMARY}; здесь счёт №83 от 26.05.2025 на 30 666 300,00 (аванс, соболь, Спец. №4)` },
  { f: "1xksAKwa", type: "PAYMENT_INVOICE", num: "40", date: "2025-03-10", to: { k: "purchase", number: "З-2026-0002" }, note: "Счёт Веллмех №40 от 10.03.2025 на 24 556 500,00 (аванс 50% по Спец. №2, SAGA 03-25); к оплате 14.03.2025 уже был привязан" },
  { f: "1LJHA18m", type: "PAYMENT_INVOICE", num: "46", date: "2025-03-14", to: { k: "purchase", number: "З-2026-0002" }, note: "Счёт Веллмех №46 от 14.03.2025 на 11 950 000,00 (второй аванс по Спец. №2, SAGA 03-25); к оплате 26.03.2025 уже был привязан" },
  { f: "1Yc1YU_-", type: "PAYMENT_INVOICE", num: "81", date: "2025-05-26", to: { k: "purchase", number: "З-2026-0005" }, note: "Счёт Веллмех №81 от 26.05.2025 на 1 632 000,00 (аванс по Спец. №3, норка коричневая 200 шт); к оплате 30.05.2025 уже был привязан" },
  { f: "1AoVTjds", type: "PAYMENT_INVOICE", num: "92", date: "2025-06-16", to: { k: "purchase", number: "З-2026-0003" }, note: "Счёт Веллмех №92 от 16.06.2025 на 1 210 000,00 (аванс по Приложению 5, каракуль 994 шт, SAGA 06-25); к оплате 19.06.2025 уже был привязан" },
  { f: "1wh35eHV", type: "PAYMENT_INVOICE", num: "96", date: "2025-06-24", to: { k: "purchase", number: "З-2026-0009" }, note: "Счёт Веллмех №96 от 24.06.2025 на 2 000 000,00 (норка белая отбеленная 200 шт); к оплате 2 000 000 уже был привязан" },
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

  const manifest: any[] = [];
  for (const f of readdirSync(INV).filter((n) => /^drive-live-batch-\d+\.json$/.test(n))) manifest.push(...JSON.parse(readFileSync(join(INV, f), "utf-8")));
  const byPrefix = (p: string) => {
    const h = manifest.filter((m) => m.id.startsWith(p));
    if (h.length !== 1) throw new Error(`Префикс «${p}» даёт ${h.length} совпадений в манифесте`);
    return h[0];
  };

  const org = await prisma.organization.findFirstOrThrow();
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { organizationId: org.id, name: { contains: "Веллмех", mode: "insensitive" } } });
  const purchases = await prisma.purchase.findMany({ where: { organizationId: org.id }, select: { id: true, number: true } });
  const payments = await prisma.payment.findMany({ where: { organizationId: org.id, paidAt: { gte: new Date("2025-01-01"), lt: new Date("2026-01-01") } }, select: { id: true, amount: true, paidAt: true, docRef: true } });
  const existing = await prisma.driveDocument.findMany({ where: { organizationId: org.id }, select: { driveFileId: true, purchaseId: true, paymentId: true, supplierId: true } });
  const keys = new Set(existing.map((e) => `${e.driveFileId}|${e.purchaseId ?? ""}|${e.paymentId ?? ""}|${e.supplierId ?? ""}`));

  const rows: { data: any; label: string }[] = [];
  const plan: string[] = [];
  for (const l of LINKS) {
    const m = byPrefix(l.f);
    let target: { purchaseId?: string; paymentId?: string; supplierId?: string; label: string };
    if (l.to.k === "supplier") target = { supplierId: supplier.id, label: `Поставщик ${supplier.name}` };
    else if (l.to.k === "purchase") {
      const num = l.to.number;
      const p = purchases.find((x) => x.number === num);
      if (!p) throw new Error("нет закупки " + num);
      target = { purchaseId: p.id, label: num };
    } else {
      const t = l.to;
      const list = payments.filter((p) => Number(p.amount).toFixed(2) === Number(t.amount).toFixed(2) && p.paidAt.toISOString().slice(0, 10) === t.paidAt && (p.docRef ?? "").includes(t.refIncludes));
      if (list.length !== 1) throw new Error(`оплата ${t.amount} ${t.paidAt}: найдено ${list.length}`);
      target = { paymentId: list[0].id, label: `оплата ${t.amount} от ${t.paidAt}` };
    }
    const key = `${m.id}|${target.purchaseId ?? ""}|${target.paymentId ?? ""}|${target.supplierId ?? ""}`;
    const has = keys.has(key);
    plan.push(`${has ? "[уже есть]" : "[+]"} ${l.type.padEnd(16)} ${m.title}  →  ${target.label}`);
    if (has) continue;
    rows.push({
      label: target.label,
      data: {
        id: newId(), organizationId: org.id, driveFileId: m.id, title: m.title, docType: l.type,
        mimeType: m.mime_type ?? null, sizeBytes: m.size ? Number(m.size) : null, drivePath: m.path ?? null, viewUrl: m.url ?? null,
        docDate: l.date ? new Date(l.date + "T00:00:00Z") : null, docNumber: l.num ?? null, year: 2025,
        notes: [l.note, "Привязка скриптом link-rematch-p2025 (повторное сопоставление, exact)"].join(". "),
        purchaseId: target.purchaseId ?? null, paymentId: target.paymentId ?? null, supplierId: target.supplierId ?? null,
      },
    });
  }
  console.log(plan.join("\n"));
  console.log(`\nК созданию строк DriveDocument: ${rows.length}`);
  if (!APPLY) { console.log("DRY-RUN: ничего не записано. Для применения — --apply (сначала scripts/backup.sh)."); return; }
  if (!rows.length) { console.log("Нечего применять — всё уже привязано."); return; }

  const time = new Date().toISOString();
  await prisma.$transaction(async (tx) => {
    for (const r of rows) await tx.driveDocument.create({ data: r.data });
  }, { timeout: 120_000, maxWait: 60_000 });
  journalAppend(rows.map((r) => ({
    time, entity: "DriveDocument", id: r.data.id, field: "__create__", before: null,
    after: { ...r.data, docDate: r.data.docDate ? (r.data.docDate as Date).toISOString() : null }, source: `link-rematch-p2025; ${r.label}`,
  })));
  console.log(`ГОТОВО: создано ${rows.length}. Журнал ${JOURNAL_PATH}. Откат: --rollback ${JOURNAL_PATH}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
