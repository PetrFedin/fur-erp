/**
 * ПОДКЛАДКА ИЗ НОВОЙ ПОСТАВКИ 05.26 В ТЗ 119–168: в приложениях к ТЗ (папка «Производство меховых изделий», извлечения
 * docs-inventory/extract/prod2026.json) подкладка записана «№N/130» по 3 848,85 ₽/м без НДС = цена лота 4 515 ₽/м с НДС × 1,04 (4%) ÷ 1,22.
 * В базе по этим ТЗ списания подкладки не было, и дорогая подкладка 05.26 нигде не учитывалась (остаток лотов = приход).
 * Скрипт заводит списания: ткань и количество из документа, лот — «Подкладка 05.26», цена = цена лота (без 4%), 4% начисляется флагом, как у остальных.
 * Остаток лота уменьшается на списанное; снимки ТЗ (materialCost/totalCost/unitCost) обновляются, если они были и сходились со списаниями.
 * ТЗ 146 (шерсть/альпака/шёлк, 2 м по 5 954,43 ₽ без НДС) — иной материал, не из лотов 05.26: не трогаем, вопрос владельцу.
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-new-lining-usage.ts [--apply | --rollback --apply]
 * Журнал: docs-inventory/corrections-journal-new-lining-usage.json
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-new-lining-usage.json");
const AUCTION = "Подкладка 05.26";
const r2 = (n: number) => Math.round(n * 100) / 100;
/** [№ ТЗ, № ткани, метров, итог по документу с НДС и 4%]. */
const ITEMS: Array<[number, string, number, number]> = [
  [119, "27", 18, 84520.75],
  [121, "23", 9, 42260.37],
  [132, "24", 3, 14086.79],
  [133, "41", 3.6, 16904.15],
  [136, "2", 17.6, 82642.51],
  [137, "41", 12, 56347.16],
  [138, "2", 4.4, 20660.63],
  [139, "24", 0.9, 4226.04],
  [140, "24", 3.6, 16904.15],
  [141, "24", 4.8, 22538.87],
  [142, "24", 1.8, 8452.07],
  [143, "24", 2.4, 11269.43],
  [144, "24", 2.4, 11269.43],
  [145, "24", 0.8, 3756.48],
  [147, "37", 2.4, 11269.43],
  [148, "37", 3.6, 16904.15],
  [150, "2", 3.85, 18078.05],
  [152, "24", 3.6, 16904.15],
  [153, "24", 3.6, 16904.15],
  [154, "37", 17.6, 82642.51],
  [155, "24", 15.4, 72312.19],
  [157, "24", 0.9, 4226.04],
  [158, "23", 5.4, 25356.22],
  [165, "24", 0.9, 4226.04],
  [167, "37", 3.6, 16904.15],
  [168, "24", 5.4, 25356.22],
];
type Snap = { materialCost: string | null; totalCost: string | null; unitCost: string | null };
type J = { time: string; usages: string[]; lots: { id: string; remaining: string }[]; orders: { id: string; before: Snap }[]; rolledBack?: string };

(async () => {
  try {
    if (ROLLBACK) {
      const j: J = JSON.parse(readFileSync(JOURNAL, "utf-8"));
      if (j.rolledBack) return console.log("Уже откачено");
      if (!APPLY) return console.log(`Будет откачено: списаний ${j.usages.length}, лотов ${j.lots.length}, ТЗ ${j.orders.length} (добавьте --apply)`);
      await prisma.$transaction(async (tx) => {
        await tx.productionMaterialUsage.deleteMany({ where: { id: { in: j.usages } } });
        for (const l of j.lots) await tx.rawMaterialLot.update({ where: { id: l.id }, data: { quantityRemaining: l.remaining } });
        for (const o of j.orders) await tx.productionOrder.update({ where: { id: o.id }, data: o.before });
      });
      j.rolledBack = new Date().toISOString();
      writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
      return console.log("Откачено");
    }
    if (existsSync(JOURNAL) && !JSON.parse(readFileSync(JOURNAL, "utf-8")).rolledBack) return console.log("Уже применено");

    const lots = await prisma.rawMaterialLot.findMany({ where: { rawMaterial: { unit: "M" }, purchase: { auctionSession: AUCTION } }, include: { rawMaterial: true } });
    const lotOf = (n: string) => { const l = lots.filter((x) => new RegExp(`№\\s*${n}$`).test(x.rawMaterial.name.trim())); if (l.length !== 1) throw new Error(`Ткань №${n}: лотов 05.26 найдено ${l.length}`); return l[0]; };
    const need = new Map<string, number>();
    const plan: Array<{ tz: number; order: Awaited<ReturnType<typeof prisma.productionOrder.findFirstOrThrow>> & { materialUsages: { totalCost: unknown }[]; expenses: { amount: unknown }[] }; lot: (typeof lots)[number]; m: number; total: number; docTotal: number }> = [];
    for (const [tz, fab, m, docTotal] of ITEMS) {
      const order = await prisma.productionOrder.findFirstOrThrow({ where: { workOrderNumber: String(tz) }, include: { materialUsages: true, expenses: true } });
      const lot = lotOf(fab);
      const exists = await prisma.productionMaterialUsage.count({ where: { productionOrderId: order.id, rawMaterial: { unit: "M" } } });
      if (exists) throw new Error(`ТЗ ${tz}: подкладка уже списана — остановлено, нужен ручной разбор`);
      const total = r2(m * Number(lot.unitCost));
      need.set(lot.id, (need.get(lot.id) ?? 0) + m);
      plan.push({ tz, order: order as never, lot, m, total, docTotal });
    }
    for (const [id, q] of need) { const l = lots.find((x) => x.id === id)!; if (q > Number(l.quantityRemaining) + 0.0001) throw new Error(`${l.rawMaterial.name}: нужно ${q} м, в лоте ${l.quantityRemaining}`); }

    let sum = 0, sumDoc = 0;
    for (const p of plan) {
      const withFour = r2(p.total * 1.04);
      sum += p.total; sumDoc += p.docTotal;
      console.log(`ТЗ ${p.tz} ${p.order.number} [${p.order.status}]: ${p.lot.rawMaterial.name} ${p.m} м × ${p.lot.unitCost} = ${p.total} (с 4% ${withFour}; документ ${p.docTotal} ${Math.abs(withFour - p.docTotal) < 0.05 ? "✓" : "✗ Δ " + r2(p.docTotal - withFour)})`);
    }
    console.log(`\nИтого: ${plan.length} ТЗ, ${r2(plan.reduce((s, p) => s + p.m, 0))} м, ${r2(sum)} ₽ без 4% (по документам с 4%: ${r2(sumDoc)})`);
    for (const [id, q] of need) { const l = lots.find((x) => x.id === id)!; console.log(`  ${l.rawMaterial.name}: остаток ${l.quantityRemaining} → ${r2(Number(l.quantityRemaining) - q)} м`); }
    if (!APPLY) return console.log("Пробный прогон: ничего не записано");

    const journal: J = { time: new Date().toISOString(), usages: [], lots: Array.from(need.keys()).map((id) => ({ id, remaining: lots.find((x) => x.id === id)!.quantityRemaining.toString() })), orders: [] };
    await prisma.$transaction(async (tx) => {
      for (const p of plan) {
        const o = p.order;
        const u = await tx.productionMaterialUsage.create({ data: { productionOrderId: o.id, rawMaterialId: p.lot.rawMaterialId, lotId: p.lot.id, quantity: p.m, unitCost: p.lot.unitCost, totalCost: p.total, date: o.startDate ?? o.createdAt, commission4: true } });
        journal.usages.push(u.id);
        if (o.totalCost != null) {
          const usagesSum = o.materialUsages.reduce((s, x) => s + Number(x.totalCost), 0);
          const exp = o.expenses.reduce((s, e) => s + Number(e.amount), 0);
          const before: Snap = { materialCost: o.materialCost?.toString() ?? null, totalCost: o.totalCost.toString(), unitCost: o.unitCost?.toString() ?? null };
          journal.orders.push({ id: o.id, before });
          if (Math.abs(Number(o.totalCost) - usagesSum - exp) < 0.02) {
            const tc = r2(Number(o.totalCost) + p.total);
            const qty = Number(o.producedQuantity) || Number(o.plannedQuantity) || 0;
            const unitOk = o.unitCost != null && qty > 0 && Math.abs(Number(o.unitCost) - Number(o.totalCost) / qty) < 0.02;
            await tx.productionOrder.update({ where: { id: o.id }, data: { materialCost: o.materialCost != null ? r2(Number(o.materialCost) + p.total) : null, totalCost: tc, unitCost: unitOk ? r2(tc / qty) : o.unitCost } });
          } else console.log(`  ТЗ ${p.tz}: снимок не сходился со списаниями — не обновлён`);
        }
      }
      for (const [id, q] of need) await tx.rawMaterialLot.update({ where: { id }, data: { quantityRemaining: { decrement: q } } });
    });
    writeFileSync(JOURNAL, JSON.stringify(journal, null, 1));
    console.log("Готово. Журнал записан.");
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e.message ?? e); process.exit(1); });
