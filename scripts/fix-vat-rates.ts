/**
 * НДС шкур подрядчика (Веллмех) в закупках З-2026-0010 и З-2026-0011: 22% -> 20% по счетам на доплату.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/fix-vat-rates.ts            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/fix-vat-rates.ts --apply    # после scripts/backup.sh
 *   node --env-file=.env node_modules/.bin/tsx scripts/fix-vat-rates.ts --rollback
 *
 * Основание (Drive «мех», счета ООО «ВеллМех» → ООО «Меркури Мода», договор подряда №1605):
 *  - счёт №235 от 04.12.2025 (доплата партия 5, 5 669 120 ₽ — в неё входят шкуры 4 584 500): «В том числе НДС 20%»;
 *  - счёт №239 от 18.12.2025 (доплата партия 6, 946 870 ₽ — в неё входят шкуры 463 750): «В том числе НДС 20%».
 * Счета №1 (15.01.2026, партия 7) и №7 (04.02.2026, партия 9) — НДС 22%: З-2026-0012/0013 остаются 22%.
 * Сумма с НДС (цена 13 250 ₽/шк.), unitCost, totalCost лота и списания по ТЗ НЕ меняются — меняется только разбивка
 * «без НДС / НДС»: lot.vatRate, materialCostExclVat, materialVatAmount; PurchaseItem.vatRate, unitPrice, subtotal.
 * Арифметика как в updatePurchaseItem: excl = incl / (1+ставка). Журнал: docs-inventory/corrections-journal-vat-rates.json
 * Бобр З-2026-0063 (НДС 0% как в источнике): в примечание позиций дописывается «ставка ждёт инвойса».
 */
import { join } from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";

const prisma = new PrismaClient();
const D = Prisma.Decimal;
const APPLY = process.argv.includes("--apply");
const JOURNAL = join(INV, "corrections-journal-vat-rates.json");
const TARGETS: Record<string, { rate: number; doc: string }> = {
  "З-2026-0010": { rate: 20, doc: "счёт №235 от 04.12.2025: НДС 20% (доплата партии 5 со шкурами подрядчика 4 584 500)" },
  "З-2026-0011": { rate: 20, doc: "счёт №239 от 18.12.2025: НДС 20% (доплата партии 6 со шкурами подрядчика 463 750)" },
};
const BEAVER_NOTE = "[vat:note] Ставка НДС 0% — как в источнике (отчёт 08.06.2026); ставка ждёт инвойса.";
const FIX_TAG = "[fix-vat]";

type Entry = {
  purchase: string; itemId: string; lotId: string; doc: string;
  item: { vatRate: string; unitPrice: string; subtotal: string; notes: string | null };
  lot: { vatRate: string; materialCostExclVat: string; materialVatAmount: string };
  newItem: { vatRate: string; unitPrice: string; subtotal: string; notes: string };
  newLot: { vatRate: string; materialCostExclVat: string; materialVatAmount: string };
};
type Journal = { script: string; appliedAt?: string; entries: Entry[]; beaver: Array<{ itemId: string; old: string | null; new: string }> };

async function totals() {
  const lots = await prisma.rawMaterialLot.findMany({ where: { purchase: { number: { in: Object.keys(TARGETS) } } } });
  const q = (await prisma.productionMaterialUsage.aggregate({ _sum: { totalCost: true }, where: { lotId: { in: lots.map((l) => l.id) } } }))._sum.totalCost;
  const items = await prisma.purchaseItem.findMany({ where: { purchase: { number: { in: Object.keys(TARGETS) } } } });
  const allU = (await prisma.productionMaterialUsage.aggregate({ _sum: { totalCost: true } }))._sum.totalCost;
  const allL = (await prisma.rawMaterialLot.aggregate({ _sum: { totalCost: true, materialVatAmount: true } }))._sum;
  return {
    lotsTotalCost: lots.reduce((a, l) => a.add(l.totalCost), new D(0)).toFixed(2),
    lotsExclVatTotal: lots.reduce((a, l) => a.add(l.materialCostExclVat.mul(l.quantityReceived)), new D(0)).toFixed(2),
    lotsVatTotal: lots.reduce((a, l) => a.add(l.materialVatAmount.mul(l.quantityReceived)), new D(0)).toFixed(2),
    itemsSubtotalExcl: items.reduce((a, i) => a.add(i.subtotal), new D(0)).toFixed(2),
    itemsInclVat: items.reduce((a, i) => a.add(i.subtotal.mul(i.vatRate).div(100).add(i.subtotal)), new D(0)).toFixed(2),
    usageOfTheseLots: String(q ?? 0),
    usageAllOrders: String(allU ?? 0),
    allLotsTotalCost: String(allL.totalCost ?? 0),
  };
}

async function rollback() {
  const j = readJson<Journal>(JOURNAL, { script: "", entries: [], beaver: [] });
  for (const e of j.entries) {
    await prisma.rawMaterialLot.update({ where: { id: e.lotId }, data: e.lot });
    await prisma.purchaseItem.update({ where: { id: e.itemId }, data: { vatRate: e.item.vatRate, unitPrice: e.item.unitPrice, subtotal: e.item.subtotal, notes: e.item.notes } });
  }
  for (const b of j.beaver) await prisma.purchaseItem.update({ where: { id: b.itemId }, data: { notes: b.old } });
  console.log(`Откат: ${j.entries.length} лотов/позиций, ${j.beaver.length} позиций бобра`);
  writeJson(JOURNAL, { script: "fix-vat-rates.ts", appliedAt: new Date().toISOString(), entries: [], beaver: [] });
}

async function main() {
  if (process.argv.includes("--rollback")) return rollback();
  const before = await totals();
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN ==", "ДО:", before);
  const entries: Entry[] = [];
  for (const [num, t] of Object.entries(TARGETS)) {
    const items = await prisma.purchaseItem.findMany({ where: { purchase: { number: num } }, include: { lot: true } });
    for (const it of items) {
      const lot = it.lot;
      if (!lot) { console.log(`  пропуск ${num} ${it.lotNumber}: нет лота`); continue; }
      if (lot.vatRate.eq(t.rate) && it.vatRate.eq(t.rate)) continue; // идемпотентность
      const rate = new D(t.rate);
      const factor = rate.div(100).add(1);
      const exclUnit = lot.unitCost.sub(lot.expenseCostExclVat).sub(lot.expenseVatAmount).div(factor).toDecimalPlaces(2); // расходов нет (0/0)
      if (!lot.expenseCostExclVat.isZero() || !lot.expenseVatAmount.isZero()) throw new Error(`лот ${lot.lotNumber}: есть расходы закупки — нужен ручной разбор`);
      const vatUnit = lot.unitCost.sub(exclUnit);
      const subtotal = lot.totalCost.div(factor).toDecimalPlaces(2);
      entries.push({
        purchase: num, itemId: it.id, lotId: lot.id, doc: t.doc,
        item: { vatRate: it.vatRate.toString(), unitPrice: it.unitPrice.toString(), subtotal: it.subtotal.toString(), notes: it.notes },
        lot: { vatRate: lot.vatRate.toString(), materialCostExclVat: lot.materialCostExclVat.toString(), materialVatAmount: lot.materialVatAmount.toString() },
        newItem: { vatRate: rate.toString(), unitPrice: exclUnit.toString(), subtotal: subtotal.toString(), notes: `${it.notes ? it.notes + "\n" : ""}${FIX_TAG} НДС 22% → 20% по документу: ${t.doc}. Цена с НДС не изменилась.` },
        newLot: { vatRate: rate.toString(), materialCostExclVat: exclUnit.toString(), materialVatAmount: vatUnit.toString() },
      });
      console.log(`  ${num} ${lot.lotNumber}: excl/ед ${lot.materialCostExclVat} → ${exclUnit}, НДС/ед ${lot.materialVatAmount} → ${vatUnit}, subtotal ${it.subtotal} → ${subtotal}`);
    }
  }
  const beaverItems = await prisma.purchaseItem.findMany({ where: { purchase: { number: "З-2026-0063" }, vatRate: 0 } });
  const beaver = beaverItems.filter((i) => !(i.notes ?? "").includes("[vat:note]")).map((i) => ({ itemId: i.id, old: i.notes, new: i.notes ? `${i.notes}\n${BEAVER_NOTE}` : BEAVER_NOTE }));
  console.log(`К изменению: ${entries.length} лотов/позиций, помет бобра: ${beaver.length}`);
  if (!APPLY) return;
  for (const e of entries) {
    await prisma.$transaction([
      prisma.rawMaterialLot.update({ where: { id: e.lotId }, data: e.newLot }),
      prisma.purchaseItem.update({ where: { id: e.itemId }, data: e.newItem }),
    ]);
  }
  for (const b of beaver) await prisma.purchaseItem.update({ where: { id: b.itemId }, data: { notes: b.new } });
  const prev = readJson<Journal>(JOURNAL, { script: "", entries: [], beaver: [] });
  writeJson(JOURNAL, { script: "fix-vat-rates.ts", appliedAt: new Date().toISOString(), entries: [...prev.entries, ...entries], beaver: [...prev.beaver, ...beaver] });
  const after = await totals();
  console.log("ПОСЛЕ:", after);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
