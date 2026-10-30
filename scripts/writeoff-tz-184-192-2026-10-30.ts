/**
 * ТЗ № 184–192: списание сырья и подкладки со склада по лотам из приложений к Договору подряда №1605 (вместо суммы «Материалы заказчика по документу ТЗ»).
 *
 * Почему: 28.10 ТЗ 184–192 внесены без списания (лоты только в примечании), поэтому остатки сырья не уменьшились; к сумме материалов из документа
 * (цена в приложении = цена лота без НДС × 1,04, то есть 4 % уже внутри) скрипт add-c4 добавил ещё 4 % — себестоимость завышена на 4 % материалов.
 * Что делает (как у ТЗ 169–183): consumeFromLot (StockMovement PRODUCTION_OUT по цене лота) + ProductionMaterialUsage (commission4 = true), удаляет строки
 * расходов «Материалы заказчика по документу ТЗ» и «Надбавка 4 % на материалы заказчика», снимок ТЗ = сумма списаний (как у ТЗ 170), приход ГП =
 * fullFinishedCost (сырьё + 4 % + работа) и средняя цена остатка ГП сдвигается на разницу. ТЗ 192 (не получено): статус IN_PROGRESS, снимок пустой.
 * Дата списания = дата ТЗ. Источник: docs-inventory/incoming-2026-10-30/ПРИЛОЖЕНИЕ 184…192 (docx).
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/writeoff-tz-184-192-2026-10-30.ts            # пробный прогон
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/writeoff-tz-184-192-2026-10-30.ts --apply    # (до этого bash scripts/backup.sh)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/writeoff-tz-184-192-2026-10-30.ts --rollback
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Prisma } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(resolve(__dirname, ".."), "docs-inventory", "corrections-journal-writeoff-tz-184-192-2026-10-30.json");
const D = Prisma.Decimal;
const MATS = "Материалы заказчика по документу ТЗ", C4 = "Надбавка 4 % на материалы заказчика";
const LIN = "З-2026-0061"; // подкладка 05.26: 4 515 ₽/м с НДС = 3 848,85 × 1,22 в приложениях

type Line = { doc: string; mat: string; lot: string | null; purchase: string; qty: number; docUnit: number; docTotal: number; note?: string };
// Строки «ЗАКАЗЧИК ПЕРЕДАЛ» из приложений. СП0526.N / РП0426.N → лот N или FW26-N (различаются ценой), как в apply-tz-169-182.
const TZ: Record<string, Line[]> = {
  "184": [
    { doc: "норка коричневая 400101 (сага 03-26)", mat: "Норка", lot: "400101", purchase: "З-2026-0037", qty: 34, docUnit: 9088.30, docTotal: 376982.68 },
    { doc: "Соболь XXI 3-1 2 лот СП0526.20", mat: "Соболь", lot: "FW26-20", purchase: "З-2026-0047", qty: 4, docUnit: 29819.14, docTotal: 145517.40 },
    { doc: "Соболь XXI 3-2 2 лот СП0526.25", mat: "Соболь", lot: "25", purchase: "З-2026-0047", qty: 10, docUnit: 28995.86, docTotal: 353749.49 },
    { doc: "Соболь XXL 2-1.1 РП0426.1", mat: "Соболь", lot: "1", purchase: "З-2026-0041", qty: 7, docUnit: 27826.55, docTotal: 237638.74 },
    { doc: "Соболь XXL 3-2.1 РП0426.20", mat: "Соболь", lot: "20", purchase: "З-2026-0042", qty: 7, docUnit: 27826.55, docTotal: 237638.74 },
    { doc: "Подкладочная ткань №37/130", mat: "Подкладочная ткань №37", lot: null, purchase: LIN, qty: 3, docUnit: 3848.85, docTotal: 14086.79 },
  ],
  "185": [
    { doc: "норка черная 500083 (сага 03-26)", mat: "Норка", lot: "500083", purchase: "З-2026-0035", qty: 21, docUnit: 11374.56, docTotal: 291416.23 },
    { doc: "норка черная 500084 (сага 03-26)", mat: "Норка", lot: "500084", purchase: "З-2026-0035", qty: 35, docUnit: 11145.25, docTotal: 475902.18 },
    { doc: "Подкладочная ткань №37/130", mat: "Подкладочная ткань №37", lot: null, purchase: LIN, qty: 6.3, docUnit: 3848.85, docTotal: 29575.73 },
  ],
  "186": [
    { doc: "норка коричневая 400102 (сага 03-26)", mat: "Норка", lot: "400102", purchase: "З-2026-0037", qty: 54, docUnit: 8370.42, docTotal: 551443.27 },
    { doc: "Подкладочная ткань №38/130", mat: "Подкладочная ткань №38", lot: null, purchase: LIN, qty: 3.6, docUnit: 3848.85, docTotal: 16904.15 },
  ],
  "187": [
    { doc: "Соболь XXI 3-1 1 лот СП0526.19", mat: "Соболь", lot: "FW26-19", purchase: "З-2026-0047", qty: 9, docUnit: 30642.45, docTotal: 336454.10 },
    { doc: "Соболь XXI 3-2 2 лот СП0526.24", mat: "Соболь", lot: "24", purchase: "З-2026-0047", qty: 1, docUnit: 28995.86, docTotal: 35374.95 },
    { doc: "Соболь XXI 3а 1 1 лот СП0526.39", mat: "Соболь", lot: "39", purchase: "З-2026-0047", qty: 12, docUnit: 28172.58, docTotal: 412446.57 },
    { doc: "Соболь XXL 3-1.3 РП0426.18", mat: "Соболь", lot: "18", purchase: "З-2026-0042", qty: 4, docUnit: 30422.28, docTotal: 148460.73 },
    { doc: "Соболь XXL 3-1.3 РП0426.19", mat: "Соболь", lot: "19", purchase: "З-2026-0042", qty: 2, docUnit: 30422.28, docTotal: 74230.36 },
    { doc: "Соболь XXL 3-2.1 РП0426.23", mat: "Соболь", lot: "23", purchase: "З-2026-0042", qty: 1, docUnit: 27826.55, docTotal: 33948.39 },
    { doc: "Соболь XXL 3-2.2 РП0426.27", mat: "Соболь", lot: "27", purchase: "З-2026-0042", qty: 1, docUnit: 29557.04, docTotal: 36059.59 },
    { doc: "Соболь XXL 3-2.2 РП0426.30", mat: "Соболь", lot: "FW26-30", purchase: "З-2026-0042", qty: 11, docUnit: 29557.04, docTotal: 396655.48 },
    { doc: "Соболь XXL 3-2.3 РП0426.32", mat: "Соболь", lot: "FW26-32", purchase: "З-2026-0042", qty: 7, docUnit: 29557.04, docTotal: 252417.12 },
    { doc: "Соболь XXL 3-2.3 РП0426.33", mat: "Соболь", lot: "FW26-33", purchase: "З-2026-0042", qty: 10, docUnit: 29557.04, docTotal: 360595.89 },
    { doc: "Подкладочная ткань №24/130", mat: "Подкладочная ткань №24", lot: null, purchase: LIN, qty: 1.8, docUnit: 3848.85, docTotal: 8452.07 },
  ],
  "188": [
    { doc: "норка коричневая 400102 (сага 03-26)", mat: "Норка", lot: "400102", purchase: "З-2026-0037", qty: 39, docUnit: 8370.42, docTotal: 398264.58 },
    { doc: "Подкладочная ткань №24/130", mat: "Подкладочная ткань №24", lot: null, purchase: LIN, qty: 3.2, docUnit: 3848.85, docTotal: 15025.91 },
  ],
  "189": [
    { doc: "Шкура норка белая 20, лот 5017/5020/5016", mat: "Норка", lot: "5017/5020/5016", purchase: "З-2026-0008", qty: 29, docUnit: 8320.00, docTotal: 294361.60 },
    { doc: "Подкладочная ткань №2/130", mat: "Подкладочная ткань №2", lot: null, purchase: LIN, qty: 3.6, docUnit: 3848.85, docTotal: 16904.15 },
  ],
  "190": [
    { doc: "Соболь дикий (лавандер) лот 3486", mat: "Соболь", lot: "3486", purchase: "З-2026-0028", qty: 27, docUnit: 28804.96, docTotal: 948835.38, note: "цена в приложении 28 804,96, у лота 28 805,00 (округление)" },
    { doc: "Соболь дикий (лавандер) лот 3487", mat: "Соболь", lot: "3487", purchase: "З-2026-0028", qty: 23, docUnit: 29731.70, docTotal: 834271.50 },
  ],
  "191": [
    { doc: "Соболь XXL 2-1.2 РП0426.4", mat: "Соболь", lot: "4", purchase: "З-2026-0041", qty: 1, docUnit: 30422.29, docTotal: 37115.19 },
    { doc: "Соболь XXL 3-2.3 РП0426.33", mat: "Соболь", lot: "FW26-33", purchase: "З-2026-0042", qty: 5, docUnit: 27826.55, docTotal: 169741.96,
      note: "СПОРНО: в приложении цена 27 826,55 (сорт 2.1, лоты 20/23), а лот РП0426.33 (FW26-33, сорт 3-2.3) стоит 29 557,04. Списано по номеру лота — по цене лота" },
    { doc: "норка коричневая 300687 (сага 03-26)", mat: "Норка", lot: "300687", purchase: "З-2026-0038", qty: 15, docUnit: 10438.43, docTotal: 191023.27 },
    { doc: "Подкладочная ткань №37/130", mat: "Подкладочная ткань №37", lot: null, purchase: LIN, qty: 1.8, docUnit: 3848.85, docTotal: 8452.07 },
  ],
  "192": [
    { doc: "Соболь клеточный XXI 1-2 2 лот 15317 (СП1225)", mat: "Соболь", lot: "15317", purchase: "З-2026-0004", qty: 10, docUnit: 29411.29, docTotal: 358817.74 },
  ],
};

type JOrder = {
  id: string; tz: string; status: string; notes: string | null;
  materialCost: string | null; expenseCost: string | null; totalCost: string | null; unitCost: string | null;
  deletedExpenses: { categoryId: string; amount: string; date: string; description: string | null }[];
  usages: string[]; movements: string[];
  fgMovement: { id: string; totalCost: string; unitCost: string } | null; fgStock: { id: string; avgUnitCost: string } | null;
};
type J = { orders: JOrder[]; lots: { lotId: string; lotNumber: string | null; qty: string }[] };

const rub = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { fullFinishedCost } = await import("../src/lib/finished-goods-cost");
  const { consumeFromLot, returnToLot } = await import("../src/lib/stock");
  const prisma = createAuditedClient("script:writeoff-tz-184-192");
  console.log(ROLLBACK ? "ОТКАТ" : APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН");
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });

  if (ROLLBACK) {
    const j: J = JSON.parse(readFileSync(JOURNAL, "utf8"));
    await prisma.$transaction(async (tx) => {
      for (const o of j.orders) {
        const us = await tx.productionMaterialUsage.findMany({ where: { id: { in: o.usages } } });
        for (const u of us) await returnToLot(tx, { organizationId: org.id, lotId: u.lotId, quantity: u.quantity, notes: "Откат writeoff-tz-184-192" });
        await tx.productionMaterialUsage.deleteMany({ where: { id: { in: o.usages } } });
        await tx.stockMovement.deleteMany({ where: { id: { in: o.movements } } });
        for (const e of o.deletedExpenses) await tx.productionExpense.create({ data: { productionOrderId: o.id, categoryId: e.categoryId, amount: new D(e.amount), date: new Date(e.date), description: e.description } });
        await tx.productionOrder.update({ where: { id: o.id }, data: { status: o.status as never, notes: o.notes, materialCost: o.materialCost, expenseCost: o.expenseCost, totalCost: o.totalCost, unitCost: o.unitCost } });
        if (o.fgMovement) await tx.finishedGoodsMovement.update({ where: { id: o.fgMovement.id }, data: { totalCost: o.fgMovement.totalCost, unitCost: o.fgMovement.unitCost } });
        if (o.fgStock) await tx.finishedGoodsStock.update({ where: { id: o.fgStock.id }, data: { avgUnitCost: o.fgStock.avgUnitCost } });
      }
      // returnToLot пишет движения ADJUSTMENT_IN «Откат…»: убираем их, остаток лота уже возвращён
      await tx.stockMovement.deleteMany({ where: { organizationId: org.id, notes: "Откат writeoff-tz-184-192" } });
    }, { timeout: 180000 });
    console.log("Откат выполнен.");
    await prisma.$disconnect();
    return;
  }
  if (APPLY && existsSync(JOURNAL)) { console.log("Журнал уже есть — сначала --rollback."); await prisma.$disconnect(); return; }

  // 1. Проверка: лот найден, остатка хватает, цена лота × 1,04 = цене в приложении, количество × цена × 1,22 = сумме строки
  const problems: string[] = [], warns: string[] = [];
  const plan: { tz: string; line: Line; lotId: string; lotPriceDoc: number; lotIncl: number }[] = [];
  const need = new Map<string, number>();
  for (const [tz, lines] of Object.entries(TZ)) {
    for (const l of lines) {
      const lots = await prisma.rawMaterialLot.findMany({
        where: { organizationId: org.id, rawMaterial: { name: l.mat }, purchase: { number: l.purchase }, ...(l.lot ? { lotNumber: l.lot } : {}) },
        include: { rawMaterial: true },
      });
      if (lots.length !== 1) { problems.push(`ТЗ ${tz}: ${l.doc}: найдено лотов ${lots.length}`); continue; }
      const lot = lots[0];
      const docPrice = Math.round(Number(lot.materialCostExclVat) * 1.04 * 100) / 100;
      const lotTotal = Math.round(docPrice * l.qty * 1.22 * 100) / 100;
      if (Math.abs(docPrice - l.docUnit) > 0.05) (l.note?.startsWith("СПОРНО") ? warns : problems).push(`ТЗ ${tz}: ${l.doc}: цена в приложении ${rub(l.docUnit)}, лот ${rub(docPrice)}${l.note ? " — " + l.note : ""}`);
      else if (Math.abs(lotTotal - l.docTotal) > 1) warns.push(`ТЗ ${tz}: ${l.doc}: сумма строки ${rub(l.docTotal)}, по лоту ${rub(lotTotal)}`);
      need.set(lot.id, (need.get(lot.id) ?? 0) + l.qty);
      if (Number(lot.quantityRemaining) < (need.get(lot.id) ?? 0)) problems.push(`ТЗ ${tz}: ${l.doc}: в лоте осталось ${lot.quantityRemaining}, нужно всего ${need.get(lot.id)}`);
      plan.push({ tz, line: l, lotId: lot.id, lotPriceDoc: docPrice, lotIncl: Number(lot.unitCost) });
    }
  }
  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: org.id, workOrderNumber: { in: Object.keys(TZ) } },
    include: { expenses: { include: { category: true } }, materialUsages: true }, orderBy: { number: "asc" },
  });
  if (orders.length !== Object.keys(TZ).length) problems.push(`Найдено ТЗ ${orders.length} из ${Object.keys(TZ).length}`);
  for (const o of orders) if (o.materialUsages.length) problems.push(`ТЗ ${o.workOrderNumber}: списания уже есть (${o.materialUsages.length})`);

  // 2. Отчёт: по каждому ТЗ было / станет
  let sumOld = 0, sumNew = 0;
  for (const o of orders) {
    const lines = plan.filter((p) => p.tz === o.workOrderNumber);
    const usageIncl = lines.reduce((s, p) => s + p.lotIncl * p.line.qty, 0);
    const q = o.producedQuantity.gt(0) ? o.producedQuantity : o.plannedQuantity;
    const full = fullFinishedCost({ materialUsages: lines.map((p) => ({ totalCost: new D(p.lotIncl).mul(p.line.qty), commission4: true })), expenses: [], clientWorkPricePerUnit: o.clientWorkPricePerUnit } as never, q);
    const docTotal = lines.reduce((s, p) => s + p.line.docTotal, 0) + Number(o.clientWorkPricePerUnit ?? 0) * Number(q);
    const mv = await prisma.finishedGoodsMovement.findFirst({ where: { productionOrderId: o.id, type: "PRODUCTION_IN" } });
    sumOld += Number(mv?.totalCost ?? 0); sumNew += mv ? Number(full.total) : 0;
    console.log(`ТЗ ${o.workOrderNumber} (${o.number}, ${o.status}): списаний ${lines.length}, сырьё по лотам ${rub(usageIncl)} ₽ с НДС; полная себестоимость ${rub(Number(full.total))} ₽ (по документу ${rub(docTotal)}), приход ГП было ${mv ? rub(Number(mv.totalCost)) : "—"}`);
  }
  console.log(`\nПриход ГП по 184–191: было ${rub(sumOld)} ₽, станет ${rub(sumNew)} ₽ (разница ${rub(sumNew - sumOld)})`);
  const byLot = new Map<string, { n: string; q: number }>();
  for (const p of plan) { const k = p.lotId; byLot.set(k, { n: `${p.line.mat} ${p.line.lot ?? "(без №)"} ${p.line.purchase}`, q: (byLot.get(k)?.q ?? 0) + p.line.qty }); }
  console.log("\nСписание по лотам:"); for (const v of byLot.values()) console.log(`  ${v.n}: ${v.q}`);
  if (warns.length) console.log("\nПредупреждения:\n  " + warns.join("\n  "));
  if (problems.length) { console.log("\nОШИБКИ (ничего не применено):\n  " + problems.join("\n  ")); await prisma.$disconnect(); process.exit(1); }
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась."); await prisma.$disconnect(); return; }

  // 3. Применение
  const journal: J = { orders: [], lots: [] };
  const lotBefore = new Map<string, string>();
  await prisma.$transaction(async (tx) => {
    for (const o of orders) {
      const tz = o.workOrderNumber!;
      const date = o.workOrderDate ?? new Date();
      const entry: JOrder = { id: o.id, tz, status: o.status, notes: o.notes, materialCost: o.materialCost?.toString() ?? null, expenseCost: o.expenseCost?.toString() ?? null,
        totalCost: o.totalCost?.toString() ?? null, unitCost: o.unitCost?.toString() ?? null, deletedExpenses: [], usages: [], movements: [], fgMovement: null, fgStock: null };
      for (const e of o.expenses.filter((e) => e.category.name === MATS || e.category.name === C4)) {
        entry.deletedExpenses.push({ categoryId: e.categoryId, amount: e.amount.toString(), date: e.date.toISOString(), description: e.description });
        await tx.productionExpense.delete({ where: { id: e.id } });
      }
      const rest = o.expenses.filter((e) => e.category.name !== MATS && e.category.name !== C4);
      let material = new D(0);
      const usages: { totalCost: Prisma.Decimal; commission4: boolean }[] = [];
      for (const p of plan.filter((p) => p.tz === tz)) {
        if (!lotBefore.has(p.lotId)) lotBefore.set(p.lotId, (await tx.rawMaterialLot.findUniqueOrThrow({ where: { id: p.lotId } })).quantityRemaining.toString());
        const before = await tx.stockMovement.findMany({ where: { productionOrderId: o.id, lotId: p.lotId }, select: { id: true } });
        const r = await consumeFromLot(tx, { organizationId: org.id, lotId: p.lotId, quantity: p.line.qty, productionOrderId: o.id, notes: `ТЗ ${tz}: ${p.line.doc}` });
        const mv = await tx.stockMovement.findMany({ where: { productionOrderId: o.id, lotId: p.lotId, id: { notIn: before.map((m) => m.id) } }, select: { id: true } });
        for (const m of mv) { entry.movements.push(m.id); await tx.stockMovement.update({ where: { id: m.id }, data: { date } }); }
        const us = await tx.productionMaterialUsage.create({ data: { productionOrderId: o.id, rawMaterialId: r.rawMaterialId, lotId: p.lotId, quantity: p.line.qty, unitCost: r.unitCost, totalCost: r.totalCost, commission4: true, date }, select: { id: true } });
        entry.usages.push(us.id);
        material = material.add(r.totalCost);
        usages.push({ totalCost: r.totalCost, commission4: true });
      }
      const extra = rest.reduce((s, e) => s.add(e.amount), new D(0));
      const notes = (o.notes ?? "").replace(/Материалы заказчика \(на склад не списаны[^)]*\)/, "Материалы заказчика (списаны со склада по лотам 30.10.2026, scripts/writeoff-tz-184-192)");
      const completed = o.status === "COMPLETED";
      await tx.productionOrder.update({
        where: { id: o.id },
        data: completed
          ? { notes, materialCost: material, expenseCost: extra, totalCost: material.add(extra), unitCost: material.add(extra).div(o.plannedQuantity) }
          : { notes, status: o.status === "PLANNED" ? "IN_PROGRESS" : o.status, materialCost: null, expenseCost: null, totalCost: null, unitCost: null },
      });
      const mv = await tx.finishedGoodsMovement.findFirst({ where: { productionOrderId: o.id, type: "PRODUCTION_IN" } });
      if (mv) {
        const q = o.producedQuantity.gt(0) ? o.producedQuantity : o.plannedQuantity;
        const full = fullFinishedCost({ materialUsages: usages, expenses: rest, clientWorkPricePerUnit: o.clientWorkPricePerUnit } as never, q);
        entry.fgMovement = { id: mv.id, totalCost: mv.totalCost.toString(), unitCost: mv.unitCost.toString() };
        await tx.finishedGoodsMovement.update({ where: { id: mv.id }, data: { totalCost: full.total, unitCost: full.total.div(q) } });
        const st = await tx.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: mv.warehouseId, productModelId: mv.productModelId } } });
        if (st && st.quantity.gt(0)) {
          entry.fgStock = { id: st.id, avgUnitCost: st.avgUnitCost.toString() };
          const avg = st.quantity.mul(st.avgUnitCost).sub(mv.totalCost).add(full.total).div(st.quantity);
          await tx.finishedGoodsStock.update({ where: { id: st.id }, data: { avgUnitCost: avg.isNegative() ? new D(0) : avg } });
        }
      }
      journal.orders.push(entry);
    }
    for (const [lotId, before] of lotBefore) {
      const lot = await tx.rawMaterialLot.findUniqueOrThrow({ where: { id: lotId } });
      if (lot.quantityRemaining.isNegative()) throw new Error(`Лот ${lot.lotNumber}: остаток ниже 0 — откат`);
      journal.lots.push({ lotId, lotNumber: lot.lotNumber, qty: new D(before).sub(lot.quantityRemaining).toString() });
    }
  }, { timeout: 180000, maxWait: 15000 });
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 1));
  console.log(`\nПрименено: ТЗ ${journal.orders.length}, списаний ${journal.orders.reduce((s, o) => s + o.usages.length, 0)}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
