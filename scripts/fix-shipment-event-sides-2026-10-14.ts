/**
 * Простановка «на ком» у этапов примера «Отгрузка октябрь 2026 · 1» — 14.10.2026, НЕ ПРИМЕНЁН. Поставщик = Веллмех.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fix-shipment-event-sides-2026-10-14.ts            # пробный прогон (БД не меняется)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fix-shipment-event-sides-2026-10-14.ts --apply    # записать (сам запускает scripts/backup.sh)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fix-shipment-event-sides-2026-10-14.ts --rollback --apply   # вернуть прежние значения по журналу
 *
 * Правила (только там, где «на ком» пусто; заполненное не трогается):
 *   «Примерка» → ЦУМ; «QC» → ЦУМ; «Поставщик записался в Коптево на приёмку 15.10» → Веллмех;
 *   автоэтапы («Принято по просмотру…», «На доработку…», «Принято после доработки…», «Согласовано к отгрузке…») → ЦУМ.
 * Остальные пустые этапы перечисляются в пробном прогоне и НЕ меняются.
 * Журнал: docs-inventory/corrections-journal-shipment-sides-2026-10-14.json.
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
const NAME = "Отгрузка октябрь 2026 · 1";
const ACTOR = "script:fix-shipment-event-sides";

type Side = "WELLMEKH" | "CUM";
/** Правило для пустого «на ком»: null — не определено (остаётся пустым и попадает в список). */
export function sideFor(title: string): Side | null {
  const t = title.trim();
  if (/^примерка$/i.test(t) || /^qc$/i.test(t)) return "CUM";
  if (/^Поставщик записался в Коптево на приёмку 15\.10$/i.test(t)) return "WELLMEKH";
  if (/Принято по просмотру|На доработку|Принято после доработки|Согласовано к отгрузке/i.test(t)) return "CUM";
  return null;
}

type Journal = { script: string; status: "applied" | "rolled-back"; at: string; shipmentId: string; changes: { eventId: string; title: string; before: string | null; after: string }[] };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const prisma = createAuditedClient(ACTOR);
  const JOURNAL = join(INV, "corrections-journal-shipment-sides-2026-10-14.json");

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
  const skipped: string[] = [];
  for (const e of sh.events) {
    if (e.side) { console.log(`  уже заполнено: «${e.title}» — ${e.side}`); continue; }
    const want = sideFor(e.title);
    if (!want) { console.log(`  НЕ ставлю (правила нет): «${e.title}»`); skipped.push(e.title); continue; }
    console.log(`  «${e.title}» → ${want === "CUM" ? "ЦУМ" : "Веллмех"}`);
    changes.push({ eventId: e.id, title: e.title, before: e.side, after: want });
  }
  console.log(`К изменению: ${changes.length} этапов. Пустые без правила (не меняю): ${skipped.length}${skipped.length ? " — " + skipped.map((t) => `«${t}»`).join(", ") : ""}.`);
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply."); await prisma.$disconnect(); return; }
  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое обновление — сначала --rollback --apply."); await prisma.$disconnect(); return; }
  if (changes.length === 0) { console.log("Менять нечего."); await prisma.$disconnect(); return; }
  console.log("Копия базы перед применением: scripts/backup.sh …");
  execSync("sh scripts/backup.sh", { stdio: "inherit" });
  await prisma.$transaction(async (tx) => {
    for (const c of changes) await tx.shipmentEvent.update({ where: { id: c.eventId }, data: { side: c.after } });
  });
  writeJson(JOURNAL, { script: "fix-shipment-event-sides-2026-10-14", status: "applied", at: new Date().toISOString(), shipmentId: sh.id, changes } satisfies Journal);
  console.log(`Готово. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
