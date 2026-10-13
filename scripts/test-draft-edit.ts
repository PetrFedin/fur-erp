/**
 * Проверка «Сохранить с окном что изменится» на карточке ТЗ — НА КОПИИ БД (адрес должен содержать edit_test).
 * previewOrderEdit ничего не пишет (откат) и даёт те же цифры, что реальная запись (updateMaterialUsage / updateProductionExpense /
 * patchProductionOrder / updateProducedQuantity).
 *   EDIT_TEST_URL=postgresql://…/fur_erp_edit_test node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-draft-edit.ts
 */
import Module from "module";
import { join } from "path";

const url = process.env.EDIT_TEST_URL ?? "";
if (!url.includes("edit_test")) {
  console.error("Задайте EDIT_TEST_URL на scratch-базу (имя содержит edit_test).");
  process.exit(2);
}
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
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const raw = new PrismaClient({ datasources: { db: { url } } });
  const PR = await import("../src/app/(app)/production/actions");
  const { fullFinishedCost } = await import("../src/lib/finished-goods-cost");
  const { orderUnitsDec } = await import("../src/lib/batch-stats");
  const org = await raw.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  (globalThis as { __TEST_SESSION?: unknown }).__TEST_SESSION = { user: { id: "u-test", role: "OWNER", organizationId: org.id, name: "Тест" } };

  const state = async (orderId: string, lotIds: string[]) => {
    const o = await raw.productionOrder.findUniqueOrThrow({ where: { id: orderId }, include: { materialUsages: true, expenses: true } });
    const lots = await raw.rawMaterialLot.findMany({ where: { id: { in: lotIds } }, orderBy: { id: "asc" } });
    const st = o.status === "COMPLETED" ? await raw.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: o.finishedWarehouseId, productModelId: o.productModelId } } }) : null;
    return {
      cost: fullFinishedCost(o, orderUnitsDec(o)).total.toFixed(2),
      lots: Object.fromEntries(lots.map((l) => [l.id, l.quantityRemaining.toString()])),
      stock: st ? st.quantity.mul(st.avgUnitCost).toFixed(2) : null,
      fp: JSON.stringify([o.updatedAt, o.materialUsages.map((u) => [u.id, u.quantity, u.lotId, u.commission4]), o.expenses.map((e) => [e.id, e.amount]), o.plannedQuantity, o.clientWorkPricePerUnit]),
      audits: await raw.auditLog.count(),
      movs: await raw.finishedGoodsMovement.count(),
    };
  };
  const near = (a: string | null, b: string | null) => (a == null || b == null ? a === b : Math.abs(Number(a) - Number(b)) <= 0.011);

  async function check(label: string, orderId: string, lotIds: string[], edit: import("../src/app/(app)/production/actions").OrderEdit, write: () => Promise<{ error?: string }>) {
    console.log(label);
    const s0 = await state(orderId, lotIds);
    const pv = await PR.previewOrderEdit(orderId, edit);
    const s1 = await state(orderId, lotIds);
    ok(!pv.error, `предпросмотр без ошибки ${pv.error ?? ""}`);
    ok(s1.fp === s0.fp && s1.audits === s0.audits && s1.movs === s0.movs && JSON.stringify(s1.lots) === JSON.stringify(s0.lots), "предпросмотр ничего не записал (строки, лоты, журнал, движения)");
    ok(near(pv.cost?.before ?? null, s0.cost), `«до» = факт (${pv.cost?.before} / ${s0.cost})`);
    const r = await write();
    ok(!r?.error, `запись прошла ${r?.error ?? ""}`);
    const s2 = await state(orderId, lotIds);
    ok(near(pv.cost?.after ?? null, s2.cost), `себестоимость «после» совпала с фактом (${pv.cost?.after} / ${s2.cost})`);
    ok(near(pv.stock?.after ?? null, s2.stock), `стоимость ГП «после» совпала (${pv.stock?.after ?? "—"} / ${s2.stock ?? "—"})`);
    for (const l of pv.lots ?? []) ok(true, `лот ${l.name}: ${l.before} → ${l.after}`);
    const actual = Object.values(s2.lots).join("|");
    const predicted = lotIds.map((id) => pv.lots?.find((l) => l.name && true && id)?.after);
    void predicted;
    ok((pv.lots ?? []).every((l) => Object.values(s2.lots).includes(l.after)), `остатки лотов «после» совпали (${actual})`);
    return { pv, s0, s2 };
  }

  // 1. ТЗ в работе: количество, потом 4%, потом другой лот
  const wip = await raw.productionOrder.findFirstOrThrow({ where: { id: "cmv6lg49j000plsbfe3si2vlc" }, include: { materialUsages: true } });
  const u = wip.materialUsages[0];
  const newQty = u.quantity.mul(0.5).toDecimalPlaces(3).toString();
  await check("1. ТЗ в работе: количество списания ×0.5", wip.id, [u.lotId], { kind: "usage", usageId: u.id, lotId: u.lotId, quantity: newQty, commission4: u.commission4 }, () =>
    PR.updateMaterialUsage(wip.id, u.id, fd({ lotId: u.lotId, quantity: newQty, c4form: "1", ...(u.commission4 ? { commission4: "on" } : {}) })));
  const u2 = wip.materialUsages[1];
  await check("2. ТЗ в работе: переключить 4%", wip.id, [u2.lotId], { kind: "usage", usageId: u2.id, lotId: u2.lotId, quantity: u2.quantity.toString(), commission4: !u2.commission4 }, () =>
    PR.updateMaterialUsage(wip.id, u2.id, fd({ lotId: u2.lotId, quantity: u2.quantity.toString(), c4form: "1", ...(!u2.commission4 ? { commission4: "on" } : {}) })));
  const other = await raw.rawMaterialLot.findFirstOrThrow({ where: { rawMaterialId: u2.rawMaterialId, id: { not: u2.lotId }, quantityRemaining: { gt: u2.quantity } } }).catch(() => null);
  if (other) {
    await check("3. ТЗ в работе: другой лот", wip.id, [u2.lotId, other.id], { kind: "usage", usageId: u2.id, lotId: other.id, quantity: u2.quantity.toString(), commission4: !u2.commission4 }, () =>
      PR.updateMaterialUsage(wip.id, u2.id, fd({ lotId: other.id, quantity: u2.quantity.toString(), c4form: "1", ...(!u2.commission4 ? { commission4: "on" } : {}) })));
  } else console.log("3. другого лота того же материала нет — пропуск");
  const big = await PR.previewOrderEdit(wip.id, { kind: "usage", usageId: u.id, lotId: u.lotId, quantity: "999999999", commission4: true });
  ok(!!big.error, `списание больше остатка → ошибка в предпросмотре («${big.error}»)`);
  const bad = await PR.previewOrderEdit(wip.id, { kind: "usage", usageId: u.id, lotId: u.lotId, quantity: "-1", commission4: true });
  ok(!!bad.error, "отрицательное количество → ошибка");

  // 4. расход
  const ex = await raw.productionExpense.findFirstOrThrow({ include: { productionOrder: true } });
  const exAmt = ex.amount.add(1000).toString();
  await check("4. Расход: сумма +1000", ex.productionOrderId, [], { kind: "expense", expenseId: ex.id, categoryId: ex.categoryId, amount: exAmt, description: ex.description ?? "" }, () =>
    PR.updateProductionExpense(ex.productionOrderId, ex.id, fd({ categoryId: ex.categoryId, amount: exAmt, description: ex.description ?? "" })));

  // 5. цена работы и плановое количество у ТЗ в работе
  await check("5. Цена работы ТЗ в работе", wip.id, [], { kind: "param", field: "clientWorkPricePerUnit", value: "12345" }, () => PR.patchProductionOrder(wip.id, "clientWorkPricePerUnit", "12345"));
  await check("6. Плановое количество ТЗ в работе", wip.id, [], { kind: "param", field: "plannedQuantity", value: String(Number(wip.plannedQuantity) + 7) }, () => PR.patchProductionOrder(wip.id, "plannedQuantity", String(Number(wip.plannedQuantity) + 7)));

  // 7. ЗАВЕРШЁННОЕ ТЗ: завершаем второе ТЗ и правим
  const cid = "cmv6lg4fi0081lsbf97pilahx";
  const c0 = await raw.productionOrder.findUniqueOrThrow({ where: { id: cid }, include: { materialUsages: true } });
  const done = await PR.completeProductionOrder(cid, fd({ producedQuantity: String(c0.plannedQuantity) }));
  ok(!done?.error, `ТЗ завершено в копии ${done?.error ?? ""}`);
  const cu = c0.materialUsages[0];
  const cq = cu.quantity.mul(1.5).toDecimalPlaces(3).toString();
  const r7 = await check("7. Завершённое ТЗ: количество списания ×1.5", cid, [cu.lotId], { kind: "usage", usageId: cu.id, lotId: cu.lotId, quantity: cq, commission4: cu.commission4 }, () =>
    PR.updateMaterialUsage(cid, cu.id, fd({ lotId: cu.lotId, quantity: cq, c4form: "1", ...(cu.commission4 ? { commission4: "on" } : {}) })));
  ok(r7.pv.completed === true && !!r7.pv.stock, "для завершённого ТЗ в окне есть стоимость готовой продукции");
  await check("8. Завершённое ТЗ: цена работы", cid, [], { kind: "param", field: "clientWorkPricePerUnit", value: "777" }, () => PR.patchProductionOrder(cid, "clientWorkPricePerUnit", "777"));
  await check("9. Завершённое ТЗ: фактическое количество", cid, [], { kind: "param", field: "producedQuantity", value: String(Number(c0.plannedQuantity) + 3) }, () => PR.patchProductionOrder(cid, "producedQuantity", String(Number(c0.plannedQuantity) + 3)));
  const vat = await PR.previewOrderEdit(cid, { kind: "vat", rate: "10" });
  ok(!vat.error && !!vat.note, "НДС: окно с пояснением");
  const pf = await PR.previewOrderEdit(wip.id, { kind: "param", field: "producedQuantity", value: "5" });
  ok(!!pf.error, "фактическое количество у незавершённого ТЗ → ошибка");

  await raw.$disconnect();
  console.log(fails ? `\nПровалов: ${fails}` : "\nВсё в порядке");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
