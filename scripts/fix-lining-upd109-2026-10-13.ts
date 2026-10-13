/**
 * Подкладка Спец. 7 (УПД №109 от 11.07.2025, счёт №100, п/п №54214): приведение цен закупок З-2026-0032 / З-2026-0060 к УПД — 13.10.2026.
 *
 * Основание (УПД №109 «Копия УПД (статус 1) № 109 от 11 июля 2025 г (2).xlsx», Drive): все 8 позиций подкладочной ткани по 1 783,33 ₽/м без НДС
 * (2 140,00 ₽/м с НДС 20%), 680,3 м, итого без НДС 1 213 201,66, с НДС 1 455 842,00; «К платёжно-расчётному документу № 54214 от 03.07.2025».
 * В базе по З-2026-0032 цены 1 784,32…1 798,19 (округления реестра), лоты пула 2 140,54…2 143,79 ₽/м -> закупки 1 457 199,06 против УПД 1 455 842,00 (+1 357,06).
 *
 * Что меняется (повторяет подход scripts/fix-lining-prices.ts; цены всех списаний приводятся к цене лота 2 140):
 *   1. PurchaseItem З-2026-0032 (7 позиций): unitPrice = 1 783,33, subtotal = кол-во × 2 140 / 1,2 (как в уже верной З-2026-0060).
 *   2. RawMaterialLot пула (лоты, где цена/сумма не равны кол-во × 2 140): unitCost = 2 140, totalCost = кол-во × 2 140, materialCostExclVat = 1 783,33, materialVatAmount = 356,67.
 *   3. ProductionMaterialUsage этих лотов с ценой не 2 140: unitCost = 2 140, totalCost = кол-во × 2 140; движение PRODUCTION_OUT (то же количество и цена).
 *   4. Кэш стоимости завершённых ТЗ и склад ГП — как syncCompletedOrderCost (production/actions.ts): снимок ТЗ, FinishedGoodsStock.avgUnitCost, движение ADJUSTMENT_*.
 * НЕ меняются: платёж п/п №54214 (остаётся оплатой аукциона «Подкладка 07.25» целиком — так задумана привязка нескольких закупок одного аукциона),
 * движения PURCHASE_IN, количество, лоты других закупок.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fix-lining-upd109-2026-10-13.ts            # пробный прогон
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fix-lining-upd109-2026-10-13.ts --apply    # перед записью scripts/backup.sh (--no-backup отключает)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fix-lining-upd109-2026-10-13.ts --rollback [--apply]
 * Журнал: docs-inventory/corrections-journal-fix-lining-upd109-2026-10-13.json
 */
import "./stubs/server-only-shim";
import { join } from "path";
import { execSync } from "child_process";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const PURCHASES = ["З-2026-0032", "З-2026-0060"];
const PRICE_GROSS = "2140";
const UNIT_NET = "1783.33";
const UNIT_VAT = "356.67";

type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string;
  items: { id: string; old: [string, string]; new: [string, string] }[];
  lots: { id: string; old: [string, string, string, string]; new: [string, string, string, string] }[];
  usages: { id: string; old: [string, string]; new: [string, string] }[];
  moves: { id: string; old: [string, string]; new: [string, string] }[];
  orders: { id: string; tz: string; old: [string | null, string | null, string | null, string | null]; stockId: string | null; stockOld: string | null; adjMovementId: string | null }[];
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { Decimal } = await import("@prisma/client/runtime/library");
  const { FG_FULL_COST_NOTE, fullFinishedCost, orderStockContribution } = await import("../src/lib/finished-goods-cost");
  const prisma = createAuditedClient("script:fix-lining-upd109-2026-10-13");
  const JOURNAL = join(INV, "corrections-journal-fix-lining-upd109-2026-10-13.json");
  const D = (v: unknown) => new Decimal(String(v));
  const GROSS = D(PRICE_GROSS);

  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен."); await prisma.$disconnect(); return; }
    console.log(`Откат: позиций ${j.items.length}, лотов ${j.lots.length}, списаний ${j.usages.length}, движений ${j.moves.length}, ТЗ ${j.orders.length}${APPLY ? "" : " (пробный; --apply)"}`);
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        for (const i of j.items) await tx.purchaseItem.update({ where: { id: i.id }, data: { unitPrice: i.old[0], subtotal: i.old[1] } });
        for (const l of j.lots) await tx.rawMaterialLot.update({ where: { id: l.id }, data: { unitCost: l.old[0], totalCost: l.old[1], materialCostExclVat: l.old[2], materialVatAmount: l.old[3] } });
        for (const u of j.usages) await tx.productionMaterialUsage.update({ where: { id: u.id }, data: { unitCost: u.old[0], totalCost: u.old[1] } });
        for (const m of j.moves) await tx.stockMovement.update({ where: { id: m.id }, data: { unitCost: m.old[0], totalCost: m.old[1] } });
        for (const o of j.orders) {
          await tx.productionOrder.update({ where: { id: o.id }, data: { materialCost: o.old[0], expenseCost: o.old[1], totalCost: o.old[2], unitCost: o.old[3] } });
          if (o.adjMovementId) await tx.finishedGoodsMovement.delete({ where: { id: o.adjMovementId } });
          if (o.stockId && o.stockOld != null) await tx.finishedGoodsStock.update({ where: { id: o.stockId }, data: { avgUnitCost: o.stockOld } });
        }
      }, { timeout: 300000, maxWait: 30000 });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Уже применено (журнал) — сначала --rollback --apply."); await prisma.$disconnect(); return; }

  const purchases = await prisma.purchase.findMany({
    where: { number: { in: PURCHASES } },
    include: { items: true, expenses: true },
  });
  if (purchases.length !== 2) throw new Error("Закупки З-2026-0032/0060 не найдены");
  const exchangeOk = purchases.every((p) => D(p.exchangeRate).eq(1));
  if (!exchangeOk) throw new Error("Курс закупки не 1");
  const lotIds = [...new Set(purchases.flatMap((p) => p.items.map((i) => i.lotId).filter((x): x is string => !!x)))];

  // 1. Позиции З-2026-0032
  const itemPlan: Journal["items"] = [];
  for (const p of purchases) {
    if (p.number !== "З-2026-0032") continue;
    for (const i of p.items) {
      const sub = D(i.quantity).mul(GROSS).div("1.2").toDecimalPlaces(2);
      if (D(i.unitPrice).eq(UNIT_NET) && D(i.subtotal).eq(sub)) continue;
      itemPlan.push({ id: i.id, old: [i.unitPrice.toString(), i.subtotal.toString()], new: [UNIT_NET, sub.toFixed(2)] });
    }
  }
  // Проверка по УПД: итог обеих закупок
  const sumSub = (p: (typeof purchases)[number]) => p.items.reduce((s, i) => {
    const pl = itemPlan.find((x) => x.id === i.id);
    return s.add(pl ? D(pl.new[1]) : D(i.subtotal));
  }, D(0));
  const netAfter = purchases.reduce((s, p) => s.add(sumSub(p)), D(0));
  const grossAfter = netAfter.mul("1.2");
  const qtyAll = purchases.reduce((s, p) => s.add(p.items.reduce((q, i) => q.add(i.quantity), D(0))), D(0));
  const grossBefore = purchases.reduce((s, p) => s.add(p.items.reduce((q, i) => q.add(D(i.subtotal).mul("1.2")), D(0))), D(0));
  console.log(`Закупки: ${qtyAll} м (УПД 680.3); с НДС было ${grossBefore.toFixed(2)} → станет ${grossAfter.toFixed(2)} (УПД 1455842.00, платёж 1455842.00)`);
  const problems: string[] = [];
  if (!qtyAll.eq("680.3")) problems.push(`метры ${qtyAll} ≠ 680.3`);
  if (grossAfter.sub("1455842").abs().gt("0.05")) problems.push(`итог после правки ${grossAfter.toFixed(4)} ≠ 1455842.00`);

  // 2. Лоты
  const lots = await prisma.rawMaterialLot.findMany({ where: { id: { in: lotIds } } });
  const lotPlan: Journal["lots"] = [];
  for (const l of lots) {
    const total = D(l.quantityReceived).mul(GROSS).toDecimalPlaces(2);
    if (D(l.unitCost).eq(GROSS) && D(l.totalCost).eq(total) && D(l.materialCostExclVat).eq(UNIT_NET) && D(l.materialVatAmount).eq(UNIT_VAT)) continue;
    lotPlan.push({ id: l.id, old: [l.unitCost.toString(), l.totalCost.toString(), l.materialCostExclVat.toString(), l.materialVatAmount.toString()], new: [GROSS.toFixed(2), total.toFixed(2), UNIT_NET, UNIT_VAT] });
  }
  // 3. Списания
  const usages = await prisma.productionMaterialUsage.findMany({ where: { lotId: { in: lotIds } }, include: { productionOrder: { select: { id: true, workOrderNumber: true, number: true } } } });
  const usagePlan: Journal["usages"] = [];
  const touchedOrders = new Set<string>();
  for (const u of usages) {
    const total = D(u.quantity).mul(GROSS).toDecimalPlaces(2);
    if (D(u.unitCost).eq(GROSS) && D(u.totalCost).eq(total)) continue;
    usagePlan.push({ id: u.id, old: [u.unitCost.toString(), u.totalCost.toString()], new: [GROSS.toFixed(2), total.toFixed(2)] });
    touchedOrders.add(u.productionOrderId);
  }
  const usageDelta = usagePlan.reduce((s, u) => s.add(D(u.new[1]).sub(u.old[1])), D(0));
  const lotDelta = lotPlan.reduce((s, l) => s.add(D(l.new[1]).sub(l.old[1])), D(0));
  console.log(`Позиций ${itemPlan.length}; лотов ${lotPlan.length} (Δ totalCost ${lotDelta.toFixed(2)}); списаний ${usagePlan.length} в ${touchedOrders.size} ТЗ (Δ ${usageDelta.toFixed(2)})`);
  for (const l of lotPlan) console.log(`  лот …${l.id.slice(-6)}: цена ${l.old[0]} → ${l.new[0]}, сумма ${l.old[1]} → ${l.new[1]}`);
  if (problems.length) { console.log("ПРОБЛЕМЫ:\n- " + problems.join("\n- ")); await prisma.$disconnect(); process.exitCode = 1; return; }
  if (!APPLY) { console.log("Пробный прогон: БД не менялась (--apply для записи)."); await prisma.$disconnect(); return; }

  if (!NO_BACKUP) { console.log("Копия базы: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  const journal: Journal = { script: "fix-lining-upd109-2026-10-13.ts", status: "applied", at: new Date().toISOString(), items: itemPlan, lots: lotPlan, usages: usagePlan, moves: [], orders: [] };
  await prisma.$transaction(async (tx) => {
    for (const i of itemPlan) await tx.purchaseItem.update({ where: { id: i.id }, data: { unitPrice: i.new[0], subtotal: i.new[1] } });
    for (const l of lotPlan) await tx.rawMaterialLot.update({ where: { id: l.id }, data: { unitCost: l.new[0], totalCost: l.new[1], materialCostExclVat: l.new[2], materialVatAmount: l.new[3] } });
    const usedMoves = new Set<string>();
    for (const u of usagePlan) {
      const src = usages.find((x) => x.id === u.id)!;
      await tx.productionMaterialUsage.update({ where: { id: u.id }, data: { unitCost: u.new[0], totalCost: u.new[1] } });
      const mv = await tx.stockMovement.findFirst({ where: { id: { notIn: [...usedMoves] }, lotId: src.lotId, productionOrderId: src.productionOrderId, type: "PRODUCTION_OUT", quantity: src.quantity, unitCost: src.unitCost } });
      if (mv) {
        usedMoves.add(mv.id);
        journal.moves.push({ id: mv.id, old: [mv.unitCost.toString(), mv.totalCost.toString()], new: [u.new[0], u.new[1]] });
        await tx.stockMovement.update({ where: { id: mv.id }, data: { unitCost: u.new[0], totalCost: u.new[1] } });
      }
    }
    // как syncCompletedOrderCost
    for (const oid of touchedOrders) {
      const order = await tx.productionOrder.findUniqueOrThrow({ where: { id: oid }, include: { materialUsages: true, expenses: true } });
      if (order.status !== "COMPLETED" || order.producedQuantity.isZero()) continue;
      const materialCost = order.materialUsages.reduce((s, x) => s.add(x.totalCost), D(0));
      const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), D(0));
      const totalCost = materialCost.add(expenseCost);
      const unitCost = totalCost.div(order.producedQuantity);
      const snapshotDelta = totalCost.sub(order.totalCost ?? D(0));
      const contribution = await orderStockContribution(tx, oid);
      const full = fullFinishedCost(order, order.producedQuantity);
      const stockDelta = contribution.marked ? full.total.sub(contribution.count === 0 ? (order.totalCost ?? D(0)) : contribution.net) : snapshotDelta;
      const rec: Journal["orders"][number] = { id: oid, tz: order.workOrderNumber ?? order.number, old: [order.materialCost?.toString() ?? null, order.expenseCost?.toString() ?? null, order.totalCost?.toString() ?? null, order.unitCost?.toString() ?? null], stockId: null, stockOld: null, adjMovementId: null };
      await tx.productionOrder.update({ where: { id: oid }, data: { materialCost, expenseCost, totalCost, unitCost } });
      if (stockDelta.abs().gte(0.005)) {
        const stock = await tx.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: order.finishedWarehouseId, productModelId: order.productModelId } } });
        if (stock) {
          const newTotalValue = stock.quantity.mul(stock.avgUnitCost).add(stockDelta);
          rec.stockId = stock.id; rec.stockOld = stock.avgUnitCost.toString();
          await tx.finishedGoodsStock.update({ where: { id: stock.id }, data: { avgUnitCost: stock.quantity.isZero() ? stock.avgUnitCost : newTotalValue.div(stock.quantity) } });
          const mv = await tx.finishedGoodsMovement.create({
            data: {
              organizationId: order.organizationId, warehouseId: order.finishedWarehouseId, productModelId: order.productModelId,
              type: stockDelta.greaterThan(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", quantity: 0,
              unitCost: stockDelta.abs().div(order.producedQuantity), totalCost: stockDelta.abs(), productionOrderId: oid,
              notes: contribution.marked ? `Корректировка себестоимости: подкладка по УПД №109 (2 140 ₽/м). ${FG_FULL_COST_NOTE}` : "Корректировка себестоимости: подкладка по УПД №109 (2 140 ₽/м)",
            },
          });
          rec.adjMovementId = mv.id;
        }
      }
      journal.orders.push(rec);
    }
  }, { timeout: 300000, maxWait: 30000 });
  writeJson(JOURNAL, journal);
  console.log(`Применено. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
