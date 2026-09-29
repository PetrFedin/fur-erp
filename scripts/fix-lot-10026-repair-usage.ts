/**
 * Full row-by-row audit of the "остатки" sheet
 * (21-08 ЕДИНЫЙ_РЕЕСТР_ПО_МЕХУ_MVST 2.xlsx) against the DB found exactly
 * one quantity discrepancy out of 186 lot rows: lot "10026" (Норка,
 * purchase З-2026-0010) shows remainUnits=54 in the sheet (received 70,
 * used 16), but the DB had quantityRemaining=70 — i.e. the DB never
 * recorded any consumption from this lot.
 *
 * Root cause, confirmed against "Реестр (единый)" row 520-521: the 16
 * units were consumed by ТЗ №116 "Ремонт пальто" (coat repair) — which
 * import-registry.ts's own header comment already documents as one of
 * the "2 строки реестра пропущены полностью" (skipped because it has no
 * product article — a repair act, not a production order for a new
 * model — see README's "2 строки реестра пропущены" note). So this isn't
 * a missed import bug, it's the direct, expected consequence of that
 * already-documented, deliberate skip: the repair job's material use was
 * never entered anywhere in the app.
 *
 * The quantity (16) and lot are both read directly from the source file,
 * not invented. Since there's no ProductionOrder to attach this
 * consumption to (that's exactly why the row was skipped), this records
 * it as a plain stock adjustment — the same pattern already used by
 * import-fw26.ts for correcting quantities against real-world numbers
 * without a matching order.
 *
 * Idempotent: no-op if the lot's remaining quantity no longer matches the
 * pre-fix value of 70 (i.e. already applied, or changed for another
 * reason since).
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/fix-lot-10026-repair-usage.ts
 */
import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findFirstOrThrow();
  const lot = await prisma.rawMaterialLot.findFirst({
    where: { organizationId: org.id, lotNumber: "10026" },
  });

  if (!lot) {
    console.log("Lot 10026 not found — nothing to do.");
    return;
  }

  const expectedBefore = new Decimal(70);
  const deduction = new Decimal(16);

  if (!lot.quantityRemaining.equals(expectedBefore)) {
    console.log(
      `Skip: lot 10026 quantityRemaining is ${lot.quantityRemaining.toString()}, expected ${expectedBefore.toString()} ` +
        `(already fixed, or changed for another reason) — not touching it.`
    );
    return;
  }

  await prisma.$transaction([
    prisma.rawMaterialLot.update({
      where: { id: lot.id },
      data: { quantityRemaining: lot.quantityRemaining.sub(deduction) },
    }),
    prisma.stockMovement.create({
      data: {
        organizationId: org.id,
        warehouseId: lot.warehouseId,
        rawMaterialId: lot.rawMaterialId,
        lotId: lot.id,
        type: "ADJUSTMENT_OUT",
        quantity: deduction,
        unitCost: lot.unitCost,
        totalCost: lot.unitCost.mul(deduction),
        notes:
          "Списание по ТЗ №116 «Ремонт пальто» (реестр, строка 520-521) — заказ не заведён в системе " +
          "(акт ремонта без артикула модели, сознательно пропущен при массовом импорте), но расход сырья " +
          "по источнику реальный — 16 шт. из 70 полученных, аудит листа «остатки».",
      },
    }),
  ]);

  console.log(`Adjusted lot 10026: quantityRemaining 70 -> 54 (ТЗ №116 repair usage, 16 units).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
