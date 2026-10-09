/**
 * Подкладка: цена списаний в ТЗ приведена к цене лота (lot.unitCost). Раньше списания хранили круглые 2 140 ₽/м, а лоты после
 * fix-lining-unitcost.ts — цены по документам (2 140,00 … 2 143,79); в ТЗ рядом стояли две разные цены подкладки.
 * Меняется: списание (unitCost, totalCost = кол-во × цена лота) и снимки ТЗ (materialCost, totalCost, unitCost), если они были заполнены
 * и сходились со списаниями. Количество, лоты и остатки не меняются.
 *   node --env-file=.env node_modules/.bin/tsx scripts/fix-lining-usage-cost.ts [--apply | --rollback --apply]
 * Журнал: docs-inventory/corrections-journal-fix-lining-usage-cost.json
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-fix-lining-usage-cost.json");
const r2 = (n: number) => Math.round(n * 100) / 100;
type Snap = { materialCost: string | null; totalCost: string | null; unitCost: string | null };
type J = { time: string; usages: { id: string; unitCost: string; totalCost: string }[]; orders: { id: string; before: Snap }[]; rolledBack?: string };

(async () => {
  try {
    if (ROLLBACK) {
      const j: J = JSON.parse(readFileSync(JOURNAL, "utf-8"));
      if (j.rolledBack) return console.log("Уже откачено");
      if (!APPLY) return console.log(`Будет откачено: списаний ${j.usages.length}, ТЗ ${j.orders.length} (добавьте --apply)`);
      await prisma.$transaction(async (tx) => {
        for (const u of j.usages) await tx.productionMaterialUsage.update({ where: { id: u.id }, data: { unitCost: u.unitCost, totalCost: u.totalCost } });
        for (const o of j.orders) await tx.productionOrder.update({ where: { id: o.id }, data: o.before });
      });
      j.rolledBack = new Date().toISOString();
      writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
      return console.log("Откачено");
    }
    if (existsSync(JOURNAL) && !JSON.parse(readFileSync(JOURNAL, "utf-8")).rolledBack) return console.log("Уже применено");

    const usages = await prisma.productionMaterialUsage.findMany({ where: { rawMaterial: { unit: "M" } }, include: { lot: true, productionOrder: { include: { materialUsages: true, expenses: true } } } });
    const todo = usages.map((u) => ({ u, unit: Number(u.lot.unitCost), tot: r2(Number(u.quantity) * Number(u.lot.unitCost)) })).filter((x) => Math.abs(x.tot - Number(x.u.totalCost)) > 0.004);
    const byOrder = new Map<string, typeof todo>();
    for (const x of todo) byOrder.set(x.u.productionOrderId, [...(byOrder.get(x.u.productionOrderId) ?? []), x]);

    let sum = 0;
    const orderOps: { id: string; number: string; before: Snap; after: Snap; note: string }[] = [];
    for (const [id, xs] of byOrder) {
      const o = xs[0].u.productionOrder;
      const delta = r2(xs.reduce((s, x) => s + (x.tot - Number(x.u.totalCost)), 0));
      sum += delta;
      const before: Snap = { materialCost: o.materialCost?.toString() ?? null, totalCost: o.totalCost?.toString() ?? null, unitCost: o.unitCost?.toString() ?? null };
      let after = before, note = "снимков нет";
      if (o.totalCost != null) {
        const usagesSum = o.materialUsages.reduce((s, u) => s + Number(u.totalCost), 0);
        const exp = o.expenses.reduce((s, e) => s + Number(e.amount), 0);
        const consistent = Math.abs(Number(o.totalCost) - usagesSum - exp) < 0.02;
        if (!consistent) note = "снимок не сходился со списаниями — не трогаем";
        else {
          const tc = r2(Number(o.totalCost) + delta);
          const qty = Number(o.producedQuantity) || Number(o.plannedQuantity) || 0;
          const unitOk = o.unitCost != null && qty > 0 && Math.abs(Number(o.unitCost) - Number(o.totalCost) / qty) < 0.02;
          after = { materialCost: o.materialCost != null ? r2(Number(o.materialCost) + delta).toString() : null, totalCost: tc.toString(), unitCost: unitOk ? r2(tc / qty).toString() : before.unitCost };
          note = unitOk ? "снимки обновлены" : "снимок unitCost не равен totalCost ÷ кол-во — оставлен";
        }
      }
      orderOps.push({ id, number: o.number, before, after, note });
      console.log(`${o.number}: ${xs.map((x) => `${x.u.quantity} м: ${x.u.unitCost} → ${x.unit}`).join("; ")}  Δ ${delta}  [${note}]`);
    }
    console.log(`\nСписаний к правке: ${todo.length} из ${usages.length}, ТЗ: ${byOrder.size}, Σ изменения ${r2(sum)} ₽`);
    if (!APPLY) return console.log("Пробный прогон: ничего не записано");

    const journal: J = { time: new Date().toISOString(), usages: todo.map((x) => ({ id: x.u.id, unitCost: x.u.unitCost.toString(), totalCost: x.u.totalCost.toString() })), orders: orderOps.map((o) => ({ id: o.id, before: o.before })) };
    writeFileSync(JOURNAL, JSON.stringify(journal, null, 1));
    await prisma.$transaction(async (tx) => {
      for (const x of todo) await tx.productionMaterialUsage.update({ where: { id: x.u.id }, data: { unitCost: x.unit, totalCost: x.tot } });
      for (const o of orderOps) if (o.after !== o.before) await tx.productionOrder.update({ where: { id: o.id }, data: o.after });
    });
    console.log("Готово. Журнал записан.");
  } finally {
    await prisma.$disconnect();
  }
})();
