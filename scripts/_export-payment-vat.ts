// Только чтение: доля НДС по каждому платежу (как в разделе Cashflow) → JSON для сверки с Excel.
import "./stubs/server-only-shim";
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { loadPaymentsOverview } from "../src/lib/payments-overview";
import { loadPurchaseVat } from "../src/lib/cashflow-server";
import { vatShares } from "../src/lib/cashflow";
const prisma = new PrismaClient();
(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const [rows, pv] = await Promise.all([loadPaymentsOverview(org), loadPurchaseVat(org)]);
  const vs = vatShares(rows, pv);
  writeFileSync(process.argv[2], JSON.stringify(rows.map((r) => ({ id: r.id, kind: r.kind, iso: r.iso, amount: r.amount, pp: r.pp, doc: r.doc, share: vs.share.get(r.id) ?? 0 })), null, 1));
  console.log(rows.length, vs.vat, vs.unknown);
  await prisma.$disconnect();
})();
