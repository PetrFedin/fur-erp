/**
 * Attaches the full cost-buildup breakdown (auction fee, broker %,
 * dressing, customs advance, agent commission, freight, ...) from the
 * FW26 purchase report to each matching RawMaterialLot.costBreakdown, so
 * "из чего и как получается финальная стоимость" is visible per lot, not
 * just the final number. Only FW26 lots have this detail in the source;
 * older (F25/historical registry) lots only ever had the landed total.
 *
 * Matches by lot number, trying the plain number first and the "FW26-"
 * prefix second (used for lot numbers that collided with an unrelated
 * lot from an earlier season — see scripts/import-fw26.ts).
 *
 * Idempotent: re-running overwrites with the same data.
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/attach-lot-cost-breakdown.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Breakdown = {
  auction: string | null;
  invoice: string | null;
  furDescription: string | null;
  exchangeRateInvoice: string | null;
  exchangeRateFixed: string | null;
  unitCostRub: string | null;
  totalCostRub: string | null;
  breakdown: { label: string; value: number }[];
};

async function main() {
  const data: Record<string, Breakdown> = JSON.parse(
    readFileSync(join(__dirname, "fw26_cost_breakdown.json"), "utf-8")
  );

  const org = await prisma.organization.findFirstOrThrow();
  let matched = 0;
  let missed = 0;

  for (const [lotNumber, entry] of Object.entries(data)) {
    if (entry.breakdown.length === 0) continue;

    const lot = await prisma.rawMaterialLot.findFirst({
      where: { organizationId: org.id, lotNumber: { in: [lotNumber, `FW26-${lotNumber}`] } },
    });
    if (!lot) {
      missed++;
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
    matched++;
  }

  console.log(`Attached cost breakdown to ${matched} lots (${missed} lot numbers not found).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
