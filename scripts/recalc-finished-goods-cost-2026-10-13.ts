/**
 * Пересчёт стоимости остатков готовой продукции (склад ГП) по ПОЛНОЙ себестоимости: сырьё и подкладка + 4% + расходы + работа.
 * Решение владельца: «ценообразование от полной стоимости с 4 %». Новые завершения ТЗ уже ставят на склад полную стоимость
 * (src/lib/finished-goods-cost.ts); этот скрипт приводит к ней уже завершённые ТЗ, по которым на складе ГП есть остаток.
 *
 * Меняется ТОЛЬКО склад ГП: FinishedGoodsStock.avgUnitCost и новые движения FinishedGoodsMovement (quantity = 0, ADJUSTMENT_IN / ADJUSTMENT_OUT,
 * пометка «Себестоимость ГП: с работой и 4%»). Снимок ТЗ (ProductionOrder.totalCost / unitCost), Главная, партии и «Изделия» НЕ затрагиваются.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/recalc-finished-goods-cost-2026-10-13.ts            # пробный прогон (БД не меняется): «было → стало» по каждому ТЗ и по складу
 *   node --env-file=.env node_modules/.bin/tsx scripts/recalc-finished-goods-cost-2026-10-13.ts --apply    # применить (перед этим scripts/backup.sh; --no-backup — только для тестовой БД)
 *   node --env-file=.env node_modules/.bin/tsx scripts/recalc-finished-goods-cost-2026-10-13.ts --rollback            # откат по журналу (пробный)
 *   node --env-file=.env node_modules/.bin/tsx scripts/recalc-finished-goods-cost-2026-10-13.ts --rollback --apply    # откат: удаляет созданные движения и возвращает среднюю стоимость
 *
 * Как считается «было»: сумма движений ГП по ТЗ (приход минус списание-корректировка); если движений нет (ТЗ завершено импортом) — снимок ТЗ (totalCost).
 * «Стало»: fullFinishedCost (мех/подкладка + 4% у строк с commission4 + расходы + цена работы × выпуск). Шкуры подрядчика не входят (в ТЗ не списаны).
 * ТЗ, у которых уже есть пометка (завершены после изменения или пересчитаны), пропускаются — повторный запуск ничего не меняет.
 * Журнал: docs-inventory/corrections-journal-recalc-fg-cost-2026-10-13.json.
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");

type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string;
  stocks: { stockId: string; model: string; avgBefore: string; avgAfter: string }[];
  movements: string[];
  orders: { id: string; tz: string; was: string; now: string; delta: string }[];
};

const rub = (n: { toString(): string } | number) => Number(n.toString()).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { Decimal } = await import("@prisma/client/runtime/library");
  const { FG_FULL_COST_NOTE, fullFinishedCost, orderStockContribution } = await import("../src/lib/finished-goods-cost");
  const prisma = createAuditedClient("script:recalc-finished-goods-cost-2026-10-13");
  const JOURNAL = join(INV, "corrections-journal-recalc-fg-cost-2026-10-13.json");

  // ----- Откат -----
  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат пересчёта склада ГП от ${j.at}: движений ${j.movements.length}, остатков ${j.stocks.length}`);
    const problems: string[] = [];
    for (const s of j.stocks) {
      const cur = await prisma.finishedGoodsStock.findUnique({ where: { id: s.stockId } });
      if (!cur) { problems.push(`остаток ${s.model}: запись удалена`); continue; }
      const same = new Decimal(cur.avgUnitCost).sub(s.avgAfter).abs().lt(0.01);
      console.log(`  ${s.model}: ${rub(cur.avgUnitCost)} → ${rub(s.avgBefore)} ₽/шт.${same ? "" : "  (!) после пересчёта стоимость менялась — откат остановлен"}`);
      if (!same) problems.push(`остаток ${s.model}: после пересчёта стоимость менялась`);
    }
    if (problems.length) { console.log("\nОткат невозможен автоматически:\n - " + problems.join("\n - ")); await prisma.$disconnect(); process.exitCode = 1; return; }
    if (!APPLY) { console.log("\nПробный откат. Для выполнения добавьте --apply."); await prisma.$disconnect(); return; }
    await prisma.$transaction(async (tx) => {
      await tx.finishedGoodsMovement.deleteMany({ where: { id: { in: j.movements } } });
      for (const s of j.stocks) await tx.finishedGoodsStock.update({ where: { id: s.stockId }, data: { avgUnitCost: s.avgBefore } });
    });
    writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
    console.log("Откат выполнен.");
    await prisma.$disconnect();
    return;
  }

  const prev = readJson<Journal | null>(JOURNAL, null);
  if (APPLY && prev?.status === "applied") { console.log("Пересчёт уже применён (журнал). Сначала откат: --rollback --apply."); await prisma.$disconnect(); return; }

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("нет организации");

  const stocks = await prisma.finishedGoodsStock.findMany({
    where: { organizationId: org.id, quantity: { gt: 0 } },
    include: { productModel: { select: { name: true } } },
    orderBy: { productModelId: "asc" },
  });
  console.log(`Остатков готовой продукции с количеством > 0: ${stocks.length}\n`);

  type Plan = { stock: (typeof stocks)[number]; orders: { id: string; tz: string; was: InstanceType<typeof Decimal>; now: InstanceType<typeof Decimal>; delta: InstanceType<typeof Decimal>; basis: string }[]; delta: InstanceType<typeof Decimal> };
  const plans: Plan[] = [];
  for (const st of stocks) {
    const orders = await prisma.productionOrder.findMany({
      where: { organizationId: org.id, status: "COMPLETED", productModelId: st.productModelId, finishedWarehouseId: st.warehouseId, producedQuantity: { gt: 0 } },
      include: { materialUsages: true, expenses: true },
      orderBy: { number: "asc" },
    });
    const rows: Plan["orders"] = [];
    for (const o of orders) {
      const c = await orderStockContribution(prisma as never, o.id);
      if (c.marked) continue;
      const was = c.count === 0 ? (o.totalCost ?? new Decimal(0)) : c.net;
      const now = fullFinishedCost(o, o.producedQuantity).total;
      rows.push({ id: o.id, tz: o.workOrderNumber ?? o.number, was, now, delta: now.sub(was), basis: c.count === 0 ? "снимок ТЗ" : "движения ГП" });
    }
    if (rows.length === 0) continue;
    plans.push({ stock: st, orders: rows, delta: rows.reduce((s, r) => s.add(r.delta), new Decimal(0)) });
  }

  let totalDelta = new Decimal(0);
  for (const p of plans) {
    const st = p.stock;
    const valueBefore = st.quantity.mul(st.avgUnitCost);
    const avgAfter = valueBefore.add(p.delta).div(st.quantity);
    console.log(`${st.productModel.name}: остаток ${rub(st.quantity)} шт., средняя ${rub(st.avgUnitCost)} → ${rub(avgAfter)} ₽/шт. (стоимость остатка ${rub(valueBefore)} → ${rub(valueBefore.add(p.delta))} ₽, ${p.delta.gte(0) ? "+" : ""}${rub(p.delta)})`);
    for (const r of p.orders) console.log(`    ТЗ ${r.tz}: было ${rub(r.was)} → стало ${rub(r.now)} ₽ (${r.delta.gte(0) ? "+" : ""}${rub(r.delta)}; база: ${r.basis})`);
    totalDelta = totalDelta.add(p.delta);
  }
  console.log(`\nИтого по складу ГП: ${totalDelta.gte(0) ? "+" : ""}${rub(totalDelta)} ₽; ТЗ к пересчёту: ${plans.reduce((n, p) => n + p.orders.length, 0)}; остатков затронуто: ${plans.length}`);
  console.log("Главная, партии и «Изделия» не меняются: снимок ТЗ (totalCost / unitCost) не трогается.");

  if (!APPLY) { console.log("\nПробный прогон: база не изменена. Для применения добавьте --apply (перед этим будет сделана копия scripts/backup.sh)."); await prisma.$disconnect(); return; }
  if (plans.length === 0) { console.log("Нечего применять."); await prisma.$disconnect(); return; }
  if (!NO_BACKUP) { console.log("\nКопия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }

  const journal: Journal = { script: "recalc-finished-goods-cost-2026-10-13.ts", status: "applied", at: new Date().toISOString(), stocks: [], movements: [], orders: [] };
  await prisma.$transaction(async (tx) => {
    for (const p of plans) {
      const st = await tx.finishedGoodsStock.findUniqueOrThrow({ where: { id: p.stock.id } });
      const avgAfter = st.quantity.mul(st.avgUnitCost).add(p.delta).div(st.quantity);
      await tx.finishedGoodsStock.update({ where: { id: st.id }, data: { avgUnitCost: avgAfter } });
      journal.stocks.push({ stockId: st.id, model: p.stock.productModel.name, avgBefore: st.avgUnitCost.toString(), avgAfter: avgAfter.toString() });
      for (const r of p.orders) {
        // Даже при нулевой разнице пишем движение-пометку (сумма 0): с него ТЗ ведётся на складе по полной себестоимости.
        const o = await tx.productionOrder.findUniqueOrThrow({ where: { id: r.id }, select: { producedQuantity: true } });
        const mv = await tx.finishedGoodsMovement.create({
          data: {
            organizationId: org.id, warehouseId: st.warehouseId, productModelId: st.productModelId,
            type: r.delta.gte(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", quantity: 0,
            unitCost: r.delta.abs().div(o.producedQuantity), totalCost: r.delta.abs(), productionOrderId: r.id,
            notes: `Пересчёт склада ГП по полной себестоимости (с работой и 4%) — scripts/recalc-finished-goods-cost-2026-10-13.ts. ${FG_FULL_COST_NOTE}`,
          },
        });
        journal.movements.push(mv.id);
        journal.orders.push({ id: r.id, tz: r.tz, was: r.was.toString(), now: r.now.toString(), delta: r.delta.toString() });
      }
    }
  });
  writeJson(JOURNAL, journal);
  console.log(`\nПрименено: движений ${journal.movements.length}, остатков ${journal.stocks.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
