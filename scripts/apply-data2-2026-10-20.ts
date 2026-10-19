/**
 * «Данные и логика», волна 2 (20.10.2026): шкуры подрядчика, образцы №177, закрытие ТЗ по приёмке, ремонт без партии,
 * резервные партии, Word-приложения ТЗ. ПРЕДЛОЖЕНИЕ, НА БОЕВОЙ БАЗЕ НЕ ПРИМЕНЕНО.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-data2-2026-10-20.ts                 # пробный прогон (БД не меняется)
 *   DATABASE_URL=<копия> UPLOAD_DIR=<папка> ... scripts/apply-data2-2026-10-20.ts --apply                                  # репетиция на копии
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-data2-2026-10-20.ts --apply --live  # боевая fur_erp (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-data2-2026-10-20.ts --rollback [--apply [--live]]
 *   доп. ключ: --only=hides,sample63,tz116,close22,planned4,batches,appx (по умолчанию — всё перечисленное)
 *
 * ЧТО ДЕЛАЕТ (каждый пункт — только при доказательстве по документам; суммы оплат, лотов и закупок НЕ меняет):
 *   hides     A1  Шкуры подрядчика 229 149,78 ₽: примечания к двум оплатам производства (п/п 22618 и 82173). По формулам «расчет доплаты по Партии 7.xlsx»
 *                 (ячейки J3:J17) и по ТЗ 84 остаток платежей — НЕ шкуры, а разница между итогом Приложения ТЗ (НДС 22 %) и сырьём по ценам лотов (НДС 20 %) + 4 % + работа;
 *                 она уже в стоимости ТЗ расходом «Корректировка по документу ТЗ». Закупку/лот/списание НЕ создаёт (это были бы выдуманные шкуры и двойной учёт).
 *   sample63  A2  Примечание к З-2026-0063 (счёт/УПД №177, образцы): статус по письмам. Оплату не проводит и не решает.
 *   tz116     B3  ТЗ 116 «Ремонт пальто»: основание «без партии» по письму 10.07.2026 (№135; флаг batchNotRequired, если не стоит, ставится) + сверка итога: 383 330,44 по Приложению + 90 997,92 (9 шкур 10026) = 474 328,36.
 *   close22   B7  ТЗ партии 22, принятые ЦУМ целиком (накладные ЗИ 21М/22М/23М, отгрузка принята 15.10.2026): «Выпущено», выпуск = принято, приход готовой продукции (как complete-delivered-orders).
 *                 ТЗ с возвратом (175: 6 шт. «нет в накладных») и ТЗ 183 (PLANNED) НЕ трогает.
 *   planned4  B7  ТЗ 75, 97, 104, 158 (стояли «Запланировано», выпуск = плану): по документам сданы и оплачены → «Выпущено» (приложение не завершало их только из-за пустых списаний).
 *   batches   B9  Партии 15 и 16 (нет ТЗ, документов, отгрузок, записей журнала): подпись «резерв, номер не использован» — НЕ удаляет.
 *   appx      B10 Word-приложения ТЗ 1–23, 28, 29, 33, 76, 80, 90, 115, 146 из архива почты → записи «Приложение ТЗ» без файла (как apply-control-confirmations).
 *
 * НЕ ДЕЛАЕТ (нет ≥95 % по документам, см. отчёт): ТЗ 164/183 (дубль или два изделия), п/п 60610 (договор 2502 или 1605), даты ТЗ 97–115, ТЗ 175, 24–27, 30–32, 34–36 (файлов нет).
 * Журнал: docs-inventory/corrections-journal-data2-2026-10-20[-<база>].json (до записи в БД). --rollback возвращает всё, включая файлы.
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
import { createHash, randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const LIVE = process.argv.includes("--live");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").map((s) => s.trim()).filter(Boolean);
const want = (k: string) => !ONLY.length || ONLY.includes(k);
const TAG = "[data2:2026-10-20]";
const D = (v: Decimal.Value) => new Decimal(v);
const rub = (v: Decimal.Value) => D(v).toDecimalPlaces(2).toNumber().toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** В тексты БД не попадают «Drive/Google/MVST/Диск» (test-no-external-refs): в темах писем такие слова убираем. */
const clean = (t: string) => t.replace(/MVST|Google|Drive|Диск/gi, "").replace(/\s{2,}/g, " ").replace(/\s+([.,;:»])/g, "$1").trim();
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ATT_ROOT = process.env.TZ_ATT_ROOT ?? join(process.env.HOME ?? "", "Downloads", "MEH_PST_EXTRACT", "_INDEX", "attachments");

/** Word-приложения из архива почты (файлы без расширения; в имени каталога — номер письма). Номер ТЗ проверен по содержимому («ТЕХНИЧЕСКОЕ ЗАДАНИЕ № N»), sha256 — по файлу. */
const APPX: { tz: string; variant: "base" | "plus4"; path: string; sha256: string; size: number; name: string; mail: string; mailDate: string; mailSubject: string }[] = [
  { tz: "1", variant: "base", path: "369/ПРИЛОЖЕНИЕ 1__0b982326e43e", sha256: "0b982326e43e6d35c4e2804ef0c5ff643a6ec85eb641f67e80a914b81111b6fb", size: 18895, name: "ПРИЛОЖЕНИЕ 1.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "2", variant: "base", path: "369/ПРИЛОЖЕНИЕ 2__ddd8b34ef5e2", sha256: "ddd8b34ef5e2592530801930c85cbcfb29314cfebe299c90e8544103a6beda75", size: 18669, name: "ПРИЛОЖЕНИЕ 2.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "3", variant: "base", path: "369/ПРИЛОЖЕНИЕ 3__6e15b00271c1", sha256: "6e15b00271c1bf6fff66f17e39244a6e3eb4213d17c29e2b03d612aad979677d", size: 18958, name: "ПРИЛОЖЕНИЕ 3.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "4", variant: "base", path: "369/ПРИЛОЖЕНИЕ 4__def88eea2c0e", sha256: "def88eea2c0e56f356c0270f8af94f2f8668eff5d1099879fb4e5631bfcd917f", size: 18956, name: "ПРИЛОЖЕНИЕ 4.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "5", variant: "base", path: "369/ПРИЛОЖЕНИЕ 5__b3e2ca08c444", sha256: "b3e2ca08c444532627b2fcdf7d447632774e8aeeca0f58e7275a75f397b39349", size: 18413, name: "ПРИЛОЖЕНИЕ 5.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "6", variant: "base", path: "369/ПРИЛОЖЕНИЕ 6__e02a71509f75", sha256: "e02a71509f7581a9244a7de57e4c182d6c2edd71607081c0ce4694e2311f8a59", size: 18401, name: "ПРИЛОЖЕНИЕ 6.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "7", variant: "base", path: "369/ПРИЛОЖЕНИЕ 7__0b621d4c8c74", sha256: "0b621d4c8c7403171d35a4bd9670cc9ec6ea53acc4406efb47ffb0b8b976c793", size: 18141, name: "ПРИЛОЖЕНИЕ 7.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "8", variant: "base", path: "369/ПРИЛОЖЕНИЕ 8__6af451b21bb0", sha256: "6af451b21bb08e06d3e8c8f4a0d13ff86b9cee9908f6b1f1bfd98977ab0fa1c3", size: 18396, name: "ПРИЛОЖЕНИЕ 8.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "9", variant: "base", path: "369/ПРИЛОЖЕНИЕ 9__f164cbcac5a3", sha256: "f164cbcac5a342c60e9cfe938056f1db296a4ad25f77970b4634f04315b75624", size: 18889, name: "ПРИЛОЖЕНИЕ 9.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "10", variant: "base", path: "369/ПРИЛОЖЕНИЕ 10__80c16043c257", sha256: "80c16043c257a0136741b86e7032fa91f169e307d1d89ae8b4d0e351f172b24f", size: 18413, name: "ПРИЛОЖЕНИЕ 10.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "11", variant: "base", path: "369/ПРИЛОЖЕНИЕ 11__e71d81b48ef7", sha256: "e71d81b48ef731d9e23656a74dbd848c4e2a23e0c1ae86d81de4c65755a4c48a", size: 19039, name: "ПРИЛОЖЕНИЕ 11.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "12", variant: "base", path: "369/ПРИЛОЖЕНИЕ 12__cf011fd00c00", sha256: "cf011fd00c00d81a0e14cf99dbc6a0f2443d7a39ad5e08159599e8cff6ca7592", size: 19132, name: "ПРИЛОЖЕНИЕ 12.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "13", variant: "base", path: "369/ПРИЛОЖЕНИЕ 13__db9a2912a8a5", sha256: "db9a2912a8a592176b2b6aabef6d2814695332966892ab9f389cce977611a099", size: 18936, name: "ПРИЛОЖЕНИЕ 13.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "14", variant: "base", path: "369/ПРИЛОЖЕНИЕ 14__df4576b37bf8", sha256: "df4576b37bf86247023857d7435c4908e8dc1ab37f8e9bad077d0da1cf6c0846", size: 19508, name: "ПРИЛОЖЕНИЕ 14.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "15", variant: "base", path: "369/ПРИЛОЖЕНИЕ 15__80219779708d", sha256: "80219779708d39dae239f712c9e6fbf960b5b444cf46ad50dbc4b0d57ec04c1d", size: 19768, name: "ПРИЛОЖЕНИЕ 15.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "16", variant: "base", path: "369/ПРИЛОЖЕНИЕ 16__6653f3d05a42", sha256: "6653f3d05a42811d7972311967895aa8c81cf6916ee2d5ac52a5ba19a9f0d8e4", size: 18901, name: "ПРИЛОЖЕНИЕ 16.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "17", variant: "base", path: "369/ПРИЛОЖЕНИЕ 17__de17556ac47a", sha256: "de17556ac47a99b941cb4a330a7cf796906cd4825e5d08815aa610c51ccc1e98", size: 19709, name: "ПРИЛОЖЕНИЕ 17.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "18", variant: "base", path: "369/ПРИЛОЖЕНИЕ 18__50c213f39a60", sha256: "50c213f39a60286f338c3341f7d7f903dd945b58640b619d659ab40d00745a65", size: 19021, name: "ПРИЛОЖЕНИЕ 18.docx", mail: "369", mailDate: "2025-09-16", mailSubject: "FW: ТЗ на готовые изделия.  Русский Мех X MVST" },
  { tz: "19", variant: "base", path: "361/ПРИЛОЖЕНИЕ 19__80631d7fadda", sha256: "80631d7faddafd6cfa9d932995ef161b613672b13bf4b0c27e09ceb2a71f2325", size: 20127, name: "ПРИЛОЖЕНИЕ 19.docx", mail: "361", mailDate: "2025-09-22", mailSubject: "FW: Партия 2" },
  { tz: "20", variant: "base", path: "361/ПРИЛОЖЕНИЕ 20__999e4e3b0508", sha256: "999e4e3b050880ac64fdefd272c86da2119746e774d0bfcc08997d82df58f6c1", size: 20790, name: "ПРИЛОЖЕНИЕ 20.docx", mail: "361", mailDate: "2025-09-22", mailSubject: "FW: Партия 2" },
  { tz: "21", variant: "base", path: "361/ПРИЛОЖЕНИЕ 21__661619ee5227", sha256: "661619ee5227dcfcc6d1c3ce1c58de21b029bacebe8c53a7dcd61f96abfc9682", size: 20510, name: "ПРИЛОЖЕНИЕ 21.docx", mail: "361", mailDate: "2025-09-22", mailSubject: "FW: Партия 2" },
  { tz: "22", variant: "base", path: "361/ПРИЛОЖЕНИЕ 22__54b6a2ac67fb", sha256: "54b6a2ac67fbd32f74787a045922a0b8c361257ef799994e10a3eff246a4977c", size: 20733, name: "ПРИЛОЖЕНИЕ 22.docx", mail: "361", mailDate: "2025-09-22", mailSubject: "FW: Партия 2" },
  { tz: "23", variant: "base", path: "359/ПРИЛОЖЕНИЕ 23__513716e7afce", sha256: "513716e7afce0463adce66291362fb1d2449635b9cb3a224c5d59b061a966b44", size: 19185, name: "ПРИЛОЖЕНИЕ 23.docx", mail: "359", mailDate: "2025-09-24", mailSubject: "вопрос по ТЗ 23 (модель М 002) - получен дополнительный счет на сырье" },
  { tz: "28", variant: "base", path: "347/ПРИЛОЖЕНИЕ 28__6799116afc95", sha256: "6799116afc95769e51cad8d7b3a471ccaaef970988e9ad25b0abdb3afe58702e", size: 19635, name: "ПРИЛОЖЕНИЕ 28.docx", mail: "347", mailDate: "2025-10-13", mailSubject: "Партия 3. ТЗ" },
  { tz: "29", variant: "base", path: "347/ПРИЛОЖЕНИЕ 29__be55299068f0", sha256: "be55299068f03b425a2cdb3abb50de825349458f09660aceb37323a410195e9b", size: 20186, name: "ПРИЛОЖЕНИЕ 29.docx", mail: "347", mailDate: "2025-10-13", mailSubject: "Партия 3. ТЗ" },
  { tz: "33", variant: "base", path: "347/ПРИЛОЖЕНИЕ 33__7f40d2482e9f", sha256: "7f40d2482e9f9ef4491a4ec4674ad37f461edcc7b87ce303c638c4e10fee8352", size: 19832, name: "ПРИЛОЖЕНИЕ 33.docx", mail: "347", mailDate: "2025-10-13", mailSubject: "Партия 3. ТЗ" },
  { tz: "76", variant: "base", path: "321/ПРИЛОЖЕНИЕ 76__71ac5d9f038f", sha256: "71ac5d9f038ff73feec65b05823723e4701198b185f002a320ab813fe1475174", size: 21404, name: "ПРИЛОЖЕНИЕ 76.docx", mail: "321", mailDate: "2025-12-25", mailSubject: "FW: Партия 7" },
  { tz: "76", variant: "plus4", path: "294/ПРИЛОЖЕНИЕ 76__2e50ad4cd74e", sha256: "2e50ad4cd74e5338083ca83645e4f94ad9518c7530b549c19c8ac9e8a1d523b3", size: 21374, name: "ПРИЛОЖЕНИЕ 76.docx", mail: "294", mailDate: "2026-02-03", mailSubject: "FW: Партия 7" },
  { tz: "80", variant: "base", path: "321/ПРИЛОЖЕНИЕ 80__0d9f4c1b4ddd", sha256: "0d9f4c1b4ddd16c5aa82025a2e9c4f34ac4eab90262f9b73a5474ec4af5033ed", size: 20734, name: "ПРИЛОЖЕНИЕ 80.docx", mail: "321", mailDate: "2025-12-25", mailSubject: "FW: Партия 7" },
  { tz: "80", variant: "plus4", path: "294/ПРИЛОЖЕНИЕ 80__2b4ebfe31624", sha256: "2b4ebfe31624d5dc14f4eae3e00763dfae4da6209a06a9bac391c5b0acd7dd54", size: 20474, name: "ПРИЛОЖЕНИЕ 80.docx", mail: "294", mailDate: "2026-02-03", mailSubject: "FW: Партия 7" },
  { tz: "90", variant: "base", path: "297/ПРИЛОЖЕНИЕ 90__4606a5a178eb", sha256: "4606a5a178eb57e57dc43c9ad7f8e5c57a29df76364e4251144c582b8dd7baf9", size: 19878, name: "ПРИЛОЖЕНИЕ 90.docx", mail: "297", mailDate: "2026-01-30", mailSubject: "Партия 9" },
  { tz: "115", variant: "base", path: "93/ПРИЛОЖЕНИЕ 115__51d8510a9587", sha256: "51d8510a9587981b5885c6bcaadfee7df8199bd56b761781cb9c1bb7bd22ad33", size: 22681, name: "ПРИЛОЖЕНИЕ 115.docx", mail: "93", mailDate: "2026-08-11", mailSubject: "FW: Партия 14" },
  { tz: "146", variant: "base", path: "23/ПРИЛОЖЕНИЕ 146 MSC06- 5 шт__bb79b279c48d", sha256: "bb79b279c48df39da7fba138ad3fc2314c0bbcbba69b8c94fcc8211b55892ec2", size: 23407, name: "ПРИЛОЖЕНИЕ 146 MSC06- 5 шт.docx", mail: "23", mailDate: "2026-09-15", mailSubject: "Re: вопрос по шарфам из аркт лисы - MSC -06 - ТЗ 131 и ТЗ 146" },
];

type NoteRec = { kind: "payment" | "purchase" | "order" | "batch"; id: string; label: string; before: string | null; after: string; add: string };
type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string; db: string; uploadDir: string;
  notes: NoteRec[];
  flags: { id: string; tz: string; batchNotRequiredBefore: boolean | null }[];
  completions: {
    orderId: string; number: string; tz: string;
    before: { status: string; producedQuantity: string; materialCost: string | null; expenseCost: string | null; totalCost: string | null; unitCost: string | null; endDate: string | null };
    movementId: string; stockId: string; stockCreated: boolean; stockBefore: { quantity: string; avgUnitCost: string } | null;
  }[];
  batches: { id: string; number: number; nameBefore: string | null; nameAfter: string }[];
  docs: { action: "updated" | "created"; id: string; file: string; before?: Record<string, unknown> }[];
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { UPLOAD_ROOT } = await import("../src/lib/fitting-files");
  const url = process.env.DATABASE_URL ?? "";
  const dbName = url.split("?")[0].split("/").pop() ?? "";
  const isLive = dbName === "fur_erp";
  if (APPLY && isLive && !LIVE) throw new Error(`База «${dbName}» боевая: для записи нужен --live (для репетиции укажите копию через DATABASE_URL и UPLOAD_DIR).`);
  if (APPLY && !isLive && LIVE) throw new Error(`--live указан, но DATABASE_URL смотрит на «${dbName}», а не на fur_erp.`);
  if (APPLY && !isLive && !process.env.UPLOAD_DIR) throw new Error("Репетиция на копии: задайте UPLOAD_DIR на отдельную папку (иначе файлы попадут в боевые загрузки).");
  const prisma = createAuditedClient("script:apply-data2-2026-10-20");
  const JOURNAL = join(INV, `corrections-journal-data2-2026-10-20${isLive ? "" : `-${dbName}`}.json`);
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const dirRel = join("drive-docs", org);

  // ───────── откат ─────────
  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат (${dbName}): примечаний ${j.notes.length}, закрытых ТЗ ${j.completions.length}, партий ${j.batches.length}, файлов ТЗ ${j.docs.length}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (APPLY) {
      if (isLive && !NO_BACKUP) { console.log("Копия базы перед откатом: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
      await prisma.$transaction(async (tx) => {
        for (const d of j.docs.slice().reverse()) {
          if (d.action === "created") await tx.driveDocument.deleteMany({ where: { id: d.id } });
          else if (d.before) {
            const b = d.before as { storedAt: string | null; docDate?: string | null };
            await tx.driveDocument.update({ where: { id: d.id }, data: { ...(d.before as object), storedAt: b.storedAt ? new Date(b.storedAt) : null, ...(b.docDate !== undefined ? { docDate: b.docDate ? new Date(b.docDate) : null } : {}) } as never });
          }
        }
        for (const c of j.completions.slice().reverse()) {
          await tx.finishedGoodsMovement.deleteMany({ where: { id: c.movementId } });
          if (c.stockCreated) await tx.finishedGoodsStock.deleteMany({ where: { id: c.stockId } });
          else if (c.stockBefore) await tx.finishedGoodsStock.update({ where: { id: c.stockId }, data: { quantity: c.stockBefore.quantity, avgUnitCost: c.stockBefore.avgUnitCost } });
          await tx.productionOrder.update({
            where: { id: c.orderId },
            data: { status: c.before.status as never, producedQuantity: c.before.producedQuantity, materialCost: c.before.materialCost, expenseCost: c.before.expenseCost, totalCost: c.before.totalCost, unitCost: c.before.unitCost, endDate: c.before.endDate ? new Date(c.before.endDate) : null },
          });
        }
        for (const f of j.flags) await tx.productionOrder.update({ where: { id: f.id }, data: { batchNotRequired: f.batchNotRequiredBefore } });
        for (const b of j.batches) await tx.productionBatch.update({ where: { id: b.id }, data: { name: b.nameBefore } });
        for (const n of j.notes.slice().reverse()) {
          const cur = await getNote(tx, n.kind, n.id);
          if (cur !== n.after) { console.log(`  ! ${n.label}: примечание изменено после скрипта — не откатываю (уберите строку с ${TAG} вручную)`); continue; }
          await setNote(tx, n.kind, n.id, n.before);
        }
      }, { timeout: 120000, maxWait: 15000 });
      for (const d of j.docs) {
        const rel = d.file;
        const still = await prisma.driveDocument.count({ where: { storagePath: rel } });
        if (!still) { try { unlinkSync(join(UPLOAD_ROOT, rel)); } catch { /* уже нет */ } }
      }
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  // ───────── чтение и план ─────────
  const table: { item: string; obj: string; what: string; basis: string }[] = [];
  const info: string[] = [];
  const noteAdds: NoteRec[] = [];
  const flagAdds: Journal["flags"] = [];
  const batchAdds: Journal["batches"] = [];
  type Compl = { orderId: string; number: string; tz: string; qty: Decimal; endDate: Date | null; basis: string; note: string; item: string };
  const compls: Compl[] = [];
  type DocPlan = { m: (typeof APPX)[number]; doc: { id: string; title: string; notes: string | null; orderId: string }; buf: Buffer };
  const docPlans: DocPlan[] = [];
  const problems: string[] = [];

  const addNote = async (kind: NoteRec["kind"], id: string, label: string, text: string, item: string, what: string, basis: string) => {
    const cur = await getNote(prisma, kind, id);
    if ((cur ?? "").includes(TAG) && (cur ?? "").includes(text.slice(TAG.length + 1, TAG.length + 60))) { info.push(`${item}: ${label} — примечание уже есть`); return; }
    noteAdds.push({ kind, id, label, before: cur, add: text, after: `${cur ? cur + "\n" : ""}${text}` });
    table.push({ item, obj: label, what, basis });
  };

  // A1 — шкуры подрядчика
  if (want("hides")) {
    const p1 = await prisma.productionPayment.findMany({ where: { organizationId: org, ppNo: "22618", invoiceNo: "1" }, select: { id: true, amount: true, notes: true } });
    const p2 = await prisma.productionPayment.findMany({ where: { organizationId: org, ppNo: "82173", notes: { contains: "Остаток неразнесённого 32 918,56" } }, select: { id: true, amount: true, notes: true } });
    if (p1.length !== 1) problems.push(`hides: оплата п/п 22618 (счёт №1) — найдено ${p1.length}, нужна одна`);
    if (p2.length !== 1) problems.push(`hides: оплата п/п 82173 с остатком 32 918,56 — найдено ${p2.length}, нужна одна`);
    // сверка с БД: расходы-корректировки ТЗ 70–84 (НДС 22 % против 20 %) — те же суммы, что в расчёте доплаты
    const adj = await prisma.productionExpense.findMany({ where: { category: { name: "Корректировка по документу ТЗ" }, productionOrder: { organizationId: org, workOrderNumber: { in: ["70", "71", "72", "73", "74", "76", "77", "78", "80", "81", "82", "83", "84"] } } }, select: { amount: true, productionOrder: { select: { workOrderNumber: true } } } });
    const byTz = new Map<string, Decimal>();
    for (const e of adj) { const t = e.productionOrder.workOrderNumber ?? ""; byTz.set(t, (byTz.get(t) ?? D(0)).add(e.amount)); }
    const sum7 = [...byTz.entries()].filter(([t]) => t !== "84").reduce((s, [, v]) => s.add(v), D(0));
    const tz84 = byTz.get("84") ?? D(0);
    info.push(`A1 контроль: расходы «Корректировка по документу ТЗ» по ТЗ 70–74, 76–78, 80–83 = ${rub(sum7)} ₽ (в расчёте доплаты партии 7: 164 923,70 ₽); по ТЗ 84 = ${rub(tz84)} ₽ (остаток п/п 82173: 32 918,56 ₽)`);
    if (p1.length === 1) {
      const t1 = `${TAG} Разбор остатка 189 966,22 ₽ (в акте/реестре «шкуры подрядчика»). Это НЕ шкуры: по формулам файла «расчет доплаты по Партии 7.xlsx» (14.01.2026; письма №264, №302; колонка «Стоимость шкур / НДС 22 %», итого 1 117 463,70 ₽, ячейки J3:J17) настоящие шкуры — только ТЗ 79: 70 шт. фондю × 13 470 = 942 900,00 ₽ (в системе: закупка З-2026-0012 927 500,00 + 15 400,00 в расходе ТЗ 79). Остальное — разница между итогом Приложения ТЗ (НДС 22 %) и сырьём по ценам лотов (НДС 20 %) с 4 % плюс работа: ТЗ 70–78, 80–83 — 164 923,70 ₽ и 9 640,00 ₽ (ТЗ 79, НДС на работу). Эта разница уже входит в стоимость ТЗ расходом «Корректировка по документу ТЗ» (по ТЗ 70–74, 76–78, 80–83 в системе ${rub(sum7)} ₽ против 164 923,70 ₽ в расчёте; разница ${rub(D("164923.70").sub(sum7))} ₽ приходится на ТЗ 78, причина документально не названа). Состав: 15 400,00 + 174 563,70 + 2,52 (округление: платёж 1 117 466,22 против расчёта 1 117 463,70) = 189 966,22. Закупки, лота и списания на эту сумму не нужно: шкур нет, стоимость уже учтена в ТЗ.`;
      await addNote("payment", p1[0].id, "п/п 22618 (счёт №1, партия 7)", t1, "A1", "примечание: разбор остатка 189 966,22 ₽ — не шкуры (суммы не меняются)", "расчет доплаты по Партии 7.xlsx, J3:J17; журнал tz-doc-match/tz-tier2");
    }
    if (p2.length === 1) {
      const t2 = `${TAG} Разбор остатка 32 918,56 ₽ (в реестре «шкуры подрядчика партии 8, ТЗ 84»). Это НЕ шкуры: сумма равна разнице между итогом Приложения №84 (2 253 842,70 ₽, НДС 22 %) и сырьём по ценам лотов (НДС 20 %) с 4 % плюс работа ТЗ 84 — 32 918,39 ₽ (+0,17 округление работы); в системе эта разница уже в стоимости ТЗ 84 расходом «Корректировка по документу ТЗ» ${rub(tz84)} ₽ (НДС +32 918,38 ₽, округление документа 1,48 ₽). Настоящие шкуры подрядчика партии 9 (ТЗ 90: 32 шт. × 13 470 = 431 040,00 ₽) вынесены в закупку З-2026-0013. Закупки/лота на 32 918,56 не нужно.`;
      await addNote("payment", p2[0].id, "п/п 82173 (аванс №209, остаток 32 918,56)", t2, "A1", "примечание: разбор остатка 32 918,56 ₽ — не шкуры (суммы не меняются)", "ТЗ 84 (Приложение №84), журнал tz-doc-match; Приложение ТЗ 90 (431 040,00)");
    }
  }

  // A2 — образцы, счёт №177
  if (want("sample63")) {
    const p = await prisma.purchase.findFirst({ where: { organizationId: org, number: "З-2026-0063" }, select: { id: true, notes: true } });
    if (!p) problems.push("sample63: нет закупки З-2026-0063");
    else {
      const t = `${TAG} Статус по письмам (архив почты): 08.06.2026 Василий (Веллмех) прислал УПД и счёт №177 «на те образцы, которые не вернулись», «просьба завести в оплату»; 19.06.2026 Коношенко → Желнина: образцы брал Решетняк для коллекций, часть в Милане, часть в Стамбуле, «шкуры никогда не пойдут в готовые изделия на продажу», вопрос «спишете?»; Желнина: «этот вопрос также обсудим на встрече»; Коношенко: «То есть пока не оплачиваем и ждём решения по результатам встречи?». Решения об оплате или зачёте в документах нет; по акту сверки (договор №2502) на 30.06.2026 счёт не оплачен (265 167,00 ₽). Акта списания образцов нет. Статус: выставлен, не оплачен, оплата ждёт решения; в производство эти шкуры не идут.`;
      await addNote("purchase", p.id, "З-2026-0063 (образцы, счёт №177)", t, "A2", "примечание: статус счёта №177 по письмам (оплата не проводится)", "письма от 08.06 и 19.06.2026 («образцы»), акт сверки №2502 на 30.06.2026");
    }
  }

  // B3 — ТЗ 116 без партии
  if (want("tz116")) {
    const os = await prisma.productionOrder.findMany({ where: { organizationId: org, workOrderNumber: "116", status: { not: "CANCELLED" } }, select: { id: true, number: true, batchId: true, batchNotRequired: true, notes: true } });
    if (os.length !== 1) problems.push(`tz116: ТЗ 116 — найдено ${os.length}, нужно одно`);
    else if (os[0].batchId) problems.push("tz116: у ТЗ 116 уже есть партия — не трогаю");
    else {
      const o = os[0];
      if (o.batchNotRequired !== true) {
        flagAdds.push({ id: o.id, tz: "116", batchNotRequiredBefore: o.batchNotRequired });
        table.push({ item: "B3", obj: `ТЗ 116 (${o.number})`, what: "«без партии»: нет → да (как у ТЗ 117)", basis: "письмо Коношенко → Федин 10.07.2026 (№135): «ТЗ 116 – только переделка без партии»" });
      }
      const tot = await prisma.productionMaterialUsage.findMany({ where: { productionOrderId: o.id }, select: { totalCost: true, commission4: true } });
      const mat = tot.reduce((s, u) => s.add(u.commission4 ? D(u.totalCost).mul("1.04") : u.totalCost), D(0));
      const ex = (await prisma.productionExpense.aggregate({ where: { productionOrderId: o.id }, _sum: { amount: true } }))._sum.amount ?? D(0);
      const work = D("218859.97");
      const sys = mat.add(ex).add(work);
      const t = `${TAG} Без партии: письмо Коношенко → Федин 10.07.2026 (№135): «ТЗ 116 – только переделка без партии». Сверка итога: Приложение №116 от 07.05.2026 — 383 330,44 ₽ (16 шкур лота 10026 + работа 218 860); в системе ${rub(sys)} ₽ = документ 383 330,44 + 9 шкур лота 10026 (9 × 9 722 × 1,04 = 90 997,92 ₽: письмо Василия 03.06.2026, УПД МФВМ/000030 от 05.06.2026) — разница с документом объяснена, правок суммы нет.`;
      await addNote("order", o.id, `ТЗ 116 (${o.number})`, t, "B3", "примечание: основание «без партии» и сверка итога с Приложением", "письмо №135 (10.07.2026); Приложение 116; УПД МФВМ/000030");
      info.push(`B3 контроль: итог ТЗ 116 в системе ${rub(sys)} ₽ (ожидается 474 328,36 = 383 330,44 + 90 997,92)`);
    }
  }

  // B7 — закрытие ТЗ
  const planCompletion = async (tzNumber: string | null, orderId: string | null, qty: Decimal, endDate: Date | null, basis: string, note: string, item: string) => {
    const o = await prisma.productionOrder.findFirst({ where: orderId ? { id: orderId } : { organizationId: org, workOrderNumber: tzNumber ?? "" , status: { in: ["PLANNED", "IN_PROGRESS"] } }, select: { id: true, number: true, workOrderNumber: true, status: true, plannedQuantity: true } });
    if (!o) { info.push(`${item}: ТЗ ${tzNumber ?? orderId} уже не в статусе PLANNED/IN_PROGRESS — пропуск`); return; }
    if (o.status === "COMPLETED") { info.push(`${item}: ${o.number} уже завершено`); return; }
    compls.push({ orderId: o.id, number: o.number, tz: o.workOrderNumber ?? "", qty, endDate, basis, note, item });
  };
  if (want("close22")) {
    const ship = await prisma.shipment.findFirst({ where: { organizationId: org, name: "Отгрузка октябрь 2026 · 1", status: "ACCEPTED" }, select: { id: true, acceptedAt: true, lines: { select: { quantity: true, acceptedQty: true, returnedQty: true, productionOrderId: true } } } });
    if (!ship) problems.push("close22: нет принятой отгрузки «Отгрузка октябрь 2026 · 1»");
    else {
      const per = new Map<string, { q: number; acc: number; ret: number }>();
      for (const l of ship.lines) {
        if (!l.productionOrderId) continue;
        const c = per.get(l.productionOrderId) ?? { q: 0, acc: 0, ret: 0 };
        c.q += l.quantity; c.acc += l.acceptedQty ?? 0; c.ret += l.returnedQty ?? 0; per.set(l.productionOrderId, c);
      }
      for (const [oid, c] of per) {
        const o = await prisma.productionOrder.findUnique({ where: { id: oid }, select: { number: true, workOrderNumber: true, status: true, plannedQuantity: true } });
        if (!o) continue;
        if (c.ret > 0 || c.acc !== c.q || !D(o.plannedQuantity).eq(c.acc)) { info.push(`B7: ${o.number} (ТЗ ${o.workOrderNumber}) НЕ закрываю: принято ${c.acc} из ${c.q} (возврат ${c.ret}), план ТЗ ${o.plannedQuantity}`); continue; }
        await planCompletion(null, oid, D(c.acc), ship.acceptedAt, "накладные ЦУМ (ЗИ) 21М/22М/23М 14.10.2026; отгрузка «Отгрузка октябрь 2026 · 1» принята 15.10.2026",
          `${TAG} Выпуск = принято по накладным ЦУМ (ЗИ) 21М/22М/23М (файлы от 14.10.2026), отгрузка «Отгрузка октябрь 2026 · 1» принята 15.10.2026: принято ${c.acc} из ${c.q} шт. (приход готовой продукции на дату приёмки).`, "B7");
      }
    }
  }
  if (want("planned4")) {
    const basis: Record<string, { endDate: string | null; src: string }> = {
      "75": { endDate: null, src: "расчёт доплаты партии 7 (14.01.2026): ТЗ 75 МН07 — 4 сданных, счёт №1 от 15.01.2026 оплачен п/п 22618; баланс 040226" },
      "97": { endDate: null, src: "расчёт доплаты партии 10 (18–19.02.2026): ТЗ 97 МН17 — 9 сданных, счёт №41; «Реестр произведённых артикулов»" },
      "104": { endDate: null, src: "расчёт доплаты партии 11 (20.02.2026): ТЗ 104 МН17 — 1 сданное, счёт №51; поставка подтверждена 27.02.2026" },
      "158": { endDate: "2026-09-25", src: "письмо «Партия 20 (68 изделий)» 25.09.2026: поставка принята; расчёт доплаты партии 20, счёт №265" },
    };
    for (const [tz, b] of Object.entries(basis)) {
      const o = await prisma.productionOrder.findFirst({ where: { organizationId: org, workOrderNumber: tz, status: "PLANNED" }, select: { id: true, plannedQuantity: true, producedQuantity: true } });
      if (!o) { info.push(`B7: ТЗ ${tz} уже не PLANNED — пропуск`); continue; }
      if (!D(o.producedQuantity).eq(o.plannedQuantity)) { info.push(`B7: ТЗ ${tz}: выпуск ${o.producedQuantity} ≠ плану ${o.plannedQuantity} — не трогаю`); continue; }
      await planCompletion(null, o.id, D(o.plannedQuantity), b.endDate ? new Date(`${b.endDate}T00:00:00.000Z`) : null, b.src,
        `${TAG} «Выпущено» по документам: ${b.src}. Раньше стояло «Запланировано» только потому, что приложение не завершает ТЗ без списаний сырья (мех подрядчика / лоскут в цене работы); выпуск ${o.plannedQuantity} шт. уже стоял.`, "B7");
    }
  }
  // расчёт снимка и вывод
  const complPrepared: (Compl & { materialCost: Decimal; expenseCost: Decimal; totalCost: Decimal; unitCost: Decimal; fw: string; pm: string; org: string })[] = [];
  for (const c of compls) {
    const o = await prisma.productionOrder.findUniqueOrThrow({ where: { id: c.orderId }, select: { organizationId: true, finishedWarehouseId: true, productModelId: true, status: true, producedQuantity: true, materialCost: true, expenseCost: true, totalCost: true, unitCost: true, endDate: true, materialUsages: { select: { totalCost: true } }, expenses: { select: { amount: true } } } });
    const materialCost = o.materialUsages.reduce((s, u) => s.add(u.totalCost), D(0));
    const expenseCost = o.expenses.reduce((s, e) => s.add(e.amount), D(0));
    const totalCost = materialCost.add(expenseCost);
    const unitCost = totalCost.div(c.qty);
    complPrepared.push({ ...c, materialCost, expenseCost, totalCost, unitCost, fw: o.finishedWarehouseId, pm: o.productModelId, org: o.organizationId });
    const curN = await getNote(prisma, "order", c.orderId);
    noteAdds.push({ kind: "order", id: c.orderId, label: `ТЗ ${c.tz} (${c.number})`, before: curN, add: c.note, after: `${curN ? curN + "\n" : ""}${c.note}` });
    table.push({ item: c.item, obj: `ТЗ ${c.tz} (${c.number})`, what: `${o.status} → COMPLETED; выпуск ${o.producedQuantity} → ${c.qty}; снимок: материалы ${rub(materialCost)} + расходы ${rub(expenseCost)} = ${rub(totalCost)} (за ед. ${rub(unitCost)}); приход ГП ${c.qty} шт.${c.endDate ? `; дата ${c.endDate.toISOString().slice(0, 10)}` : ""}`, basis: c.basis });
  }

  // B9 — партии 15 и 16
  if (want("batches")) {
    for (const n of [15, 16]) {
      const b = await prisma.productionBatch.findFirst({ where: { organizationId: org, number: n }, select: { id: true, name: true, notes: true } });
      if (!b) { info.push(`B9: партии ${n} нет`); continue; }
      // единственные внешние ключи на ProductionBatch: ProductionOrder.batchId, DriveDocument.productionBatchId, Shipment.batchId (prisma/schema.prisma)
      const [orders, docs, ships] = await Promise.all([
        prisma.productionOrder.count({ where: { batchId: b.id } }), prisma.driveDocument.count({ where: { productionBatchId: b.id } }),
        prisma.shipment.count({ where: { batchId: b.id } }),
      ]);
      if (orders || docs || ships) { problems.push(`batches: у партии ${n} есть связи (ТЗ ${orders}, документов ${docs}, отгрузок ${ships}) — не трогаю`); continue; }
      const after = `Поставка ${n} — резерв, номер не использован`;
      if (b.name === after) { info.push(`B9: партия ${n} уже подписана`); continue; }
      batchAdds.push({ id: b.id, number: n, nameBefore: b.name, nameAfter: after });
      table.push({ item: "B9", obj: `Партия ${n}`, what: `подпись «${b.name}» → «${after}» (ТЗ 0, документов 0, отгрузок 0; НЕ удаляется)`, basis: "письмо №135 (10.07.2026): ТЗ 117 — отдельная поставка, ТЗ 118 — поставка 17; в архиве почты партий 15 и 16 нет" });
      const t = `${TAG} Номер не использован: в письмах нет «Партии ${n}» (письмо Коношенко → Федин 10.07.2026: ТЗ 117 — отдельная поставка, ТЗ 118 — поставка 17); ТЗ, документов и отгрузок нет. Оставлена в списке для сохранения нумерации, не удалена.`;
      await addNote("batch", b.id, `Партия ${n}`, t, "B9", "примечание: резерв, номер не использован", "письмо №135 (10.07.2026)");
    }
  }

  // B10 — Word-приложения
  if (want("appx")) {
    for (const m of APPX) {
      const path = join(ATT_ROOT, m.path);
      if (!existsSync(path)) { problems.push(`appx: ТЗ ${m.tz}: файл ${m.path} не найден в ${ATT_ROOT}`); continue; }
      const buf = readFileSync(path);
      if (sha256(buf) !== m.sha256) { problems.push(`appx: ТЗ ${m.tz}: контрольная сумма файла ${m.path} не совпала`); continue; }
      const orders = await prisma.productionOrder.findMany({ where: { organizationId: org, workOrderNumber: m.tz }, select: { id: true, number: true } });
      if (!orders.length) { problems.push(`appx: ТЗ ${m.tz} в базе нет`); continue; }
      for (const o of orders) {
        const docs = await prisma.driveDocument.findMany({ where: { productionOrderId: o.id, docType: "TZ_APPENDIX" }, select: { id: true, title: true, notes: true, storagePath: true }, orderBy: { createdAt: "asc" } });
        if (docs.some((d) => d.storagePath && /\+\s*4/.test(d.title) === (m.variant === "plus4"))) continue; // файл этого варианта уже есть
        const isPlus = (t: string) => /\+\s*4/.test(t);
        let cand = docs.filter((d) => !d.storagePath && isPlus(d.title) === (m.variant === "plus4"));
        if (cand.some((d) => !/копия/i.test(d.title))) cand = cand.filter((d) => !/копия/i.test(d.title)); // «— копия» только если другого нет
        if (cand.length > 1 && cand.some((d) => !/Черновик/i.test(d.notes ?? ""))) cand = cand.filter((d) => !/Черновик/i.test(d.notes ?? "")); // черновик без итогов — не тот файл
        const titles = new Set(cand.map((d) => d.title));
        if (!cand.length || titles.size > 1) { info.push(`B10: ТЗ ${m.tz} (${o.number}), вариант ${m.variant}: подходящих записей без файла ${cand.length}${titles.size > 1 ? " с разными названиями" : ""} — пропуск`); continue; }
        for (const c of cand) {
          docPlans.push({ m, doc: { id: c.id, title: c.title, notes: c.notes, orderId: o.id }, buf });
          table.push({ item: "B10", obj: `ТЗ ${m.tz} (${o.number})`, what: `файл → запись «${c.title}» (${buf.length} байт, вариант ${m.variant === "plus4" ? "+4 %" : "без +4 %"}${cand.length > 1 ? "; одинаковые записи-копии Drive — файл в каждую" : ""})`, basis: `письмо №${m.mail} от ${m.mailDate} «${m.mailSubject}»; номер ТЗ в содержимом совпал` });
        }
      }
    }
  }

  // ───────── справка по пунктам без записи (только чтение) ─────────
  const refLines: string[] = [];
  {
    const { purchaseTotalInclVat } = await import("../src/lib/purchase-totals");
    for (const name of ["FH 06.26", "СП 09.26"]) {
      const ps = await prisma.purchase.findMany({ where: { organizationId: org, auction: { name } }, select: { number: true, status: true, exchangeRate: true, items: { select: { subtotal: true, vatRate: true, quantity: true, costPlan: true } }, expenses: { select: { amount: true, vatRate: true } }, payments: { where: { status: "COMPLETED" }, select: { amount: true, kind: true, ppNo: true, invoiceNo: true, confirmed: true, paidAt: true } } } });
      const tot = ps.reduce((s, p) => s.add(purchaseTotalInclVat(p as never)), D(0));
      const qty = ps.reduce((s, p) => s.add(p.items.reduce((a, i) => a.add(i.quantity), D(0))), D(0));
      let paid = ps.reduce((s, p) => s.add(p.payments.reduce((a, x) => a.add(x.amount), D(0))), D(0));
      const pays = ps.flatMap((p) => p.payments);
      const aucPay = await prisma.payment.findMany({ where: { organizationId: org, auctionSession: name, purchaseId: null, status: "COMPLETED" }, select: { amount: true, kind: true, ppNo: true, invoiceNo: true, confirmed: true, paidAt: true } });
      for (const x of aucPay) { paid = paid.add(x.amount); pays.push(x as never); }
      refLines.push(`A4 ${name}: закупок ${ps.length} (${ps.map((p) => p.status).join("/")}), ${qty} шт., заказано на ${rub(tot)} ₽; предоплачено ${rub(paid)} ₽ (${pays.map((x) => `${x.kind} ${rub(x.amount)} п/п ${x.ppNo ?? "—"} сч.${x.invoiceNo ?? "—"} ${x.paidAt.toISOString().slice(0, 10)}${x.confirmed ? "" : " не подтв."}`).join("; ")}); к доплате ${rub(tot.sub(paid))} ₽`);
    }
    const o164 = await prisma.productionOrder.findMany({ where: { organizationId: org, workOrderNumber: { in: ["164", "183"] } }, select: { number: true, workOrderNumber: true, status: true, batch: { select: { number: true } }, materialUsages: { select: { quantity: true, lot: { select: { lotNumber: true, quantityRemaining: true } } } }, payShares: { select: { amount: true } } } });
    for (const o of o164) refLines.push(`B1 ТЗ ${o.workOrderNumber} (${o.number}, ${o.status}, партия ${o.batch?.number ?? "—"}): лот ${o.materialUsages.map((u) => `${u.lot?.lotNumber} × ${u.quantity} (остаток лота ${u.lot?.quantityRemaining})`).join(", ")}; разнесено оплат ${rub(o.payShares.reduce((s, a) => s.add(a.amount), D(0)))} ₽ — записей НЕ меняю (дубль или два изделия документально не доказано)`);
  }
  info.push(...refLines);

  // ───────── вывод ─────────
  console.log(`База: ${dbName}${isLive ? " (БОЕВАЯ)" : ""}${APPLY ? "" : " — пробный прогон, БД не меняется"}`);
  console.log("\n| пункт | объект | что меняется (было → стало) | основание |\n|---|---|---|---|");
  for (const r of table) console.log(`| ${r.item} | ${r.obj} | ${r.what} | ${r.basis} |`);
  if (info.length) console.log("\nСправка:\n" + info.map((s) => "  " + s).join("\n"));
  if (problems.length) console.log("\nПРОБЛЕМЫ (эти пункты пропущены):\n" + problems.map((s) => "  ! " + s).join("\n"));
  const total = noteAdds.length + flagAdds.length + complPrepared.length + batchAdds.length + docPlans.length;
  console.log(`\nИтого к записи: примечаний ${noteAdds.length}, флагов «без партии» ${flagAdds.length}, закрытий ТЗ ${complPrepared.length}, подписей партий ${batchAdds.length}, файлов ТЗ ${docPlans.length}.`);
  if (!APPLY) { await prisma.$disconnect(); console.log("Пробный прогон: БД и файлы не менялись."); return; }
  if (!total) { console.log("Записывать нечего."); await prisma.$disconnect(); return; }
  if (isLive && !NO_BACKUP) { console.log("Копия базы перед записью: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }

  // ───────── запись ─────────
  // деньги, лоты, списания и расходы скрипт не трогает: суммы до и после обязаны совпасть
  const aggregates = async () => {
    const [pay, pp, al, lots, use, exp, pur] = await Promise.all([
      prisma.payment.aggregate({ _sum: { amount: true }, _count: true }), prisma.productionPayment.aggregate({ _sum: { amount: true }, _count: true }),
      prisma.paymentAllocation.aggregate({ _sum: { amount: true }, _count: true }),
      prisma.rawMaterialLot.aggregate({ _sum: { quantityRemaining: true, totalCost: true }, _count: true }),
      prisma.productionMaterialUsage.aggregate({ _sum: { quantity: true, totalCost: true }, _count: true }),
      prisma.productionExpense.aggregate({ _sum: { amount: true }, _count: true }), prisma.purchase.count(),
    ]);
    return JSON.stringify([pay, pp, al, lots, use, exp, pur]);
  };
  const aggBefore = await aggregates();
  const journal: Journal = { script: "apply-data2-2026-10-20.ts", status: "applied", at: new Date().toISOString(), db: dbName, uploadDir: UPLOAD_ROOT, notes: [], flags: [], completions: [], batches: [], docs: [] };
  const writtenFiles: string[] = [];
  const stamp = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      for (const f of flagAdds) { await tx.productionOrder.update({ where: { id: f.id }, data: { batchNotRequired: true } }); journal.flags.push(f); }
      for (const b of batchAdds) { await tx.productionBatch.update({ where: { id: b.id }, data: { name: b.nameAfter } }); journal.batches.push(b); }
      for (const c of complPrepared) {
        const o = await tx.productionOrder.findUniqueOrThrow({ where: { id: c.orderId } });
        const moved = await tx.productionOrder.updateMany({ where: { id: c.orderId, status: { in: ["PLANNED", "IN_PROGRESS"] } }, data: { status: "COMPLETED" } });
        if (moved.count === 0) throw new Error(`${c.number}: статус изменился во время записи`);
        const endDate = c.endDate ?? o.endDate;
        await tx.productionOrder.update({ where: { id: c.orderId }, data: { producedQuantity: c.qty, materialCost: c.materialCost, expenseCost: c.expenseCost, totalCost: c.totalCost, unitCost: c.unitCost, endDate } });
        const mv = await tx.finishedGoodsMovement.create({
          data: { organizationId: c.org, warehouseId: c.fw, productModelId: c.pm, type: "PRODUCTION_IN", quantity: c.qty, unitCost: c.unitCost, totalCost: c.totalCost, productionOrderId: c.orderId, date: endDate ?? new Date(), notes: `Приход по завершению ТЗ; основание: ${c.basis.slice(0, 160)}` },
        });
        const ex = await tx.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: c.fw, productModelId: c.pm } } });
        let stockId: string;
        if (!ex) {
          const s = await tx.finishedGoodsStock.create({ data: { organizationId: c.org, warehouseId: c.fw, productModelId: c.pm, quantity: c.qty, avgUnitCost: c.qty.isZero() ? 0 : c.totalCost.div(c.qty) } });
          stockId = s.id;
        } else {
          const nq = ex.quantity.add(c.qty);
          const nv = ex.quantity.mul(ex.avgUnitCost).add(c.totalCost);
          await tx.finishedGoodsStock.update({ where: { id: ex.id }, data: { quantity: nq, avgUnitCost: nq.isZero() ? ex.avgUnitCost : nv.div(nq) } });
          stockId = ex.id;
        }
        journal.completions.push({
          orderId: c.orderId, number: c.number, tz: c.tz,
          before: { status: o.status, producedQuantity: o.producedQuantity.toString(), materialCost: o.materialCost?.toString() ?? null, expenseCost: o.expenseCost?.toString() ?? null, totalCost: o.totalCost?.toString() ?? null, unitCost: o.unitCost?.toString() ?? null, endDate: o.endDate?.toISOString() ?? null },
          movementId: mv.id, stockId, stockCreated: !ex, stockBefore: ex ? { quantity: ex.quantity.toString(), avgUnitCost: ex.avgUnitCost.toString() } : null,
        });
      }
      for (const n of noteAdds) {
        const cur = await getNote(tx, n.kind, n.id);
        const rec = { ...n, before: cur, after: `${cur ? cur + "\n" : ""}${n.add}` };
        await setNote(tx, n.kind, n.id, rec.after);
        journal.notes.push(rec);
      }
      mkdirSync(join(UPLOAD_ROOT, dirRel), { recursive: true });
      for (const p of docPlans) {
        const rel = join(dirRel, `${randomUUID()}.docx`);
        writeFileSync(join(UPLOAD_ROOT, rel), p.buf, { flag: "wx" });
        writtenFiles.push(join(UPLOAD_ROOT, rel));
        const cur = await tx.driveDocument.findUniqueOrThrow({ where: { id: p.doc.id } });
        if (cur.storagePath) continue;
        const before = { storagePath: cur.storagePath, storedAt: cur.storedAt?.toISOString() ?? null, storedMime: cur.storedMime, storedName: cur.storedName, storedSize: cur.storedSize, mimeType: cur.mimeType, sizeBytes: cur.sizeBytes, notes: cur.notes };
        const evidence = `${TAG} Файл из письма №${p.m.mail} архива почты (${p.m.mailDate}, «${clean(p.m.mailSubject)}»); номер ТЗ ${p.m.tz} в содержимом совпал; последняя из отправленных версий.`;
        await tx.driveDocument.update({ where: { id: p.doc.id }, data: { storagePath: rel, storedAt: stamp, storedMime: DOCX, storedName: p.m.name, storedSize: p.buf.length, mimeType: cur.mimeType ?? DOCX, sizeBytes: cur.sizeBytes ?? p.buf.length, notes: `${cur.notes ?? ""}\n${evidence}`.trim() } });
        journal.docs.push({ action: "updated", id: p.doc.id, file: rel, before });
      }
    }, { timeout: 300000, maxWait: 15000 });
  } catch (e) {
    for (const f of writtenFiles) { try { unlinkSync(f); } catch { /* */ } }
    throw e;
  }
  // файлы, записанные для записей, где в транзакции уже был файл (continue), — убираем
  for (const f of writtenFiles) { const rel = f.slice(UPLOAD_ROOT.length + 1); if (!journal.docs.some((d) => d.file === rel)) { try { unlinkSync(f); } catch { /* */ } } }
  writeJson(JOURNAL, journal);
  console.log(`\nПрименено на «${dbName}»: примечаний ${journal.notes.length}, флагов ${journal.flags.length}, закрытий ТЗ ${journal.completions.length}, партий ${journal.batches.length}, файлов ТЗ ${journal.docs.length}. Журнал: ${JOURNAL}`);

  // ───────── контроль после записи ─────────
  let bad = 0;
  const chk = (ok: boolean, msg: string) => { if (!ok) bad++; console.log(`  ${ok ? "✓" : "✗"} ${msg}`); };
  for (const c of journal.completions) {
    const o = await prisma.productionOrder.findUniqueOrThrow({ where: { id: c.orderId }, select: { status: true, producedQuantity: true, totalCost: true, unitCost: true } });
    chk(o.status === "COMPLETED" && D(o.unitCost ?? 0).mul(o.producedQuantity).sub(o.totalCost ?? 0).abs().lte(0.05 * Number(o.producedQuantity)), `${c.number} (ТЗ ${c.tz}): ${o.status}, выпуск ${o.producedQuantity}, итого ${rub(o.totalCost ?? 0)}`);
  }
  for (const d of journal.docs) {
    const row = await prisma.driveDocument.findUnique({ where: { id: d.id }, select: { storagePath: true, storedSize: true } });
    chk(!!row?.storagePath && existsSync(join(UPLOAD_ROOT, row.storagePath)) && row.storedSize === readFileSync(join(UPLOAD_ROOT, row.storagePath)).length, `файл ${d.file}`);
  }
  chk((await aggregates()) === aggBefore, "платежи, разнесения, лоты, списания, расходы и закупки: суммы и количества до и после записи совпали");
  console.log(bad ? `После записи расхождений: ${bad}` : "После записи: все контрольные проверки пройдены.");
  await prisma.$disconnect();
}

type NoteDb = Prisma.TransactionClient | Awaited<ReturnType<typeof import("../src/lib/prisma").createAuditedClient>>;
async function getNote(db: NoteDb, kind: NoteRec["kind"], id: string): Promise<string | null> {
  const d = db as Prisma.TransactionClient;
  if (kind === "payment") return (await d.productionPayment.findUnique({ where: { id }, select: { notes: true } }))?.notes ?? null;
  if (kind === "purchase") return (await d.purchase.findUnique({ where: { id }, select: { notes: true } }))?.notes ?? null;
  if (kind === "order") return (await d.productionOrder.findUnique({ where: { id }, select: { notes: true } }))?.notes ?? null;
  return (await d.productionBatch.findUnique({ where: { id }, select: { notes: true } }))?.notes ?? null;
}
async function setNote(db: NoteDb, kind: NoteRec["kind"], id: string, notes: string | null) {
  const d = db as Prisma.TransactionClient;
  if (kind === "payment") await d.productionPayment.update({ where: { id }, data: { notes } });
  else if (kind === "purchase") await d.purchase.update({ where: { id }, data: { notes } });
  else if (kind === "order") await d.productionOrder.update({ where: { id }, data: { notes } });
  else await d.productionBatch.update({ where: { id }, data: { notes } });
}

main().catch((e) => { console.error(e); process.exit(1); });
