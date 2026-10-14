/**
 * Дополнение примера «Отгрузка октябрь 2026 · 1» полем «на ком» — 14.10.2026, НЕ ПРИМЕНЁН. Нужны применённая миграция
 * 20261014220000_shipments_accept и `prisma generate`.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/update-shipment-example-2026-10-14.ts            # пробный прогон (БД не меняется)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/update-shipment-example-2026-10-14.ts --apply    # записать (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/update-shipment-example-2026-10-14.ts --rollback --apply   # вернуть прежние значения по журналу
 *
 * Ставит ShipmentEvent.side ТОЛЬКО там, где это однозначно из названия / ответственного (этапы Василия, Ольги и «Поставщик …» → Веллмех;
 * «Подтверждение исправлений» (Анна) и «Принято в Коптево» → ЦУМ). «Примерка», «QC» и «Поставщик записался в Коптево …» остаются пустыми.
 * Уже заполненное «на ком» не трогается. Больше ничего не меняется. Журнал: docs-inventory/corrections-journal-shipment-example-side-2026-10-14.json.
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  if (req === "next/cache") return join(__dirname, "stubs", "next-cache.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const NAME = "Отгрузка октябрь 2026 · 1";
const ACTOR = "script:update-shipment-example";

type Side = "WELLMEKH" | "CUM";
/** Название этапа (точное, как в примере) → «на ком». Нет в списке — не трогаем. */
const SIDE_BY_TITLE: Record<string, Side> = {
  "Василий прислал первое ТЗ": "WELLMEKH",
  "Василий прислал исправленные ТЗ № 169 и № 181": "WELLMEKH",
  "Подтверждение исправлений": "CUM",
  "Ольга начала работу с партией": "WELLMEKH",
  "Ольга отправила УПД": "WELLMEKH",
  "Василий прислал финальные ТЗ": "WELLMEKH",
  "Поставщик прислал документы в РПОСТ с датаматрикс": "WELLMEKH",
  "Принято в Коптево": "CUM",
};

type Journal = { script: string; status: "applied" | "rolled-back"; at: string; shipmentId: string; changes: { eventId: string; title: string; before: string | null; after: string }[] };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const prisma = createAuditedClient(ACTOR);
  const JOURNAL = join(INV, "corrections-journal-shipment-example-side-2026-10-14.json");

  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    for (const c of j.changes) console.log(`  вернуть «${c.title}»: ${c.after} → ${c.before ?? "пусто"}`);
    if (APPLY) {
      for (const c of j.changes) await prisma.shipmentEvent.updateMany({ where: { id: c.eventId, side: c.after }, data: { side: c.before } });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    } else console.log("Пробный прогон отката: БД не менялась. Для отката — --rollback --apply.");
    await prisma.$disconnect();
    return;
  }

  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const sh = await prisma.shipment.findFirst({ where: { organizationId: org.id, name: NAME }, select: { id: true, events: { select: { id: true, title: true, side: true, responsibleName: true, occurredAt: true }, orderBy: { occurredAt: "asc" } } } });
  if (!sh) throw new Error(`Отгрузка «${NAME}» не найдена`);
  console.log(`Отгрузка «${NAME}» (${sh.id}): этапов ${sh.events.length}.`);
  const changes: Journal["changes"] = [];
  for (const e of sh.events) {
    const want = SIDE_BY_TITLE[e.title];
    if (!want) { console.log(`  оставить пустым: «${e.title}»${e.side ? ` (уже: ${e.side})` : ""}`); continue; }
    if (e.side) { console.log(`  уже заполнено: «${e.title}» — ${e.side}`); continue; }
    console.log(`  «${e.title}» → ${want === "CUM" ? "ЦУМ" : "Веллмех"}`);
    changes.push({ eventId: e.id, title: e.title, before: e.side, after: want });
  }
  console.log(`К изменению: ${changes.length} этапов.`);
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply."); await prisma.$disconnect(); return; }
  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое обновление — сначала --rollback --apply."); await prisma.$disconnect(); return; }
  if (changes.length === 0) { console.log("Менять нечего."); await prisma.$disconnect(); return; }
  if (!NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  await prisma.$transaction(async (tx) => {
    for (const c of changes) await tx.shipmentEvent.update({ where: { id: c.eventId }, data: { side: c.after } });
  });
  writeJson(JOURNAL, { script: "update-shipment-example-2026-10-14", status: "applied", at: new Date().toISOString(), shipmentId: sh.id, changes } satisfies Journal);
  console.log(`Готово. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
