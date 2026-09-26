/**
 * The user clarified the real business relationship: ООО «Веллмех» is the
 * only actual supplier/counterparty — everything else (Союзпушнина, SAGA,
 * FH, РП, unlabeled batches) are auction houses Веллмех buys raw material
 * from on the business's behalf, not separate suppliers of ours. Every
 * Purchase already carries the auction/session in `auctionSession`
 * (e.g. "SAGA 03-26", "СП 03.25"), so nothing is lost by consolidating —
 * only the (wrong) Supplier attribution changes.
 *
 * Idempotent: once only "ООО «Веллмех»" remains, this is a no-op.
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/consolidate-supplier-vellmex.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const vellmex = await prisma.supplier.findFirst({ where: { name: "ООО «Веллмех»" } });
  if (!vellmex) {
    console.log('Supplier "ООО «Веллмех»" not found — nothing to consolidate onto.');
    return;
  }

  const others = await prisma.supplier.findMany({ where: { id: { not: vellmex.id } } });
  if (others.length === 0) {
    console.log("Already consolidated.");
    return;
  }

  const moved = await prisma.purchase.updateMany({
    where: { supplierId: { in: others.map((s) => s.id) } },
    data: { supplierId: vellmex.id },
  });
  console.log(`Moved ${moved.count} purchases to ООО «Веллмех».`);

  const deleted = await prisma.supplier.deleteMany({ where: { id: { in: others.map((s) => s.id) } } });
  console.log(`Deleted ${deleted.count} now-redundant supplier rows: ${others.map((s) => s.name).join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
