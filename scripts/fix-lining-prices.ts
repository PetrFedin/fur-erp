/**
 * 13 списаний подкладки (ТЗ 78, 79, 86, 87, 90, 101, 102, 106–110, 117) по 2 175,66–2 175,67 ₽/м -> цена лота 2 140 ₽/м.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/fix-lining-prices.ts            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/fix-lining-prices.ts --apply    # после scripts/backup.sh
 *   node --env-file=.env node_modules/.bin/tsx scripts/fix-lining-prices.ts --rollback
 *
 * Основание: во всех приложениях ТЗ (docs-inventory/extract/prod2025b.json, поле lining.pricePerMeterInclVat) подкладка = 2 140 ₽/м
 * (закупка по УПД №109, НДС 20%); 2 175,67 = 2 140 × 1,22 / 1,2 — пересчёт НДС 20→22%, отдельной статьёй затрат не названа,
 * остальные 2026-е ТЗ (120, 123, 125, 127, 128, 149 …) списаны по 2 140. Для каждой строки меняются: ProductionMaterialUsage
 * (unitCost, totalCost), движение PRODUCTION_OUT, кэш стоимости ТЗ (materialCost/totalCost/unitCost) и стоимость готовой продукции —
 * точно как syncCompletedOrderCost в production/actions.ts. Журнал: docs-inventory/corrections-journal-lining-prices.json
 */
import { join } from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";

const prisma = new PrismaClient();
const D = Prisma.Decimal;
const APPLY = process.argv.includes("--apply");
const JOURNAL = join(INV, "corrections-journal-lining-prices.json");
type J = {
  usage: Array<{ id: string; wo: string; old: [string, string]; new: [string, string] }>;
  moves: Array<{ id: string; old: [string, string]; new: [string, string] }>;
  orders: Array<{ id: string; old: [string | null, string | null, string | null, string | null]; stockId: string | null; stockOld: string | null; adjMovementId: string | null }>;
};

async function sums() {
  const u = (await prisma.productionMaterialUsage.aggregate({ _sum: { totalCost: true } }))._sum.totalCost;
  const o = (await prisma.productionOrder.aggregate({ _sum: { totalCost: true, materialCost: true } }))._sum;
  const l = (await prisma.rawMaterialLot.aggregate({ _sum: { totalCost: true } }))._sum.totalCost;
  return { usage: String(u), ordersTotalCost: String(o.totalCost), ordersMaterialCost: String(o.materialCost), lots: String(l) };
}

async function rollback() {
  const j = readJson<J & { script?: string }>(JOURNAL, { usage: [], moves: [], orders: [] });
  await prisma.$transaction(async (tx) => {
    for (const u of j.usage) await tx.productionMaterialUsage.update({ where: { id: u.id }, data: { unitCost: u.old[0], totalCost: u.old[1] } });
    for (const m of j.moves) await tx.stockMovement.update({ where: { id: m.id }, data: { unitCost: m.old[0], totalCost: m.old[1] } });
    for (const o of j.orders) {
      await tx.productionOrder.update({ where: { id: o.id }, data: { materialCost: o.old[0], totalCost: o.old[1], unitCost: o.old[2] } });
      if (o.adjMovementId) await tx.finishedGoodsMovement.delete({ where: { id: o.adjMovementId } });
      if (o.stockId && o.stockOld != null) await tx.finishedGoodsStock.update({ where: { id: o.stockId }, data: { avgUnitCost: o.stockOld } });
    }
  });
  console.log(`Откат: ${j.usage.length} списаний`);
  writeJson(JOURNAL, { script: "fix-lining-prices.ts", rolledBackAt: new Date().toISOString(), usage: [], moves: [], orders: [] });
}

async function main() {
  if (process.argv.includes("--rollback")) return rollback();
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN ==", "ДО:", await sums());
  const cand = await prisma.productionMaterialUsage.findMany({
    where: { rawMaterial: { unit: "M" } },
    include: { lot: true, productionOrder: true },
  });
  const rows = cand.filter((u) => !u.unitCost.eq(u.lot.unitCost) && u.unitCost.sub(u.lot.unitCost).div(u.lot.unitCost).toNumber() > 0.016 && u.unitCost.sub(u.lot.unitCost).div(u.lot.unitCost).toNumber() < 0.0175);
  console.log(`Кандидатов: ${rows.length}`);
  let delta = new D(0);
  const byOrder = new Map<string, typeof rows>();
  for (const r of rows) byOrder.set(r.productionOrderId, [...(byOrder.get(r.productionOrderId) ?? []), r]);
  const j: J = { usage: [], moves: [], orders: [] };
  const plan: Array<() => Promise<void>> = [];
  for (const [oid, us] of byOrder) {
    const o = us[0].productionOrder;
    for (const u of us) {
      const newTotal = u.quantity.mul(u.lot.unitCost).toDecimalPlaces(2);
      delta = delta.add(newTotal.sub(u.totalCost));
      console.log(`  ТЗ ${o.workOrderNumber}: ${u.quantity} м × ${u.unitCost} = ${u.totalCost} → × ${u.lot.unitCost} = ${newTotal}`);
    }
    plan.push(async () => {
      await prisma.$transaction(async (tx) => {
        for (const u of us) {
          const newTotal = u.quantity.mul(u.lot.unitCost).toDecimalPlaces(2);
          j.usage.push({ id: u.id, wo: o.workOrderNumber ?? o.number, old: [u.unitCost.toString(), u.totalCost.toString()], new: [u.lot.unitCost.toString(), newTotal.toString()] });
          await tx.productionMaterialUsage.update({ where: { id: u.id }, data: { unitCost: u.lot.unitCost, totalCost: newTotal } });
          const mv = await tx.stockMovement.findFirst({ where: { lotId: u.lotId, productionOrderId: oid, type: "PRODUCTION_OUT", quantity: u.quantity, unitCost: u.unitCost } });
          if (mv) {
            j.moves.push({ id: mv.id, old: [mv.unitCost.toString(), mv.totalCost.toString()], new: [u.lot.unitCost.toString(), newTotal.toString()] });
            await tx.stockMovement.update({ where: { id: mv.id }, data: { unitCost: u.lot.unitCost, totalCost: newTotal } });
          }
        }
        // как syncCompletedOrderCost
        const order = await tx.productionOrder.findUniqueOrThrow({ where: { id: oid }, include: { materialUsages: true, expenses: true } });
        const materialCost = order.materialUsages.reduce((s, x) => s.add(x.totalCost), new D(0));
        const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), new D(0));
        const totalCost = materialCost.add(expenseCost);
        const rec = { id: oid, old: [order.materialCost?.toString() ?? null, order.totalCost?.toString() ?? null, order.unitCost?.toString() ?? null, null] as [string | null, string | null, string | null, string | null], stockId: null as string | null, stockOld: null as string | null, adjMovementId: null as string | null };
        if (order.status === "COMPLETED" && !order.producedQuantity.isZero()) {
          const d = totalCost.sub(order.totalCost ?? new D(0));
          await tx.productionOrder.update({ where: { id: oid }, data: { materialCost, expenseCost, totalCost, unitCost: totalCost.div(order.producedQuantity) } });
          if (!d.isZero()) {
            const stock = await tx.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: order.finishedWarehouseId, productModelId: order.productModelId } } });
            if (stock) {
              const newTotalValue = stock.quantity.mul(stock.avgUnitCost).add(d);
              rec.stockId = stock.id; rec.stockOld = stock.avgUnitCost.toString();
              await tx.finishedGoodsStock.update({ where: { id: stock.id }, data: { avgUnitCost: stock.quantity.isZero() ? stock.avgUnitCost : newTotalValue.div(stock.quantity) } });
              const mv = await tx.finishedGoodsMovement.create({ data: { organizationId: order.organizationId, warehouseId: order.finishedWarehouseId, productModelId: order.productModelId, type: d.greaterThan(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", quantity: 0, unitCost: d.abs().div(order.producedQuantity), totalCost: d.abs(), productionOrderId: oid, notes: "Корректировка себестоимости: подкладка по цене лота 2 140 ₽/м (fix-lining-prices.ts)" } });
              rec.adjMovementId = mv.id;
            }
          }
        }
        j.orders.push(rec);
      });
    });
  }
  console.log(`Δ Σ списаний подкладки: ${delta.toFixed(2)} ₽`);
  if (!APPLY) return;
  for (const p of plan) await p();
  writeJson(JOURNAL, { script: "fix-lining-prices.ts", appliedAt: new Date().toISOString(), ...j });
  console.log("ПОСЛЕ:", await sums());
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
