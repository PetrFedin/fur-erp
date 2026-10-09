/**
 * БОБР «ПОКА УХОДИТ» (решение владельца 09.10.2026): бобр — сырьё подрядчика (инвойс 1-2026, продавец WELLFUR/Веллмех, покупатель YUSUFOĞULLARI),
 * не наша закупка и не наш долг. Убираем из системы закупку З-2026-0063 (отменена) с позициями, вид меха «Бобр», партию «Бобр 08.26» и контрагента YUSUFOĞULLARI —
 * только если на них больше ничего не ссылается (оплат, лотов, списаний, других закупок нет). Документ-инвойс в Drive остаётся: запись документа открепляется от закупки.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/remove-beaver.ts            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/remove-beaver.ts --apply    # перед этим scripts/backup.sh
 * Вернуть: node --env-file=.env node_modules/.bin/tsx scripts/create-beaver-purchase.ts --apply (создаёт заново черновик закупки, вид меха и контрагента).
 * Журнал со снимком удалённых строк: docs-inventory/corrections-journal-remove-beaver.json
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-remove-beaver.json");

(async () => {
  try {
    const purchase = await prisma.purchase.findFirst({
      where: { number: "З-2026-0063" },
      include: { items: true, payments: true, expenses: true, supplier: true },
    });
    if (!purchase) return console.log("Закупки З-2026-0063 нет — ничего не делаем");
    if (!/Бобр/i.test(purchase.auctionSession ?? "") || purchase.supplier.name.toUpperCase().indexOf("YUSUF") < 0) throw new Error("З-2026-0063 не похожа на бобра — остановлено");

    const lots = await prisma.rawMaterialLot.count({ where: { purchaseId: purchase.id } });
    const drive = await prisma.driveDocument.findMany({ where: { purchaseId: purchase.id } });
    const pdocs = await prisma.purchaseDocument.count({ where: { purchaseId: purchase.id } });
    const materialIds = Array.from(new Set(purchase.items.map((i) => i.rawMaterialId)));
    const materials = await prisma.rawMaterial.findMany({ where: { id: { in: materialIds } } });
    const usage = await prisma.productionMaterialUsage.count({ where: { rawMaterialId: { in: materialIds } } });
    const otherItems = await prisma.purchaseItem.count({ where: { rawMaterialId: { in: materialIds }, purchaseId: { not: purchase.id } } });
    const otherLots = await prisma.rawMaterialLot.count({ where: { rawMaterialId: { in: materialIds } } });
    const supplierOther = await prisma.purchase.count({ where: { supplierId: purchase.supplierId, id: { not: purchase.id } } });
    const supplierPays = await prisma.payment.count({ where: { supplierId: purchase.supplierId } });
    const auction = purchase.auctionId ? await prisma.auction.findUnique({ where: { id: purchase.auctionId } }) : null;
    const auctionOther = purchase.auctionId ? await prisma.purchase.count({ where: { auctionId: purchase.auctionId, id: { not: purchase.id } } }) : 0;

    console.log(`Закупка ${purchase.number}: статус ${purchase.status}, позиций ${purchase.items.length}, оплат ${purchase.payments.length}, расходов ${purchase.expenses.length}, лотов ${lots}, PurchaseDocument ${pdocs}, DriveDocument ${drive.length} (${drive.map((d) => d.title).join("; ")})`);
    console.log(`Материалы: ${materials.map((m) => m.name).join(", ")}; списаний в ТЗ ${usage}; в других закупках ${otherItems}; лотов ${otherLots}`);
    console.log(`Контрагент ${purchase.supplier.name}: других закупок ${supplierOther}, оплат ${supplierPays}`);
    console.log(`Партия ${auction?.name ?? "—"}: других закупок ${auctionOther}`);
    if (purchase.payments.length || lots || pdocs || otherItems || usage || otherLots) throw new Error("На бобра что-то ссылается — удаление остановлено, нужен ручной разбор");

    const dropMaterial = otherItems === 0 && usage === 0 && otherLots === 0;
    const dropSupplier = supplierOther === 0 && supplierPays === 0;
    const dropAuction = !!auction && auctionOther === 0;
    console.log(`\nБудет: открепить документы (${drive.length}), удалить закупку и позиции${dropMaterial ? ", вид меха/материал «Бобр»" : ""}${dropSupplier ? ", контрагента" : ""}${dropAuction ? ", партию" : ""}.`);
    if (!APPLY) return console.log("\nПробный прогон: ничего не записано.");

    writeFileSync(JOURNAL, JSON.stringify({ time: new Date().toISOString(), purchase, drive, materials, auction, supplier: purchase.supplier }, null, 1));
    await prisma.$transaction(async (tx) => {
      if (drive.length) await tx.driveDocument.updateMany({ where: { purchaseId: purchase.id }, data: { purchaseId: null } });
      await tx.purchaseItem.deleteMany({ where: { purchaseId: purchase.id } });
      await tx.purchase.delete({ where: { id: purchase.id } });
      if (dropMaterial) {
        const m = await tx.rawMaterial.findMany({ where: { id: { in: materialIds } }, select: { id: true } });
        for (const x of m) await tx.rawMaterial.delete({ where: { id: x.id } });
      }
      if (dropSupplier) await tx.supplier.delete({ where: { id: purchase.supplierId } });
      if (dropAuction) await tx.auction.delete({ where: { id: purchase.auctionId! } });
    });
    console.log("\nГотово. Журнал записан.");
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e.message ?? e); process.exit(1); });
