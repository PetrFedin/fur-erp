/**
 * Владелец, 05.11.2026: «влить 24 в 23». ТЗ 193–202 (партия 24) переносятся в партию 23 (ТЗ 184–192), партия 24 удаляется.
 * У партии 24 нет документов и отгрузок (проверено), только 9 ТЗ. Журнал нужен для отката: сохраняется вся строка партии 24.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/merge-batch-24-into-23-2026-11-05.ts [--apply | --rollback]
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const APPLY = process.argv.includes("--apply"), ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(resolve(__dirname, ".."), "docs-inventory", "corrections-journal-merge-batch-24-into-23-2026-11-05.json");
(async () => {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:merge-batch-24-into-23");
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8"));
    await prisma.$transaction(async (tx) => {
      const b24 = await tx.productionBatch.create({ data: { ...j.batch24, createdAt: new Date(j.batch24.createdAt), verifiedAt: j.batch24.verifiedAt ? new Date(j.batch24.verifiedAt) : null } });
      for (const o of j.orders) await tx.productionOrder.update({ where: { id: o.id }, data: { batchId: b24.id } });
      await tx.productionBatch.update({ where: { id: j.batch23.id }, data: { plannedUnits: j.batch23.plannedUnits, notes: j.batch23.notes } });
    });
    console.log("Откат выполнен: партия 24 восстановлена."); process.exit(0);
  }
  const [b23, b24] = await Promise.all([
    prisma.productionBatch.findFirstOrThrow({ where: { organizationId: org.id, number: 23 } }),
    prisma.productionBatch.findFirstOrThrow({ where: { organizationId: org.id, number: 24 } }),
  ]);
  const [orders, docs, ships] = await Promise.all([
    prisma.productionOrder.findMany({ where: { batchId: b24.id }, select: { id: true, workOrderNumber: true } }),
    prisma.driveDocument.count({ where: { productionBatchId: b24.id } }),
    prisma.shipment.count({ where: { batchId: b24.id } }),
  ]);
  const plannedUnits = (b23.plannedUnits ?? 0) + (b24.plannedUnits ?? 0);
  const notes = [
    b23.notes?.trim(),
    "ТЗ 193–202 влиты в партию 23 из бывшей партии 24 (владелец, 05.11.2026: «влить 24 в 23»). ТЗ 197 в системе нет — документа не было.",
    b24.notes?.split("\n").slice(1).join("\n").trim(),
  ].filter(Boolean).join("\n");
  console.log(`Партия 24: ТЗ ${orders.map((o) => o.workOrderNumber).join(", ")}; документов ${docs}, отгрузок ${ships}. Партия 23 после слияния: плановых изделий ${plannedUnits}.`);
  if (docs || ships) { console.log("У партии 24 есть документы или отгрузки — остановка, нужно решение."); process.exit(1); }
  if (!APPLY) { console.log("Пробный прогон."); process.exit(0); }
  if (existsSync(JOURNAL)) { console.log("Журнал уже есть — сначала --rollback."); process.exit(1); }
  await prisma.$transaction(async (tx) => {
    for (const o of orders) await tx.productionOrder.update({ where: { id: o.id }, data: { batchId: b23.id } });
    await tx.productionBatch.update({ where: { id: b23.id }, data: { plannedUnits, notes } });
    await tx.productionBatch.delete({ where: { id: b24.id } });
  });
  writeFileSync(JOURNAL, JSON.stringify({ batch23: { id: b23.id, plannedUnits: b23.plannedUnits, notes: b23.notes }, batch24: b24, orders }, null, 1));
  console.log("Применено. Журнал:", JOURNAL); process.exit(0);
})();
