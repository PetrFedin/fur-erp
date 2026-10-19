/**
 * Причина «не принято» по строкам приёмки (M018): вместо «Нет в накладных ЗИ …; причина по документам не названа»
 * в примечании строк и в итоге приёмки пишем коротко «Причина не указана» (потом её можно отредактировать).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-m018-reason-2026-10-19.ts            # пробный прогон
 *   ... --apply --live        # записать (на боевой — сам делает bash scripts/backup.sh)
 *   ... --rollback --apply --live
 * Журнал: docs-inventory/corrections-journal-m018-reason-2026-10-19[-<база>].json
 */
import Module from "module";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
const JOURNAL = join(__dirname, "..", "docs-inventory", `corrections-journal-m018-reason-2026-10-19${dbName === "fur_erp" ? "" : `-${dbName}`}.json`);
const SHIPMENT_NAME = "Отгрузка октябрь 2026 · 1";
const OLD_LINE = "Нет в накладных ЗИ 21М/22М/23М (файлы от 14.10.2026); причина по документам не названа";
const NEW_LINE = "Причина не указана";
const OLD_EVENT = "причина по документам не названа";
const NEW_EVENT = "причина не указана";
type Journal = { at: string; lines: { id: string; comment: string | null }[]; event: { id: string; details: string | null } | null };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:apply-m018-reason");
  console.log(`База: ${dbName}${dbName === "fur_erp" ? " (БОЕВАЯ)" : ""}; режим: ${ROLLBACK ? "откат" : "внесение"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}`);
  if (APPLY && dbName === "fur_erp" && !LIVE) { console.log("Боевая база: нужен --live. Ничего не изменено."); process.exitCode = 1; return; }
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const sh = await prisma.shipment.findFirstOrThrow({ where: { organizationId: org.id, name: SHIPMENT_NAME }, select: { id: true } });

  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal;
    console.log(`Откат: строк ${j.lines.length}, итог приёмки ${j.event ? "да" : "нет"}`);
    if (!APPLY) return console.log("пробный откат — добавьте --apply");
    if (dbName === "fur_erp") execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
    await prisma.$transaction(async (tx) => {
      for (const l of j.lines) await tx.shipmentLine.update({ where: { id: l.id }, data: { comment: l.comment } });
      if (j.event) await tx.shipmentEvent.update({ where: { id: j.event.id }, data: { details: j.event.details } });
    });
    return console.log("откат выполнен");
  }

  const lines = await prisma.shipmentLine.findMany({ where: { shipmentId: sh.id, comment: { contains: OLD_LINE } }, select: { id: true, comment: true, size: true, color: true } });
  const events = await prisma.shipmentEvent.findMany({ where: { shipmentId: sh.id }, select: { id: true, details: true } });
  const ev = events.find((e) => (e.details ?? "").includes(OLD_EVENT)) ?? null;
  console.log(`Строк приёмки с прежней пометкой: ${lines.length}; итог приёмки с прежней фразой: ${ev ? "да" : "нет"}`);
  if (lines.length === 0 && !ev) return console.log("Нечего менять (уже сделано).");
  for (const l of lines) console.log(`  строка ${l.color ?? ""} ${l.size ?? ""}: «${l.comment}» → «${(l.comment ?? "").replace(OLD_LINE, NEW_LINE)}»`);
  if (ev) console.log(`  итог приёмки: «${ev.details}» → «${(ev.details ?? "").replace(OLD_EVENT, NEW_EVENT)}»`);
  if (!APPLY) return console.log("\nпробный прогон: БД не менялась. Для записи: --apply --live");

  if (dbName === "fur_erp") execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  const journal: Journal = { at: new Date().toISOString(), lines: lines.map((l) => ({ id: l.id, comment: l.comment })), event: ev ? { id: ev.id, details: ev.details } : null };
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 1));
  await prisma.$transaction(async (tx) => {
    for (const l of lines) await tx.shipmentLine.update({ where: { id: l.id }, data: { comment: (l.comment ?? "").replace(OLD_LINE, NEW_LINE) } });
    if (ev) await tx.shipmentEvent.update({ where: { id: ev.id }, data: { details: (ev.details ?? "").replace(OLD_EVENT, NEW_EVENT) } });
  });
  console.log(`\nзаписано. Журнал: ${JOURNAL}`);
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
