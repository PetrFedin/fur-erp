/**
 * Загрузка приложений к ТЗ 169–182 («Партия 22») как документов-оснований — ПРЕДЛОЖЕНИЕ от 13.10.2026, НЕ ПРИМЕНЕНО.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/attach-tz-169-182-appendices-2026-10-13.ts             # пробный прогон (БД и UPLOAD_DIR не меняются)
 *   node --env-file=.env node_modules/.bin/tsx scripts/attach-tz-169-182-appendices-2026-10-13.ts --apply     # применить (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --env-file=.env node_modules/.bin/tsx scripts/attach-tz-169-182-appendices-2026-10-13.ts --rollback [--apply]
 *
 * Как у прежних ТЗ: DriveDocument docType TZ_APPENDIX, productionOrderId, номер документа = номер приложения (как у ТЗ 118/119/162: «118»),
 * название = имя файла. Запись и файл создаются теми же функциями, что «Загрузить документ» (uploadDriveDocument): readDocumentFiles (проверка сигнатуры, 25 МБ)
 * → writeDriveFile (UPLOAD_DIR/drive-docs/<org>/<uuid>.docx) → driveDocument.create (driveFileId local-<uuid>, storagePath/storedName/storedMime/storedSize/storedAt).
 * Образец «несколько позиций» — ТЗ 118: по записи на КАЖДЫЙ заказ, файл один. Так же здесь: приложение 182 → 3 записи (заказы П-2026-0197…0199), один файл на диске.
 * Номер приложения и дата берутся из текста файла («ТЕХНИЧЕСКОЕ ЗАДАНИЕ № N», «26.08.2026г.»); дата должна совпасть с workOrderDate заказов.
 * Дублей нет: если у заказа уже есть документ TZ_APPENDIX — заказ пропускается. Ничего больше (суммы, партии, оплаты, подтверждения) не меняется.
 * Журнал: docs-inventory/corrections-journal-attach-tz-169-182-appendices-2026-10-13.json. Откат удаляет ТОЛЬКО созданные записи и файлы с диска, на которые больше никто не ссылается.
 * Каталог с файлами: DOWNLOADS (по умолчанию ~/Downloads); для проверки на копии — UPLOAD_DIR копии.
 */
import "./stubs/server-only-shim";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const DOWNLOADS = process.env.DOWNLOADS?.trim() || join(homedir(), "Downloads");
const SCRIPT = "attach-tz-169-182-appendices-2026-10-13";

/** tz → имя файла. */
const FILES: [string, string][] = [
  ["169", "ПРИЛОЖЕНИЕ 169 (М001Е - арк.лиса).docx"],
  ["170", "ПРИЛОЖЕНИЕ 170 (М028 - 1 шт).docx"],
  ["171", "ПРИЛОЖЕНИЕ 171 (М023 - 1 шт).docx"],
  ["172", "ПРИЛОЖЕНИЕ 172 (М002 - 1 собол).docx"],
  ["173", "ПРИЛОЖЕНИЕ 173 (М009 - 1 шт. браун).docx"],
  ["174", "ПРИЛОЖЕНИЕ_174_М026_4_шт_норка_белая.docx"],
  ["175", "ПРИЛОЖЕНИЕ 175 (М018-свакара 6 шт).docx"],
  ["176", "ПРИЛОЖЕНИЕ 176 (М038 - 2 шт).docx"],
  ["177", "ПРИЛОЖЕНИЕ 177 (М044 - 1 шт).docx"],
  ["178", "ПРИЛОЖЕНИЕ 178 (MMF01 - 1 шт. ).docx"],
  ["179", "ПРИЛОЖЕНИЕ 179 (MCF01 - 5 шт. ).docx"],
  ["180", "ПРИЛОЖЕНИЕ 180 (М045 - 5 шт.) бордо.docx"],
  ["181", "ПРИЛОЖЕНИЕ 181 (М055 - 2 шт.).docx"],
  ["182", "ПРИЛОЖЕНИЕ 182 (МН06-МН07 - 46 шт).docx"],
];

type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string;
  created: { id: string; orderId: string; orderNumber: string; tz: string; title: string; docNumber: string; storagePath: string }[];
  files: string[];
};

/** Текст word/document.xml без тегов. */
function docxText(path: string): string {
  const xml = execFileSync("unzip", ["-p", path, "word/document.xml"], { maxBuffer: 20 * 1024 * 1024 }).toString("utf8");
  return xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/ /g, " ");
}

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { readDocumentFiles } = await import("../src/lib/purchase-files");
  const { writeDriveFile } = await import("../src/lib/drive-files");
  const { removeStoredFiles } = await import("../src/lib/fitting-files");
  const { storedFileExists } = await import("../src/lib/stored-file-check");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const prisma = createAuditedClient(`script:${SCRIPT}`);
  const JOURNAL = join(INV, `corrections-journal-${SCRIPT}.json`);

  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат: записей ${j.created.length}, файлов на диске ${j.files.length}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (APPLY) {
      const del = await prisma.driveDocument.deleteMany({ where: { id: { in: j.created.map((c) => c.id) } } });
      console.log(`  удалено записей ${del.count}`);
      const gone: string[] = [];
      for (const p of j.files) {
        const left = await prisma.driveDocument.count({ where: { storagePath: p } }) + await prisma.purchaseDocument.count({ where: { storagePath: p } });
        if (left === 0) gone.push(p); else console.log(`  файл ${p} оставлен: на него ссылаются ${left} др. записей`);
      }
      await removeStoredFiles(gone);
      console.log(`  удалено файлов ${gone.length}`);
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
    }
    await prisma.$disconnect();
    return;
  }

  const problems: string[] = [];
  const org = await prisma.organization.findFirstOrThrow({ select: { id: true } });
  const orgId = org.id;
  type Row = { tz: string; file: string; path: string; size: number; docNumber: string; docDate: Date; dateText: string; orders: { id: string; number: string; verified: boolean; workOrderDate: Date | null; hasAppendix: boolean }[] };
  const rows: Row[] = [];
  for (const [tz, file] of FILES) {
    const path = join(DOWNLOADS, file);
    if (!existsSync(path)) { problems.push(`ТЗ ${tz}: файл не найден — ${path}`); continue; }
    const text = docxText(path);
    const num = /ТЕХНИЧЕСКОЕ ЗАДАНИЕ\s*№\s*(\d+)/i.exec(text)?.[1];
    const appNum = /ПРИЛОЖЕНИЕ\s*№\s*(\d+)/i.exec(text)?.[1];
    const dm = /(\d{2})\.(\d{2})\.(\d{4})\s*г/.exec(text);
    if (num !== tz || appNum !== tz) problems.push(`ТЗ ${tz}: в тексте приложение №${appNum}, ТЗ №${num} — не совпало с номером в имени файла`);
    if (!dm) { problems.push(`ТЗ ${tz}: дата в тексте не найдена`); continue; }
    const docDate = new Date(Date.UTC(+dm[3], +dm[2] - 1, +dm[1]));
    const orders = await prisma.productionOrder.findMany({
      where: { organizationId: orgId, workOrderNumber: tz, status: { not: "CANCELLED" } },
      select: { id: true, number: true, verifiedAt: true, workOrderDate: true, driveDocuments: { where: { docType: "TZ_APPENDIX" }, select: { id: true } } },
      orderBy: { number: "asc" },
    });
    if (!orders.length) { problems.push(`ТЗ ${tz}: заказов в базе нет`); continue; }
    for (const o of orders) {
      if (o.workOrderDate && o.workOrderDate.getTime() !== docDate.getTime()) problems.push(`ТЗ ${tz} (${o.number}): дата ТЗ в базе ${o.workOrderDate.toISOString().slice(0, 10)} ≠ дате в приложении ${docDate.toISOString().slice(0, 10)}`);
    }
    rows.push({
      tz, file, path, size: statSync(path).size, docNumber: tz, docDate, dateText: `${dm[1]}.${dm[2]}.${dm[3]}`,
      orders: orders.map((o) => ({ id: o.id, number: o.number, verified: !!o.verifiedAt, workOrderDate: o.workOrderDate, hasAppendix: o.driveDocuments.length > 0 })),
    });
  }

  const out: string[] = [`# Приложения к ТЗ 169–182 — ${APPLY ? "ПРИМЕНЕНИЕ" : "пробный прогон"} (${new Date().toISOString()})`, "",
    "| файл | ТЗ → заказ | тип | номер документа (приложение №) | дата | размер, байт | куда | статус |", "|---|---|---|---|---|---:|---|---|"];
  let toCreate = 0;
  for (const r of rows) {
    for (const o of r.orders) {
      const st = o.hasAppendix ? "уже есть TZ_APPENDIX — пропуск" : o.verified ? "заказ подтверждён — загрузка сбросит подтверждение (скрипт не трогает)" : "создать";
      if (!o.hasAppendix) toCreate++;
      out.push(`| ${r.file} | ТЗ ${r.tz} → ${o.number} | TZ_APPENDIX | ${r.docNumber} | ${r.dateText} | ${r.size} | UPLOAD_DIR/drive-docs/${orgId}/<uuid>.docx | ${st} |`);
    }
  }
  out.push("", `К созданию записей: ${toCreate}; файлов на диске: ${rows.filter((r) => r.orders.some((o) => !o.hasAppendix)).length}.`);
  if (rows.some((r) => r.orders.some((o) => o.verified && !o.hasAppendix))) problems.push("Есть подтверждённые заказы: сброс подтверждения делает приложение, не скрипт — сначала разберитесь.");
  if (problems.length) out.push("", "## ПРОБЛЕМЫ — запись не выполняется", ...problems.map((x) => `- ${x}`));
  console.log(out.join("\n"));
  if (problems.length) { console.log(`\nНайдено проблем: ${problems.length}. Запись невозможна.`); await prisma.$disconnect(); process.exitCode = 1; return; }
  if (!APPLY) { console.log("\nПробный прогон: БД и UPLOAD_DIR не менялись. Для записи — --apply."); await prisma.$disconnect(); return; }

  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённую загрузку — повторно не применяю (сначала --rollback --apply)."); await prisma.$disconnect(); return; }
  if (!NO_BACKUP) { console.log("Копия базы и файлов перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }

  const journal: Journal = { script: `${SCRIPT}.ts`, status: "applied", at: new Date().toISOString(), created: [], files: [] };
  try {
    for (const r of rows) {
      const todo = r.orders.filter((o) => !o.hasAppendix);
      if (!todo.length) continue;
      const buf = readFileSync(r.path);
      const read = await readDocumentFiles([new File([buf], r.file)]);
      if ("error" in read) throw new Error(`ТЗ ${r.tz}: ${read.error}`);
      const stored = await writeDriveFile(orgId, read.files[0]); // один файл на ТЗ, записи — по заказу (как у ТЗ 118)
      journal.files.push(stored.storagePath);
      for (const o of todo) {
        const doc = await prisma.driveDocument.create({
          data: {
            organizationId: orgId,
            driveFileId: `local-${randomUUID()}`,
            title: r.file.slice(0, 200),
            docType: "TZ_APPENDIX",
            mimeType: stored.storedMime,
            sizeBytes: stored.storedSize,
            docNumber: r.docNumber,
            docDate: r.docDate,
            year: r.docDate.getUTCFullYear(),
            ...stored,
            storedAt: new Date(),
            productionOrderId: o.id,
          },
          select: { id: true },
        });
        journal.created.push({ id: doc.id, orderId: o.id, orderNumber: o.number, tz: r.tz, title: r.file, docNumber: r.docNumber, storagePath: stored.storagePath });
        if (!storedFileExists(stored.storagePath)) throw new Error(`Файл ${stored.storagePath} не найден на диске после записи`);
      }
    }
  } catch (e) {
    // Частичный результат не оставляем: убираем созданные записи и файлы, журнал не пишем.
    console.error("Сбой — откатываю уже созданное:", e);
    await prisma.driveDocument.deleteMany({ where: { id: { in: journal.created.map((c) => c.id) } } });
    await removeStoredFiles(journal.files);
    await prisma.$disconnect();
    process.exit(1);
  }
  writeJson(JOURNAL, journal);
  console.log(`Применено: записей ${journal.created.length}, файлов ${journal.files.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
