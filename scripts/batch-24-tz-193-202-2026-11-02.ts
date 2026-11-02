/**
 * Партия (поставка) 24 = ТЗ 193–202 (владелец, 02.11.2026; ТЗ 197 в системе нет — документа не было). Создаёт ProductionBatch №24 и привязывает к ней ТЗ.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/batch-24-tz-193-202-2026-11-02.ts [--apply | --rollback]
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const APPLY = process.argv.includes("--apply"), ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(resolve(__dirname, ".."), "docs-inventory", "corrections-journal-batch-24-2026-11-02.json");
const TZ = ["193", "194", "195", "196", "198", "199", "200", "201", "202"];
const NOTES = [
  "ТЗ 193–202 (владелец, 02.11.2026: «тз 193-202 партия 24»). ТЗ 197 в системе нет — документа не было.",
  "Сырьё передано по УПД МФВМ/109–117 от 01.10.2026 (кроме ТЗ 196 — УПД нет). Срок работ до 15.11.2026 (ТЗ 194 — до 30.11.2026); изделия у подрядчика.",
].join("\n");
(async () => {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:batch-24");
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8"));
    await prisma.$transaction(async (tx) => {
      for (const o of j.orders) await tx.productionOrder.update({ where: { id: o.id }, data: { batchId: o.batchId } });
      if (j.created) await tx.productionBatch.delete({ where: { id: j.batchId } });
    });
    console.log("Откат выполнен."); process.exit(0);
  }
  const orders = await prisma.productionOrder.findMany({ where: { organizationId: org.id, workOrderNumber: { in: TZ } }, select: { id: true, workOrderNumber: true, batchId: true, plannedQuantity: true } });
  const units = orders.reduce((s, o) => s + Number(o.plannedQuantity), 0);
  const existing = await prisma.productionBatch.findFirst({ where: { organizationId: org.id, number: 24 } });
  console.log(`ТЗ найдено ${orders.length}/${TZ.length}, изделий ${units}; партия 24 ${existing ? "уже есть" : "будет создана"}; сейчас партии у ТЗ: ${[...new Set(orders.map((o) => o.batchId ?? "нет"))].join(", ")}`);
  if (!APPLY) { console.log("Пробный прогон."); process.exit(0); }
  if (existsSync(JOURNAL)) { console.log("Журнал уже есть — сначала --rollback."); process.exit(1); }
  const j = await prisma.$transaction(async (tx) => {
    const b = existing ?? await tx.productionBatch.create({ data: { organizationId: org.id, number: 24, name: "Поставка 24", year: 2026, plannedUnits: units, notes: NOTES } });
    for (const o of orders) await tx.productionOrder.update({ where: { id: o.id }, data: { batchId: b.id } });
    return { batchId: b.id, created: !existing, orders: orders.map((o) => ({ id: o.id, tz: o.workOrderNumber, batchId: o.batchId })) };
  });
  writeFileSync(JOURNAL, JSON.stringify(j, null, 1)); console.log("Применено. Журнал:", JOURNAL); process.exit(0);
})();
