/**
 * Attaches the itemized cost-buildup breakdown (auction price, exchange
 * rate, auction/marketing/delivery fees, VAT splits, dressing/tinting,
 * customs, transport, commission) from the historical registry file's
 * "Расчет для ЦУМ" sheet to each matching RawMaterialLot.costBreakdown.
 *
 * This is the pre-FW26 counterpart of attach-lot-cost-breakdown.ts: that
 * script covers the 157 FW26-season lots from the FW26 purchase report;
 * this one covers the pre-FW26 (historical registry) lots using the same
 * kind of itemized buildup, found in
 * "21-08 ЕДИНЫЙ_РЕЕСТР_ПО_МЕХУ_MVST 2.xlsx" → "Расчет для ЦУМ" (despite
 * its name, this sheet is not a separate "for ЦУМ" price — it is the cost
 * calculation sheet whose final column is the exact same number already
 * imported as RawMaterialLot.unitCost; see README "Сверка со всеми
 * оставшимися листами исходного реестра").
 *
 * Matches by plain lot number (no prefix scheme applies to these
 * historical lots — unlike FW26, which used an "FW26-" prefix for
 * collisions with unrelated earlier lots).
 *
 * Before attaching, re-verifies that the sheet's own final total column
 * ("Общая стоимость за ед c доп расходами в т.ч. НДС", captured as
 * finalUnitCost in registry_cost_breakdown.json) still matches the lot's
 * current unitCost within a small tolerance (rounding: unitCost is stored
 * as Decimal(14,2)). A lot whose sheet total disagrees with the DB is
 * skipped rather than attaching a "detail" that would contradict the
 * lot's actual recorded cost — see README for the tolerance rationale
 * used in the FW26 collision fixes.
 *
 * Idempotent: re-running overwrites with the same data. Skips lots that
 * already carry a costBreakdown from a different source (e.g. FW26).
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/attach-registry-lot-cost-breakdown.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TOLERANCE = 0.5; // rubles; unitCost is Decimal(14,2), sheet values are full-precision floats

type Entry = {
  furDescription: string | null;
  exchangeRateInvoice: string | null;
  exchangeRateFixed: string | null;
  finalUnitCost: number;
  breakdown: { label: string; value: number }[];
};

async function main() {
  const data: Record<string, Entry> = JSON.parse(
    readFileSync(join(__dirname, "registry_cost_breakdown.json"), "utf-8")
  );

  const org = await prisma.organization.findFirstOrThrow();
  let attached = 0;
  let noLot = 0;
  let alreadyHasBreakdown = 0;
  let mismatch = 0;
  let emptyBreakdown = 0;
  const mismatches: { lotNumber: string; dbUnitCost: number; sheetTotal: number }[] = [];

  for (const [lotNumber, entry] of Object.entries(data)) {
    if (entry.breakdown.length === 0) {
      emptyBreakdown++;
      continue;
    }

    const lot = await prisma.rawMaterialLot.findFirst({
      where: { organizationId: org.id, lotNumber },
    });
    if (!lot) {
      noLot++;
      continue;
    }

    if (lot.costBreakdown) {
      alreadyHasBreakdown++;
      continue;
    }

    const dbUnitCost = Number(lot.unitCost);
    const diff = Math.abs(dbUnitCost - entry.finalUnitCost);
    if (diff > TOLERANCE) {
      mismatch++;
      mismatches.push({ lotNumber, dbUnitCost, sheetTotal: entry.finalUnitCost });
      continue;
    }

    await prisma.rawMaterialLot.update({
      where: { id: lot.id },
      data: {
        costBreakdown: {
          furDescription: entry.furDescription,
          exchangeRateInvoice: entry.exchangeRateInvoice,
          exchangeRateFixed: entry.exchangeRateFixed,
          items: entry.breakdown,
        },
      },
    });
    attached++;
  }

  console.log(`Attached cost breakdown to ${attached} lots.`);
  console.log(`Skipped: ${noLot} lot numbers not found in DB, ${alreadyHasBreakdown} already had a breakdown, ${mismatch} sheet/DB total mismatches, ${emptyBreakdown} empty breakdown rows.`);
  if (mismatches.length > 0) {
    console.log("Mismatches (sheet total vs DB unitCost):");
    for (const m of mismatches) {
      console.log(`  lot ${m.lotNumber}: DB unitCost=${m.dbUnitCost}, sheet total=${m.sheetTotal}, diff=${Math.abs(m.dbUnitCost - m.sheetTotal).toFixed(2)}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
