/**
 * Партия (поставка) 23 = ТЗ 184–192 (владелец, 30.10.2026). Создаёт ProductionBatch №23 и привязывает к ней 9 ТЗ.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/batch-23-tz-184-192-2026-10-30.ts [--apply | --rollback]
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const APPLY = process.argv.includes("--apply"), ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(resolve(__dirname, ".."), "docs-inventory", "corrections-journal-batch-23-2026-10-30.json");
const TZ = ["184", "185", "186", "187", "188", "189", "190", "191", "192"];
const NOTES = [
  "ТЗ 184–192 (владелец, 30.10.2026: «ТЗ 184–192 — это партия 23»).",
  "Доставка 1 (часть 1): 17 изделий ТЗ 184–191 — расчёт «расчет_по_доплате_Партия_23_часть_1.xlsx»: работа 2 786 700 ₽, авансы 70 % 1 092 840 ₽, доплата 1 693 860 ₽.",
  "Счёт №289 от 21.10.2026 на 1 693 860 ₽ — не оплачен (владелец, 30.10.2026; срок по счёту 26.10.2026).",
  "ТЗ 192 (MSC05, шарф) — сырьё передано, изделие не получено.",
].join("\n");
(async () => {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:batch-23");
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
  const existing = await prisma.productionBatch.findFirst({ where: { organizationId: org.id, number: 23 } });
  console.log(`ТЗ найдено ${orders.length}/9, изделий ${units}; партия 23 ${existing ? "уже есть" : "будет создана"}; сейчас партии у ТЗ: ${[...new Set(orders.map((o) => o.batchId ?? "нет"))].join(", ")}`);
  if (!APPLY) { console.log("Пробный прогон."); process.exit(0); }
  if (existsSync(JOURNAL)) { console.log("Журнал уже есть — сначала --rollback."); process.exit(1); }
  const j = await prisma.$transaction(async (tx) => {
    const b = existing ?? await tx.productionBatch.create({ data: { organizationId: org.id, number: 23, name: "Поставка 23", year: 2026, plannedUnits: units, notes: NOTES } });
    for (const o of orders) await tx.productionOrder.update({ where: { id: o.id }, data: { batchId: b.id } });
    return { batchId: b.id, created: !existing, orders: orders.map((o) => ({ id: o.id, tz: o.workOrderNumber, batchId: o.batchId })) };
  });
  writeFileSync(JOURNAL, JSON.stringify(j, null, 1)); console.log("Применено. Журнал:", JOURNAL); process.exit(0);
})();
