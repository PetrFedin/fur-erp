/**
 * Отгрузка «Отгрузка октябрь 2026 · 1» = список с примерки 05.10 (все 77 шт., строки остаются). Список со скана «Количество изделий
 * с подкладом на 06.10.2026» (26 строк, 30 изделий; верхняя одежда 24 + аксессуары MCF01×5, MMF01×1) — то, что согласовано к отгрузке:
 *   • сопоставленные строки (модель + размер + цвет): № изделия из скана, стадия «Готов к отгрузке» (stageChangedAt = 05.10.2026,
 *     stageChangedBy = «примерка 05.10 (по списку)»); строка ТЗ делится так, чтобы на каждую строку скана была своя строка отгрузки
 *     (количество 1; у MCF01 — 5), сумма количеств сохраняется;
 *   • остальные строки, не попавшие в скан: стадия «Отправлен на доработку» с одним пунктом доработки (OPEN)
 *     «Не вошло в список согласованного к отгрузке на примерке 05.10 (список с подкладом на 06.10.2026) — доработать/согласовать»;
 *   • непарные строки скана НЕ создаются «по догадке» — печатаются в «не сопоставлено»; ничего не удаляется.
 * Добавляется этап хронологии «Согласовано к отгрузке по списку с примерки 05.10» (если его нет).
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-shipment-scan-list-2026-10-14.ts                    # пробный прогон
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-shipment-scan-list-2026-10-14.ts --apply            # применить (сначала scripts/backup.sh; --no-backup — только для тестовой БД)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-shipment-scan-list-2026-10-14.ts --rollback --apply  # откат по журналу
 *
 * Нужна применённая миграция 20261015090000_shipment_line_status и `prisma generate`.
 * Журнал: docs-inventory/corrections-journal-shipment-scan-2026-10-14.json (прежние стадии/значения строк, созданные строки, созданные пункты доработки, этап).
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const SHIPMENT_NAME = "Отгрузка октябрь 2026 · 1";
const EVENT_TITLE = "Согласовано к отгрузке по списку с примерки 05.10";
const EVENT_DETAILS = "26 строк, 30 изделий, список с подкладом на 06.10.2026";
const STAGE_BY = "примерка 05.10 (по списку)";
const REWORK_TEXT = "Не вошло в список согласованного к отгрузке на примерке 05.10 (список с подкладом на 06.10.2026) — доработать/согласовать";
const STAGE_AT = new Date("2026-10-05T00:00:00.000Z");

type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string; shipmentId: string;
  /** Строки отгрузки, существовавшие до: прежние значения изменённых полей. */
  updated: { id: string; before: { quantity: number; itemNo: string | null; stage: string; stageChangedAt: string | null; stageChangedBy: string | null } }[];
  created: string[];
  /** Автоматически созданные пункты доработки. */
  reworkIds: string[];
  eventId: string | null;
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { SCAN, matchScan } = await import("./shipment-scan-match");
  const { orderLabel } = await import("../src/lib/order-label");
  const { loadTzPositions } = await import("../src/lib/order-label-db");
  const prisma = createAuditedClient("script:apply-shipment-scan-list");
  const JOURNAL = join(INV, "corrections-journal-shipment-scan-2026-10-14.json");

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("нет организации");
  const sh = await prisma.shipment.findFirst({ where: { organizationId: org.id, name: SHIPMENT_NAME }, select: { id: true } });
  if (!sh) throw new Error(`Отгрузка «${SHIPMENT_NAME}» не найдена`);

  // ----- Откат -----
  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    const blockers: string[] = [];
    const created = await prisma.shipmentLine.findMany({ where: { id: { in: j.created } }, include: { reworks: { select: { id: true } } } });
    for (const l of created) if (l.acceptedQty != null || l.returnedQty != null || l.reworks.length) blockers.push(`созданная строка ${l.id}: по ней уже есть приёмка / доработка`);
    console.log(`Откат: убрать созданных строк ${j.created.length}, вернуть прежние стадии/значения ${j.updated.length}, убрать авто-пунктов доработки ${j.reworkIds.length}${j.eventId ? ", убрать этап хронологии" : ""}.`);
    if (blockers.length) { console.log("Блокировки:\n  " + blockers.join("\n  ")); await prisma.$disconnect(); process.exitCode = 1; return; }
    if (!APPLY) { console.log("(пробный прогон; для отката добавьте --apply)"); await prisma.$disconnect(); return; }
    await prisma.$transaction(async (tx) => {
      await tx.shipmentLineRework.deleteMany({ where: { id: { in: j.reworkIds } } });
      await tx.shipmentLine.deleteMany({ where: { id: { in: j.created } } });
      for (const u of j.updated) {
        await tx.shipmentLine.update({ where: { id: u.id }, data: { quantity: u.before.quantity, itemNo: u.before.itemNo, stage: u.before.stage as "REVIEW" | "REWORK" | "READY", stageChangedAt: u.before.stageChangedAt ? new Date(u.before.stageChangedAt) : null, stageChangedBy: u.before.stageChangedBy } });
      }
      if (j.eventId) await tx.shipmentEvent.deleteMany({ where: { id: j.eventId } });
    });
    writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
    console.log("Откат выполнен.");
    await prisma.$disconnect();
    return;
  }

  // ----- Пробный прогон / применение -----
  const lines = await prisma.shipmentLine.findMany({
    where: { shipmentId: sh.id },
    include: { reworks: { select: { id: true } }, productionOrder: { select: { id: true, number: true, workOrderNumber: true, productModel: { select: { name: true, salesCode: true } } } } },
  });
  const pos = await loadTzPositions(org.id, lines.map((l) => l.productionOrder));
  const tz = (l: (typeof lines)[number]) => orderLabel({ workOrderNumber: l.productionOrder.workOrderNumber, number: l.productionOrder.number, ...pos.get(l.productionOrder.id) });
  const byId = new Map(lines.map((l) => [l.id, l]));
  const m = matchScan(SCAN, lines.map((l) => ({ id: l.id, model: [l.productionOrder.productModel.name, l.productionOrder.productModel.salesCode ?? ""], size: l.size, color: l.color, quantity: l.quantity })));

  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое внесение — сначала --rollback --apply."); await prisma.$disconnect(); process.exitCode = 1; return; }

  console.log(`Отгрузка «${SHIPMENT_NAME}»: строк сейчас ${lines.length}, ${lines.reduce((t, l) => t + l.quantity, 0)} шт.\n`);
  console.log("№ · модель · размер → ТЗ · поз. → найдено/нет");
  for (const p of m.pairs) {
    const l = p.lineId ? byId.get(p.lineId)! : null;
    console.log(`${p.scan.no.padStart(4)} · ${p.scan.model.padEnd(6)} · ${(p.scan.size ?? "—").padEnd(3)} ×${p.scan.qty} → ${l ? `${tz(l)} (${l.color ?? "—"})` : "—"} → ${l ? "найдено" : "нет"}${p.reason ? ` [${p.reason}]` : ""}${p.colorNote ? ` (${p.colorNote})` : ""}`);
  }
  const okItems = m.pairs.filter((p) => p.lineId).reduce((t, p) => t + p.scan.qty, 0);
  const okRows = m.pairs.filter((p) => p.lineId).length;
  console.log(`\nСопоставлено ${okItems} из ${SCAN.reduce((t, s) => t + s.qty, 0)} изделий (строк списка ${okRows} из ${SCAN.length}).`);
  const unmatched = m.pairs.filter((p) => !p.lineId);
  if (unmatched.length) {
    console.log("\nНе сопоставлено (строка списка → причина):");
    for (const p of unmatched) console.log(`  №${p.scan.no} ${p.scan.model} р.${p.scan.size ?? "—"} → ${p.reason}`);
  }

  // стадии: сопоставленные — READY, остальные — REWORK
  const readyIds = new Set(m.groups.map((g) => g.lineId));
  const toRework = lines.filter((l) => !readyIds.has(l.id));
  const withWork = toRework.filter((l) => l.reworks.length > 0 || l.acceptedQty != null || l.returnedQty != null);
  const readyQty = okItems;
  const reworkQty = toRework.reduce((t, l) => t + l.quantity, 0);
  const afterRows = lines.length + m.groups.reduce((t, g) => t + g.scans.length - 1, 0);
  console.log(`\nГотов к отгрузке (READY): ${afterRows - toRework.length} строк, ${readyQty} шт.`);
  console.log(`На доработку (REWORK, один автопункт): ${toRework.length} строк, ${reworkQty} шт.`);
  for (const l of toRework) console.log(`  - ${tz(l)} · ${l.productionOrder.productModel.name} · ${l.color ?? "—"} · р.${l.size ?? "—"} × ${l.quantity}${l.stage !== "REVIEW" ? ` (сейчас ${l.stage})` : ""}`);
  if (withWork.length) { console.log("Внимание: у этих строк уже есть пункты доработки / приёмка (стадия меняется, значения не трогаются):"); for (const l of withWork) console.log(`  - ${tz(l)} · р.${l.size ?? "—"}`); }
  console.log(`Ничего не удаляется. Итог: строк ${afterRows}, шт. ${lines.reduce((t, l) => t + l.quantity, 0)} (было ${lines.length} строк, ${lines.reduce((t, l) => t + l.quantity, 0)} шт.).`);
  const hasEvent = !!(await prisma.shipmentEvent.findFirst({ where: { shipmentId: sh.id, title: EVENT_TITLE }, select: { id: true } }));
  console.log(hasEvent ? `Этап «${EVENT_TITLE}» уже есть — не добавляется.` : `Добавится этап «${EVENT_TITLE}» (05.10.2026, время не указано): ${EVENT_DETAILS}.`);

  if (!APPLY) { console.log("\n(пробный прогон: БД не менялась; для применения добавьте --apply)"); await prisma.$disconnect(); return; }

  if (!NO_BACKUP) { console.log("\nКопия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  const owner = await prisma.user.findFirst({ where: { organizationId: org.id, role: "OWNER", isActive: true }, select: { id: true } });
  if (!owner) throw new Error("нет активного владельца для автора этапа");
  const journal: Journal = { script: "apply-shipment-scan-list-2026-10-14.ts", status: "applied", at: new Date().toISOString(), shipmentId: sh.id, updated: [], created: [], reworkIds: [], eventId: null };
  await prisma.$transaction(async (tx) => {
    const stageAt = { stageChangedAt: STAGE_AT, stageChangedBy: STAGE_BY };
    for (const g of m.groups) {
      const l = byId.get(g.lineId)!;
      journal.updated.push({ id: l.id, before: { quantity: l.quantity, itemNo: l.itemNo, stage: l.stage, stageChangedAt: l.stageChangedAt ? l.stageChangedAt.toISOString() : null, stageChangedBy: l.stageChangedBy } });
      const [first, ...rest] = g.scans;
      await tx.shipmentLine.update({ where: { id: l.id }, data: { quantity: first.qty, itemNo: first.no, stage: "READY", ...stageAt } });
      for (const s2 of rest) {
        const c = await tx.shipmentLine.create({
          data: { shipmentId: l.shipmentId, productionOrderId: l.productionOrderId, size: l.size, color: l.color, furKind: l.furKind, comment: l.comment, quantity: s2.qty, itemNo: s2.no, stage: "READY", ...stageAt },
          select: { id: true },
        });
        journal.created.push(c.id);
      }
    }
    for (const l of toRework) {
      journal.updated.push({ id: l.id, before: { quantity: l.quantity, itemNo: l.itemNo, stage: l.stage, stageChangedAt: l.stageChangedAt ? l.stageChangedAt.toISOString() : null, stageChangedBy: l.stageChangedBy } });
      await tx.shipmentLine.update({ where: { id: l.id }, data: { stage: "REWORK", ...stageAt } });
      const rw = await tx.shipmentLineRework.create({ data: { lineId: l.id, text: REWORK_TEXT, state: "OPEN", createdById: owner.id }, select: { id: true } });
      journal.reworkIds.push(rw.id);
    }
    if (!hasEvent) {
      const ev = await tx.shipmentEvent.create({
        data: { shipmentId: sh.id, title: EVENT_TITLE, occurredAt: new Date("2026-10-05T00:00:00.000Z"), timeKnown: false, details: EVENT_DETAILS, createdById: owner.id },
        select: { id: true },
      });
      journal.eventId = ev.id;
    }
  }, { timeout: 60000 });
  writeJson(JOURNAL, journal);
  console.log(`\nПрименено: обновлено строк ${journal.updated.length}, создано ${journal.created.length}, пунктов доработки ${journal.reworkIds.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
