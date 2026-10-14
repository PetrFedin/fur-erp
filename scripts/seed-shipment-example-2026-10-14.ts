/**
 * Пример данных раздела «Отгрузки» — 14.10.2026, НЕ ПРИМЕНЁН. Нужны применённая миграция
 * 20261014180000_shipments_events и `prisma generate`.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/seed-shipment-example-2026-10-14.ts            # пробный прогон (БД не меняется)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/seed-shipment-example-2026-10-14.ts --apply    # записать (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/seed-shipment-example-2026-10-14.ts --rollback  # откат по журналу (пробный); с --apply — выполнить
 *
 * Создаёт отгрузку «Отгрузка октябрь 2026 · 1» (поставщик Веллмех, партия пошива 22, плановая дата 15.10.2026):
 * состав — все позиции ТЗ партии 22 (ТЗ 169–182; цвет, размер, вид меха — из ТЗ, количество — plannedQuantity позиции),
 * этапы — ровно по данным владельца (см. EVENTS ниже), ничего сверх перечисленного не добавляется.
 * Журнал: docs-inventory/corrections-journal-shipment-example-2026-10-14.json (id созданной отгрузки; строки и этапы уходят вместе с ней каскадом).
 * Правки идут через createAuditedClient("script:seed-shipment-example") — попадают в журнал изменений.
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
const PLANNED = "2026-10-15";
const BATCH_NUMBER = 22;
const ACTOR = "script:seed-shipment-example";

const VASILY = "Василий (Веллмех)";
type Ev = { title: string; date: string; time?: string; who?: "anna" | string; place?: string; details?: string; expected?: boolean };
// Только то, что написал владелец. time не указан — час неизвестен (timeKnown=false).
const EVENTS: Ev[] = [
  { title: "Примерка", date: "2026-10-05", who: VASILY, place: "Санкт-Петербург", details: "Поездка Василия в Петербург на аукцион соболя → первое ТЗ" },
  { title: "QC", date: "2026-10-05", details: "около 77 изделий; час не указан" },
  { title: "Василий прислал первое ТЗ", date: "2026-10-08", time: "19:32", who: VASILY },
  { title: "Василий прислал исправленные ТЗ № 169 и № 181", date: "2026-10-09", time: "18:24", who: VASILY },
  { title: "Подтверждение исправлений", date: "2026-10-09", time: "19:07", who: "anna" },
  { title: "Ольга начала работу с партией", date: "2026-10-12", who: "Ольга", details: "утро; час не указан" },
  { title: "Ольга отправила УПД", date: "2026-10-12", time: "13:06", who: "Ольга" },
  { title: "Василий прислал финальные ТЗ", date: "2026-10-12", time: "17:01", who: VASILY },
  { title: "Поставщик прислал документы в РПОСТ с датаматрикс", date: "2026-10-12", who: "Поставщик (Веллмех)", place: "РПОСТ" },
  { title: "Поставщик записался в Коптево на приёмку 15.10", date: "2026-10-12", place: "Коптево", details: "Приёмка товара 15.10.2026" },
  {
    title: "Принято в Коптево",
    date: "2026-10-15",
    expected: true,
    details: "отметить по строкам, сколько принято из скольки; при непринятых — причина и следующий этап (например возврат поставщику на переделку)",
  },
];

type Journal = { script: string; status: "applied" | "rolled-back"; at: string; shipmentId: string };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { loadShipmentCandidates } = await import("../src/lib/shipment-data");
  const { wallToDate, formatInterval, compareEvents, fmtWall } = await import("../src/lib/shipment-calc");
  const prisma = createAuditedClient(ACTOR);
  const JOURNAL = join(INV, "corrections-journal-shipment-example-2026-10-14.json");

  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    const cur = await prisma.shipment.findUnique({ where: { id: j.shipmentId }, select: { id: true, name: true, _count: { select: { events: true, lines: true } } } });
    console.log(cur ? `Откат: удалить отгрузку «${cur.name}» (строк ${cur._count.lines}, этапов ${cur._count.events}).` : "Отгрузки уже нет — только пометить журнал.");
    if (APPLY) {
      if (cur) await prisma.shipment.delete({ where: { id: cur.id } });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    } else console.log("Пробный прогон отката: БД не менялась. Для отката — --rollback --apply.");
    await prisma.$disconnect();
    return;
  }

  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const supplier = await prisma.supplier.findFirst({ where: { organizationId: org.id, name: { contains: "Веллмех", mode: "insensitive" } } });
  const batch = await prisma.productionBatch.findFirst({ where: { organizationId: org.id, number: BATCH_NUMBER } });
  const anna = await prisma.user.findFirst({ where: { organizationId: org.id, email: "anna@qa-test.ru" }, select: { id: true, name: true } });
  if (!supplier) throw new Error("Поставщик «Веллмех» не найден");
  if (!batch) throw new Error(`Партия пошива ${BATCH_NUMBER} не найдена`);

  const cands = await loadShipmentCandidates(org.id, null, { onlyBatchNumber: BATCH_NUMBER });
  const total = cands.reduce((s, c) => s + c.qtyTz, 0);
  const tzs = [...new Set(cands.map((c) => c.workOrder))];
  console.log(`Отгрузка «${NAME}»: поставщик ${supplier.name}, партия ${batch.number} («${batch.name ?? ""}»), плановая дата 15.10.2026.`);
  console.log(`Состав: ${cands.length} строк по ТЗ ${tzs.join(", ")}; всего ${total} шт. (в письме владельца: около 77 изделий).`);
  for (const c of cands) console.log(`  ${c.label} · ${c.article} · ${c.color ?? "без цвета"} · размер ${c.size ?? "—"} · мех ${c.furKind || "—"} · ${c.qtyTz} шт.`);
  console.log(`«Анна» — ${anna ? `пользователь приложения (${anna.name}, anna@qa-test.ru)` : "пользователя нет, будет внешним «Анна»"}.`);

  const now = Date.now();
  const rows = EVENTS.map((e, i) => ({
    ...e,
    occurredAt: wallToDate(e.date, e.time),
    timeKnown: Boolean(e.time),
    createdAt: new Date(now + i * 1000),
  }));
  console.log(`\nЭтапов: ${rows.length}`);
  const sorted = [...rows].sort(compareEvents);
  for (const e of sorted) console.log(`  ${fmtWall(e.occurredAt, e.timeKnown)}${e.timeKnown ? "" : " (время не указано)"} · ${e.title}${e.expected ? " [ожидается]" : ""}${e.who ? ` · ${e.who === "anna" ? "Анна" : e.who}` : ""}`);
  const a = rows.find((r) => r.title === "Подтверждение исправлений")!;
  const o = rows.find((r) => r.title === "Ольга отправила УПД")!;
  console.log(`Интервал Анна ${fmtWall(a.occurredAt, true)} → Ольга ${fmtWall(o.occurredAt, true)}: ${formatInterval(a, o)}`);

  const dup = await prisma.shipment.findFirst({ where: { organizationId: org.id, name: NAME }, select: { id: true } });
  if (dup) console.log(`\nОтгрузка с таким названием уже есть (${dup.id}) — при --apply повторно не создам.`);
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply."); await prisma.$disconnect(); return; }
  if (dup) { await prisma.$disconnect(); return; }
  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённый пример — сначала --rollback --apply."); await prisma.$disconnect(); return; }
  if (!NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }

  const shipmentId = await prisma.$transaction(async (tx) => {
    const sh = await tx.shipment.create({
      data: { organizationId: org.id, name: NAME, supplierId: supplier.id, batchId: batch.id, plannedDate: new Date(PLANNED), createdById: anna?.id ?? null },
    });
    for (const c of cands) {
      await tx.shipmentLine.create({
        data: { shipmentId: sh.id, productionOrderId: c.orderId, color: c.color, size: c.size, furKind: c.furKind || null, quantity: c.qtyTz },
      });
    }
    for (const e of rows) {
      const internal = e.who === "anna" && anna;
      await tx.shipmentEvent.create({
        data: {
          shipmentId: sh.id,
          title: e.title,
          occurredAt: e.occurredAt,
          timeKnown: e.timeKnown,
          responsibleUserId: internal ? anna.id : null,
          responsibleName: internal ? null : e.who === "anna" ? "Анна" : (e.who ?? null),
          place: e.place ?? null,
          details: e.details ?? null,
          expected: Boolean(e.expected),
          createdById: ACTOR,
          createdAt: e.createdAt,
        },
      });
    }
    return sh.id;
  }, { timeout: 120_000 });
  writeJson(JOURNAL, { script: "seed-shipment-example-2026-10-14", status: "applied", at: new Date().toISOString(), shipmentId } satisfies Journal);
  console.log(`\nСоздана отгрузка ${shipmentId}: строк ${cands.length}, этапов ${rows.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
