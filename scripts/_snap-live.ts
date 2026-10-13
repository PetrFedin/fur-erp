// Разовый снимок цифр боевой базы (только чтение). Не коммитить.
import Module from "module";
import { join } from "path";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const o = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return o.call(this, req, ...rest);
};
async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { loadSupplierDebt } = await import("../src/lib/supplier-debt");
  const p = new PrismaClient();
  const org = (await p.organization.findFirstOrThrow()).id;
  const d = await loadSupplierDebt(p, org);
  const q = async (s: string) => (await p.$queryRawUnsafe<Record<string, unknown>[]>(s))[0];
  const out = {
    debt: d.debt.toFixed(2),
    orders: Number((await q('select count(*) c from "ProductionOrder"')).c),
    usages: Number((await q('select count(*) c from "ProductionMaterialUsage"')).c),
    payments: String((await q(`select count(*)||' / '||coalesce(sum(amount),0) c from "Payment" where status='COMPLETED'`)).c),
    prodPayments: String((await q(`select count(*)||' / '||coalesce(sum(amount),0) c from "ProductionPayment"`)).c),
    payAll: Number((await q('select count(*) c from "Payment"')).c),
    lots: String((await q('select count(*)||\' / \'||sum("quantityRemaining") c from "RawMaterialLot"')).c),
    stockMov: Number((await q('select count(*) c from "StockMovement"')).c),
    docs: Number((await q('select count(*) c from "DriveDocument"')).c) + "/" + Number((await q('select count(*) c from "PurchaseDocument"')).c),
    batches: Number((await q('select count(*) c from "ProductionBatch"')).c),
    models: Number((await q('select count(*) c from "ProductModel"')).c),
    colors: Number((await q('select count(*) c from "ColorRef"')).c),
    clients: Number((await q('select count(*) c from "Client"')).c),
    orderColors: Number((await q('select count(*) c from "ProductionOrderColor"')).c),
    ppo: Number((await q('select count(*) c from "ProductionPaymentOrder"')).c),
    verified: Number((await q('select count(*) c from "Payment" where "confirmedAt" is not null')).c),
    marker: String((await q(`select count(*) c from "ProductionOrder" where number like 'TEST-%' or "workOrderNumber" like 'TEST-%' or notes like '%[WIZ-TEST]%'`)).c),
    payTest: String((await q(`select count(*) c from "Payment" where notes like '%WIZ-TEST%'`)).c),
  };
  console.log(JSON.stringify(out, null, 1));
  await p.$disconnect();
}
main();
