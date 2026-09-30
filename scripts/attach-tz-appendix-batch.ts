/**
 * Generalizes scripts/attach-tz141-source-appendix.ts to a batch of real
 * signed ТЗ appendix documents (from Google Drive folder "ТЗ mvst"),
 * cross-checked read-only against the DB before this script ever runs —
 * every entry in tz_appendix_data.json is a confirmed clean match: lots,
 * quantities, planned quantity, material description, lining, and work
 * price in the document all already agreed with what the earlier bulk
 * import put in the DB. All that's missing is what these documents state
 * but the source registry sheet never carried: the real Заказчик, the
 * Договор подряда reference, and the ТЗ's own date.
 *
 * Reads scripts/tz_appendix_data.json: { [workOrderNumber]: { clientName,
 * contractNumber, workOrderDate } }. For each entry, finds the
 * ProductionOrder by workOrderNumber and — only if clientId is still
 * unset (idempotent, and never overwrites a value someone set another
 * way) — fills clientId/contractNumber/workOrderDate. Creates the Client
 * row if clientName doesn't exist yet (a name taken verbatim from a real
 * signed document is not invented data).
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/attach-tz-appendix-batch.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Entry = { clientName: string; contractNumber: string; workOrderDate: string };

async function main() {
  const data: Record<string, Entry> = JSON.parse(
    readFileSync(join(__dirname, "tz_appendix_data.json"), "utf-8")
  );
  const org = await prisma.organization.findFirstOrThrow();

  let updated = 0;
  let skipped = 0;
  let missing = 0;

  for (const [workOrderNumber, entry] of Object.entries(data)) {
    const order = await prisma.productionOrder.findFirst({
      where: { organizationId: org.id, workOrderNumber },
    });
    if (!order) {
      console.log(`ТЗ №${workOrderNumber}: no matching ProductionOrder — skipped.`);
      missing++;
      continue;
    }
    if (order.clientId) {
      console.log(`ТЗ №${workOrderNumber} (${order.number}): already has a client — skipped.`);
      skipped++;
      continue;
    }

    let client = await prisma.client.findFirst({
      where: { organizationId: org.id, name: entry.clientName },
    });
    if (!client) {
      client = await prisma.client.create({ data: { organizationId: org.id, name: entry.clientName } });
      console.log(`Created new Client "${entry.clientName}" (from ТЗ №${workOrderNumber}'s signed appendix).`);
    }

    await prisma.productionOrder.update({
      where: { id: order.id },
      data: {
        clientId: client.id,
        contractNumber: entry.contractNumber,
        workOrderDate: new Date(entry.workOrderDate),
      },
    });
    console.log(`ТЗ №${workOrderNumber} (${order.number}): set client "${entry.clientName}", contract, date.`);
    updated++;
  }

  console.log(`\nUpdated: ${updated}, already set (skipped): ${skipped}, no matching order: ${missing}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
