import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { loadDashboard } from "../src/lib/dashboard-data";
import { loadLive } from "../src/app/(app)/reconciliation/live";
import { ALL_INVOICES, ALL_GROUPS, calcInvoice, totalsOf } from "../src/app/(app)/reconciliation/model";
const prisma = new PrismaClient();
const E0 = { auction: [] as string[], fur: [] as string[], color: [] as string[], batch: [] as string[], status: [] as string[], vat: [] as string[], attr: [] as string[], catgroup: [] as string[] };
(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const all = ALL_INVOICES.map((i) => calcInvoice(i));
  const t = totalsOf(all);
  console.log("registry total", t.amount, "paid", t.paid, "count", t.count);
  for (const s of ["purchase", "production"] as const) { const x = totalsOf(all.filter((c) => c.inv.section === s)); console.log(s, x.amount, x.paid, x.count); }
  const d = await loadDashboard(org, "all", E0, "off");
  console.log("dash purchases", d.bridge.purchases, "raw.fur recv", d.raw.fur.incl.recvValue, "lining", d.raw.lining.incl.recvValue, "supplierCashPaid", d.supplierCashPaid, "paidByItem", d.paidByItem, "left", d.left, "clientWork", d.bridge.clientWork, "debt", d.debt.total.toString(), d.debt.paid.toString());
  const live = await loadLive(org);
  let sumCost = 0, sumPaid = 0;
  for (const g of ALL_GROUPS) { const x = live.group.get(g.id); if (x?.cost) sumCost += x.cost; sumPaid += x?.paid ?? 0; }
  console.log("live groups cost", sumCost, "paid", sumPaid);
  let invDb = 0; for (const [, v] of live.inv) invDb += v.paid;
  console.log("live inv paid", invDb);
  // missing in db
  let miss = 0; const rows: any[] = [];
  for (const i of ALL_INVOICES) { const docs = i.paid.filter((p) => p.evidence === "fact").reduce((a, p) => a + p.amountRub, 0); const dbp = live.inv.get(i.id)?.paid ?? 0; if (docs - dbp > 1) { miss += docs - dbp; rows.push({ no: i.no, sec: i.section, amount: i.amountRub, docs, dbp, miss: docs - dbp }); } }
  console.log("missing in db", miss); console.table(rows);
  console.log("auction rows", d.rawTable.length);
})().finally(() => prisma.$disconnect());
