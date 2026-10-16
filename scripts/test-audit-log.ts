/**
 * Проверка журнала изменений (AuditLog) на КОПИИ БД. Боевую базу не трогает.
 *
 *   docker exec fur-erp-db-1 psql -U fur_erp -d postgres -c 'CREATE DATABASE fur_erp_audit_test'
 *   docker exec fur-erp-db-1 pg_dump -U fur_erp --no-owner fur_erp | docker exec -i fur-erp-db-1 psql -q -U fur_erp -d fur_erp_audit_test
 *   AUDIT_TEST_URL=postgresql://fur_erp:<пароль>@localhost:5436/fur_erp_audit_test \
 *     node --env-file=.env node_modules/.bin/tsx scripts/test-audit-log.ts
 *   docker exec fur-erp-db-1 psql -U fur_erp -d postgres -c 'DROP DATABASE fur_erp_audit_test'
 *
 * Скрипт отказывается работать, если в адресе нет «audit_test».
 */
import { createAuditedClient } from "../src/lib/prisma";

const url = process.env.AUDIT_TEST_URL ?? "";
if (!url.includes("audit_test")) {
  console.error("Задайте AUDIT_TEST_URL на scratch-базу (имя содержит audit_test).");
  process.exit(2);
}

const prisma = createAuditedClient({ source: "script:test-audit-log", id: "u-test", name: "Тест", role: "OWNER" }, { url });
const raw = (prisma as unknown as { $rawBase: typeof prisma }).$rawBase;

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  if (cond) console.log("  ok  ", msg);
  else {
    fails++;
    console.log("  FAIL", msg);
  }
};
// Только записи, сделанные этим прогоном: в копии боевой базы журнал уже содержит старые записи тех же моделей/действий.
const startedAt = new Date(Date.now() - 2000);
const logs = (where: object = {}) => raw.auditLog.findMany({ where: { ...where, at: { gte: startedAt } }, orderBy: { at: "asc" } });
const tag = "AUDTEST-" + Date.now();

async function main() {
  const org = await raw.organization.findFirstOrThrow();
  const supplier = await raw.supplier.findFirstOrThrow({ where: { organizationId: org.id } });
  const warehouse = await raw.warehouse.findFirstOrThrow({ where: { organizationId: org.id } });
  const model = await raw.productModel.findFirstOrThrow({ where: { organizationId: org.id } });
  const material = await raw.rawMaterial.findFirstOrThrow({ where: { organizationId: org.id } });
  const base0 = await raw.auditLog.count();

  console.log("1. Purchase create / update / no-op / delete");
  const p = await prisma.purchase.create({
    data: { organizationId: org.id, number: tag, supplierId: supplier.id, warehouseId: warehouse.id, notes: "до" },
  });
  let l = await logs({ model: "Purchase", recordId: p.id });
  ok(l.length === 1 && l[0].action === "create", "create → 1 запись");
  ok(l[0].source === "script:test-audit-log" && l[0].actorName === "Тест", "актёр записан");
  ok((l[0].changes as Record<string, unknown>).number === tag && l[0].label === `Закупка ${tag}`, "снимок и название");
  await prisma.purchase.update({ where: { id: p.id }, data: { notes: "после" } });
  l = await logs({ model: "Purchase", recordId: p.id });
  const upd = l.find((x) => x.action === "update");
  ok(upd && JSON.stringify(upd.changes) === JSON.stringify({ notes: ["до", "после"] }), "update → {notes:[до,после]} без updatedAt");
  await prisma.purchase.update({ where: { id: p.id }, data: { notes: "после" } });
  ok((await logs({ model: "Purchase", recordId: p.id })).length === 2, "update без изменений не пишет");
  await prisma.purchase.update({ where: { id: p.id }, data: { verifiedAt: new Date("2026-10-04T10:00:00Z"), verifiedBy: "u-test" } });
  const ver = (await logs({ model: "Purchase", recordId: p.id })).at(-1)!;
  ok("verifiedAt" in (ver.changes as object) && "verifiedBy" in (ver.changes as object), "подтверждение записано отдельным событием");

  console.log("2. createMany → одна запись");
  const res = await prisma.purchaseItem.createMany({
    data: [1, 2, 3].map((i) => ({ purchaseId: p.id, rawMaterialId: material.id, quantity: i, unitPrice: 10, subtotal: 10 * i, lotNumber: `${tag}-${i}` })),
  });
  ok(res.count === 3, "результат createMany прежний {count:3}");
  const cm = await logs({ model: "PurchaseItem", action: "create" });
  ok(cm.length === 1 && (cm[0].changes as { count: number; ids: string[] }).count === 3 && (cm[0].changes as { ids: string[] }).ids.length === 3, "createMany(3) → 1 запись с count и ids");
  ok(cm[0].organizationId === org.id, "организация определена и у модели без organizationId (через резерв)");

  console.log("3. updateMany / deleteMany");
  await prisma.purchaseItem.updateMany({ where: { purchaseId: p.id }, data: { grade: "G1" } });
  const um = await logs({ model: "PurchaseItem", action: "update" });
  ok(um.length === 3 && new Set(um.map((x) => x.batchId)).size === 1 && !!um[0].batchId, "updateMany(3) → 3 записи с общим batchId");
  const dm = await prisma.purchaseItem.deleteMany({ where: { purchaseId: p.id } });
  ok(dm.count === 3, "deleteMany вернул count 3");
  const dl = await logs({ model: "PurchaseItem", action: "delete" });
  ok(dl.length === 3 && (dl[0].changes as Record<string, unknown>).lotNumber, "deleteMany → 3 записи с полным снимком");

  console.log("4. Payment create/update/delete");
  const pay = await prisma.payment.create({ data: { organizationId: org.id, supplierId: supplier.id, purchaseId: p.id, amount: "1000.50", docRef: "п/п 1" } });
  await prisma.payment.update({ where: { id: pay.id }, data: { amount: "2000", docRef: null } });
  const pu = (await logs({ model: "Payment", recordId: pay.id, action: "update" }))[0];
  const ch = pu.changes as Record<string, [unknown, unknown]>;
  ok(ch.amount?.[0] === "1000.5" && ch.amount?.[1] === "2000" && ch.docRef?.[0] === "п/п 1" && ch.docRef?.[1] === null, "Payment diff: сумма и основание");
  await prisma.payment.delete({ where: { id: pay.id } });
  ok((await logs({ model: "Payment", recordId: pay.id, action: "delete" })).length === 1, "Payment delete записан");

  console.log("5. ProductionOrder + дочерние при удалении");
  const po = await prisma.productionOrder.create({
    data: { organizationId: org.id, number: tag, productModelId: model.id, rawWarehouseId: warehouse.id, finishedWarehouseId: warehouse.id, plannedQuantity: 5 },
  });
  await prisma.productionOrder.update({ where: { id: po.id }, data: { status: "IN_PROGRESS", notes: "заметка" } });
  const pod = (await logs({ model: "ProductionOrder", recordId: po.id, action: "update" }))[0].changes as Record<string, [unknown, unknown]>;
  ok(pod.status?.[1] === "IN_PROGRESS" && pod.notes?.[0] === null, "ProductionOrder diff");
  const cat = await raw.expenseCategory.findFirstOrThrow({ where: { organizationId: org.id } });
  await prisma.productionExpense.create({ data: { productionOrderId: po.id, categoryId: cat.id, amount: 7 } });
  await prisma.productionOrder.delete({ where: { id: po.id } });
  const pdel = (await logs({ model: "ProductionOrder", recordId: po.id, action: "delete" }))[0];
  const kids = (pdel.changes as { _children?: { expenses?: unknown[] } })._children;
  ok(kids?.expenses?.length === 1, "delete ТЗ: в снимке есть каскадные расходы");

  console.log("6. Транзакции");
  const before = await raw.auditLog.count();
  await prisma
    .$transaction(async (tx) => {
      await tx.payment.create({ data: { organizationId: org.id, supplierId: supplier.id, amount: 1, notes: tag + "-rollback" } });
      throw new Error("откат");
    })
    .catch(() => undefined);
  ok((await raw.auditLog.count()) === before, "откат транзакции откатил и запись журнала");
  ok((await raw.payment.count({ where: { notes: tag + "-rollback" } })) === 0, "и саму оплату");
  await prisma.$transaction(async (tx) => {
    const a = await tx.payment.create({ data: { organizationId: org.id, supplierId: supplier.id, amount: 5, notes: tag + "-tx" } });
    await tx.payment.update({ where: { id: a.id }, data: { amount: 6 } }); // читает строку, созданную в этой же транзакции
  });
  const txl = await logs({ model: "Payment", action: { in: ["create", "update"] } });
  const mine = txl.filter((x) => x.label?.startsWith("Оплата 5 ₽") || x.label?.startsWith("Оплата 6 ₽"));
  ok(mine.length === 2 && mine[0].batchId && mine[0].batchId === mine[1].batchId, "две правки в одной транзакции: общий batchId, обе записаны");
  await prisma.$transaction([
    prisma.payment.create({ data: { organizationId: org.id, supplierId: supplier.id, amount: 8, notes: tag + "-batch" } }),
    prisma.payment.updateMany({ where: { notes: tag + "-tx" }, data: { notes: tag + "-tx2" } }),
  ]);
  const bl = await logs({ model: "Payment", action: "create" });
  ok(bl.some((x) => x.label?.startsWith("Оплата 8 ₽")), "$transaction([..]) массивом: запись создана");

  console.log("7. Секреты и белый список");
  const u = await prisma.user.create({ data: { organizationId: org.id, email: `${tag}@x.test`, passwordHash: "SECRET-HASH", name: "Тест Пользователь" } });
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: "SECRET-HASH-2", name: "Новое имя" } });
  const ul = await logs({ model: "User" });
  ok(!JSON.stringify(ul).includes("SECRET-HASH"), "passwordHash не попал в журнал");
  ok(ul.some((x) => (x.changes as Record<string, unknown>).name && Array.isArray((x.changes as Record<string, unknown>).name)), "User diff по имени");
  const wh = await prisma.warehouse.update({ where: { id: warehouse.id }, data: { name: warehouse.name } });
  ok(wh.id === warehouse.id && (await logs({ model: "Warehouse" })).length === 0, "модель вне белого списка не пишется");
  const big = "я".repeat(5000);
  await prisma.purchase.update({ where: { id: p.id }, data: { notes: big } });
  const bigLog = (await logs({ model: "Purchase", recordId: p.id })).at(-1)!;
  ok(JSON.stringify(bigLog.changes).length < 4300, "длинные строки усечены");

  console.log("8. Очистка тестовых строк");
  await prisma.user.delete({ where: { id: u.id } });
  await prisma.payment.deleteMany({ where: { notes: { startsWith: tag } } });
  await prisma.purchase.delete({ where: { id: p.id } });
  const total = (await raw.auditLog.count()) - base0;
  console.log(`  записей журнала за прогон: ${total}`);
  ok(total > 20, "журнал накопил записи");
}

main()
  .catch((e) => {
    fails++;
    console.error(e);
  })
  .finally(async () => {
    await raw.$disconnect();
    console.log(fails === 0 ? "\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" : `\nПРОВАЛЕНО: ${fails}`);
    process.exit(fails === 0 ? 0 : 1);
  });
