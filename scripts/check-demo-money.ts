// Контрольные суммы для сверки демо с основной системой: печатает JSON. Только чтение.
//   DATABASE_URL=… node --conditions=react-server node_modules/.bin/tsx scripts/check-demo-money.ts
// Одинаковые числа на живой и на демо-базе (коэффициент денег 1) = суммы настоящие.
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { loadDashboard } from "../src/lib/dashboard-data";

const prisma = new PrismaClient();
const E0 = { auction: [] as string[], fur: [] as string[], color: [] as string[], batch: [] as string[], status: [] as string[], vat: [] as string[], attr: [] as string[], catgroup: [] as string[] };
const num = (v: unknown) => Number(v ?? 0);

(async () => {
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const out: Record<string, unknown> = {};
  for (const c4 of ["on", "off"] as const) {
    const d = await loadDashboard(org, "all", E0, c4);
    out[`dashboard.${c4}.paidByItem`] = d.paidByItem;
    out[`dashboard.${c4}.rawMoneyTotal`] = { paid: d.rawMoneyTotal.paid, due: d.rawMoneyTotal.due };
    out[`dashboard.${c4}.furBoughtIncl`] = d.rawTable.filter((r) => r.kind === "fur").reduce((a, r) => a + r.cells.incl.rv, 0).toFixed(2);
    out[`dashboard.${c4}.rawTable`] = d.rawTable.map((r) => ({ kind: r.kind, cells: r.cells, paid: r.paid, due: r.due }));
  }
  // Суммы по таблицам: Σ каждой денежной колонки (то, что умножал бы коэффициент)
  const cols: [string, string][] = [["Payment", "amount"], ["PaymentAllocation", "amount"], ["Invoice", "amountInclVat"], ["PurchaseItem", "subtotal"], ["PurchaseItem", "unitPrice"],
    ["RawMaterialLot", "totalCost"], ["RawMaterialLot", "materialCostExclVat"], ["PurchaseExpense", "amount"], ["ProductionOrder", "totalCost"], ["ProductionOrder", "clientWorkPricePerUnit"],
    ["ProductionOrder", "materialCost"], ["ProductionExpense", "amount"], ["ProductionPayment", "amount"], ["ProductionMaterialUsage", "totalCost"], ["StockMovement", "totalCost"],
    ["FinishedGoodsMovement", "totalCost"], ["ProductModel", "sellingPrice"], ["ProductModel", "supplierWorkPrice"]];
  const sums: Record<string, string> = {};
  for (const [t, c] of cols) sums[`${t}.${c}`] = String((await prisma.$queryRawUnsafe<{ s: unknown }[]>(`select coalesce(sum("${c}"),0)::text as s from "${t}"`))[0].s);
  out.sums = sums;
  // Себестоимость ТЗ №172 (по номеру ТЗ заказчика): материалы + 4 % + расходы (+ работа) — то, что показывает карточка ТЗ
  const { fullFinishedCost } = await import("../src/lib/finished-goods-cost");
  const tz = await prisma.productionOrder.findMany({ where: { workOrderNumber: "172" }, include: { materialUsages: true, expenses: true } });
  out.tz172 = tz.map((o) => { const f = fullFinishedCost(o, o.plannedQuantity); return { material: f.material.toFixed(2), extra4: f.extra4.toFixed(2), expenses: f.expenses.toFixed(2), work: f.work.toFixed(2), total: f.total.toFixed(2), withoutWork: f.total.sub(f.work).toFixed(2) }; });
  // Дробные числа — до копейки: порядок строк в разных базах разный, и плавающая сумма отличается на ~1e-8.
  console.log(JSON.stringify(out, (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v), 1));
  void num;
  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
