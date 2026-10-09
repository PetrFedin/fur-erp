/**
 * Журнал движений склада для списаний подкладки 05.26 (scripts/apply-new-lining-usage.ts): по одному PRODUCTION_OUT на списание,
 * как у остальных списаний. Остатки лотов не меняются (уже уменьшены тем скриптом).
 *   node --env-file=.env node_modules/.bin/tsx scripts/add-new-lining-movements.ts [--apply | --rollback --apply]
 * Журнал: docs-inventory/corrections-journal-new-lining-movements.json
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const SRC = join(__dirname, "..", "docs-inventory", "corrections-journal-new-lining-usage.json");
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-new-lining-movements.json");
type J = { time: string; movements: string[]; rolledBack?: string };

(async () => {
  try {
    if (ROLLBACK) {
      const j: J = JSON.parse(readFileSync(JOURNAL, "utf-8"));
      if (j.rolledBack) return console.log("Уже откачено");
      if (!APPLY) return console.log(`Будет удалено движений: ${j.movements.length} (добавьте --apply)`);
      await prisma.stockMovement.deleteMany({ where: { id: { in: j.movements } } });
      j.rolledBack = new Date().toISOString();
      writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
      return console.log("Откачено");
    }
    if (existsSync(JOURNAL) && !JSON.parse(readFileSync(JOURNAL, "utf-8")).rolledBack) return console.log("Уже применено");
    const ids: string[] = JSON.parse(readFileSync(SRC, "utf-8")).usages;
    const usages = await prisma.productionMaterialUsage.findMany({ where: { id: { in: ids } }, include: { lot: true, productionOrder: { select: { workOrderNumber: true, number: true, organizationId: true } } } });
    const have = await prisma.stockMovement.count({ where: { type: "PRODUCTION_OUT", productionOrderId: { in: usages.map((u) => u.productionOrderId) }, lotId: { in: usages.map((u) => u.lotId) } } });
    if (have) throw new Error(`Движения по этим списаниям уже есть (${have}) — остановлено`);
    console.log(`Списаний подкладки 05.26: ${usages.length}; будет создано движений PRODUCTION_OUT: ${usages.length}, Σ ${usages.reduce((s, u) => s + Number(u.quantity), 0).toFixed(2)} м`);
    if (!APPLY) return console.log("Пробный прогон: ничего не записано");
    const created: string[] = [];
    await prisma.$transaction(async (tx) => {
      for (const u of usages) {
        const m = await tx.stockMovement.create({ data: { organizationId: u.productionOrder.organizationId, warehouseId: u.lot.warehouseId, rawMaterialId: u.rawMaterialId, lotId: u.lotId, type: "PRODUCTION_OUT", quantity: u.quantity, unitCost: u.unitCost, totalCost: u.totalCost, productionOrderId: u.productionOrderId, date: u.date, notes: `Подкладка 05.26 по ТЗ ${u.productionOrder.workOrderNumber ?? u.productionOrder.number}` } });
        created.push(m.id);
      }
    });
    writeFileSync(JOURNAL, JSON.stringify({ time: new Date().toISOString(), movements: created } satisfies J, null, 1));
    console.log("Готово. Журнал записан.");
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e.message ?? e); process.exit(1); });
