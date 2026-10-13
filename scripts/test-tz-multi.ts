/**
 * Проверка «Нового ТЗ» с несколькими артикулами (createProductionOrder + поле extras) на КОПИИ БД.
 * Отказывается работать, если в адресе нет «wiz_test». Запуск:
 *   WIZ_TEST_URL=postgresql://…/wiz_test_multi node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-tz-multi.ts
 */
import Module from "module";
import { join } from "path";

const url = process.env.WIZ_TEST_URL ?? "";
if (!url.includes("wiz_test")) { console.error("Задайте WIZ_TEST_URL на scratch-базу (имя содержит wiz_test)."); process.exit(2); }
process.env.DATABASE_URL = url;
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
const stub = (n: string) => join(__dirname, "stubs", n);
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return stub("empty.js");
  if (req === "next/cache") return stub("next-cache.js");
  if (req === "next/navigation") return stub("next-navigation.js");
  if (req === "@/lib/session") return stub("session-stub.js");
  return orig.call(this, req, ...rest);
};
let fails = 0;
const ok = (c: unknown, m: string) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) fails++; };

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { createProductionOrder } = await import("../src/app/(app)/production/actions");
  const org = (await prisma.organization.findFirst())!.id;
  const user = await prisma.user.findFirst({ where: { organizationId: org, role: "OWNER" } }) ?? (await prisma.user.findFirst({ where: { organizationId: org } }))!;
  (globalThis as { __TEST_SESSION?: unknown }).__TEST_SESSION = { user: { id: user.id, role: user.role, organizationId: org, name: "Тест" } };
  const models = await prisma.productModel.findMany({ where: { organizationId: org }, take: 3, select: { id: true } });
  const wh = (await prisma.warehouse.findFirst({ where: { organizationId: org } }))!.id;
  const no = "TEST-MULTI-" + Date.now();
  const fd = new FormData();
  const set = (o: Record<string, string>) => Object.entries(o).forEach(([k, v]) => fd.set(k, v));
  set({ productModelId: models[0].id, plannedQuantity: "10", size: "42", workOrderNumber: no, workOrderDate: "2026-10-01", rawWarehouseId: wh, finishedWarehouseId: wh, clientWorkPricePerUnit: "1000", intent: "again" });
  fd.set("draft", JSON.stringify({ fur: [], lining: [], expenses: [] }));
  fd.set("extras", JSON.stringify([
    { productModelId: models[1].id, plannedQuantity: 5, size: "44", clientWorkPricePerUnit: 1500 },
    { productModelId: models[2].id, plannedQuantity: 7, color: "Тест-цвет" },
  ]));
  const r = await createProductionOrder({}, fd);
  ok(!!r.created, "созданo: " + JSON.stringify(r));
  const rows = await prisma.productionOrder.findMany({ where: { organizationId: org, workOrderNumber: no }, orderBy: { number: "asc" } });
  ok(rows.length === 3, `3 позиции с одним № ТЗ (${rows.length})`);
  ok(new Set(rows.map((x) => x.number)).size === 3, "внутренние номера разные");
  ok(rows.map((x) => Number(x.plannedQuantity)).sort().join() === "10,5,7".split(",").map(Number).sort().join(), "количества 10/5/7");
  // ошибка во 2-й позиции → ничего не создаётся
  const no2 = no + "-B";
  const fd2 = new FormData();
  fd2.set("productModelId", models[0].id); fd2.set("plannedQuantity", "1"); fd2.set("workOrderNumber", no2); fd2.set("rawWarehouseId", wh); fd2.set("finishedWarehouseId", wh);
  fd2.set("extras", JSON.stringify([{ productModelId: "нет-такого", plannedQuantity: 1 }]));
  const r2 = await createProductionOrder({}, fd2);
  ok(!!r2.errors && (await prisma.productionOrder.count({ where: { workOrderNumber: no2 } })) === 0, "неверный артикул позиции → ничего не создано");
  await prisma.$disconnect();
  if (fails) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
