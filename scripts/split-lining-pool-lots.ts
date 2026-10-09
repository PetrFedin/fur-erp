/**
 * РАЗДЕЛЕНИЕ СМЕШАННЫХ ЛОТОВ ПОДКЛАДКИ: поставка 05.26 (УПД №233, закупка «Подкладка 05.26») отдельным лотом.
 *
 * Было: лот подкладки по каждой ткани собран «пулом» из позиций закупок 07.25 (счёт №100, УПД №109, 20% НДС) и 05.26
 * (счёт №157, УПД №233, 22% НДС), а цена за единицу (unitCost) выставлена неверно: количество × цена даёт 7 628 814 ₽,
 * тогда как по позициям закупок и документам подкладка стоит 6 821 475 ₽ (1 457 199 + 5 344 405,50 + 19 870).
 * Стало: у каждой такой ткани два лота — «07.25» (прежний лот, к нему привязаны все списания в ТЗ, цена ≈ 2 140 ₽/м с НДС)
 * и «05.26» (новый лот, 4 515 ₽/м с НДС). Списания в ТЗ и себестоимость ТЗ НЕ меняются: все они брали ткань по цене 07.25.
 * Количество на складе в сумме не меняется: остаток 07.25-лота = его приход − списано, остаток 05.26-лота = весь приход.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/split-lining-pool-lots.ts            # пробный прогон
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/split-lining-pool-lots.ts --apply    # применить (перед этим bash scripts/backup.sh)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/split-lining-pool-lots.ts --rollback --apply
 * Журнал: docs-inventory/corrections-journal-split-lining-pool-lots.json
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-split-lining-pool-lots.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const NEW_AUCTION = "Подкладка 05.26";
const r2 = (n: number) => Math.round(n * 100) / 100;

type LotBefore = { id: string; quantityReceived: string; quantityRemaining: string; unitCost: string; totalCost: string; materialCostExclVat: string; materialVatAmount: string; vatRate: string; purchaseId: string | null; receivedDate: string };
type Journal = { time: string; lots: LotBefore[]; created: string[]; items: { id: string; lotId: string | null }[]; rolledBack?: string };

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    if (ROLLBACK) {
      if (!existsSync(JOURNAL)) { console.log("Нет журнала"); return; }
      const j: Journal = JSON.parse(readFileSync(JOURNAL, "utf-8"));
      if (j.rolledBack) { console.log("Уже откачено"); return; }
      if (!APPLY) { console.log(`Будет откачено: лотов ${j.lots.length}, удалено новых ${j.created.length} (добавьте --apply)`); return; }
      await prisma.$transaction(async (tx) => {
        for (const it of j.items) await tx.purchaseItem.update({ where: { id: it.id }, data: { lotId: it.lotId } });
        for (const id of j.created) await tx.rawMaterialLot.delete({ where: { id } });
        for (const l of j.lots) await tx.rawMaterialLot.update({ where: { id: l.id }, data: { quantityReceived: l.quantityReceived, quantityRemaining: l.quantityRemaining, unitCost: l.unitCost, totalCost: l.totalCost, materialCostExclVat: l.materialCostExclVat, materialVatAmount: l.materialVatAmount, vatRate: l.vatRate, purchaseId: l.purchaseId, receivedDate: new Date(l.receivedDate) } });
      });
      j.rolledBack = new Date().toISOString();
      writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
      console.log("Откачено");
      return;
    }

    if (existsSync(JOURNAL) && !JSON.parse(readFileSync(JOURNAL, "utf-8")).rolledBack) { console.log("Уже применено (журнал есть). Для повтора сначала --rollback --apply."); return; }

    const lots = await prisma.rawMaterialLot.findMany({
      where: { rawMaterial: { unit: "M" } },
      include: { rawMaterial: true, purchaseItems: { include: { purchase: true } }, usages: true },
    });
    type Plan = { lot: (typeof lots)[number]; a: typeof lots[number]["purchaseItems"]; b: typeof lots[number]["purchaseItems"]; usedQty: number };
    const plans: Plan[] = [];
    for (const lot of lots) {
      const b = lot.purchaseItems.filter((i) => i.purchase.auctionSession === NEW_AUCTION);
      const a = lot.purchaseItems.filter((i) => i.purchase.auctionSession !== NEW_AUCTION);
      if (b.length === 0 || a.length === 0) continue; // нечего делить (чисто 05.26 или чисто 07.25)
      plans.push({ lot, a, b, usedQty: lot.usages.reduce((s, u) => s + Number(u.quantity), 0) });
    }

    const incl = (i: { subtotal: unknown; vatRate: unknown }) => Number(i.subtotal) * (1 + Number(i.vatRate) / 100);
    console.log(`\nРазделение смешанных лотов подкладки (${APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН"}): ${plans.length} лотов\n`);
    let sumBefore = 0, sumAfter = 0, qtyBefore = 0, qtyAfter = 0;
    const ops: { lotId: string; aData: Record<string, unknown>; bCreate: Record<string, unknown>; bItemIds: string[]; before: LotBefore }[] = [];
    for (const p of plans) {
      const l = p.lot;
      const aQty = p.a.reduce((s, i) => s + Number(i.quantity), 0);
      const bQty = p.b.reduce((s, i) => s + Number(i.quantity), 0);
      const aTot = r2(p.a.reduce((s, i) => s + incl(i), 0));
      const bTot = r2(p.b.reduce((s, i) => s + incl(i), 0));
      const aExcl = p.a.reduce((s, i) => s + Number(i.subtotal), 0);
      const bExcl = p.b.reduce((s, i) => s + Number(i.subtotal), 0);
      const aRem = r2(aQty - p.usedQty);
      const bRem = bQty;
      const curRem = Number(l.quantityRemaining);
      const curQty = Number(l.quantityReceived);
      const check = [
        Math.abs(aQty + bQty - curQty) < 0.001 ? "" : `приход не сходится (${aQty}+${bQty}≠${curQty})`,
        Math.abs(aRem + bRem - curRem) < 0.001 ? "" : `остаток не сходится (${aRem}+${bRem}≠${curRem})`,
        aRem >= -0.0001 ? "" : "списано больше, чем приход 07.25",
        Math.abs(Number(l.totalCost) - (aTot + bTot)) < 1 ? "" : `totalCost лота ${l.totalCost} ≠ Σ позиций ${r2(aTot + bTot)}`,
      ].filter(Boolean);
      const uA = r2(aTot / aQty), uB = r2(bTot / bQty);
      console.log(`${l.rawMaterial.name}: 07.25 ${aQty} м × ${uA} = ${aTot} (остаток ${aRem}); 05.26 ${bQty} м × ${uB} = ${bTot}; было ${curQty} м × ${l.unitCost} = ${r2(curQty * Number(l.unitCost))}${check.length ? "  ✗ " + check.join("; ") : "  ✓"}`);
      if (check.length) throw new Error(`Лот ${l.id}: ${check.join("; ")}`);
      sumBefore += curQty * Number(l.unitCost); sumAfter += aQty * uA + bQty * uB; qtyBefore += curQty; qtyAfter += aQty + bQty;
      const bPurchase = p.b[0].purchase;
      const vatA = Number(p.a[0].vatRate), vatB = Number(p.b[0].vatRate);
      const exA = r2(aExcl / aQty), exB = r2(bExcl / bQty);
      ops.push({
        lotId: l.id,
        before: { id: l.id, quantityReceived: l.quantityReceived.toString(), quantityRemaining: l.quantityRemaining.toString(), unitCost: l.unitCost.toString(), totalCost: l.totalCost.toString(), materialCostExclVat: l.materialCostExclVat.toString(), materialVatAmount: l.materialVatAmount.toString(), vatRate: l.vatRate.toString(), purchaseId: l.purchaseId, receivedDate: l.receivedDate.toISOString() },
        aData: { quantityReceived: aQty, quantityRemaining: aRem, unitCost: uA, totalCost: aTot, materialCostExclVat: exA, materialVatAmount: r2(uA - exA), vatRate: vatA },
        bCreate: {
          organizationId: l.organizationId, rawMaterialId: l.rawMaterialId, warehouseId: l.warehouseId, lotNumber: null, grade: l.grade, color: l.color, colorRefId: l.colorRefId, sizeGrade: l.sizeGrade,
          purchaseId: bPurchase.id, quantityReceived: bQty, quantityRemaining: bRem, unitCost: uB, totalCost: bTot, materialCostExclVat: exB, materialVatAmount: r2(uB - exB), vatRate: vatB,
          receivedDate: bPurchase.receivedDate ?? l.receivedDate, expenseCostExclVat: 0, expenseVatAmount: 0,
        },
        bItemIds: p.b.map((i) => i.id),
      });
    }
    console.log(`\nИтого стоимость лотов (кол-во × цена): было ${r2(sumBefore)}, станет ${r2(sumAfter)} (по документам 6 821 475 вместе с лотами 05.26 из двух тканей и «Доп. материалами»); количество ${qtyBefore} → ${qtyAfter} м`);
    if (!APPLY) { console.log("\nПробный прогон: ничего не записано. Списания в ТЗ и себестоимость ТЗ не меняются."); return; }

    const journal: Journal = { time: new Date().toISOString(), lots: ops.map((o) => o.before), created: [], items: [] };
    await prisma.$transaction(async (tx) => {
      for (const o of ops) {
        const created = await tx.rawMaterialLot.create({ data: o.bCreate as never });
        journal.created.push(created.id);
        for (const itemId of o.bItemIds) {
          const it = await tx.purchaseItem.findUniqueOrThrow({ where: { id: itemId } });
          journal.items.push({ id: itemId, lotId: it.lotId });
          await tx.purchaseItem.update({ where: { id: itemId }, data: { lotId: created.id } });
        }
        await tx.rawMaterialLot.update({ where: { id: o.lotId }, data: o.aData as never });
      }
    });
    writeFileSync(JOURNAL, JSON.stringify(journal, null, 1));
    console.log("\nГотово. Журнал записан.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
