/**
 * Лот 10026 (норка серебристо-голубая 50 М): ещё 9 шкур ушли Веллмеху по УПД МФВМ/000030 от 05.06.2026 (письма 03.06 и 05.06.2026;
 * 16 + 9 = 25 списано, как в ОСВ бухгалтерии). Остаток 54 → 45: списание в ТЗ 116 (ремонт пальто, письмо Веллмеха о «ещё 9 шкурах» — в той же переписке «Ремонт меховых изделий»).
 * Пробный прогон по умолчанию; --apply (backup.sh + журнал); --rollback --apply.
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
const APPLY = process.argv.includes("--apply"), ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-lot-10026-writeoff-2026-10-14.json");
async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:lot-10026-writeoff");
  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as { lotId: string; movementId: string; usageId: string; qty: number };
    if (APPLY) await prisma.$transaction([...(j.usageId ? [prisma.productionMaterialUsage.delete({ where: { id: j.usageId } })] : []), prisma.stockMovement.delete({ where: { id: j.movementId } }), prisma.rawMaterialLot.update({ where: { id: j.lotId }, data: { quantityRemaining: { increment: j.qty } } })]);
    return console.log(APPLY ? "откат выполнен" : "пробный откат");
  }
  const lot = await prisma.rawMaterialLot.findFirstOrThrow({ where: { lotNumber: "10026" } });
  console.log(`лот 10026: остаток ${lot.quantityRemaining} → ${Number(lot.quantityRemaining) - 9}, цена ${lot.unitCost}`);
  if (Number(lot.quantityRemaining) !== 54) return console.log("остаток не 54 — пропуск (уже исправлено или менялось)");
  if (!APPLY) return console.log("пробный прогон (добавьте --apply)");
  execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  const u0 = await prisma.productionMaterialUsage.findFirstOrThrow({ where: { lotId: lot.id }, include: { productionOrder: { select: { number: true } } } });
  console.log(`ТЗ ${u0.productionOrder.number}: уже списано ${u0.quantity} шт. по ${u0.unitCost}`);
  const mv = await prisma.$transaction(async (tx) => {
    const usage = await tx.productionMaterialUsage.create({ data: { productionOrderId: u0.productionOrderId, rawMaterialId: lot.rawMaterialId, lotId: lot.id, quantity: 9, unitCost: u0.unitCost, totalCost: Number(u0.unitCost) * 9, date: new Date("2026-06-05T00:00:00Z"), commission4: u0.commission4, vatRate: u0.vatRate } });
    const m = await tx.stockMovement.create({ data: { organizationId: lot.organizationId, warehouseId: lot.warehouseId, rawMaterialId: lot.rawMaterialId, lotId: lot.id, type: "PRODUCTION_OUT", quantity: 9, unitCost: u0.unitCost, totalCost: Number(u0.unitCost) * 9, productionOrderId: u0.productionOrderId, date: new Date("2026-06-05T00:00:00Z"), notes: "Ещё 9 шкур на ремонт (ТЗ 116): письмо Веллмеха 03.06.2026, УПД МФВМ/000030 от 05.06.2026" } });
    await tx.rawMaterialLot.update({ where: { id: lot.id }, data: { quantityRemaining: 45 } });
    return { id: m.id, usageId: usage.id };
  });
  writeFileSync(JOURNAL, JSON.stringify({ lotId: lot.id, movementId: mv.id, usageId: mv.usageId, qty: 9 }, null, 1));
  console.log("готово");
}
main().then(() => process.exit(0));
