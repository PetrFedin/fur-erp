/**
 * Исходные файлы накладных ЦУМ (ЗИ) для окна «Откуда цифра» у суммы накладной.
 *   • три .xls (21М, 22М, 23М) копируются в UPLOAD_DIR/drive-docs/<организация>/<uuid>.xls и прикрепляются документами
 *     к этапу «Накладные ЦУМ (ЗИ) по поставкам 21М, 22М, 23М» (DriveDocument.notes = «zi-source» — подрядчику не отдаются);
 *   • в SystemState «shipment-zi:<id>» дописывается список files (поставка, имя файла, id документа); к строкам накладных
 *     добавляются лист и номер строки в файле, а прежнее поле расхождений «заказ ЦУМ» (priceDiffs) убирается — владелец признал его неактуальным.
 * Нужно, чтобы уже был внесён scripts/apply-zi-acceptance-2026-10-19.ts (есть этап и запись ЗИ). Идемпотентно.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-zi-sources-2026-10-19.ts            # пробный прогон
 *   ... --apply --live        # записать (на боевой — сам делает bash scripts/backup.sh)
 *   ... --rollback --apply --live
 * Журнал: docs-inventory/corrections-journal-zi-sources-2026-10-19[-<база>].json
 */
import Module from "module";
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const dbName = /\/([^/?]+)(\?|$)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "?";
const INVDIR = join(__dirname, "..", "docs-inventory");
const JOURNAL = join(INVDIR, `corrections-journal-zi-sources-2026-10-19${dbName === "fur_erp" ? "" : `-${dbName}`}.json`);
const UPLOAD_ROOT = resolve(process.env.UPLOAD_DIR?.trim() || join(__dirname, "..", "uploads"));
const DOWNLOADS = "/Users/petr/Downloads";
const SHIPMENT_NAME = "Отгрузка октябрь 2026 · 1";
const EVENT_TITLE = "Накладные ЦУМ (ЗИ) по поставкам 21М, 22М, 23М";
type Journal = { at: string; shipmentId: string; docIds: string[]; files: string[]; before: unknown };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { ziKey, ZI_SOURCE_NOTE } = await import("../src/lib/shipment-zi");
  const prisma = createAuditedClient("script:apply-zi-sources");
  console.log(`База: ${dbName}${dbName === "fur_erp" ? " (БОЕВАЯ)" : ""}; каталог файлов: ${UPLOAD_ROOT}; режим: ${ROLLBACK ? "откат" : "внесение"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}`);
  if (APPLY && dbName === "fur_erp" && !LIVE) { console.log("Боевая база: нужен --live. Ничего не изменено."); process.exitCode = 1; return; }
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const sh = await prisma.shipment.findFirstOrThrow({ where: { organizationId: org.id, name: SHIPMENT_NAME }, select: { id: true } });
  const key = ziKey(sh.id);
  const state = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: org.id, key } } });

  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal;
    console.log(`Откат: документов ${j.docIds.length}, файлов ${j.files.length}, данные ЗИ вернуть как были`);
    if (!APPLY) return console.log("пробный откат — добавьте --apply");
    if (dbName === "fur_erp") execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
    await prisma.$transaction(async (tx) => {
      await tx.driveDocument.deleteMany({ where: { id: { in: j.docIds } } });
      await tx.systemState.update({ where: { organizationId_key: { organizationId: org.id, key } }, data: { value: j.before as never } });
    });
    for (const f of j.files) { const abs = resolve(UPLOAD_ROOT, f); if (abs.startsWith(UPLOAD_ROOT) && existsSync(abs)) unlinkSync(abs); }
    return console.log("откат выполнен");
  }

  if (!state) throw new Error("Нет данных ЗИ — сначала scripts/apply-zi-acceptance-2026-10-19.ts");
  const ev = await prisma.shipmentEvent.findFirst({ where: { shipmentId: sh.id, title: EVENT_TITLE }, select: { id: true } });
  if (!ev) throw new Error("Нет этапа накладных ЦУМ — сначала scripts/apply-zi-acceptance-2026-10-19.ts");
  const data = JSON.parse(JSON.stringify(state.value)) as { lines: { supply: string; boutique: string; article: string; size: string; sum: number; vat: number; sheet?: string; row?: number }[]; priceDiffs?: unknown; files?: { supply: string; fileName: string; docId: string }[] };
  if (data.files?.length) { console.log("Файлы уже прикреплены — ничего не делаю."); return; }

  const names = readdirSync(DOWNLOADS).filter((n) => /^ЗИ\d+.*_(21|22|23)М\.xls$/.test(n)).sort();
  if (names.length !== 3) throw new Error(`Ожидалось 3 файла накладных в Загрузках, найдено ${names.length}`);
  // Строки накладных: лист и номер строки из разбора файлов (тот же порядок, что при внесении приёмки).
  const raw = JSON.parse(readFileSync(join(INVDIR, "zi-2026-10-19", "zi-lines.json"), "utf8")) as Record<string, { sheet: string; b: string; art: string; size: string; sum: number; vat: number; row: number }[]>;
  const fresh = Object.entries(raw).flatMap(([supply, arr]) => arr.filter((r) => r.sheet === "MVST").map((r) => ({ supply, r })));
  if (fresh.length !== data.lines.length) throw new Error(`строк в базе ${data.lines.length}, в разборе ${fresh.length} — не сходится`);
  data.lines.forEach((l, i) => {
    const f = fresh[i];
    if (l.supply !== f.supply || l.boutique !== f.r.b || l.article !== f.r.art || l.size !== f.r.size || Math.abs(l.sum - f.r.sum) > 0.001) throw new Error(`строка ${i} не совпала с разбором`);
    l.sheet = f.r.sheet; l.row = f.r.row;
  });
  delete data.priceDiffs;
  console.log(`строк накладных с листом и номером строки: ${data.lines.length}; поле расхождений убрано`);
  for (const n of names) console.log(`файл: ${n} (${statSync(join(DOWNLOADS, n)).size} байт)`);
  if (!APPLY) return console.log("\nпробный прогон: БД и файлы не тронуты (--apply --live запишет)");

  if (dbName === "fur_erp") execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  const dirRel = join("drive-docs", org.id);
  mkdirSync(resolve(UPLOAD_ROOT, dirRel), { recursive: true });
  const journal: Journal = { at: new Date().toISOString(), shipmentId: sh.id, docIds: [], files: [], before: state.value };
  const files: { supply: string; fileName: string; docId: string }[] = [];
  const copied: { n: string; rel: string; size: number }[] = [];
  for (const n of names) {
    const rel = join(dirRel, `${randomUUID()}.xls`);
    copyFileSync(join(DOWNLOADS, n), resolve(UPLOAD_ROOT, rel));
    copied.push({ n, rel, size: statSync(join(DOWNLOADS, n)).size });
    journal.files.push(rel);
  }
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 1)); // журнал — до записи в БД
  await prisma.$transaction(async (tx) => {
    for (const c of copied) {
      const supply = /_(\d+М)\.xls$/.exec(c.n)![1];
      const d = await tx.driveDocument.create({
        data: { organizationId: org.id, driveFileId: `zi-source-${supply}`, title: c.n, docType: "OTHER", mimeType: "application/vnd.ms-excel", sizeBytes: c.size, storagePath: c.rel, storedName: c.n, storedMime: "application/vnd.ms-excel", storedSize: c.size, storedAt: new Date(), docDate: new Date("2026-10-14T00:00:00.000Z"), notes: ZI_SOURCE_NOTE, shipmentEventId: ev.id },
        select: { id: true },
      });
      journal.docIds.push(d.id);
      files.push({ supply, fileName: c.n, docId: d.id });
    }
    await tx.systemState.update({ where: { organizationId_key: { organizationId: org.id, key } }, data: { value: { ...data, files } as never } });
  });
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 1));
  console.log(`\nзаписано: документов ${files.length}. Журнал: ${JOURNAL}`);
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
