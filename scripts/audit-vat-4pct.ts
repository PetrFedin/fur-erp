/**
 * Аудит НДС и 4% по ТЗ (только чтение). Запуск: npx tsx scripts/audit-vat-4pct.ts [номер ТЗ П-2026-0136 ...]
 * Считает теми же функциями, что интерфейс (lib/commission4, lib/tz-vat), и сверяет с независимым пересчётом:
 *  - ставка НДС лота против года закупки (2025 → 20, 2026 → 22);
 *  - ставки НДС в списаниях каждого ТЗ (только 20 / только 22 / смешанные / без списаний);
 *  - Σ с НДС = Σ totalCost; Σ без НДС = Σ количество × цена лота без НДС; расхождение цены списания и лота;
 *  - надбавка 4% = 4% × (сырьё + подкладка со строк commission4 = true); работа и расходы не облагаются.
 */
import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { sumUsagesWith4, base4AndExtra } from "../src/lib/commission4";
import { vatBreakdown } from "../src/lib/tz-vat";
import { lotUnitCostExclVat } from "../src/lib/purchase-totals";

const prisma = new PrismaClient();
const f = (d: Decimal.Value) => new Decimal(d).toFixed(2);

async function main() {
  const only = process.argv.slice(2);
  // 1) лоты: ставка против года закупки
  const lots = await prisma.rawMaterialLot.findMany({
    include: { purchase: { select: { number: true, orderDate: true } }, rawMaterial: { select: { name: true } } },
  });
  const expected = (y: number) => (y <= 2025 ? 20 : 22);
  const bad = lots.filter((l) => l.purchase && Number(l.vatRate) !== expected(l.purchase.orderDate.getUTCFullYear()));
  console.log(`Лотов: ${lots.length}; ставка не по году закупки: ${bad.length}`);
  for (const l of bad) console.log(`  ${l.purchase!.number} (${l.purchase!.orderDate.toISOString().slice(0, 10)}) лот ${l.lotNumber ?? "—"} ${l.rawMaterial.name}: НДС ${l.vatRate}%`);

  // 2) ТЗ
  const orders = await prisma.productionOrder.findMany({
    where: only.length ? { number: { in: only } } : {},
    include: {
      materialUsages: { include: { rawMaterial: true, lot: true } },
      expenses: true,
    },
    orderBy: { number: "asc" },
  });
  const kinds = new Map<string, string[]>();
  let usageUnitDiff = 0;
  for (const o of orders) {
    const b = vatBreakdown(o.materialUsages, "off");
    const k = b.kind;
    kinds.set(k, [...(kinds.get(k) ?? []), o.workOrderNumber ?? o.number]);
    // инварианты
    const incl = o.materialUsages.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
    const excl = o.materialUsages.reduce((s, u) => s.add(new Decimal(u.quantity).mul(lotUnitCostExclVat(u.lot))), new Decimal(0));
    const sumRows = b.rows.reduce((s, r) => ({ i: s.i.add(r.incl), e: s.e.add(r.excl) }), { i: new Decimal(0), e: new Decimal(0) });
    if (!sumRows.i.sub(incl).abs().lessThan(0.005) || !sumRows.e.sub(excl).abs().lessThan(0.005)) console.log(`  ! ТЗ ${o.workOrderNumber}: разбивка по ставкам не сходится с суммой строк`);
    for (const u of o.materialUsages) if (new Decimal(u.unitCost).sub(u.lot.unitCost).abs().greaterThan(0.01)) usageUnitDiff++;
    if (only.length) {
      const fur = o.materialUsages.filter((u) => u.rawMaterial.unit !== "M");
      const lin = o.materialUsages.filter((u) => u.rawMaterial.unit === "M");
      const on = [sumUsagesWith4(fur, "on"), sumUsagesWith4(lin, "on")];
      const c = base4AndExtra(o.materialUsages);
      const expSum = o.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
      const extraIncl = on[0].extraIncl.add(on[1].extraIncl);
      const extraExcl = on[0].extraExcl.add(on[1].extraExcl);
      console.log(`\nТЗ ${o.workOrderNumber} (${o.number}) НДС: ${b.rows.map((r) => `${r.rate}%: ${r.lines} стр., с НДС ${f(r.incl)}, без ${f(r.excl)}`).join(" | ") || "нет списаний"}`);
      console.log(`  сырьё+подкладка без 4%: с НДС ${f(incl)}, без НДС ${f(excl)}; база 4% (commission4=true) ${f(c.base)}; вне 4% ${f(c.excluded)}`);
      console.log(`  надбавка 4%: с НДС ${f(extraIncl)} (ручной = база × 0,04 = ${f(c.base.mul(0.04))}), без НДС ${f(extraExcl)}; расходы ${f(expSum)} (4% не облагаются)`);
      console.log(`  итого материалы с 4%: с НДС ${f(on[0].incl.add(on[1].incl))}, без НДС ${f(on[0].excl.add(on[1].excl))}`);
    }
  }
  if (!only.length) {
    for (const [k, v] of kinds) console.log(`ТЗ [${k}]: ${v.length} шт.${k === "mixed" || k === "none" ? " — " + v.join(", ") : ""}`);
    console.log(`Списаний, где цена списания ≠ цене лота (>0,01 ₽): ${usageUnitDiff}`);
  }
}

main().finally(() => prisma.$disconnect());
