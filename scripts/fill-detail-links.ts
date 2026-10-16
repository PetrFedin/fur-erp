/**
 * Привязка трёх файлов Drive, которых не было в БД и у которых нет точных дублей среди уже привязанных
 * (прочие 26 из docs-inventory/unlinked-files.json — точные копии «Копия …»/«(1)» с тем же именем и размером,
 * сознательно не заводятся; «~$расчет производства партии 8.xlsx» — временный файл Office, 165 байт).
 *
 *  - «Соболь счета выделка + перевозки.pdf»: счета МК ЛИС/МП-Прогресс (выделка соболя, апрель–май 2025) и
 *    Деловые Линии/ПЭК (перевозка) — к закупкам СП 03.25 и РП 03.25 (поставка по УПД №77/№78 от 16.05.2025).
 *  - «ПРИЛОЖЕНИЕ_8_152_шкуры_Союзпушнина_12_25.docx»: Спецификация №8 от 22.12.2025, 152 шкурки соболя,
 *    4 836 327,52 ₽ — к закупке З-2026-0004 (СП 12.25, 152 шт).
 *  - «расчет пошива 8 партии.xlsx»: расчёт доплаты за пошив партии 8 от 26.01.2026 — к партии 8.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/fill-detail-links.ts [--apply|--rollback]
 * Журнал: docs-inventory/corrections-journal-detail-links.json
 */
import "./lib/drive-links-disabled";
import { join } from "path";
import { PrismaClient, DriveDocType } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(INV, "corrections-journal-detail-links.json");
const view = (id: string) => `https://drive.google.com/file/d/${id}/view?usp=drivesdk`;

const FILES = [
  { id: "1DWzY20UZ75bZ1cMncMTbS5fqO8IMOqtS", title: "Соболь счета выделка + перевозки.pdf", mime: "application/pdf", size: 7352669, type: DriveDocType.OTHER, path: "мех/Приобретение мехового сырья — копия/закупка 2025/соболь/Соболь счета выделка + перевозки.pdf", year: 2025, notes: "Счета на выделку соболя (МК ЛИС акты 265/303/304, МП-Прогресс мп2904.3/.4, мп0605.4, счета 95 и 104) и перевозку (Деловые Линии, ПЭК), апрель–май 2025", sessions: ["СП 03.25", "РП 03.25"] },
  { id: "1pYggTyZOOWYD_6Y0CL2ZibzVYXtCItf7", title: "ПРИЛОЖЕНИЕ_8_152_шкуры_Союзпушнина_12_25.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 16000, type: DriveDocType.SPECIFICATION, path: "мех/Приобретение мехового сырья — копия/закупка 2026/соболь/закупка 2 Союзпушнина/ПРИЛОЖЕНИЕ_8_152_шкуры_Союзпушнина_12_25.docx", year: 2025, docDate: "2025-12-22", docNumber: "8", notes: "Спецификация №8 от 22.12.2025 к Договору №2502: 152 шкурки соболя, 4 836 327,52 ₽, поставка декабрь 2025", purchases: ["З-2026-0004"] },
];
const BATCH_FILE = { id: "12EQLSCDGMV-m8tz8QTbXZ7lovE-Tn8_m", title: "расчет пошива 8 партии.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 12556, path: "мех/Производство меховых изделий — копия/2025/поставка 8 - 46 ед/расчет пошива 8 партии.xlsx", notes: "Расчёт доплаты за пошив партии 8 от 26.01.2026: 9 строк, работа 1 182 657 ₽, аванс 814 949,80, к доплате 400 625,59" };

async function main() {
  const org = await prisma.organization.findFirstOrThrow();
  if (ROLLBACK) {
    const j = readJson<{ createdIds: string[] }>(JOURNAL, { createdIds: [] });
    const r = await prisma.driveDocument.deleteMany({ where: { id: { in: j.createdIds }, organizationId: org.id } });
    writeJson(JOURNAL, { createdIds: [], rolledBackAt: new Date().toISOString(), deleted: r.count });
    return console.log(`Откат: удалено ${r.count} созданных ссылок.`);
  }
  const plan: Array<{ data: any; label: string }> = [];
  const exists = async (fileId: string, where: object) => (await prisma.driveDocument.count({ where: { driveFileId: fileId, ...where } })) > 0;
  for (const f of FILES) {
    const ps = await prisma.purchase.findMany({
      where: { organizationId: org.id, ...(f.sessions ? { auctionSession: { in: f.sessions } } : { number: { in: f.purchases } }) },
    });
    for (const p of ps) {
      if (await exists(f.id, { purchaseId: p.id })) continue;
      plan.push({ label: `${f.title} → ${p.number}`, data: { organizationId: org.id, driveFileId: f.id, title: f.title, docType: f.type, mimeType: f.mime, sizeBytes: f.size, drivePath: f.path, viewUrl: view(f.id), docDate: (f as any).docDate ? new Date((f as any).docDate) : null, docNumber: (f as any).docNumber ?? null, year: f.year, notes: f.notes, purchaseId: p.id } });
    }
  }
  const b8 = await prisma.productionBatch.findFirst({ where: { organizationId: org.id, number: 8 } });
  if (b8 && !(await exists(BATCH_FILE.id, { productionBatchId: b8.id })))
    plan.push({ label: `${BATCH_FILE.title} → партия 8`, data: { organizationId: org.id, driveFileId: BATCH_FILE.id, title: BATCH_FILE.title, docType: DriveDocType.CALC_SHEET, mimeType: BATCH_FILE.mime, sizeBytes: BATCH_FILE.size, drivePath: BATCH_FILE.path, viewUrl: view(BATCH_FILE.id), docDate: new Date("2026-01-26"), year: 2026, notes: BATCH_FILE.notes, productionBatchId: b8.id } });
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN ==", `новых ссылок: ${plan.length}`);
  for (const p of plan) console.log("  ", p.label);
  if (!APPLY) return;
  const j = readJson<{ createdIds: string[] }>(JOURNAL, { createdIds: [] });
  for (const p of plan) {
    const row = await prisma.driveDocument.create({ data: p.data });
    j.createdIds.push(row.id);
    writeJson(JOURNAL, { script: "fill-detail-links.ts", createdIds: j.createdIds });
  }
  writeJson(JOURNAL, { script: "fill-detail-links.ts", appliedAt: new Date().toISOString(), createdIds: j.createdIds });
  console.log(`Создано ${plan.length}.`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
