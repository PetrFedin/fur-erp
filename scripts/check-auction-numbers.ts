/**
 * Сверка ключевых сумм (только чтение): запускается ДО и ПОСЛЕ переименования аукционов, числа не должны измениться.
 *   node --env-file=.env node_modules/.bin/tsx scripts/check-auction-numbers.ts [файл-куда-сохранить.json]
 * Печатает Σ закупок, оплачено, долг поставщику (и его три части), остаток меха, число закупок/оплат/документов.
 */
import Module from "module";
import { join } from "path";
import { writeFileSync } from "fs";

const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const origResolve = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return origResolve.call(this, req, ...rest);
};

export async function collectNumbers() {
  const { PrismaClient } = await import("@prisma/client");
  const { Decimal } = await import("@prisma/client/runtime/library");
  const { purchaseTotalInclVat } = await import("../src/lib/purchase-totals");
  const { loadSupplierDebt } = await import("../src/lib/supplier-debt");
  const prisma = new PrismaClient();
  try {
    const orgs = await prisma.organization.findMany();
    const out: Record<string, unknown> = {};
    for (const org of orgs) {
      const purchases = await prisma.purchase.findMany({ where: { organizationId: org.id }, include: { items: true, expenses: true } });
      let total = new Decimal(0);
      for (const p of purchases) if (p.status !== "CANCELLED") total = total.add(purchaseTotalInclVat(p));
      const pays = await prisma.payment.findMany({ where: { organizationId: org.id } });
      const paid = pays.filter((p) => p.status === "COMPLETED").reduce((s, p) => s.add(p.amount), new Decimal(0));
      const debt = await loadSupplierDebt(prisma, org.id, "all");
      const lots = await prisma.rawMaterialLot.findMany({ where: { organizationId: org.id, rawMaterial: { unit: { not: "M" } } }, select: { quantityRemaining: true, unitCost: true } });
      const furStock = lots.reduce((s, l) => s.add(l.quantityRemaining.mul(l.unitCost)), new Decimal(0));
      const f = (d: InstanceType<typeof Decimal>) => d.toFixed(2);
      out[org.name] = {
        purchasesTotal: f(total), purchasesCount: purchases.length, paymentsPaid: f(paid), paymentsCount: pays.length,
        debt: f(debt.debt), debtReceivedNet: f(debt.receivedNet), debtInvoiced: f(debt.invoiced), debtExpected: f(debt.expected),
        debtByAuctionCount: debt.byAuction.length, nonAuctionDebt: f(debt.nonAuctionDebt), furStock: f(furStock),
        purchaseDocuments: await prisma.purchaseDocument.count({ where: { organizationId: org.id } }),
        driveDocuments: await prisma.driveDocument.count({ where: { organizationId: org.id } }),
        lots: await prisma.rawMaterialLot.count({ where: { organizationId: org.id } }),
        byAuction: debt.byAuction.map((a) => ({ name: a.name, purchases: a.purchases, total: f(a.total), paid: f(a.paid), due: f(a.due), received: f(a.dueReceived), invoiced: f(a.dueInvoiced), expected: f(a.dueExpected) })),
      };
    }
    return out;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  collectNumbers().then((o) => {
    const json = JSON.stringify(o, null, 2);
    const file = process.argv[2];
    if (file) writeFileSync(file, json);
    console.log(json);
  });
}
