/**
 * Надбавка 4 % на материалы заказчика в ТЗ № 184–192 (внесены 28.10.2026 из приложений без строк списания, поэтому 4 % к ним не начислялось, а у всех прежних ТЗ
 * она есть: commission4 = true у строк списания). Добавляется строкой расходов «Надбавка 4 % на материалы заказчика»: 4 % от суммы материалов без НДС
 * (строка расходов «Материалы заказчика по документу ТЗ»); снимок ТЗ (expenseCost / totalCost / unitCost) и приход готовой продукции пересчитываются.
 * Ограничение: строка расходов одна на режимы «с НДС» и «без НДС», поэтому в режиме «с НДС» 4 % считается от суммы без НДС (на ≈ 0,9 % сырья меньше, чем от суммы с НДС).
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/add-c4-tz-184-192-2026-10-28.ts            # пробный прогон
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/add-c4-tz-184-192-2026-10-28.ts --apply    # (до этого bash scripts/backup.sh)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/add-c4-tz-184-192-2026-10-28.ts --rollback
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Prisma } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(resolve(__dirname, ".."), "docs-inventory", "corrections-journal-add-c4-tz-184-192-2026-10-28.json");
const D = Prisma.Decimal;
const MATS = "Материалы заказчика по документу ТЗ", C4 = "Надбавка 4 % на материалы заказчика";

type J = { orders: { id: string; expenseCost: string | null; totalCost: string | null; unitCost: string | null; expenseId: string; movement: { id: string; totalCost: string; unitCost: string } | null; stock: { id: string; avgUnitCost: string } | null }[]; categoryCreated: string | null };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { fullFinishedCost } = await import("../src/lib/finished-goods-cost");
  const prisma = createAuditedClient("script:add-c4-tz-184-192");
  console.log(ROLLBACK ? "ОТКАТ" : APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН");
  if (ROLLBACK) {
    const j: J = JSON.parse(readFileSync(JOURNAL, "utf8"));
    await prisma.$transaction(async (tx) => {
      for (const o of j.orders) {
        await tx.productionExpense.deleteMany({ where: { id: o.expenseId } });
        await tx.productionOrder.update({ where: { id: o.id }, data: { expenseCost: o.expenseCost, totalCost: o.totalCost, unitCost: o.unitCost } });
        if (o.movement) await tx.finishedGoodsMovement.update({ where: { id: o.movement.id }, data: { totalCost: o.movement.totalCost, unitCost: o.movement.unitCost } });
        if (o.stock) await tx.finishedGoodsStock.update({ where: { id: o.stock.id }, data: { avgUnitCost: o.stock.avgUnitCost } });
      }
      if (j.categoryCreated) await tx.expenseCategory.deleteMany({ where: { id: j.categoryCreated } });
    });
    console.log("Откат выполнен.");
    await prisma.$disconnect();
    return;
  }
  if (APPLY && existsSync(JOURNAL)) { console.log("Журнал уже есть — сначала --rollback."); await prisma.$disconnect(); return; }
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const orders = await prisma.productionOrder.findMany({ where: { organizationId: org.id, workOrderNumber: { in: ["184", "185", "186", "187", "188", "189", "190", "191", "192"] } }, include: { expenses: { include: { category: true } } }, orderBy: { number: "asc" } });
  let cat = await prisma.expenseCategory.findFirst({ where: { organizationId: org.id, name: C4 } });
  const journal: J = { orders: [], categoryCreated: null };
  let sum = 0;
  for (const o of orders) {
    const mats = o.expenses.find((e) => e.category.name === MATS);
    if (!mats) { console.log(`ТЗ ${o.workOrderNumber}: нет строки «${MATS}» — пропуск`); continue; }
    if (o.expenses.some((e) => e.category.name === C4)) { console.log(`ТЗ ${o.workOrderNumber}: 4 % уже есть — пропуск`); continue; }
    const c4 = mats.amount.mul(0.04).toDecimalPlaces(2);
    sum += Number(c4);
    console.log(`ТЗ ${o.workOrderNumber} (${o.number}): материалы без НДС ${mats.amount} ₽ → 4 % = ${c4} ₽`);
    if (!APPLY) continue;
    await prisma.$transaction(async (tx) => {
      if (!cat) { cat = await tx.expenseCategory.create({ data: { organizationId: org.id, name: C4, kind: "PRODUCTION" } }); journal.categoryCreated = cat.id; }
      const ex = await tx.productionExpense.create({ data: { productionOrderId: o.id, categoryId: cat.id, amount: c4, date: mats.date, description: "4 % на материалы заказчика (как у всех ТЗ с материалами)" } });
      const entry: J["orders"][number] = { id: o.id, expenseCost: o.expenseCost?.toString() ?? null, totalCost: o.totalCost?.toString() ?? null, unitCost: o.unitCost?.toString() ?? null, expenseId: ex.id, movement: null, stock: null };
      const expenseCost = (o.expenseCost ?? new D(0)).add(c4), totalCost = (o.totalCost ?? new D(0)).add(c4);
      await tx.productionOrder.update({ where: { id: o.id }, data: { expenseCost, totalCost, unitCost: totalCost.div(o.plannedQuantity) } });
      const mv = await tx.finishedGoodsMovement.findFirst({ where: { productionOrderId: o.id, type: "PRODUCTION_IN" } });
      if (mv) {
        const q = o.producedQuantity.gt(0) ? o.producedQuantity : o.plannedQuantity;
        const full = fullFinishedCost({ materialUsages: [], expenses: [{ amount: totalCost }], clientWorkPricePerUnit: o.clientWorkPricePerUnit } as never, q);
        entry.movement = { id: mv.id, totalCost: mv.totalCost.toString(), unitCost: mv.unitCost.toString() };
        await tx.finishedGoodsMovement.update({ where: { id: mv.id }, data: { totalCost: full.total, unitCost: full.total.div(q) } });
        const st = await tx.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: mv.warehouseId, productModelId: mv.productModelId } } });
        if (st && st.quantity.gt(0)) {
          entry.stock = { id: st.id, avgUnitCost: st.avgUnitCost.toString() };
          await tx.finishedGoodsStock.update({ where: { id: st.id }, data: { avgUnitCost: st.quantity.mul(st.avgUnitCost).sub(mv.totalCost).add(full.total).div(st.quantity) } });
        }
      }
      journal.orders.push(entry);
    });
  }
  console.log(`Итого 4 %: ${sum.toFixed(2)} ₽`);
  if (APPLY) { writeFileSync(JOURNAL, JSON.stringify(journal, null, 1)); console.log("Журнал:", JOURNAL); } else console.log("Пробный прогон: БД не менялась.");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
