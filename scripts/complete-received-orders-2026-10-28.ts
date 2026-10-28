/**
 * Завершение ТЗ «В работе/Запланировано», по которым в приходе MVST РМ (SalesReceiptLine, kind RECEIPT, 2025–2026) уже получено больше, чем завершено в ТЗ.
 * Правило: по модели нужно = получено − завершено в ТЗ; ТЗ закрываются по возрастанию номера и ТОЛЬКО целиком (план ≤ остатку нужного); частичных закрытий нет.
 * ТЗ без списаний сырья приложение завершать не позволяет — скрипт их не трогает, а перечисляет.
 * Логика = completeProductionOrder (src/app/(app)/production/actions.ts): снимок ТЗ (сырьё+расходы), приход готовой продукции по ПОЛНОЙ себестоимости (fullFinishedCost).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/complete-received-orders-2026-10-28.ts                 # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/complete-received-orders-2026-10-28.ts --apply         # (до этого bash scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/complete-received-orders-2026-10-28.ts --rollback
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import { FG_FULL_COST_NOTE, fullFinishedCost } from "../src/lib/finished-goods-cost";

const prisma = new PrismaClient();
const JOURNAL = join(resolve(__dirname, ".."), "docs-inventory", "corrections-journal-complete-received-2026-10-28.json");
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const MARK = "[завершено по приходу 2026-10-28]";
const D = Prisma.Decimal;
const N = (s: string) => s.replace(/[-\s_/.]/g, "").toUpperCase();

type J = { orderId: string; number: string; before: { status: string; producedQuantity: string; materialCost: string | null; expenseCost: string | null; totalCost: string | null; unitCost: string | null; endDate: string | null; notes: string | null }; movementId: string; stockBefore: { id: string; quantity: string; avgUnitCost: string } | null }[];

async function rollback() {
  const j: J = JSON.parse(readFileSync(JOURNAL, "utf8")).changes;
  for (const e of j.slice().reverse()) {
    await prisma.$transaction(async (tx) => {
      const o = await tx.productionOrder.findUnique({ where: { id: e.orderId } });
      if (!o || o.status !== "COMPLETED") { console.log("пропуск", e.number); return; }
      await tx.finishedGoodsMovement.deleteMany({ where: { id: e.movementId } });
      const st = await tx.finishedGoodsStock.findFirst({ where: { warehouseId: o.finishedWarehouseId, productModelId: o.productModelId } });
      if (st) {
        if (e.stockBefore) await tx.finishedGoodsStock.update({ where: { id: st.id }, data: { quantity: e.stockBefore.quantity, avgUnitCost: e.stockBefore.avgUnitCost } });
        else await tx.finishedGoodsStock.delete({ where: { id: st.id } });
      }
      await tx.productionOrder.update({ where: { id: e.orderId }, data: { status: e.before.status as never, producedQuantity: e.before.producedQuantity, materialCost: e.before.materialCost, expenseCost: e.before.expenseCost, totalCost: e.before.totalCost, unitCost: e.before.unitCost, endDate: e.before.endDate ? new Date(e.before.endDate) : null, notes: e.before.notes } });
      console.log("откат", e.number);
    });
  }
}

async function main() {
  console.log(ROLLBACK ? "ОТКАТ" : APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН");
  if (ROLLBACK) return rollback();
  if (APPLY && existsSync(JOURNAL)) { console.log("Журнал уже есть — сначала откат или перенос журнала."); return; }
  const models = await prisma.productModel.findMany({ select: { id: true, name: true, sku: true, salesCode: true, aliases: true } });
  const keyOf = new Map<string, string>();
  for (const m of models) for (const k of [m.name, m.sku, m.salesCode, ...(m.aliases ?? [])]) if (k) { keyOf.set(N(k), m.id); const b = N(k.split(/[ /+]/)[0]); if (!keyOf.has(b)) keyOf.set(b, m.id); }
  const rc = await prisma.salesReceiptLine.findMany({ where: { kind: "RECEIPT" }, select: { article: true, modelCode: true, pcs: true } });
  const received = new Map<string, number>();
  for (const r of rc) { const id = keyOf.get(N(r.modelCode ?? "")) ?? keyOf.get(N(r.article.split(/[ /+]/)[0])); if (id) received.set(id, (received.get(id) ?? 0) + (r.pcs ?? 0)); }
  const journal: J = [];
  const notDone: string[] = [];
  let closed = 0, closedQty = 0;
  for (const m of models) {
    const rec = received.get(m.id) ?? 0;
    if (!rec) continue;
    const orders = await prisma.productionOrder.findMany({ where: { productModelId: m.id, status: { not: "CANCELLED" } }, include: { materialUsages: true, expenses: true }, orderBy: { number: "asc" } });
    const done = orders.filter((o) => o.status === "COMPLETED").reduce((a, o) => a + Number(o.producedQuantity), 0);
    let left = rec - done;
    if (left <= 0) continue;
    for (const order of orders.filter((o) => o.status !== "COMPLETED")) {
      const qty = order.plannedQuantity;
      if (qty.lte(0) || qty.gt(left)) { notDone.push(`${m.name} ${order.number}: план ${qty}, нужно ещё ${left} — целиком не помещается`); continue; }
      if (order.materialUsages.length === 0) { notDone.push(`${m.name} ${order.number}: нет списаний сырья — приложение не завершает`); continue; }
      left -= Number(qty);
      const materialCost = order.materialUsages.reduce((s, u) => s.add(u.totalCost), new D(0));
      const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), new D(0));
      const totalCost = materialCost.add(expenseCost);
      const unitCost = totalCost.div(qty);
      const fg = fullFinishedCost(order, qty);
      console.log(`${m.name} ${order.number}: ${order.status} → COMPLETED, ${qty} шт., итого ${totalCost.toFixed(2)}, склад ${fg.total.toFixed(2)}`);
      closed++; closedQty += Number(qty);
      if (!APPLY) continue;
      const res = await prisma.$transaction(async (tx) => {
        const moved = await tx.productionOrder.updateMany({ where: { id: order.id, status: { in: ["PLANNED", "IN_PROGRESS"] } }, data: { status: "COMPLETED" } });
        if (moved.count === 0) return null;
        await tx.productionOrder.update({ where: { id: order.id }, data: { status: "COMPLETED", producedQuantity: qty, materialCost, expenseCost, totalCost, unitCost, endDate: new Date(), notes: `${order.notes ? order.notes + "\n" : ""}${MARK} получено по файлу прихода` } });
        const mv = await tx.finishedGoodsMovement.create({ data: { organizationId: order.organizationId, warehouseId: order.finishedWarehouseId, productModelId: order.productModelId, type: "PRODUCTION_IN", quantity: qty, unitCost: fg.total.div(qty), totalCost: fg.total, productionOrderId: order.id, notes: FG_FULL_COST_NOTE } });
        const ex = await tx.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: order.finishedWarehouseId, productModelId: order.productModelId } } });
        if (!ex) await tx.finishedGoodsStock.create({ data: { organizationId: order.organizationId, warehouseId: order.finishedWarehouseId, productModelId: order.productModelId, quantity: qty, avgUnitCost: fg.total.div(qty) } });
        else { const nq = ex.quantity.add(qty); const nv = ex.quantity.mul(ex.avgUnitCost).add(fg.total); await tx.finishedGoodsStock.update({ where: { id: ex.id }, data: { quantity: nq, avgUnitCost: nq.isZero() ? ex.avgUnitCost : nv.div(nq) } }); }
        return { mvId: mv.id, ex };
      });
      if (!res) { console.log("  гонка/уже завершено"); continue; }
      journal.push({ orderId: order.id, number: order.number, before: { status: order.status, producedQuantity: order.producedQuantity.toString(), materialCost: order.materialCost?.toString() ?? null, expenseCost: order.expenseCost?.toString() ?? null, totalCost: order.totalCost?.toString() ?? null, unitCost: order.unitCost?.toString() ?? null, endDate: order.endDate?.toISOString() ?? null, notes: order.notes }, movementId: res.mvId, stockBefore: res.ex ? { id: res.ex.id, quantity: res.ex.quantity.toString(), avgUnitCost: res.ex.avgUnitCost.toString() } : null });
      writeFileSync(JOURNAL, JSON.stringify({ script: "complete-received-orders-2026-10-28.ts", time: new Date().toISOString(), changes: journal }, null, 1));
    }
  }
  console.log(`\nИтого к закрытию: ${closed} ТЗ, ${closedQty} шт.`);
  if (notDone.length) console.log("НЕ ЗАКРЫТЫ:\n" + notDone.map((s) => "  " + s).join("\n"));
  if (APPLY) console.log("Журнал:", JOURNAL);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
