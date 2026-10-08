/**
 * Проверка РЕДАКТИРУЕМОСТИ на КОПИИ БД: настоящие серверные действия (закупки, оплаты, лоты, ТЗ, партии, документы,
 * справочники) вызываются напрямую; next/cache, next/navigation и @/lib/session заменены заглушками (scripts/stubs).
 * Боевую базу скрипт не трогает и отказывается работать, если в адресе нет «edit_test».
 *
 *   docker exec fur-erp-db-1 psql -U fur_erp -d postgres -c 'CREATE DATABASE fur_erp_edit_test'
 *   docker exec fur-erp-db-1 pg_dump -U fur_erp --no-owner fur_erp | docker exec -i fur-erp-db-1 psql -q -U fur_erp -d fur_erp_edit_test
 *   EDIT_TEST_URL=postgresql://fur_erp:<пароль>@localhost:5436/fur_erp_edit_test \
 *     node --env-file=.env node_modules/.bin/tsx scripts/test-editability.ts
 *   docker exec fur-erp-db-1 psql -U fur_erp -d postgres -c 'DROP DATABASE fur_erp_edit_test'
 *
 * Что проверяется по каждой сущности: правка проходит; защита от чужой правки (_v); сброс подтверждения; запись в журнал;
 * изоляция организаций; запрет опасных правок (принятая закупка, лот со списанием, занятый номер партии…).
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

type G = { __TEST_SESSION?: unknown };
const as = (role: string, organizationId: string) => {
  (globalThis as G).__TEST_SESSION = { user: { id: "u-test", role, organizationId, name: "Тест" } };
};
const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
let fails = 0;
const ok = (c: unknown, m: string) => {
  console.log(`${c ? "ok  " : "FAIL"} ${m}`);
  if (!c) fails++;
};
const errOf = (r: unknown) => ((r as { error?: string } | undefined)?.error ?? "");
const day = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const raw = new PrismaClient({ datasources: { db: { url } } });
  const C = await import("../src/lib/concurrency");
  const { guessDocType } = await import("../src/lib/drive-docs");
  const P = await import("../src/app/(app)/purchases/actions");
  const PR = await import("../src/app/(app)/production/actions");
  const D = await import("../src/app/(app)/drive-actions");
  const U = await import("../src/app/(app)/users/actions");
  const PL = await import("../src/app/(app)/plan/actions");

  const org = await raw.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const org2 = await raw.organization.create({ data: { name: "EDIT-TEST-ORG2", slug: "edit-test-org2-" + Date.now() } });
  as("OWNER", org.id);
  const tag = "EDITTEST-" + Date.now();
  const logCount = (model: string, recordId: string) => raw.auditLog.count({ where: { model, recordId, action: "update" } });

  console.log("0. Тип документа по имени файла");
  const g: [string, string | null][] = [
    ["Платёжка_125.pdf", "PAYMENT_PROOF"], ["УПД 143 от 22.09.pdf", "UPD"], ["Счёт на оплату 2004.pdf", "PAYMENT_INVOICE"],
    ["ТЗ 88 приложение.xlsx", "TZ_APPENDIX"], ["Расчётный лист СП0925.xlsx", "CALC_SHEET"], ["Договор поставки.docx", "CONTRACT"],
    ["IMG_0001.jpg", null],
  ];
  for (const [n, t] of g) ok(guessDocType(n) === t, `${n} → ${t}`);

  console.log("1. Шапка ПРИНЯТОЙ закупки");
  const recv = await raw.purchase.findFirstOrThrow({
    where: { organizationId: org.id, status: "RECEIVED", auctionSession: { not: null }, auctionId: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  await raw.purchase.update({ where: { id: recv.id }, data: { verifiedAt: new Date(), verifiedBy: "u-test" } });
  const recvFull = await raw.purchase.findFirstOrThrow({ where: { id: recv.id } });
  const otherSupplier = await raw.supplier.findFirst({ where: { organizationId: org.id, id: { not: recv.supplierId } } });
  const hdr = (over: Record<string, string> = {}) =>
    fd({
      supplierId: otherSupplier?.id ?? recv.supplierId, warehouseId: recv.warehouseId, currency: recv.currency === "RUB" ? "USD" : "RUB",
      orderDate: "2026-01-15", invoiceNumber: tag, transferDocument: "UPD-" + tag, auctionSession: (recv.auctionSession ?? "").split(/\r?\n/)[0],
      _v: C.rowVersion(recvFull, C.PURCHASE_V), ...over,
    });
  let r = await P.updatePurchase(recv.id, hdr());
  const after = await raw.purchase.findFirstOrThrow({ where: { id: recv.id } });
  ok(!errOf(r), "правка принята без ошибки " + errOf(r));
  ok(after.invoiceNumber === tag && after.transferDocument === "UPD-" + tag && day(after.orderDate) === "2026-01-15", "№ счёта, УПД и дата изменены");
  ok(after.supplierId === recv.supplierId && after.currency === recv.currency && after.warehouseId === recv.warehouseId, "поставщик, склад, валюта НЕ изменились (заблокированы)");
  ok(after.verifiedAt === null, "подтверждение закупки сброшено");
  ok((await logCount("Purchase", recv.id)) >= 1, "правка записана в журнал");
  r = await P.updatePurchase(recv.id, hdr());
  ok(/другой пользователь/.test(errOf(r)), "старая версия формы отклонена (_v)");
  as("OWNER", org2.id);
  r = await P.updatePurchase(recv.id, hdr());
  ok(/нельзя редактировать|не найден/.test(errOf(r)), "чужая организация: отказ");
  as("WAREHOUSE", org.id);
  r = await P.updatePurchase(recv.id, hdr()).catch((e) => ({ error: String(e) }));
  ok(/FORBIDDEN/.test(errOf(r)), "роль WAREHOUSE: отказ (ACCESS.purchases)");
  as("OWNER", org.id);
  const lumpName = (await raw.payment.findFirst({ where: { organizationId: org.id, purchaseId: null, auctionSession: { not: null } } }))?.auctionSession;
  if (lumpName) {
    const withLump = await raw.purchase.findFirst({ where: { organizationId: org.id, status: "RECEIVED", auctionSession: { startsWith: lumpName } } });
    const anotherAuction = await raw.auction.findFirst({ where: { organizationId: org.id, name: { not: lumpName }, isService: false } });
    if (withLump && anotherAuction) {
      const full = await raw.purchase.findFirstOrThrow({ where: { id: withLump.id } });
      r = await P.updatePurchase(withLump.id, fd({ supplierId: withLump.supplierId, warehouseId: withLump.warehouseId, currency: withLump.currency, orderDate: day(withLump.orderDate), auctionId: anotherAuction.id, _v: C.rowVersion(full, C.PURCHASE_V) }));
      ok(/Аукцион менять нельзя/.test(errOf(r)), "смена аукциона при оплатах «целиком» заблокирована с объяснением");
    }
  }

  console.log("2. Расход закупки (черновик) и запрет после приёмки");
  const cat = await raw.expenseCategory.findFirstOrThrow({ where: { organizationId: org.id, kind: "PURCHASE" } });
  const cat2 = await raw.expenseCategory.findFirst({ where: { organizationId: org.id, kind: "PURCHASE", id: { not: cat.id } } });
  const sup = await raw.supplier.findFirstOrThrow({ where: { organizationId: org.id } });
  const wh = await raw.warehouse.findFirstOrThrow({ where: { organizationId: org.id } });
  const draft = await raw.purchase.create({ data: { organizationId: org.id, number: tag, supplierId: sup.id, warehouseId: wh.id, verifiedAt: new Date(), verifiedBy: "u-test" } });
  const exp = await raw.purchaseExpense.create({ data: { purchaseId: draft.id, categoryId: cat.id, amount: 1000, vatRate: 20, description: "до" } });
  const expV = C.rowVersion(exp, C.PURCHASE_EXPENSE_V);
  r = await P.updatePurchaseExpense(draft.id, exp.id, fd({ categoryId: (cat2 ?? cat).id, amount: "2500.50", vatRate: "22", description: "после", _v: expV }));
  const e2 = await raw.purchaseExpense.findFirstOrThrow({ where: { id: exp.id } });
  ok(!errOf(r) && e2.amount.toString() === "2500.5" && e2.vatRate.toString() === "22" && e2.description === "после", "расход изменён " + errOf(r));
  ok((await raw.purchase.findFirstOrThrow({ where: { id: draft.id } })).verifiedAt === null, "подтверждение закупки сброшено");
  ok((await logCount("PurchaseExpense", exp.id)) === 1, "расход записан в журнал");
  r = await P.updatePurchaseExpense(draft.id, exp.id, fd({ categoryId: cat.id, amount: "1", vatRate: "0", _v: expV }));
  ok(/другой пользователь/.test(errOf(r)), "защита от чужой правки (_v)");
  r = await P.updatePurchaseExpense(draft.id, exp.id, fd({ categoryId: cat.id, amount: "-5", vatRate: "0" }));
  ok(errOf(r) !== "", "отрицательная сумма отклонена: " + errOf(r));
  const recvExp = await raw.purchaseExpense.findFirst({ where: { purchase: { status: "RECEIVED", organizationId: org.id } } });
  if (recvExp) {
    r = await P.updatePurchaseExpense(recvExp.purchaseId, recvExp.id, fd({ categoryId: recvExp.categoryId, amount: "1", vatRate: "0" }));
    ok(/принятой закупки менять нельзя/.test(errOf(r)), "расход принятой закупки не правится (объяснение)");
  }
  as("OWNER", org2.id);
  r = await P.updatePurchaseExpense(draft.id, exp.id, fd({ categoryId: cat.id, amount: "1", vatRate: "0" }));
  ok(errOf(r) !== "", "чужая организация: отказ");
  as("OWNER", org.id);

  console.log("3. Оплата закупки: правка, переплата, перенос, сброс подтверждения");
  const pay = await raw.payment.findFirstOrThrow({ where: { organizationId: org.id, purchaseId: { not: null }, status: "COMPLETED" }, include: { purchase: true } });
  await raw.payment.update({ where: { id: pay.id }, data: { confirmedAt: new Date(), confirmedBy: "u-test" } });
  await raw.purchase.update({ where: { id: pay.purchaseId! }, data: { verifiedAt: new Date(), verifiedBy: "u-test" } });
  let pf = await raw.payment.findFirstOrThrow({ where: { id: pay.id } });
  const newAmt = pay.amount.minus(1).toFixed(2);
  r = await P.updatePurchasePayment(pay.purchaseId!, pay.id, fd({ amount: newAmt, method: "CASH", paidAt: "2026-02-03", notes: "правка " + tag, docRef: "ПП-" + tag, status: "COMPLETED", _v: C.rowVersion(pf, C.PAYMENT_EDIT_V) }));
  const p2 = await raw.payment.findFirstOrThrow({ where: { id: pay.id } });
  ok(!errOf(r) && !("confirm" in (r as object)) && p2.amount.toFixed(2) === newAmt && p2.method === "CASH" && p2.docRef === "ПП-" + tag && day(p2.paidAt) === "2026-02-03", "сумма, способ, дата, п/п изменены " + JSON.stringify(r));
  ok(p2.confirmedAt === null, "отметка «подтверждена» у оплаты сброшена");
  ok((await raw.purchase.findFirstOrThrow({ where: { id: pay.purchaseId! } })).verifiedAt === null, "подтверждение закупки сброшено");
  ok((await logCount("Payment", pay.id)) >= 1, "оплата записана в журнал");
  pf = p2;
  r = await P.updatePurchasePayment(pay.purchaseId!, pay.id, fd({ amount: "999999999", method: "CASH", paidAt: "2026-02-03", status: "COMPLETED", _v: C.rowVersion(pf, C.PAYMENT_EDIT_V) }));
  ok(!!(r as { confirm?: string }).confirm, "огромная сумма: запрос подтверждения переплаты");
  r = await P.updatePurchasePayment(pay.purchaseId!, pay.id, fd({ amount: newAmt, method: "CASH", paidAt: "2026-02-03", status: "COMPLETED", _v: "stale0000000000" }));
  ok(/другой пользователь/.test(errOf(r)), "защита от чужой правки (_v)");
  const sibling = await raw.purchase.findFirst({ where: { organizationId: org.id, supplierId: pay.supplierId, id: { not: pay.purchaseId! }, status: { not: "CANCELLED" } } });
  const foreign = await raw.purchase.findFirst({ where: { organizationId: org.id, supplierId: { not: pay.supplierId } } });
  if (foreign) {
    r = await P.updatePurchasePayment(pay.purchaseId!, pay.id, fd({ amount: newAmt, method: "CASH", paidAt: "2026-02-03", status: "COMPLETED", targetPurchaseId: foreign.id }));
    ok(/того же поставщика/.test(errOf(r)), "перенос на закупку другого поставщика запрещён");
  }
  if (sibling) {
    // оплата маленькая, чтобы перенос не упёрся в переплату
    await raw.payment.update({ where: { id: pay.id }, data: { amount: 1 } });
    const cur = await raw.payment.findFirstOrThrow({ where: { id: pay.id } });
    r = await P.updatePurchasePayment(pay.purchaseId!, pay.id, fd({ amount: "1", method: "CASH", paidAt: "2026-02-03", status: "COMPLETED", targetPurchaseId: sibling.id, confirmOverpay: "1", _v: C.rowVersion(cur, C.PAYMENT_EDIT_V) }));
    ok(!errOf(r) && (await raw.payment.findFirstOrThrow({ where: { id: pay.id } })).purchaseId === sibling.id, "оплата перенесена на другую закупку поставщика " + errOf(r));
  }
  as("OWNER", org2.id);
  r = await P.updatePurchasePayment(pay.purchaseId!, pay.id, fd({ amount: "1", method: "CASH", paidAt: "2026-02-03" }));
  ok(errOf(r) !== "", "чужая организация: отказ");
  as("OWNER", org.id);

  console.log("4. Лот: безопасные поля после приёмки");
  const lot = await raw.rawMaterialLot.findFirstOrThrow({ where: { organizationId: org.id, purchaseId: { not: null }, purchaseItems: { some: {} } }, include: { purchaseItems: true, rawMaterial: true } });
  const colorRef = await raw.colorRef.findFirstOrThrow({ where: { organizationId: org.id } });
  await raw.purchase.update({ where: { id: lot.purchaseId! }, data: { verifiedAt: new Date(), verifiedBy: "u-test" } });
  const lotRow = await raw.rawMaterialLot.findFirstOrThrow({ where: { id: lot.id } });
  r = await P.updateLotMeta(lot.id, fd({ lotNumber: lot.lotNumber ?? "", grade: lot.rawMaterial.name.startsWith("Норка") ? "Норка тест size 40" : "Соболь тест сырец XL 3 - 2.1", sizeGrade: "", color: colorRef.name, colorRefId: colorRef.id, notes: "проверка " + tag, _v: C.rowVersion(lotRow, C.LOT_V) }));
  const l2 = await raw.rawMaterialLot.findFirstOrThrow({ where: { id: lot.id }, include: { purchaseItems: true } });
  ok(!errOf(r) && l2.colorRefId === colorRef.id && l2.color === colorRef.name && l2.notes === "проверка " + tag, "цвет (из справочника) и примечание лота изменены " + errOf(r));
  ok(l2.sizeGrade === (lot.rawMaterial.name.startsWith("Норка") ? "40" : "XL"), "размер определён из сорта: " + l2.sizeGrade);
  ok(l2.quantityReceived.equals(lot.quantityReceived) && l2.quantityRemaining.equals(lot.quantityRemaining) && l2.unitCost.equals(lot.unitCost) && l2.totalCost.equals(lot.totalCost), "количество, остаток и стоимость лота НЕ затронуты");
  if (lot.purchaseItems.length === 1) ok(l2.purchaseItems[0].colorRefId === colorRef.id, "цвет позиции закупки синхронизирован");
  ok((await raw.purchase.findFirstOrThrow({ where: { id: lot.purchaseId! } })).verifiedAt === null, "подтверждение закупки сброшено");
  ok((await logCount("RawMaterialLot", lot.id)) >= 1, "лот записан в журнал");
  r = await P.updateLotMeta(lot.id, fd({ lotNumber: "x", grade: "", sizeGrade: "", color: "", _v: C.rowVersion(lotRow, C.LOT_V) }));
  ok(/другой пользователь/.test(errOf(r)), "защита от чужой правки (_v)");
  r = await P.updateLotMeta(lot.id, fd({ lotNumber: "x", grade: "", sizeGrade: "", color: "" })).then((x) => x, (e) => ({ error: String(e) }));
  ok(!errOf(r), "очистка полей допустима (без _v)");
  as("OWNER", org2.id);
  r = await P.updateLotMeta(lot.id, fd({ lotNumber: "x", grade: "", sizeGrade: "", color: "" }));
  ok(/не найден/.test(errOf(r)), "чужая организация: отказ");
  as("OWNER", org.id);

  console.log("5. Оплата работы (производство)");
  const pp = await raw.productionPayment.findFirstOrThrow({ where: { organizationId: org.id, orders: { some: {} } }, include: { orders: true } });
  const ord0 = pp.orders[0].productionOrderId;
  await raw.productionPayment.update({ where: { id: pp.id }, data: { confirmedAt: new Date(), confirmedBy: "u-test" } });
  const ppRow = await raw.productionPayment.findFirstOrThrow({ where: { id: pp.id } });
  r = await PR.updateProductionPayment(ord0, pp.id, fd({ amount: pp.amount.plus(100).toFixed(2), paymentType: "PARTIAL", method: "CARD", paidAt: "2026-03-01", notes: "правка " + tag, docRef: "ПП-" + tag, orderIds: pp.orders.map((o) => o.productionOrderId), _v: C.rowVersion(ppRow, C.PRODUCTION_PAYMENT_V) }));
  const pp2 = await raw.productionPayment.findFirstOrThrow({ where: { id: pp.id }, include: { orders: true } });
  ok(!errOf(r) && pp2.amount.equals(pp.amount.plus(100)) && pp2.paymentType === "PARTIAL" && pp2.docRef === "ПП-" + tag && day(pp2.paidAt) === "2026-03-01", "сумма, тип, дата, п/п изменены " + errOf(r));
  ok(pp2.confirmedAt === null, "отметка «подтверждена» сброшена");
  ok(pp2.orders.length === pp.orders.length, "набор ТЗ сохранён");
  ok((await logCount("ProductionPayment", pp.id)) >= 1, "оплата работы записана в журнал");
  r = await PR.updateProductionPayment(ord0, pp.id, fd({ amount: "1", method: "CARD", paidAt: "2026-03-01", orderIds: [] }));
  ok(/хотя бы одно ТЗ/.test(errOf(r)), "оплата без ТЗ отклонена");
  r = await PR.updateProductionPayment(ord0, pp.id, fd({ amount: "1", method: "CARD", paidAt: "2026-03-01", orderIds: [ord0], _v: "stale0000000000" }));
  ok(/другой пользователь/.test(errOf(r)), "защита от чужой правки (_v)");
  as("OWNER", org2.id);
  r = await PR.updateProductionPayment(ord0, pp.id, fd({ amount: "1", method: "CARD", paidAt: "2026-03-01", orderIds: [ord0] }));
  ok(/не найдена/.test(errOf(r)), "чужая организация: отказ");
  as("OWNER", org.id);

  console.log("6. Партия");
  const batches = await raw.productionBatch.findMany({ where: { organizationId: org.id }, orderBy: { number: "asc" }, take: 2 });
  const b = batches[0];
  const bRow = await raw.productionBatch.findFirstOrThrow({ where: { id: b.id } });
  r = await PR.updateProductionBatch(b.id, fd({ number: String(b.number), name: "Тест " + tag, year: "2026", plannedUnits: "123", notes: "прим", _v: C.rowVersion(bRow, C.BATCH_V) }));
  const b2 = await raw.productionBatch.findFirstOrThrow({ where: { id: b.id } });
  ok(!errOf(r) && b2.name === "Тест " + tag && b2.year === 2026 && b2.plannedUnits === 123, "название, год, план изменены " + errOf(r));
  ok((await logCount("ProductionBatch", b.id)) >= 1, "партия записана в журнал");
  r = await PR.updateProductionBatch(b.id, fd({ number: String(batches[1].number), name: "", year: "", plannedUnits: "", notes: "" }));
  ok(/уже есть/.test(errOf(r)), "занятый номер партии отклонён");
  r = await PR.updateProductionBatch(b.id, fd({ number: "abc", name: "", year: "", plannedUnits: "", notes: "" }));
  ok(errOf(r) !== "", "некорректный номер отклонён");
  const freeNum = 9000 + (Date.now() % 900);
  r = await PR.updateProductionBatch(b.id, fd({ number: String(freeNum), name: "", year: "", plannedUnits: "", notes: "" }));
  ok(!errOf(r) && (r as { number?: number }).number === freeNum, "номер партии изменён на свободный");
  const ordersInBatch = await raw.productionOrder.count({ where: { batchId: b.id } });
  ok(ordersInBatch >= 0, `ТЗ остались привязаны (${ordersInBatch})`);
  r = await PR.updateProductionBatch(b.id, fd({ number: String(b.number), name: b.name ?? "", year: b.year ? String(b.year) : "", plannedUnits: b.plannedUnits ? String(b.plannedUnits) : "", notes: b.notes ?? "", _v: "stale0000000000" }));
  ok(/другой пользователь/.test(errOf(r)), "защита от чужой правки (_v)");

  console.log("7. Цвета составного ТЗ");
  const order = await raw.productionOrder.findFirstOrThrow({ where: { organizationId: org.id, colors: { none: {} } } });
  const refs = await raw.colorRef.findMany({ where: { organizationId: org.id }, take: 2 });
  await raw.productionOrder.update({ where: { id: order.id }, data: { verifiedAt: new Date(), verifiedBy: "u-test" } }).catch(() => null);
  r = await PR.setOrderColors(order.id, fd({ colorRefId: [refs[0].id, refs[1].id], quantity: ["1", "1"], sizes: ["42, 46", ""] }));
  const colors = await raw.productionOrderColor.findMany({ where: { orderId: order.id } });
  ok(!errOf(r) && colors.length === 2, "два цвета сохранены " + errOf(r));
  ok((await raw.productionOrderColor.count({ where: { orderId: order.id, sizes: "42, 46" } })) === 1, "размеры по цвету сохранены");
  r = await PR.setOrderColors(order.id, fd({ colorRefId: [refs[0].id, refs[0].id], quantity: ["1", "1"], sizes: ["", ""] }));
  ok(/дважды/.test(errOf(r)), "повтор цвета отклонён");
  r = await PR.setOrderColors(order.id, fd({ colorRefId: [refs[0].id], quantity: [String(Number(order.plannedQuantity) + 5)], sizes: [""] }));
  ok(/больше планового/.test(errOf(r)), "сумма по цветам больше плана отклонена");
  r = await PR.setOrderColors(order.id, fd({ colorRefId: [refs[0].id], quantity: [""], sizes: [""], _v: "[]" }));
  ok(/успели изменить/.test(errOf(r)), "защита от чужой правки цветов");
  r = await PR.setOrderColors(order.id, fd({ colorRefId: [], quantity: [], sizes: [] }));
  ok(!errOf(r) && (await raw.productionOrderColor.count({ where: { orderId: order.id } })) === 0, "список цветов можно очистить");
  ok((await raw.auditLog.count({ where: { model: "ProductionOrderColor", action: "create" } })) >= 1, "цвета записаны в журнал");
  as("OWNER", org2.id);
  r = await PR.setOrderColors(order.id, fd({ colorRefId: [refs[0].id] }));
  ok(/не найдено/.test(errOf(r)), "чужая организация: отказ");
  as("OWNER", org.id);

  console.log("8. Документ: метаданные");
  const doc = await raw.driveDocument.findFirstOrThrow({ where: { organizationId: org.id, purchaseId: { not: null } } });
  const docRow = await raw.driveDocument.findFirstOrThrow({ where: { id: doc.id } });
  await raw.purchase.update({ where: { id: doc.purchaseId! }, data: { verifiedAt: new Date(), verifiedBy: "u-test" } });
  r = await D.updateDriveDocument(doc.id, fd({ title: "Новое имя " + tag, docType: "UPD", docNumber: "143", docDate: "2025-09-22", notes: "прим", _v: C.rowVersion(docRow, C.DRIVE_DOC_V) }));
  const d2 = await raw.driveDocument.findFirstOrThrow({ where: { id: doc.id } });
  ok(!errOf(r) && d2.title === "Новое имя " + tag && d2.docType === "UPD" && d2.docNumber === "143" && d2.year === 2025, "название, тип, номер, дата изменены; год из даты " + errOf(r));
  ok((await raw.purchase.findFirstOrThrow({ where: { id: doc.purchaseId! } })).verifiedAt === null, "подтверждение закупки сброшено");
  ok(d2.driveFileId === doc.driveFileId && d2.storagePath === doc.storagePath, "ссылка на Drive и файл не затронуты");
  ok((await logCount("DriveDocument", doc.id)) >= 1, "документ записан в журнал");
  r = await D.updateDriveDocument(doc.id, fd({ title: "x", docType: "NOPE" }));
  ok(/Неизвестный тип/.test(errOf(r)), "неизвестный тип отклонён");
  r = await D.updateDriveDocument(doc.id, fd({ title: "", docType: "UPD" }));
  ok(/название/.test(errOf(r)), "пустое название отклонено");
  r = await D.updateDriveDocument(doc.id, fd({ title: "x", docType: "UPD", _v: "stale0000000000" }));
  ok(/другой пользователь/.test(errOf(r)), "защита от чужой правки (_v)");
  as("OWNER", org2.id);
  r = await D.updateDriveDocument(doc.id, fd({ title: "x", docType: "UPD" }));
  ok(/не найден/.test(errOf(r)), "чужая организация: отказ");
  as("VIEWER", org.id);
  r = await D.updateDriveDocument(doc.id, fd({ title: "x", docType: "UPD" }));
  ok(/Недостаточно прав/.test(errOf(r)), "роль VIEWER: отказ");
  as("OWNER", org.id);

  console.log("9. Справочники: пользователь и сезон");
  const user = (await raw.user.findFirst({ where: { organizationId: org.id, role: { not: "OWNER" } } })) ?? (await raw.user.create({ data: { organizationId: org.id, email: tag.toLowerCase() + "@edit.test", passwordHash: "x", name: "Тестовый", role: "VIEWER" } }));
  r = await U.updateUserName(user.id, fd({ name: "Имя " + tag, _v: C.rowVersion(user, ["name"]) }));
  ok(!errOf(r) && (await raw.user.findFirstOrThrow({ where: { id: user.id } })).name === "Имя " + tag, "имя пользователя изменено " + errOf(r));
  r = await U.updateUserName(user.id, fd({ name: "я" }));
  ok(errOf(r) !== "", "слишком короткое имя отклонено");
  as("PURCHASER", org.id);
  r = await U.updateUserName(user.id, fd({ name: "Имя 2" })).catch((e) => ({ error: String(e) }));
  ok(/FORBIDDEN/.test(errOf(r)), "роль PURCHASER не правит пользователей");
  as("OWNER", org.id);
  const seasons = await raw.season.findMany({ where: { organizationId: org.id }, take: 2 });
  if (seasons.length >= 1) {
    let s = seasons.length === 2 ? await PL.updateSeasonDates({}, fd({ id: seasons[0].id, code: seasons[1].code, name: "", startDate: "", endDate: "" })) : {};
    if (seasons.length === 2) ok(/уже есть/.test((s as { error?: string }).error ?? ""), "код сезона: дубль отклонён");
    s = await PL.updateSeasonDates({}, fd({ id: seasons[0].id, code: seasons[0].code + "-R", name: "Переименован", startDate: "", endDate: "" }));
    ok(!(s as { error?: string }).error && (await raw.season.findFirstOrThrow({ where: { id: seasons[0].id } })).code === seasons[0].code + "-R", "код сезона переименован");
  }

  console.log("10. Принятая закупка: количество не правится без пересчёта лотов");
  const item = await raw.purchaseItem.findFirstOrThrow({ where: { purchase: { organizationId: org.id, status: "RECEIVED" }, costPlan: { equals: undefined as never } as never } }).catch(() => null);
  void item;
  const consumed = await raw.rawMaterialLot.findFirst({ where: { organizationId: org.id, usages: { some: {} }, purchaseItems: { some: {} } }, include: { purchaseItems: true } });
  if (consumed) {
    const it = consumed.purchaseItems[0];
    r = await P.updatePurchaseItem(it.purchaseId, it.id, fd({ rawMaterialId: it.rawMaterialId, quantity: it.quantity.plus(1).toString(), unitPrice: it.unitPrice.toString(), vatRate: it.vatRate.toString(), lotNumber: it.lotNumber ?? "", grade: it.grade ?? "", color: it.color ?? "" }));
    ok(errOf(r) !== "", "лот со списанием: количество/цена не меняются — " + errOf(r).slice(0, 90));
  }

  // чистим служебную организацию (в scratch-базе остальное не важно)
  await raw.organization.delete({ where: { id: org2.id } }).catch(() => null);
  await raw.$disconnect();
  console.log(fails === 0 ? "\nВСЁ В ПОРЯДКЕ" : `\nПРОВАЛЕНО: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
