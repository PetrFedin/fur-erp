/**
 * Fixes a mismatch found while auditing attach-lot-cost-breakdown.ts's
 * results: fw26_cost_breakdown.json is a flat dict keyed only by lot
 * number, but 9 lot numbers from the FW26 report (30, 32, 33, 1525, 19,
 * 20, 23, 26, 27) collide with a *different* physical lot that already
 * exists under the same plain number:
 *
 *  - 30, 32, 33, 1525 collide with an unrelated older lot from the
 *    historical registry import (same numbering scheme reused across
 *    seasons) — see import-fw26.ts's own comment about this.
 *  - 19, 20, 23, 26, 27 are *duplicated within the FW26 report itself*:
 *    each number appears on two distinct rows (once under invoice 4080
 *    "Закупка меха 04-26", once under invoice 2020 "СОЮЗПУШНИНА 05-26"),
 *    confirmed by re-reading "закупка FW26" rows 27-35 and 82-89 of
 *    08_06_2026_Отчет_по_закупке_мехового_сырья_MVST.xlsx directly.
 *
 * import-fw26.ts correctly detected both collisions and inserted the
 * second occurrence under an "FW26-<n>" lot number — so the DB lots
 * themselves are all correct. But attach-lot-cost-breakdown.ts's
 * `findFirst({ lotNumber: { in: [n, "FW26-"+n] } })` matched whichever
 * lot Prisma happened to return first, which in every one of these 9
 * cases was the WRONG lot:
 *  - the unrelated historical lot for 30/32/33/1525 (confirmed: those
 *    lots' purchase.notes say "bulk-import-registry-2026-09", not FW26),
 *  - the *other* FW26 occurrence for 19/20/23/26/27 (confirmed: the
 *    breakdown data attached to plain "19" etc. has invoice "2020",
 *    but the plain-numbered lot is the one from the 4080 purchase).
 *
 * This script moves each mis-attached breakdown to its correct lot and
 * clears it from the wrong one. It does NOT fabricate the missing
 * breakdown for the 4080-side occurrence of 19/20/23/26/27 — that data
 * was never captured in fw26_cost_breakdown.json (the extraction script,
 * not checked into this repo, collapsed same-numbered rows into one dict
 * key and only the "2020" row survived). Re-deriving it would mean
 * guessing which raw column maps to which cost-breakdown label beyond
 * what's already verified against known-good entries — see README for
 * the exact raw source values, left for manual follow-up instead of
 * invented labels.
 *
 * Idempotent: safe to re-run once fixed (finds nothing left to move).
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/fix-fw26-cost-breakdown-collisions.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// The attached costBreakdown JSON doesn't store `invoice`/`auction`
// (attach-lot-cost-breakdown.ts only kept furDescription, the exchange
// rates and the cost items) — use furDescription + exchangeRateFixed as
// the sanity check instead, both read directly from the two known-good
// rows of the FW26 report during this audit.
const EXPECTED_SOURCE: Record<string, { furDescription: string; exchangeRateFixed: string }> = {
  "30": { furDescription: "Sable  wild raw Barguzinsky XXL 3 - 2.2 -", exchangeRateFixed: "74.5897" },
  "32": { furDescription: "Sable  wild raw Barguzinsky XXL 3 - 2.3 -", exchangeRateFixed: "74.5897" },
  "33": { furDescription: "Sable  wild raw Barguzinsky XXL 3 - 2.3 -", exchangeRateFixed: "74.5897" },
  "1525": { furDescription: "Sable  wild raw Barguzinsky Silvery XXL,XL 3 - 1.1 SIL.3", exchangeRateFixed: "74.5897" },
  "19": { furDescription: "Sable wild raw Barguzinsky", exchangeRateFixed: "71.292599999999993" },
  "20": { furDescription: "Sable wild raw Barguzinsky", exchangeRateFixed: "71.292599999999993" },
  "23": { furDescription: "Sable wild raw Barguzinsky", exchangeRateFixed: "71.292599999999993" },
  "26": { furDescription: "Sable wild raw Barguzinsky", exchangeRateFixed: "71.292599999999993" },
  "27": { furDescription: "Sable wild raw Barguzinsky", exchangeRateFixed: "71.292599999999993" },
};

async function main() {
  const org = await prisma.organization.findFirstOrThrow();
  let moved = 0;
  let skipped = 0;

  for (const [plainNumber, expected] of Object.entries(EXPECTED_SOURCE)) {
    const fw26Number = `FW26-${plainNumber}`;

    const [plainLot, fw26Lot] = await Promise.all([
      prisma.rawMaterialLot.findFirst({
        where: { organizationId: org.id, lotNumber: plainNumber },
      }),
      prisma.rawMaterialLot.findFirst({
        where: { organizationId: org.id, lotNumber: fw26Number },
      }),
    ]);

    if (!plainLot || !fw26Lot) {
      console.log(`Skip ${plainNumber}: missing lot(s) (plain=${!!plainLot}, ${fw26Number}=${!!fw26Lot})`);
      skipped++;
      continue;
    }

    if (fw26Lot.costBreakdown) {
      console.log(`Skip ${plainNumber}: ${fw26Number} already has a costBreakdown (already fixed?)`);
      skipped++;
      continue;
    }

    if (!plainLot.costBreakdown) {
      console.log(`Skip ${plainNumber}: plain lot has no costBreakdown to move`);
      skipped++;
      continue;
    }

    const breakdown = plainLot.costBreakdown as Prisma.JsonObject;
    const actualFurDescription = breakdown.furDescription;
    const actualExchangeRateFixed = breakdown.exchangeRateFixed;
    // exchangeRateFixed is stored as a string parsed from the source float,
    // so compare numerically (not by exact string) to avoid false mismatches
    // from trailing-digit float formatting (e.g. "74.5897" vs "74.589699999999993").
    const rateMatches =
      typeof actualExchangeRateFixed === "string" &&
      Number(actualExchangeRateFixed) === Number(expected.exchangeRateFixed);
    if (actualFurDescription !== expected.furDescription || !rateMatches) {
      console.log(
        `Skip ${plainNumber}: sanity check failed — got furDescription="${actualFurDescription}" ` +
          `exchangeRateFixed="${actualExchangeRateFixed}", expected furDescription="${expected.furDescription}" ` +
          `exchangeRateFixed="${expected.exchangeRateFixed}"`
      );
      skipped++;
      continue;
    }

    await prisma.$transaction([
      prisma.rawMaterialLot.update({
        where: { id: fw26Lot.id },
        data: { costBreakdown: breakdown },
      }),
      prisma.rawMaterialLot.update({
        where: { id: plainLot.id },
        data: { costBreakdown: Prisma.JsonNull },
      }),
    ]);
    console.log(`Moved breakdown from lot "${plainNumber}" to "${fw26Number}" (${actualFurDescription}).`);
    moved++;
  }

  console.log(`\nMoved: ${moved}, skipped: ${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
