// «Произведено» по ТЗ: выпуском считается ТОЛЬКО завершённое ТЗ (production-totals.ts). У ТЗ 75, 97, 104, 158 статус «Запланировано», но в базе producedQuantity = плану:
// это не выпуск (в расчёте не учитывается, в базе не меняем). Заодно: CSV артикулов и справочник считают «Произведено» той же функцией orderUnits.
// Только чтение.   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-production-units.ts
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { inWorkUnits, orderUnits, producedUnits, productionSplit } from "../src/lib/production-totals";

const prisma = new PrismaClient();
let fails = 0, checks = 0;
const eq = (what: string, got: number, want: number, tol = 0) => { checks++; if (Math.abs(got - want) > tol) { fails++; console.log(`  ✗ ${what}: ${got} ≠ ${want}`); } };
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

(async () => {
  const orders = await prisma.productionOrder.findMany({ where: { status: { not: "CANCELLED" } }, select: { workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true } });
  const done = orders.filter((o) => o.status === "COMPLETED"), open = orders.filter((o) => o.status !== "COMPLETED");
  eq("Σ «выпущено» = Σ producedQuantity только завершённых ТЗ", sum(orders.map((o) => producedUnits(o))), sum(done.map((o) => Number(o.producedQuantity))));
  const ghosts = open.filter((o) => Number(o.producedQuantity) > 0);
  for (const o of ghosts) {
    eq(`ТЗ ${o.workOrderNumber} (${o.status}): выпуск не засчитан`, producedUnits(o), 0);
    eq(`ТЗ ${o.workOrderNumber}: в расчёте — план (${o.plannedQuantity})`, orderUnits(o), Number(o.plannedQuantity));
    eq(`ТЗ ${o.workOrderNumber}: «в работе» = план`, inWorkUnits(o), Number(o.plannedQuantity));
  }
  const sp = productionSplit(orders);
  eq("Σ произведено + в работе = Σ orderUnits", sp.producedUnits + sp.inWorkUnits, sum(orders.map((o) => orderUnits(o))));
  eq("ТЗ с «призрачным» выпуском среди незавершённых (75, 97, 104, 158)", ghosts.map((o) => o.workOrderNumber ?? "").filter((n) => ["75", "97", "104", "158"].includes(n)).length, ghosts.length === 0 ? 0 : 4, ghosts.length === 0 ? 0 : 4);
  // CSV артикулов: те же цифры, что и в справочнике — orderUnits по ТЗ без отменённых
  const byModel = new Map<string, number>();
  for (const o of await prisma.productionOrder.findMany({ where: { status: { not: "CANCELLED" } }, select: { productModelId: true, status: true, plannedQuantity: true, producedQuantity: true } })) byModel.set(o.productModelId, (byModel.get(o.productModelId) ?? 0) + orderUnits(o));
  eq("Σ по артикулам = Σ orderUnits по всем ТЗ", sum([...byModel.values()]), sum(orders.map((o) => orderUnits(o))), 1e-6);
  console.log(`\nПроизведено (ТЗ): проверок ${checks}, расхождений ${fails}`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})();
