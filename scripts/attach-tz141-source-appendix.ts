/**
 * The user provided the actual signed appendix document for ТЗ №141
 * ("ПРИЛОЖЕНИЕ 141 (М001К соболь - 2 шт.)+.docx") — the real "Источник
 * файл" the registry's column B references for this order. Cross-checking
 * it against the already-imported ProductionOrder confirmed an excellent
 * match: all 14 Соболь lots (31, 32, 337, 343, 344, 346, 353, 1316, 1330,
 * 1337, 1351, 1353, 1360, 1386) and their exact quantities, the work price
 * (246 000 ₽/ед.), material description, lining description, and planned
 * quantity all agree exactly with what's in the DB.
 *
 * Two things WERE missing, though the source clearly states them:
 *  - ЗАКАЗЧИК (customer): "ООО «Меркури Мода»" — this settles an open
 *    question from an earlier audit pass, which had flagged the one
 *    Client record named "ООО Меркури Мода" as probable leftover manual
 *    test data (zero linked orders, not created by any import script).
 *    It is, in fact, real: this document proves it's the actual client
 *    for at least ТЗ №141, signed by "Павлов А. М." as Генеральный
 *    директор. Not deleting it was the right call.
 *  - Договор подряда (contract): "№ 1605 от 16 мая 2025 г."
 *
 * Not touched: the "ЗАКАЗЧИК ПЕРЕДАЛ" materials table's own per-unit
 * "Стоимость без НДС" figures run about 5.73% higher than this app's
 * RawMaterialLot.materialCostExclVat for the same lots (checked lots 31,
 * 32, 337, 343 — the ratio is consistent, not random noise, so it's a
 * real, systematic difference — most likely a different USD/RUB rate
 * snapshot between this давальческое handover paperwork and the purchase
 * invoice this app's cost is anchored to). Left as-is rather than
 * overwriting a purchase-invoice-sourced cost with a document that may
 * reflect a different valuation date — flagged in README as an open
 * question, not silently resolved either way.
 *
 * Idempotent: a no-op if the order already has this clientId set.
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/attach-tz141-source-appendix.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const order = await prisma.productionOrder.findFirst({ where: { workOrderNumber: "141" } });
  if (!order) {
    console.log("ТЗ №141 not found — nothing to do.");
    return;
  }
  if (order.clientId) {
    console.log("Order already has a client set — already applied, skipping.");
    return;
  }

  const client = await prisma.client.findFirstOrThrow({ where: { name: "ООО Меркури Мода" } });
  await prisma.productionOrder.update({
    where: { id: order.id },
    data: {
      clientId: client.id,
      contractNumber: "Договор подряда № 1605 от 16.05.2025 г.",
      workOrderDate: new Date("2026-08-26"),
    },
  });
  console.log(`Set client/contract/date on ${order.number} (ТЗ №141) from the source appendix document.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
