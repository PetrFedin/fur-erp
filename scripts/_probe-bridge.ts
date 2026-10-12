import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { loadClientDebt } from "../src/lib/payment-alloc";
import { loadPaymentsOverview } from "../src/lib/payments-overview";
const prisma = new PrismaClient();
(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const cd = await loadClientDebt(prisma, org, { year: "all" });
  console.log("clientDebt", { billable: cd.billable, work: cd.work, paid: cd.paid, alloc: cd.allocated, unalloc: cd.unallocated, unallocAll: cd.unallocatedAll, hides: cd.hides, bal: cd.balance, byKind: cd.unallocatedByKind });
  const ov = await loadPaymentsOverview(org);
  const s = (k: "fur"|"lining"|"work"|"hides"|"amount") => ov.reduce((a, r: any) => a + (r[k] ?? 0), 0);
  console.log("overview", { work: s("work"), fur: s("fur"), lining: s("lining"), hides: s("hides"), amount: s("amount") });
  const pays = await prisma.productionPayment.findMany({ where: { organizationId: org, status: "COMPLETED" }, select: { id: true, amount: true, paidAt: true, paymentType: true, docRef: true, notes: true, client: { select: { name: true } }, allocations: { select: { amount: true, productionOrder: { select: { status: true, batchId: true, clientId: true } } } } } });
  let tot = 0, aBatch = 0, aNoBatch = 0, aCancel = 0, aNoClient = 0;
  for (const p of pays) { tot += Number(p.amount); for (const a of p.allocations) { const o = a.productionOrder; if (o.status === "CANCELLED") aCancel += Number(a.amount); else if (!o.batchId) aNoBatch += Number(a.amount); else aBatch += Number(a.amount); if (!o.clientId) aNoClient += Number(a.amount); } }
  console.log({ payments: pays.length, tot, aBatch, aNoBatch, aCancel, aNoClient });
  const un = cd.payments.map((p) => ({ date: p.paidAt.toISOString().slice(0,10), client: p.clientName, amount: Number(p.amount), rest: Number(p.rest), kind: p.kind, doc: p.docRef, notes: (p.notes ?? "").slice(0, 60) }));
  console.table(un);
  // ТЗ с клиентом, их работа: в партиях и без
  const ords = await prisma.productionOrder.findMany({ where: { organizationId: org, status: { not: "CANCELLED" } }, select: { batchId: true, clientId: true, clientWorkPricePerUnit: true, status: true, plannedQuantity: true, producedQuantity: true } });
  console.log("orders", ords.length, "noBatch", ords.filter(o => !o.batchId).length, "noClient", ords.filter(o => !o.clientId).length);
})().finally(() => prisma.$disconnect());
