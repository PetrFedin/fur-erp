/**
 * Списание подкладки по ТЗ-приложениям Google Drive «мех» — ТОЛЬКО для ТЗ, где проверкой доказано: подкладка в стоимость
 * ТЗ в базе НЕ входит (см. docs-inventory/lining-verification.md). Данные — только из документов Drive; у каждой строки
 * ниже указаны метры/цена/итоги прямо из ТЗ-приложения.
 *
 * Запуск (по умолчанию DRY-RUN: всё выполняется в одной транзакции по живым данным, печатается план и сверка «до/после»,
 * затем транзакция ОТКАТЫВАЕТСЯ — в базе ничего не остаётся):
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-lining.ts
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-lining.ts --apply
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-lining.ts --only 80,81,85      (только указанные ТЗ)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-lining.ts --rollback docs-inventory/corrections-journal-lining.json [--apply]
 *
 * ПЕРЕД --apply СДЕЛАЙТЕ БЭКАП БАЗЫ (scripts/backup.sh).
 *
 * Защита от двойного счёта: ТЗ пропускается, если у него уже есть ЛЮБОЕ списание «Подкладочной ткани…» (в т.ч. от
 * apply-drive-open-items.ts, п.2) либо движение с тегом [open-items:lining TZ…] / [drive-lining TZ…]. Поэтому скрипт
 * можно запускать независимо от пункта 2 apply-drive-open-items.ts (и пункт 2 его после этого ничего не спишет повторно).
 *
 * Списание: логика consumeFromLot (движение PRODUCTION_OUT + строка ProductionMaterialUsage, commission4 = true, цена =
 * цена лота 2 140 ₽/м, остаток лота уменьшается, отрицательных остатков не бывает — проверка до списания);
 * для «завершённого» ТЗ пересчёт materialCost/totalCost/unitCost и остатка готовой продукции — копия syncCompletedOrderCost
 * из src/app/(app)/production/actions.ts.
 * Журнал docs-inventory/corrections-journal-lining.json: записи {time, entity, id, field, before, after, source};
 * field = "__create__" (откат удалит) либо изменение поля (откат вернёт before).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const rbIdx = process.argv.indexOf("--rollback");
const ROLLBACK_FILE = rbIdx >= 0 ? process.argv[rbIdx + 1] : null;
const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx >= 0 ? new Set(process.argv[onlyIdx + 1].split(",").map((s) => s.trim())) : null;
const JOURNAL = resolve(__dirname, "..", "docs-inventory", "corrections-journal-lining.json");

type Tx = Prisma.TransactionClient;
type Entry = { time: string; entity: string; id: string; field: string; before: unknown; after: unknown; source: string };
type Ctx = { tx: Tx; J: Entry[]; log: string[]; orgId: string };

const MODEL: Record<string, string> = {
  Purchase: "purchase", PurchaseItem: "purchaseItem", RawMaterialLot: "rawMaterialLot", StockMovement: "stockMovement",
  RawMaterial: "rawMaterial", DriveDocument: "driveDocument", Payment: "payment",
  ProductionMaterialUsage: "productionMaterialUsage", ProductionOrder: "productionOrder", ProductionBatch: "productionBatch",
  FinishedGoodsStock: "finishedGoodsStock", FinishedGoodsMovement: "finishedGoodsMovement", ProductModel: "productModel",
};
const JSON_FIELDS = new Set(["costPlan", "costBreakdown", "extra"]);
class DryRunDone extends Error {}

const r2 = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const snap = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const fmt = (v: Decimal.Value | null | undefined) => (v == null ? "∅" : new Decimal(v).toFixed(2));
const NOW = new Date();

function eq(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (a instanceof Date || b instanceof Date) return new Date(a as never).getTime() === new Date(b as never).getTime();
  if (Decimal.isDecimal(a) || Decimal.isDecimal(b)) return new Decimal(a as never).eq(new Decimal(b as never));
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(snap(a)) === JSON.stringify(snap(b));
  return a === b;
}
function toData(data: Record<string, unknown>) {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) o[k] = v === null && JSON_FIELDS.has(k) ? Prisma.DbNull : v;
  return o;
}
const delegate = (tx: Tx, entity: string) => (tx as unknown as Record<string, any>)[MODEL[entity]]; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Обновление полей с журналом before/after (значения «после» перечитываются из БД). Возвращает список изменённых полей. */
async function upd(c: Ctx, entity: string, id: string, data: Record<string, unknown>, source: string): Promise<string[]> {
  const m = delegate(c.tx, entity);
  const cur = await m.findUniqueOrThrow({ where: { id } });
  const changed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!eq(cur[k], v)) changed[k] = v;
  const keys = Object.keys(changed);
  if (!keys.length) return [];
  await m.update({ where: { id }, data: toData(changed) });
  const now = await m.findUniqueOrThrow({ where: { id } });
  const time = new Date().toISOString();
  for (const k of keys) c.J.push({ time, entity, id, field: k, before: snap(cur[k]), after: snap(now[k]), source });
  return keys;
}
async function createRow(c: Ctx, entity: string, data: Record<string, unknown>, source: string) {
  const row = await delegate(c.tx, entity).create({ data: toData(data) });
  c.J.push({ time: new Date().toISOString(), entity, id: row.id, field: "__create__", before: null, after: snap(row), source });
  return row;
}
async function deleteRow(c: Ctx, entity: string, id: string, source: string) {
  const m = delegate(c.tx, entity);
  const row = await m.findUniqueOrThrow({ where: { id } });
  await m.delete({ where: { id } });
  c.J.push({ time: new Date().toISOString(), entity, id, field: "__delete__", before: snap(row), after: null, source });
}
const say = (c: Ctx, s: string) => c.log.push(s);

/** Дописывает пометку в текстовое поле (идемпотентно по тегу). */
async function addNote(c: Ctx, entity: string, id: string, field: string, tag: string, text: string, source: string) {
  const cur = await delegate(c.tx, entity).findUniqueOrThrow({ where: { id } });
  const old: string | null = cur[field];
  if (old && old.includes(tag)) return false;
  await upd(c, entity, id, { [field]: old ? `${old}\n${tag} ${text}` : `${tag} ${text}` }, source);
  return true;
}

// ------------------------------------------------------------------ общие операции с ТЗ / лотами

/** Копия syncCompletedOrderCost из production/actions.ts (+ журнал): пересчёт снимка стоимости завершённого ТЗ и остатка готовой продукции. */
async function syncCompletedOrderCost(c: Ctx, orderId: string, src: string) {
  const { tx, orgId } = c;
  const order = await tx.productionOrder.findUnique({ where: { id: orderId }, include: { materialUsages: true, expenses: true } });
  if (!order || order.status !== "COMPLETED" || order.producedQuantity.isZero()) return;
  const materialCost = order.materialUsages.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
  const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const totalCost = materialCost.add(expenseCost);
  const unitCost = totalCost.div(order.producedQuantity);
  const delta = totalCost.sub(order.totalCost ?? new Decimal(0));
  await upd(c, "ProductionOrder", orderId, { materialCost, expenseCost, totalCost, unitCost: r2(unitCost) }, src);
  if (delta.isZero()) return;
  say(c, `    ТЗ ${order.workOrderNumber} (${order.number}): totalCost ${fmt(order.totalCost)} → ${fmt(totalCost)} (Δ ${fmt(delta)})`);
  const stock = await tx.finishedGoodsStock.findUnique({
    where: { warehouseId_productModelId: { warehouseId: order.finishedWarehouseId, productModelId: order.productModelId } },
  });
  if (!stock) return;
  const newTotalValue = stock.quantity.mul(stock.avgUnitCost).add(delta);
  const newAvg = stock.quantity.isZero() ? stock.avgUnitCost : newTotalValue.div(stock.quantity);
  await upd(c, "FinishedGoodsStock", stock.id, { avgUnitCost: r2(newAvg) }, src);
  await createRow(c, "FinishedGoodsMovement", {
    organizationId: orgId, warehouseId: order.finishedWarehouseId, productModelId: order.productModelId,
    type: delta.greaterThan(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", quantity: 0,
    unitCost: r2(delta.abs().div(order.producedQuantity)), totalCost: delta.abs(), productionOrderId: orderId,
    notes: "Корректировка себестоимости после правки завершённого ТЗ",
  }, src);
}

/** Списание из лота в ТЗ — логика consumeFromLot + создание строки списания (как addMaterialUsage). */
async function consume(c: Ctx, lotId: string, qty: Decimal, orderId: string, tag: string, src: string, commission4 = true) {
  const lot = await c.tx.rawMaterialLot.findUniqueOrThrow({ where: { id: lotId } });
  if (lot.quantityRemaining.lessThan(qty)) throw new Error(`Недостаточно в лоте ${lot.lotNumber ?? lot.id}: ${lot.quantityRemaining} < ${qty}`);
  const total = r2(lot.unitCost.mul(qty));
  await createRow(c, "StockMovement", {
    organizationId: c.orgId, warehouseId: lot.warehouseId, rawMaterialId: lot.rawMaterialId, lotId: lot.id,
    type: "PRODUCTION_OUT", quantity: qty, unitCost: lot.unitCost, totalCost: total, productionOrderId: orderId, notes: tag, date: NOW,
  }, src);
  await upd(c, "RawMaterialLot", lot.id, { quantityRemaining: lot.quantityRemaining.sub(qty) }, src);
  await createRow(c, "ProductionMaterialUsage", {
    productionOrderId: orderId, rawMaterialId: lot.rawMaterialId, lotId: lot.id, quantity: qty, unitCost: lot.unitCost,
    totalCost: total, commission4, date: NOW,
  }, src);
  const o = await c.tx.productionOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (o.status === "PLANNED") await upd(c, "ProductionOrder", orderId, { status: "IN_PROGRESS" }, src);
  return { lot, total };
}

const orderByTz = (c: Ctx, tz: string) => c.tx.productionOrder.findFirst({ where: { organizationId: c.orgId, workOrderNumber: tz } });
async function findLot(c: Ctx, purchaseNumber: string, lotNumber: string) {
  const p = await c.tx.purchase.findFirst({ where: { organizationId: c.orgId, number: purchaseNumber } });
  if (!p) return null;
  const lots = await c.tx.rawMaterialLot.findMany({ where: { organizationId: c.orgId, purchaseId: p.id, lotNumber } });
  return lots.length === 1 ? lots[0] : null;
}
const hasTagMovement = (c: Ctx, tag: string, orderId?: string, lotId?: string) =>
  c.tx.stockMovement.count({ where: { notes: { contains: tag }, ...(orderId ? { productionOrderId: orderId } : {}), ...(lotId ? { lotId } : {}) } });


// ================================================================= подкладка

// Источники (Drive «мех»): ТЗ-приложения; метры и итоги прочитаны из самих документов.
// base = «без 4%» (закупка, как в БД: 2 140 ₽/м с НДС 20%). Для документов 2026 цена подкладки 1 854,66 ₽/м без НДС
// (+22% НДС) = 2 140 / 1,2 × 1,04 — то есть то же самое с 4% наценкой; в БД наценки нет (как и по сырью).
type Lin = {
  tz: string; fabric: string; m: number; docLining: number; // сумма подкладки в документе (в той же валюте, что docTotal)
  docRaw: number; docWork: number; docTotal: number | null; year: 2025 | 2026; src: string;
};
const LINING: Lin[] = [
  // 2025 (НДС 20%, цены без 4%): подкладка «2140 × м»
  { tz: "23", fabric: "№24", m: 1.6, docLining: 3424, docRaw: 1059989.59, docWork: 213790, docTotal: 1277203.59, year: 2025, src: "ПРИЛОЖЕНИЕ 23 (соболь 1 изд).docx, Drive 2025/ТЗ/поставка 2" },
  { tz: "35", fabric: "№41", m: 8.8, docLining: 18832, docRaw: 1185620, docWork: 767160, docTotal: 1971612, year: 2025, src: "ПРИЛОЖЕНИЕ 35 (М009 - 4 изд).docx, Drive 2025/ТЗ/поставка 3" },
  { tz: "80", fabric: "№2", m: 8.4, docLining: 17976, docRaw: 600000, docWork: 730740, docTotal: 1348716, year: 2025, src: "ПРИЛОЖЕНИЕ 80 (М016 ... 6 шт).docx, Drive 2025/поставка 7: «Итого 617 976»" },
  { tz: "81", fabric: "№2", m: 5, docLining: 10700, docRaw: 500000, docWork: 343580, docTotal: 854280, year: 2025, src: "ПРИЛОЖЕНИЕ 81 (М015 ... 2 шт).docx, Drive 2025/поставка 7: «Итого 510700»" },
  { tz: "82", fabric: "№41", m: 3.6, docLining: 7704, docRaw: 3900531.91, docWork: 483580, docTotal: 4391815.91, year: 2025, src: "ПРИЛОЖЕНИЕ 82 (М001А ... 2 шт).docx, Drive 2025/поставка 7: «Итого 3 908 235.91»" },
  { tz: "84", fabric: "№41", m: 1.8, docLining: 3852, docRaw: 1895286.8, docWork: 241790, docTotal: 2140928.8, year: 2025, src: "ПРИЛОЖЕНИЕ 84 (М001А ... 1 шт).docx, Drive 2025/поставка 7: «Итого 1 899 138,80»" },
  { tz: "85", fabric: "№2", m: 2.5, docLining: 5350, docRaw: 250000, docWork: 174650, docTotal: null, year: 2025, src: "ПРИЛОЖЕНИЕ 85 (М015 ... 1 шт).docx, Drive 2025/поставка 8: «Итого 255 350»" },
  // 2026 (НДС 22%, с 4%): подкладка 1 854,66 ₽/м без НДС
  { tz: "120", fabric: "№41", m: 7.2, docLining: 16291.33, docRaw: 484031.34, docWork: 660000, docTotal: 1160322.67, year: 2026, src: "ПРИЛОЖЕНИЕ 120 (М056 перл)+.docx, Drive 2026/поставки/поставка 18" },
  { tz: "123", fabric: "№37", m: 7.2, docLining: 16291.33, docRaw: 434739.38, docWork: 720000, docTotal: 1171030.71, year: 2026, src: "ПРИЛОЖЕНИЕ 123 (М041 черная норка)+.docx, Drive 2026/поставки/поставка 18" },
  { tz: "125", fabric: "№41", m: 7.2, docLining: 16291.33, docRaw: 5344927.96, docWork: 817000, docTotal: 6178219.29, year: 2026, src: "ПРИЛОЖЕНИЕ 125 (М002 - 2 соболя)+.docx, Drive 2026/поставки/поставка 18" },
  { tz: "127", fabric: "№37", m: 1.8, docLining: 4072.84, docRaw: 146284.05, docWork: 191200, docTotal: 341556.89, year: 2026, src: "ПРИЛОЖЕНИЕ 127 (М012 - 2 манишки)+.docx, Drive 2026/поставки/поставка 18" },
  { tz: "128", fabric: "№37", m: 11.4, docLining: 25794.61, docRaw: 789045.78, docWork: 870000, docTotal: 1684840.39, year: 2026, src: "ПРИЛОЖЕНИЕ 128 (М052 - 6 шуб из лис)+.docx, Drive 2026/поставки/поставка 18" },
  { tz: "149", fabric: "№41", m: 4.8, docLining: 10860.89, docRaw: 322687.56, docWork: 440000, docTotal: 773548.45, year: 2026, src: "ПРИЛОЖЕНИЕ 149 (М056 - 2 шт) норка жемчуг+.docx, Drive 2026/поставки/поставка 19" },
  { tz: "166", fabric: "№41", m: 2.4, docLining: 5430.44, docRaw: 161343.78, docWork: 220000, docTotal: 386774.22, year: 2026, src: "ПРИЛОЖЕНИЕ 1166 (М056 - 1 шт) норка жемчуг.docx, Drive 2026/поставки/поставка 21" },
];
const OLD_TAG = "[open-items:lining TZ";

async function unitLining(c: Ctx) {
  const { tx, orgId } = c;
  const touched = new Set<string>();
  for (const l of LINING) {
    if (ONLY && !ONLY.has(l.tz)) continue;
    const tag = `[drive-lining TZ${l.tz}]`;
    // целостность переписанных из документа чисел: итог = сырьё + подкладка + работа (±0,05)
    if (l.docTotal != null && Math.abs(l.docRaw + l.docLining + l.docWork - l.docTotal) > 0.05) { say(c, `ТЗ ${l.tz}: данные документа не сходятся (сырьё+подкладка+работа ≠ итог) — НЕ списано`); continue; }
    const base = l.m * 2140; // закупка (без 4%) в базе
    const docBase = l.year === 2025 ? l.docLining : l.docLining / (1.04 * 1.22 / 1.2);
    if (Math.abs(docBase - base) > 0.5) { say(c, `ТЗ ${l.tz}: подкладка документа ${l.docLining} не соответствует ${l.m} м × 2140 — НЕ списано`); continue; }
    const o = await orderByTz(c, l.tz);
    if (!o) { say(c, `ТЗ ${l.tz}: не найдено — пропущено`); continue; }
    const existing = await tx.productionMaterialUsage.findMany({ where: { productionOrderId: o.id, rawMaterial: { name: { startsWith: "Подкладочная" } } } });
    const tagged = await tx.stockMovement.count({ where: { productionOrderId: o.id, OR: [{ notes: { contains: tag } }, { notes: { contains: `${OLD_TAG}${l.tz}]` } }] } });
    if (existing.length || tagged) { say(c, `✓ уже учтено, пропущено (двойной счёт исключён): ТЗ ${l.tz} — списаний подкладки у ТЗ: ${existing.length}`); continue; }
    const rm = await tx.rawMaterial.findFirst({ where: { organizationId: orgId, name: `Подкладочная ткань ${l.fabric}`, unit: "M" } });
    const lots = rm ? await tx.rawMaterialLot.findMany({ where: { organizationId: orgId, rawMaterialId: rm.id } }) : [];
    if (!rm || lots.length !== 1) { say(c, `ТЗ ${l.tz}: ткань ${l.fabric} — лотов ${lots.length} (ожидался один пул) — НЕ списано`); continue; }
    const lot = lots[0];
    if (new Decimal(2140).sub(lot.unitCost).abs().greaterThan(0.02)) { say(c, `ТЗ ${l.tz}: цена лота ${fmt(lot.unitCost)} ≠ 2 140 — НЕ списано`); continue; }
    const qty = new Decimal(l.m);
    if (lot.quantityRemaining.lessThan(qty)) { say(c, `ТЗ ${l.tz}: ${l.fabric} нужно ${l.m} м, остаток ${lot.quantityRemaining} — НЕ списано`); continue; }
    const before = o.totalCost;
    const { total } = await consume(c, lot.id, qty, o.id, `${tag} подкладка по ТЗ-документу Drive (${l.src})`, `${l.src}; подкладка ${l.m} м; итог ТЗ в документе = сырьё + подкладка + работа`, true);
    say(c, `ТЗ ${l.tz} (${o.status}): подкладка ${l.fabric} ${l.m} м × ${fmt(lot.unitCost)} = ${fmt(total)}; остаток ткани ${fmt(lot.quantityRemaining)} → ${fmt(lot.quantityRemaining.sub(qty))} м; стоимость ТЗ было ${fmt(before)}`);
    touched.add(o.id);
  }
  for (const id of touched) await syncCompletedOrderCost(c, id, "подкладка (drive-lining)");
}

// ================================================================= метрики

type LotRow = { id: string; lotNumber: string | null; rec: string; rem: string; outq: string; inq: string; unit: string; used: string };
async function metrics(tx: Tx) {
  const lots = await tx.$queryRaw<LotRow[]>`
    select l.id, l."lotNumber", l."quantityReceived"::text rec, l."quantityRemaining"::text rem, l."unitCost"::text unit,
      coalesce((select sum(quantity) from "StockMovement" s where s."lotId"=l.id and s.type in ('PRODUCTION_OUT','ADJUSTMENT_OUT','TRANSFER_OUT')),0)::text outq,
      coalesce((select sum(quantity) from "StockMovement" s where s."lotId"=l.id and s.type in ('ADJUSTMENT_IN','TRANSFER_IN')),0)::text inq,
      coalesce((select sum(quantity) from "ProductionMaterialUsage" u where u."lotId"=l.id),0)::text used
    from "RawMaterialLot" l`;
  let neg = 0, recS = new Decimal(0), remS = new Decimal(0), outS = new Decimal(0), remVal = new Decimal(0);
  const mismatch: Record<string, string> = {}; // Σ получено − Σ выбыло + Σ приход-корр ≠ остаток
  const usageVsMove: Record<string, string> = {}; // Σ списаний в ТЗ ≠ Σ движений PRODUCTION_OUT
  for (const l of lots) {
    const rec = new Decimal(l.rec), rem = new Decimal(l.rem), out = new Decimal(l.outq), inn = new Decimal(l.inq);
    if (rem.isNegative()) neg++;
    recS = recS.add(rec); remS = remS.add(rem); outS = outS.add(out); remVal = remVal.add(rem.mul(l.unit));
    const d = rec.sub(out).add(inn).sub(rem);
    if (!d.isZero()) mismatch[`${l.lotNumber ?? ""}|${l.id}`] = d.toString();
  }
  const pm = await tx.$queryRaw<{ id: string; lot: string | null; used: string; moved: string }[]>`
    select l.id, l."lotNumber" lot,
      coalesce((select sum(quantity) from "ProductionMaterialUsage" u where u."lotId"=l.id),0)::text used,
      coalesce((select sum(quantity) from "StockMovement" s where s."lotId"=l.id and s.type='PRODUCTION_OUT'),0)::text moved
    from "RawMaterialLot" l`;
  for (const r of pm) if (!new Decimal(r.used).eq(r.moved)) usageVsMove[`${r.lot ?? ""}|${r.id}`] = `${r.used} vs ${r.moved}`;
  const orders = await tx.productionOrder.findMany({ select: { id: true, workOrderNumber: true, number: true, status: true, totalCost: true, materialCost: true } });
  const ordersMap: Record<string, string> = {};
  for (const o of orders) ordersMap[o.workOrderNumber ?? o.number] = `${o.totalCost ?? "∅"}`;
  const usageSum = (await tx.productionMaterialUsage.aggregate({ _sum: { totalCost: true } }))._sum.totalCost ?? new Decimal(0);
  const lotsTotal = (await tx.rawMaterialLot.aggregate({ _sum: { totalCost: true } }))._sum.totalCost ?? new Decimal(0);
  const purchases = await tx.purchase.count();
  return { lots: lots.length, neg, recS, remS, outS, remVal, mismatch, usageVsMove, ordersMap, usageSum, lotsTotal, purchases, orders: orders.length };
}
type Metrics = Awaited<ReturnType<typeof metrics>>;
function printMetrics(title: string, m: Metrics) {
  console.log(`\n--- ${title} ---`);
  console.log(`лотов ${m.lots}, закупок ${m.purchases}, ТЗ ${m.orders}; отрицательных остатков: ${m.neg}`);
  console.log(`Σ получено ${m.recS} = Σ выбыло ${m.outS} + Σ остаток ${m.remS} (± корректировки прихода); Σ стоимость остатков ${fmt(m.remVal)}`);
  console.log(`Σ totalCost лотов ${fmt(m.lotsTotal)}; Σ списаний в ТЗ ${fmt(m.usageSum)}`);
  console.log(`лотов с расхождением «получено − выбыло ± корр. ≠ остаток»: ${Object.keys(m.mismatch).length}; со списаниями ≠ движениям: ${Object.keys(m.usageVsMove).length}`);
}
function diffMetrics(a: Metrics, b: Metrics) {
  console.log("\n--- СВЕРКА до/после ---");
  const newMis = Object.keys(b.mismatch).filter((k) => !(k in a.mismatch) || a.mismatch[k] !== b.mismatch[k]);
  const newUM = Object.keys(b.usageVsMove).filter((k) => !(k in a.usageVsMove));
  console.log(`отрицательных остатков: ${a.neg} → ${b.neg}`);
  console.log(`новых расхождений остаток/движения: ${newMis.length}${newMis.length ? " " + JSON.stringify(newMis) : ""}; новых «списания ≠ движения»: ${newUM.length}${newUM.length ? " " + JSON.stringify(newUM) : ""}`);
  console.log(`Σ получено ${a.recS} → ${b.recS}; Σ выбыло ${a.outS} → ${b.outS}; Σ остаток ${a.remS} → ${b.remS}`);
  const changed = Object.keys(b.ordersMap).filter((k) => a.ordersMap[k] !== b.ordersMap[k]);
  console.log(`ТЗ с изменённым totalCost: ${changed.length}`);
  for (const k of changed) console.log(`  ТЗ ${k}: ${a.ordersMap[k] ?? "(нет)"} → ${b.ordersMap[k]}`);
  for (const k of Object.keys(a.ordersMap)) if (!(k in b.ordersMap)) console.log(`  ТЗ ${k} исчез!`);
}

// ================================================================= main / apply / rollback

function appendJournal(entries: Entry[]) {
  if (!entries.length) return;
  const all: Entry[] = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : [];
  all.push(...entries);
  writeFileSync(JOURNAL, JSON.stringify(all, null, 2));
}


async function main() {
  const dbUrl = (process.env.DATABASE_URL ?? "").replace(/:[^:@/]*@/, ":***@");
  console.log(`База: ${dbUrl}\nРежим: ${ROLLBACK_FILE ? "ОТКАТ" : APPLY ? "APPLY" : "DRY-RUN (транзакция откатывается)"}`);
  if (ROLLBACK_FILE) return rollback(ROLLBACK_FILE);
  const org = await prisma.organization.findFirstOrThrow();
  const before = await prisma.$transaction((tx) => metrics(tx));
  printMetrics("ДО", before);

  const run = async (tx: Tx) => {
    const J: Entry[] = [];
    const c: Ctx = { tx, J, log: [], orgId: org.id };
    await unitLining(c);
    console.log("\n=== Подкладка (УПД №109, лот 2 140 ₽/м) ===");
    for (const l of c.log) console.log(l);
    return J;
  };

  if (!APPLY) {
    let after: Metrics | null = null;
    let nJ = 0;
    try {
      await prisma.$transaction(async (tx) => {
        const J = await run(tx);
        nJ = J.length;
        after = await metrics(tx);
        throw new DryRunDone();
      }, { timeout: 300000, maxWait: 30000 });
    } catch (e) { if (!(e instanceof DryRunDone)) throw e; }
    printMetrics("ПОСЛЕ (в транзакции, откат)", after!);
    diffMetrics(before, after!);
    console.log(`\nDRY-RUN: записей журнала было бы ${nJ}; в базе ничего не изменено. Для применения добавьте --apply.`);
    return;
  }
  let total = 0;
  await prisma.$transaction(async (tx) => {
    const J = await run(tx);
    appendJournal(J); // пишем до коммита: если запись упала — транзакция откатится
    total += J.length;
  }, { timeout: 300000, maxWait: 30000 });
  const after = await prisma.$transaction((tx) => metrics(tx));
  printMetrics("ПОСЛЕ", after);
  diffMetrics(before, after);
  console.log(`\nПрименено. Записей журнала: ${total} → ${JOURNAL}`);
}

async function rollback(file: string) {
  const entries: Entry[] = JSON.parse(readFileSync(resolve(file), "utf-8"));
  console.log(`Откат по журналу ${file}: ${entries.length} записей`);
  try {
    await prisma.$transaction(async (tx) => {
      printMetrics("ДО отката", await metrics(tx));
      let done = 0, skipped = 0;
      for (const e of [...entries].reverse()) {
        const m = delegate(tx, e.entity);
        if (!m) { console.log(`  неизвестная сущность ${e.entity}`); skipped++; continue; }
        const cur = await m.findUnique({ where: { id: e.id } });
        if (e.field === "__create__") {
          if (!cur) continue;
          if (e.entity === "RawMaterialLot" && (await tx.productionMaterialUsage.count({ where: { lotId: e.id } }))) { console.log(`  лот ${e.id}: ИСПОЛЬЗУЕТСЯ в ТЗ — не удалён`); skipped++; continue; }
          await m.delete({ where: { id: e.id } }); console.log(`  удалён ${e.entity} ${e.id}`); done++;
        } else if (e.field === "__delete__") {
          if (cur) { console.log(`  ${e.entity} ${e.id}: уже существует — пропуск`); continue; }
          const data: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(e.before as Record<string, unknown>)) if (v !== null) data[k] = v;
          await m.create({ data }); console.log(`  восстановлен ${e.entity} ${e.id}`); done++;
        } else {
          if (!cur) { console.log(`  ${e.entity} ${e.id}: не найден — пропуск`); skipped++; continue; }
          if (eq(cur[e.field], e.before)) continue;
          if (!eq(cur[e.field], e.after)) { console.log(`  ${e.entity} ${e.id}.${e.field}: изменён после применения — НЕ откатывается`); skipped++; continue; }
          await m.update({ where: { id: e.id }, data: toData({ [e.field]: e.before }) }); done++;
        }
      }
      console.log(`Откат: операций ${done}, пропущено ${skipped}`);
      printMetrics("ПОСЛЕ отката", await metrics(tx));
      if (!APPLY) throw new DryRunDone();
    }, { timeout: 300000, maxWait: 30000 });
  } catch (e) { if (!(e instanceof DryRunDone)) throw e; console.log("\nDRY-RUN отката: ничего не записано. Для применения добавьте --apply."); }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
