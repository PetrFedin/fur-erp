/**
 * Правка действующих лиц и сторон у этапов примера «Отгрузка октябрь 2026 · 1» — 14.10.2026, НЕ ПРИМЕНЁН.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fix-shipment-example-people-2026-10-14.ts            # пробный прогон (БД не меняется)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fix-shipment-example-people-2026-10-14.ts --apply    # записать (сам запускает scripts/backup.sh)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fix-shipment-example-people-2026-10-14.ts --rollback --apply   # вернуть прежние значения и удалённый этап
 *
 * Правки (по названию этапа):
 *   «Примерка»: сторона → Веллмех; место → пусто; в детализацию добавляется строка «Около 77 изделий; час не указан» (если её ещё нет);
 *   «QC»: удаляется (если нет документов, связанных строк и приёмки), в журнале сохраняется целиком;
 *   «Согласовано к отгрузке по списку с примерки 05.10»: ЦУМ, ответственный «Анна» = пользователь anna@qa-test.ru;
 *   «Ольга начала работу с партией», «Ольга отправила УПД»: ЦУМ;
 *   «Поставщик прислал документы в РПОСТ с датаматрикс»: Веллмех, ответственный «Геннадий (Веллмех)»;
 *   «Поставщик записался в Коптево на приёмку 15.10»: ЦУМ (название не меняется).
 * Журнал: docs-inventory/corrections-journal-shipment-people-2026-10-14.json.
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
const ACTOR = "script:fix-shipment-example-people";
const ANNA_EMAIL = "anna@qa-test.ru";
const SIDE_RU: Record<string, string> = { WELLMEKH: "Веллмех", CUM: "ЦУМ" };
const NOTE = "Около 77 изделий; час не указан";

type Fields = { side: string | null; responsibleName: string | null; responsibleUserId: string | null; place: string | null; details: string | null };
type Edit = { eventId: string; title: string; before: Fields; after: Fields };
/** Удалённый этап целиком (даты строкой ISO). */
type Removed = {
  id: string; shipmentId: string; title: string; occurredAt: string; timeKnown: boolean; responsibleUserId: string | null; responsibleName: string | null;
  side: string | null; place: string | null; details: string | null; docLinks: string | null; expected: boolean;
  createdById: string; createdAt: string; updatedAt: string; updatedById: string | null;
};
type Journal = { script: string; status: "applied" | "rolled-back"; at: string; shipmentId: string; edits: Edit[]; removed: Removed[] };

const FIELDS = ["side", "responsibleName", "responsibleUserId", "place", "details"] as const;
const show = (f: Fields) => `сторона=${f.side ? SIDE_RU[f.side] ?? f.side : "—"}, кто=${f.responsibleName ?? "—"}${f.responsibleUserId ? " (польз.)" : ""}, место=${f.place ?? "—"}, детализация=${JSON.stringify(f.details ?? "")}`;

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const prisma = createAuditedClient(ACTOR);
  const JOURNAL = join(INV, "corrections-journal-shipment-people-2026-10-14.json");

  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    for (const c of j.edits) console.log(`  вернуть «${c.title}»:\n     было: ${show(c.after)}\n     станет: ${show(c.before)}`);
    for (const r of j.removed) console.log(`  восстановить удалённый этап «${r.title}» (${r.id})`);
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        for (const c of j.edits) await tx.shipmentEvent.update({ where: { id: c.eventId }, data: { ...c.before } });
        for (const r of j.removed) {
          if (await tx.shipmentEvent.findUnique({ where: { id: r.id }, select: { id: true } })) continue;
          await tx.shipmentEvent.create({ data: { ...r, occurredAt: new Date(r.occurredAt), createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt) } });
        }
      });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    } else console.log("Пробный прогон отката: БД не менялась. Для отката — --rollback --apply.");
    await prisma.$disconnect();
    return;
  }

  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const sh = await prisma.shipment.findFirst({ where: { organizationId: org.id, name: NAME }, select: { id: true, acceptEventId: true, events: { orderBy: { occurredAt: "asc" }, include: { documents: { select: { id: true } }, lines: { select: { id: true } } } } } });
  if (!sh) throw new Error(`Отгрузка «${NAME}» не найдена`);
  const anna = await prisma.user.findFirst({ where: { organizationId: org.id, email: ANNA_EMAIL }, select: { id: true, name: true } });
  if (!anna) throw new Error(`Пользователь ${ANNA_EMAIL} не найден`);
  console.log(`Отгрузка «${NAME}» (${sh.id}): этапов ${sh.events.length}.\n`);

  const find = (title: string) => {
    const hit = sh.events.filter((e) => e.title === title);
    if (hit.length !== 1) { console.log(`  ПРОПУСК: этап «${title}» найден ${hit.length} раз`); return null; }
    return hit[0];
  };
  const edits: Edit[] = [];
  const plan = (title: string, patch: (e: NonNullable<ReturnType<typeof find>>) => Partial<Fields>) => {
    const e = find(title);
    if (!e) return;
    const before: Fields = { side: e.side, responsibleName: e.responsibleName, responsibleUserId: e.responsibleUserId, place: e.place, details: e.details };
    const after: Fields = { ...before, ...patch(e) };
    if (FIELDS.every((k) => before[k] === after[k])) { console.log(`«${title}»: уже как нужно, не меняю`); return; }
    console.log(`«${title}»:\n     было:   ${show(before)}\n     станет: ${show(after)}`);
    edits.push({ eventId: e.id, title, before, after });
  };

  plan("Примерка", (e) => ({
    side: "WELLMEKH",
    place: null,
    details: (e.details ?? "").includes(NOTE) ? e.details : e.details ? `${e.details}\n${NOTE}` : NOTE,
  }));
  plan("Согласовано к отгрузке по списку с примерки 05.10", () => ({ side: "CUM", responsibleName: anna.name === "Анна" ? anna.name : "Анна", responsibleUserId: anna.id }));
  plan("Ольга начала работу с партией", () => ({ side: "CUM" }));
  plan("Ольга отправила УПД", () => ({ side: "CUM" }));
  plan("Поставщик прислал документы в РПОСТ с датаматрикс", () => ({ side: "WELLMEKH", responsibleName: "Геннадий (Веллмех)" }));
  plan("Поставщик записался в Коптево на приёмку 15.10", () => ({ side: "CUM" }));

  const removed: Removed[] = [];
  const qc = find("QC");
  if (qc) {
    const why = qc.documents.length ? "есть документы" : qc.lines.length ? "есть связанные строки" : sh.acceptEventId === qc.id ? "это этап приёмки" : null;
    if (why) console.log(`«QC»: НЕ удаляю — ${why}`);
    else {
      console.log(`«QC»: УДАЛИТЬ (было: сторона=${qc.side ? SIDE_RU[qc.side] : "—"}, кто=${qc.responsibleName ?? "—"}, место=${qc.place ?? "—"}, детализация=${JSON.stringify(qc.details ?? "")}; документов 0, строк 0 → станет: нет)`);
      removed.push({
        id: qc.id, shipmentId: qc.shipmentId, title: qc.title, occurredAt: qc.occurredAt.toISOString(), timeKnown: qc.timeKnown, responsibleUserId: qc.responsibleUserId, responsibleName: qc.responsibleName,
        side: qc.side, place: qc.place, details: qc.details, docLinks: qc.docLinks, expected: qc.expected, createdById: qc.createdById, createdAt: qc.createdAt.toISOString(), updatedAt: qc.updatedAt.toISOString(), updatedById: qc.updatedById,
      });
    }
  }

  console.log(`\nК изменению: правок ${edits.length}, удалений ${removed.length}.`);
  if (!APPLY) { console.log("Пробный прогон: БД не менялась. Для записи — --apply."); await prisma.$disconnect(); return; }
  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое обновление — сначала --rollback --apply."); await prisma.$disconnect(); return; }
  if (edits.length === 0 && removed.length === 0) { console.log("Менять нечего."); await prisma.$disconnect(); return; }
  console.log("Копия базы перед применением: scripts/backup.sh …");
  execSync("sh scripts/backup.sh", { stdio: "inherit" });
  await prisma.$transaction(async (tx) => {
    for (const c of edits) await tx.shipmentEvent.update({ where: { id: c.eventId }, data: { ...c.after } });
    for (const r of removed) await tx.shipmentEvent.delete({ where: { id: r.id } });
  });
  writeJson(JOURNAL, { script: "fix-shipment-example-people-2026-10-14", status: "applied", at: new Date().toISOString(), shipmentId: sh.id, edits, removed } satisfies Journal);
  console.log(`Готово. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
