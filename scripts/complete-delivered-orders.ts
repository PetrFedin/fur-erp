/**
 * Завершение ТЗ, по документам СДАННЫХ заказчику (Drive «мех»), у которых уже есть списания сырья.
 * Логика = completeProductionOrder (src/app/(app)/production/actions.ts) + receiveFinishedGoodsStock
 * (src/lib/stock.ts) — копия построчно, т.к. server action требует сессии, а stock.ts импортирует "server-only".
 * Отличия от action: endDate = документальная дата сдачи (а не «сейчас»); у прихода готовой продукции
 * дата = дата сдачи и примечание-основание.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/complete-delivered-orders.ts [--only П-2026-0175]            # DRY-RUN
 *   node --env-file=.env node_modules/.bin/tsx scripts/complete-delivered-orders.ts [--only ...] --apply            # (до этого scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/complete-delivered-orders.ts --rollback docs-inventory/corrections-journal-complete-orders.json
 *
 * ТЗ без списаний (П-2026-0163, 0164, 0165, 0172) приложение завершать не позволяет — скрипт их НЕ трогает, а перечисляет.
 * Идемпотентно: завершает только PLANNED/IN_PROGRESS. verifiedAt не трогает.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const JOURNAL = join(resolve(__dirname, ".."), "docs-inventory", "corrections-journal-complete-orders.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const rb = args.indexOf("--rollback");
const MARK = "[завершено по документам 2026-10-04]";
const D = Prisma.Decimal;

// ТЗ, сданные по документам. basis — что именно подтверждает сдачу.
const B8 = "расчёт доплаты партии 8 (26.01.2026): «количество сданных изделий» ТЗ 88 = 8; письмо 27.01.2026 «расчёт производства партии 8», баланс 040226 (отгрузка партии 8, 46 ед.)";
const B20 = "письмо «Партия 20 (68 изделий)» 25.09.2026: поставка принята; расчёт доплаты партии 20 (ТЗ 152–162), счёт №265 от 22.09.2026";
const TARGETS: Record<string, { endDate: string | null; basis: string }> = {
  "П-2026-0160": { endDate: "2026-01-27", basis: B8 },
  "П-2026-0161": { endDate: "2026-01-27", basis: B8 },
  "П-2026-0162": { endDate: "2026-01-27", basis: B8 },
  "П-2026-0163": { endDate: null, basis: "расчёт доплаты партии 7 (14.01.2026): ТЗ 75 МН07 — 4 сданных; счёт №1 от 15.01.2026" },
  "П-2026-0164": { endDate: null, basis: "расчёт доплаты партии 10 (18.02.2026): ТЗ 97 МН17 — 9 сданных; счёт №41" },
  "П-2026-0165": { endDate: null, basis: "расчёт доплаты партии 11 (20.02.2026): ТЗ 104 МН17 — 1 сданное; счёт №51" },
  ...Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`П-2026-${String(166 + i).padStart(4, "0")}`, { endDate: null, basis: B20 }])),
};

type J = {
  orderId: string; number: string;
  before: { status: string; producedQuantity: string; materialCost: string | null; expenseCost: string | null; totalCost: string | null; unitCost: string | null; endDate: string | null; notes: string | null };
  after: { totalCost: string; unitCost: string; endDate: string | null };
  movementId: string; stockBefore: { id: string; quantity: string; avgUnitCost: string } | null; stockAfter: { quantity: string; avgUnitCost: string };
}[];

async function rollback(file: string) {
  const j: J = JSON.parse(readFileSync(file, "utf8")).changes;
  for (const e of j.slice().reverse()) {
    await prisma.$transaction(async (tx) => {
      const o = await tx.productionOrder.findUnique({ where: { id: e.orderId } });
      if (!o || o.status !== "COMPLETED") { console.log("пропуск", e.number, "(не завершено)"); return; }
      const mv = await tx.finishedGoodsMovement.findUnique({ where: { id: e.movementId } });
      if (mv) await tx.finishedGoodsMovement.delete({ where: { id: e.movementId } });
      const st = await tx.finishedGoodsStock.findFirst({ where: { warehouseId: o.finishedWarehouseId, productModelId: o.productModelId } });
      if (st) {
        if (e.stockBefore) await tx.finishedGoodsStock.update({ where: { id: st.id }, data: { quantity: e.stockBefore.quantity, avgUnitCost: e.stockBefore.avgUnitCost } });
        else await tx.finishedGoodsStock.delete({ where: { id: st.id } });
      }
      await tx.productionOrder.update({
        where: { id: e.orderId },
        data: { status: e.before.status as any, producedQuantity: e.before.producedQuantity, materialCost: e.before.materialCost, expenseCost: e.before.expenseCost, totalCost: e.before.totalCost, unitCost: e.before.unitCost, endDate: e.before.endDate ? new Date(e.before.endDate) : null, notes: e.before.notes },
      });
      console.log("откат", e.number);
    });
  }
}

async function main() {
  console.log(APPLY ? "ПРИМЕНЕНИЕ" : rb >= 0 ? "ОТКАТ" : "DRY-RUN");
  if (rb >= 0) return rollback(args[rb + 1]);
  const prev: J = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")).changes : [];
  const journal: J = [...prev];
  const skipped: string[] = [];
  for (const [number, t] of Object.entries(TARGETS)) {
    if (only && only !== number) continue;
    const order = await prisma.productionOrder.findFirst({ where: { number }, include: { materialUsages: true, expenses: true } });
    if (!order) { console.log("нет ТЗ", number); continue; }
    if (order.status === "COMPLETED") { console.log(number, "уже завершено"); continue; }
    if (order.materialUsages.length === 0) { skipped.push(`${number}: нет списаний сырья — приложение не завершает; ${t.basis}`); continue; }
    const materialCost = order.materialUsages.reduce((s, u) => s.add(u.totalCost), new D(0));
    const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), new D(0));
    const totalCost = materialCost.add(expenseCost);
    const qty = order.producedQuantity.isZero() ? order.plannedQuantity : order.producedQuantity;
    const unitCost = totalCost.div(qty);
    const endDate = t.endDate ? new Date(t.endDate + "T00:00:00.000Z") : order.endDate;
    console.log(`${number}: ${order.status} → COMPLETED, qty ${qty}, материалы ${materialCost}, итого ${totalCost}, за ед. ${unitCost.toFixed(2)}, endDate ${endDate?.toISOString().slice(0, 10) ?? "—"}`);
    if (!APPLY) continue;
    const res = await prisma.$transaction(async (tx) => {
      const moved = await tx.productionOrder.updateMany({ where: { id: order.id, status: { in: ["PLANNED", "IN_PROGRESS"] } }, data: { status: "COMPLETED" } });
      if (moved.count === 0) return null;
      await tx.productionOrder.update({
        where: { id: order.id },
        data: { status: "COMPLETED", producedQuantity: qty, materialCost, expenseCost, totalCost, unitCost, endDate, notes: `${order.notes ? order.notes + "\n" : ""}${MARK} сдано заказчику: ${t.basis}` },
      });
      // --- receiveFinishedGoodsStock (src/lib/stock.ts), построчно
      const mv = await tx.finishedGoodsMovement.create({
        data: {
          organizationId: order.organizationId, warehouseId: order.finishedWarehouseId, productModelId: order.productModelId,
          type: "PRODUCTION_IN", quantity: qty, unitCost, totalCost, productionOrderId: order.id,
          date: endDate ?? new Date(), notes: `Приход по завершению ТЗ; дата — сдача заказчику по документам (${t.basis.slice(0, 120)}…)`,
        },
      });
      const existing = await tx.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: order.finishedWarehouseId, productModelId: order.productModelId } } });
      let stockAfter: { quantity: string; avgUnitCost: string };
      if (!existing) {
        const s = await tx.finishedGoodsStock.create({ data: { organizationId: order.organizationId, warehouseId: order.finishedWarehouseId, productModelId: order.productModelId, quantity: qty, avgUnitCost: qty.isZero() ? 0 : totalCost.div(qty) } });
        stockAfter = { quantity: s.quantity.toString(), avgUnitCost: s.avgUnitCost.toString() };
      } else {
        const nq = existing.quantity.add(qty);
        const nv = existing.quantity.mul(existing.avgUnitCost).add(totalCost);
        const na = nq.isZero() ? existing.avgUnitCost : nv.div(nq);
        const s = await tx.finishedGoodsStock.update({ where: { id: existing.id }, data: { quantity: nq, avgUnitCost: na } });
        stockAfter = { quantity: s.quantity.toString(), avgUnitCost: s.avgUnitCost.toString() };
      }
      return { mvId: mv.id, existing, stockAfter };
    });
    if (!res) { console.log("  гонка/уже завершено"); continue; }
    journal.push({
      orderId: order.id, number,
      before: { status: order.status, producedQuantity: order.producedQuantity.toString(), materialCost: order.materialCost?.toString() ?? null, expenseCost: order.expenseCost?.toString() ?? null, totalCost: order.totalCost?.toString() ?? null, unitCost: order.unitCost?.toString() ?? null, endDate: order.endDate?.toISOString() ?? null, notes: order.notes },
      after: { totalCost: totalCost.toString(), unitCost: unitCost.toString(), endDate: endDate?.toISOString() ?? null },
      movementId: res.mvId,
      stockBefore: res.existing ? { id: res.existing.id, quantity: res.existing.quantity.toString(), avgUnitCost: res.existing.avgUnitCost.toString() } : null,
      stockAfter: res.stockAfter,
    });
    writeFileSync(JOURNAL, JSON.stringify({ script: "complete-delivered-orders.ts", time: new Date().toISOString(), changes: journal }, null, 1));
  }
  if (skipped.length) console.log("\nНЕ ЗАВЕРШЕНЫ (нет списаний):\n" + skipped.map((s) => "  " + s).join("\n"));
  if (APPLY) console.log(`Журнал: ${JOURNAL}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
