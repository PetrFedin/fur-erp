import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { loadLive } from "../src/app/(app)/reconciliation/live";
import { ALL_INVOICES, ALL_GROUPS, groupInvoices, totalsOf } from "../src/app/(app)/reconciliation/model";
import { loadDebtInputs, supplierDebtFromInputs } from "../src/lib/supplier-debt";
const prisma = new PrismaClient();
(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const live = await loadLive(org);
  const ids = new Set(ALL_INVOICES.map((i) => i.id));
  const rows: any[] = [];
  let sr = 0, sd = 0;
  for (const g of ALL_GROUPS) {
    const t = totalsOf(groupInvoices(g, ids));
    const db = live.group.get(g.id);
    rows.push({ sec: g.section, id: g.id.slice(0, 28), reg: t.amount, regPaid: t.paid, dbCost: db?.cost ?? null, dbPaid: db?.paid ?? 0, diff: db?.cost != null ? Math.round((t.amount - db.cost)) : null, note: db?.note });
    sr += t.amount; if (db?.cost) sd += db.cost;
  }
  console.table(rows);
  console.log("sum group reg (shares)", sr, "sum db", sd);
  const inp = await loadDebtInputs(prisma, org);
  const d = supplierDebtFromInputs(inp, "all");
  console.log({ total: d.total.toString(), receivedNet: d.receivedNet.toString(), invoiced: d.invoiced.toString(), expected: d.expected.toString(), paid: d.paid.toString(), unlinked: d.unlinkedAdvances.toString(), debt: d.debt.toString(), byAuction: d.byAuction.length });
  console.table(d.byAuction.map((a: any) => ({ name: a.name, total: a.total.toString(), paid: a.paid.toString(), due: a.due.toString(), invoiced: a.dueInvoiced.toString() })));
})().finally(() => prisma.$disconnect());
