/**
 * Привязка документов по результатам глобального сканирования Drive (rematch-global).
 * Итог сканирования 07.10.2026: вне папки «мех» документов по закупкам/производству нет, а все 593 файла внутри
 * «мех» без дублей уже имеют DriveDocument — новых exact-привязок нет (см. docs-inventory/rematch-global.md).
 * Скрипт оставлен для идемпотентной проверки: он перечисляет файлы манифеста без DriveDocument и подтверждает, что все они — дубли
 * (тот же размер и имя, что у привязанного файла) или служебные.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-rematch-global.ts            # dry-run (по умолчанию)
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-rematch-global.ts --apply    # привязывает CANDIDATES (сейчас пуст)
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-rematch-global.ts --rollback docs-inventory/corrections-journal-rematch-global.json
 */
import "./lib/drive-links-disabled";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const INV = join(resolve(__dirname, ".."), "docs-inventory");
const JOURNAL = join(INV, "corrections-journal-rematch-global.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rb = args.indexOf("--rollback");
const newId = () => "c" + Date.now().toString(36) + randomBytes(9).toString("hex");

type Cand = { fileId: string; docType: string; purchaseId?: string; paymentId?: string; productionBatchId?: string; docNumber?: string; docDate?: string; note: string };
const CANDIDATES: Cand[] = []; // exact-привязок не найдено

async function main() {
  if (rb >= 0) {
    const e = JSON.parse(readFileSync(resolve(args[rb + 1]), "utf-8")) as { id: string; field: string }[];
    const r = await prisma.driveDocument.deleteMany({ where: { id: { in: e.filter((x) => x.field === "__create__").map((x) => x.id) } } });
    console.log("откат: удалено", r.count);
    return;
  }
  const files: any[] = readdirSync(INV).filter((f) => /^drive-live-batch-\d+\.json$/.test(f)).flatMap((f) => JSON.parse(readFileSync(join(INV, f), "utf-8")));
  const org = await prisma.organization.findFirstOrThrow();
  const docs = await prisma.driveDocument.findMany({ where: { organizationId: org.id }, select: { driveFileId: true } });
  const linked = new Set(docs.map((d) => d.driveFileId));
  const un = files.filter((f) => !linked.has(f.id) && !f.mime_type.includes("folder"));
  const sizeLinked = new Set(files.filter((f) => linked.has(f.id)).map((f) => f.size));
  const nonDup = un.filter((f) => !sizeLinked.has(f.size));
  console.log(`${APPLY ? "ПРИМЕНЕНИЕ" : "DRY-RUN"}: файлов ${files.length}, без DriveDocument ${un.length}, из них не дубли по размеру ${nonDup.length}`);
  nonDup.forEach((f) => console.log("  не дубль по размеру:", f.id.slice(0, 8), f.path));
  const have = new Set((await prisma.driveDocument.findMany({ where: { organizationId: org.id }, select: { driveFileId: true, purchaseId: true, paymentId: true, productionBatchId: true } })).map((d) => `${d.driveFileId}|${d.purchaseId ?? ""}|${d.paymentId ?? ""}|${d.productionBatchId ?? ""}`));
  const todo = CANDIDATES.filter((c) => !have.has(`${c.fileId}|${c.purchaseId ?? ""}|${c.paymentId ?? ""}|${c.productionBatchId ?? ""}`));
  console.log(`кандидатов ${CANDIDATES.length}, к созданию ${todo.length}`);
  if (!APPLY || todo.length === 0) return;
  const journal: unknown[] = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : [];
  for (const c of todo) {
    const f = files.find((x) => x.id === c.fileId)!;
    const id = newId();
    await prisma.driveDocument.create({ data: { id, organizationId: org.id, driveFileId: f.id, title: f.title, docType: c.docType as never, mimeType: f.mime_type, sizeBytes: Number(f.size) || null, drivePath: f.path, viewUrl: f.url, docNumber: c.docNumber, docDate: c.docDate ? new Date(c.docDate) : null, year: c.docDate ? Number(c.docDate.slice(0, 4)) : null, notes: c.note, purchaseId: c.purchaseId, paymentId: c.paymentId, productionBatchId: c.productionBatchId } });
    journal.push({ entity: "DriveDocument", id, field: "__create__", fileId: f.id });
    writeFileSync(JOURNAL, JSON.stringify(journal, null, 2));
  }
}
main().finally(() => prisma.$disconnect());
