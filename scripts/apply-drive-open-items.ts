/**
 * Закрытие открытых пунктов по документам Google Drive «мех» (ничего не берётся «из головы»: у каждой правки есть
 * источник; нет документа/остатка/однозначного соответствия — нет изменения, причина идёт в
 * docs-inventory/pending-decisions-open-items.md).
 *
 * Запуск (по умолчанию DRY-RUN: вся логика выполняется в одной транзакции по живым данным, печатается план и сверка
 * «до/после», затем транзакция ОТКАТЫВАЕТСЯ — в базе ничего не остаётся):
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-open-items.ts
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-open-items.ts --apply
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-open-items.ts --only 1,2      (только указанные пункты)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-open-items.ts --rollback docs-inventory/corrections-journal-open-items.json [--apply]
 *
 * ПЕРЕД --apply СДЕЛАЙТЕ БЭКАП БАЗЫ (scripts/backup.sh).
 *
 * Пункты:
 *   1. «Реконструированные из ТЗ» закупки З-2026-0030 (СП0526.N) и З-2026-0031 (РП0426.N) дублируют лоты УПД №199
 *      (З-2026-0047: FW26-20/FW26-23/24/FW26-26/FW26-27) и УПД №201 (З-2026-0041: лоты 1–5): номер лота и цена совпали
 *      с УПД (прочитаны из Drive). Списания ТЗ переносятся на полные лоты (ProductionMaterialUsage + движение
 *      PRODUCTION_OUT; остаток полного лота уменьшается; цена строки = цена полного лота, как при списании в приложении;
 *      при «завершённом» ТЗ пересчитываются materialCost/totalCost/unitCost и корректируется остаток готовой продукции —
 *      как syncCompletedOrderCost). Затем «реконструированные» лоты, их позиции, движения и сами закупки удаляются
 *      (снимок в журнал) — только если на них нет иных ссылок (оплаты, документы, расходы, чужие списания).
 *   2. Подкладка: списание только там, где в ТЗ-документе ткань = «старый склад» (УПД №109, цена с НДС 20% = 2 140 ₽/м;
 *      в ТЗ-приложении 1 854,66 ₽ без НДС = 2 140/1,2 × 1,04) и остатка достаточно. «…/130» (Спец. №13, 2026, приход не
 *      подтверждён), «шерсть/альпака/шёлк» (Спец. №16), №23/130 — на складе их нет → не списываются.
 *      Подкладка ТЗ 23, 35, 80–82, 84, 85 — по расходам prod2025a/b (метры × 2 140).
 *   3. ТЗ 157, 165, 167: списание сырья с полных лотов УПД №201/199 (и 300687), где лот и цена (ТЗ = цена УПД × 1,04)
 *      совпали и остаток есть. ТЗ 158 (сырьё подрядчика) и 75/97/104 (лоскут, бобр) — только пометка в notes ТЗ.
 *   4. ТЗ 116 «Ремонт пальто» (строка единого реестра в Drive): ТЗ создаётся, движение ADJUSTMENT_OUT лота 10026 (16 шт.)
 *      превращается в PRODUCTION_OUT этого ТЗ и добавляется строка списания (остаток лота не меняется).
 *   5. Партия 20: пометка в notes про занижение счёта №265 на 115 110 (оплат не заводится).
 *
 * Идемпотентно (повторный запуск печатает «уже применено»). Журнал docs-inventory/corrections-journal-open-items.json
 * дописывается после КАЖДОЙ транзакции: записи {time, entity, id, field, before, after, source};
 * field = "__create__" (создано — откат удалит), "__delete__" (удалено — before содержит полный снимок строки, откат
 * создаст её заново с тем же id), иначе — изменение поля.
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
const JOURNAL = resolve(__dirname, "..", "docs-inventory", "corrections-journal-open-items.json");

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

// ================================================================= 1. реконструированные закупки 0030 / 0031

const SRC1 = "УПД №199 и №201 от 09.07.2026 (Drive: закупка 2026/соболь): номера лотов и цены строк совпали с «реконструированными» лотами";
// [закупка-дубль, лот-дубль] → [полная закупка, полный лот]
const PAIRS: Record<string, Record<string, [string, string]>> = {
  "З-2026-0030": {
    "СП0526.20": ["З-2026-0047", "FW26-20"], "СП0526.23": ["З-2026-0047", "FW26-23"], "СП0526.24": ["З-2026-0047", "24"],
    "СП0526.26": ["З-2026-0047", "FW26-26"], "СП0526.27": ["З-2026-0047", "FW26-27"],
  },
  "З-2026-0031": {
    "РП0426.1": ["З-2026-0041", "1"], "РП0426.2": ["З-2026-0041", "2"], "РП0426.3": ["З-2026-0041", "3"],
    "РП0426.4": ["З-2026-0041", "4"], "РП0426.5": ["З-2026-0041", "5"],
  },
};

async function unit1(c: Ctx) {
  const { tx, orgId } = c;
  for (const [pNum, map] of Object.entries(PAIRS)) {
    const p = await tx.purchase.findFirst({
      where: { organizationId: orgId, number: pNum },
      include: { items: true, expenses: true, payments: true, documents: true, driveDocuments: true,
        rawMaterialLots: { include: { usages: true, stockMovements: true, purchaseItems: true, driveDocuments: true } } },
    });
    if (!p) { say(c, `✓ уже применено: ${pNum} отсутствует`); continue; }
    const problems: string[] = [];
    if (p.payments.length) problems.push(`платежи: ${p.payments.length}`);
    if (p.expenses.length) problems.push(`расходы закупки: ${p.expenses.length}`);
    if (p.documents.length) problems.push(`документы закупки: ${p.documents.length}`);
    if (p.driveDocuments.length) problems.push(`документы Drive: ${p.driveDocuments.length}`);
    const plan: { rec: (typeof p.rawMaterialLots)[number]; full: Awaited<ReturnType<typeof findLot>> & object }[] = [];
    const need = new Map<string, Decimal>(); // fullLotId → Σ qty
    for (const rec of p.rawMaterialLots) {
      const pair = map[rec.lotNumber ?? ""];
      if (!pair) { problems.push(`лот ${rec.lotNumber}: нет пары в УПД`); continue; }
      const full = await findLot(c, pair[0], pair[1]);
      if (!full) { problems.push(`лот ${rec.lotNumber}: полный лот ${pair[0]}/${pair[1]} не найден`); continue; }
      if (full.rawMaterialId !== rec.rawMaterialId) problems.push(`лот ${rec.lotNumber}: другой материал`);
      if (full.unitCost.sub(rec.unitCost).abs().greaterThan(0.03)) problems.push(`лот ${rec.lotNumber}: цена ${rec.unitCost} ≠ ${full.unitCost}`);
      if (rec.driveDocuments.length) problems.push(`лот ${rec.lotNumber}: документы Drive`);
      if (rec.purchaseItems.length !== 1) problems.push(`лот ${rec.lotNumber}: позиций ${rec.purchaseItems.length}`);
      const outs = rec.stockMovements.filter((m) => m.type === "PRODUCTION_OUT");
      const others = rec.stockMovements.filter((m) => m.type !== "PRODUCTION_OUT" && m.type !== "PURCHASE_IN");
      if (others.length) problems.push(`лот ${rec.lotNumber}: иные движения (${others.map((m) => m.type).join(",")})`);
      if (outs.length !== rec.usages.length) problems.push(`лот ${rec.lotNumber}: движений ${outs.length} ≠ списаний ${rec.usages.length}`);
      for (const u of rec.usages) if (!outs.some((m) => m.productionOrderId === u.productionOrderId && m.quantity.eq(u.quantity))) problems.push(`лот ${rec.lotNumber}: списание ${u.id} без парного движения`);
      const used = rec.usages.reduce((s, u) => s.add(u.quantity), new Decimal(0));
      if (!used.eq(rec.quantityReceived) || !rec.quantityRemaining.isZero()) problems.push(`лот ${rec.lotNumber}: получено ${rec.quantityReceived}, списано ${used}, остаток ${rec.quantityRemaining}`);
      need.set(full.id, (need.get(full.id) ?? new Decimal(0)).add(used));
      plan.push({ rec, full });
    }
    // «бесхозные» приходы: PURCHASE_IN с purchaseId этой закупки на лотах ДРУГИХ закупок (хвост ранее слитых реконструированных
    // лотов Saga 03-26) — переадресуются на закупку самого лота (дата прихода = дата получения той закупки)
    const planLotIds = new Set(plan.map((x) => x.rec.id));
    const strays = (await tx.stockMovement.findMany({ where: { purchaseId: p.id }, include: { lot: { include: { purchase: true } } } }))
      .filter((m) => !m.lotId || !planLotIds.has(m.lotId));
    for (const m of strays) {
      if (m.type !== "PURCHASE_IN" || !m.lot || !m.lot.purchaseId || m.lot.purchaseId === p.id) problems.push(`движение ${m.id} (${m.type}) на постороннем лоте — не переадресовать`);
    }
    for (const [id, q] of need) {
      const f = await tx.rawMaterialLot.findUniqueOrThrow({ where: { id } });
      if (f.quantityRemaining.lessThan(q)) problems.push(`полный лот ${f.lotNumber}: остаток ${f.quantityRemaining} < ${q}`);
    }
    if (problems.length) {
      say(c, `${pNum}: НЕ ТРОГАЮ (${problems.join("; ")})`);
      await addNote(c, "Purchase", p.id, "notes", "[open-items:dup]", `Вероятный дубль лотов УПД №199/№201 (З-2026-0047/0041); автоматически не удалено: ${problems.join("; ")}.`, SRC1);
      continue;
    }
    say(c, `${pNum}: перенос списаний на полные лоты и удаление закупки-дубля`);
    const touched = new Set<string>();
    for (const { rec, full } of plan) {
      for (const u of rec.usages) {
        const f = await tx.rawMaterialLot.findUniqueOrThrow({ where: { id: full.id } });
        const total = r2(f.unitCost.mul(u.quantity));
        const mv = rec.stockMovements.find((m) => m.type === "PRODUCTION_OUT" && m.productionOrderId === u.productionOrderId && m.quantity.eq(u.quantity))!;
        await upd(c, "StockMovement", mv.id, { lotId: f.id, unitCost: f.unitCost, totalCost: total,
          notes: `${mv.notes ? mv.notes + " " : ""}[open-items:moved ${rec.lotNumber}→${f.lotNumber}]` }, SRC1);
        await upd(c, "ProductionMaterialUsage", u.id, { lotId: f.id, unitCost: f.unitCost, totalCost: total }, SRC1);
        await upd(c, "RawMaterialLot", f.id, { quantityRemaining: f.quantityRemaining.sub(u.quantity) }, SRC1);
        const o = await tx.productionOrder.findUniqueOrThrow({ where: { id: u.productionOrderId } });
        say(c, `  ТЗ ${o.workOrderNumber}: ${rec.lotNumber} ×${u.quantity} → лот ${pairLabel(map, rec.lotNumber)} (цена ${fmt(u.unitCost)} → ${fmt(f.unitCost)}, сумма ${fmt(u.totalCost)} → ${fmt(total)})`);
        touched.add(u.productionOrderId);
      }
    }
    for (const oid of touched) await syncCompletedOrderCost(c, oid, SRC1);
    for (const m of strays) {
      await upd(c, "StockMovement", m.id, { purchaseId: m.lot!.purchaseId }, SRC1 + "; приход лота относится к закупке самого лота");
      say(c, `  приход ${m.quantity} лота ${m.lot!.lotNumber} переадресован ${pNum} → ${m.lot!.purchase!.number}`);
    }
    // удаление: движения → позиции → лоты → закупка (в таком порядке снимки; откат идёт в обратном)
    for (const { rec } of plan) {
      const fresh = await tx.stockMovement.findMany({ where: { lotId: rec.id } });
      for (const m of fresh) {
        if (m.type !== "PURCHASE_IN") throw new Error(`на лоте ${rec.lotNumber} осталось движение ${m.type}`);
        await deleteRow(c, "StockMovement", m.id, SRC1);
      }
      if (await tx.productionMaterialUsage.count({ where: { lotId: rec.id } })) throw new Error(`на лоте ${rec.lotNumber} остались списания`);
      for (const it of rec.purchaseItems) await deleteRow(c, "PurchaseItem", it.id, SRC1);
      await deleteRow(c, "RawMaterialLot", rec.id, SRC1);
    }
    const leftItems = await tx.purchaseItem.count({ where: { purchaseId: p.id } });
    const leftLots = await tx.rawMaterialLot.count({ where: { purchaseId: p.id } });
    const leftMv = await tx.stockMovement.count({ where: { purchaseId: p.id } });
    if (leftItems || leftLots || leftMv) throw new Error(`${pNum}: остались ссылки (позиции ${leftItems}, лоты ${leftLots}, движения ${leftMv})`);
    await deleteRow(c, "Purchase", p.id, SRC1);
    say(c, `  удалена закупка ${pNum} (${fmt(p.rawMaterialLots.reduce((s, l) => s.add(l.totalCost), new Decimal(0)))} ₽ по лотам)`);
  }
}
const pairLabel = (map: Record<string, [string, string]>, lot: string | null) => (lot && map[lot] ? `${map[lot][0]}/${map[lot][1]}` : "?");

// ================================================================= 2. подкладка

const SRC2A = "ТЗ-приложения 2026 (prod2026.json): подкладка «№41/№37», 1 854,66 ₽/м без НДС = 2 140 ₽/м (УПД №109, НДС 20%) / 1,2 × 1,04";
const SRC2B = "prod2025a.md §6 / prod2025b.md §5 п.9: расход подкладки, метры × 2 140 ₽/м с НДС";
type Lin = { tz: string; fabric: string; m: number; price: { exVat?: number; inclVat?: number }; src: string };
const LINING: Lin[] = [
  { tz: "120", fabric: "№41", m: 7.2, price: { exVat: 1854.66 }, src: SRC2A },
  { tz: "123", fabric: "№37", m: 7.2, price: { exVat: 1854.66 }, src: SRC2A },
  { tz: "125", fabric: "№41", m: 7.2, price: { exVat: 1854.66 }, src: SRC2A },
  { tz: "127", fabric: "№37", m: 1.8, price: { exVat: 1854.66 }, src: SRC2A },
  { tz: "128", fabric: "№37", m: 11.4, price: { exVat: 1854.66 }, src: SRC2A },
  { tz: "149", fabric: "№41", m: 4.8, price: { exVat: 1854.66 }, src: SRC2A },
  { tz: "166", fabric: "№41", m: 2.4, price: { exVat: 1854.66 }, src: SRC2A },
  { tz: "23", fabric: "№24", m: 1.6, price: { inclVat: 2140 }, src: SRC2B },
  { tz: "35", fabric: "№41", m: 8.8, price: { inclVat: 2140 }, src: SRC2B },
  { tz: "80", fabric: "№2", m: 8.4, price: { inclVat: 2140 }, src: SRC2B },
  { tz: "81", fabric: "№2", m: 5, price: { inclVat: 2140 }, src: SRC2B },
  { tz: "82", fabric: "№41", m: 3.6, price: { inclVat: 2140 }, src: SRC2B },
  { tz: "84", fabric: "№41", m: 1.8, price: { inclVat: 2140 }, src: SRC2B },
  { tz: "85", fabric: "№2", m: 2.5, price: { inclVat: 2140 }, src: SRC2B },
];

async function unit2(c: Ctx) {
  const { tx, orgId } = c;
  const touched = new Set<string>();
  for (const l of LINING) {
    const tag = `[open-items:lining TZ${l.tz}]`;
    const o = await orderByTz(c, l.tz);
    if (!o) { say(c, `ТЗ ${l.tz}: не найдено — пропущено`); continue; }
    const rm = await tx.rawMaterial.findFirst({ where: { organizationId: orgId, name: `Подкладочная ткань ${l.fabric}`, unit: "M" } });
    const lots = rm ? await tx.rawMaterialLot.findMany({ where: { organizationId: orgId, rawMaterialId: rm.id } }) : [];
    if (!rm || lots.length !== 1) { say(c, `ТЗ ${l.tz}: ткань ${l.fabric} — лотов ${lots.length} (ожидался один пул) — НЕ списано`); continue; }
    const lot = lots[0];
    if (await hasTagMovement(c, tag, o.id, lot.id)) { say(c, `✓ уже применено: ТЗ ${l.tz} подкладка ${l.fabric} ${l.m} м`); continue; }
    const docIncl = l.price.inclVat != null ? new Decimal(l.price.inclVat) : new Decimal(l.price.exVat!).div(1.04).mul(1.2);
    if (docIncl.sub(lot.unitCost).abs().greaterThan(0.02)) { say(c, `ТЗ ${l.tz}: цена документа ${fmt(docIncl)} ≠ цена лота ${fmt(lot.unitCost)} — НЕ списано`); continue; }
    const qty = new Decimal(l.m);
    if (lot.quantityRemaining.lessThan(qty)) { say(c, `ТЗ ${l.tz}: ${l.fabric} нужно ${l.m} м, остаток ${lot.quantityRemaining} — НЕ списано`); continue; }
    const before = o.totalCost;
    const { total } = await consume(c, lot.id, qty, o.id, `${tag} подкладка по ТЗ-документу Drive`, l.src, true);
    say(c, `ТЗ ${l.tz} (${o.status}): подкладка ${l.fabric} ${l.m} м × ${fmt(lot.unitCost)} = ${fmt(total)}; остаток ткани ${fmt(lot.quantityRemaining)} → ${fmt(lot.quantityRemaining.sub(qty))} м; стоимость ТЗ было ${fmt(before)}`);
    touched.add(o.id);
  }
  for (const id of touched) await syncCompletedOrderCost(c, id, "подкладка (п.2)");
}

// ================================================================= 3. ТЗ 157, 165, 167 и «не складское» сырьё

const SRC3 = "ТЗ-приложение Drive (ТЗ = цена УПД × 1,04); лот и цена сверены с УПД №201/№199";
type Raw = { tz: string; purchase: string; lot: string; docLabel: string; qty: number; docExVat: number };
const RAW: Raw[] = [
  { tz: "157", purchase: "З-2026-0041", lot: "1", docLabel: "РП0426.1", qty: 6, docExVat: 27826.55 },
  { tz: "157", purchase: "З-2026-0041", lot: "2", docLabel: "РП0426.2", qty: 5, docExVat: 27826.55 },
  { tz: "157", purchase: "З-2026-0041", lot: "3", docLabel: "РП0426.3", qty: 6, docExVat: 27826.55 },
  { tz: "157", purchase: "З-2026-0041", lot: "4", docLabel: "РП0426.4", qty: 3, docExVat: 30422.29 },
  { tz: "157", purchase: "З-2026-0041", lot: "5", docLabel: "РП0426.5", qty: 8, docExVat: 27826.57 },
  { tz: "165", purchase: "З-2026-0047", lot: "FW26-19", docLabel: "СП0526.19", qty: 28, docExVat: 30642.45 },
  { tz: "167", purchase: "З-2026-0047", lot: "FW26-23", docLabel: "СП0526.23", qty: 6, docExVat: 28995.86 },
  { tz: "167", purchase: "З-2026-0041", lot: "3", docLabel: "РП0426.3", qty: 2, docExVat: 27826.55 },
  { tz: "167", purchase: "З-2026-0041", lot: "4", docLabel: "РП0426.4", qty: 4, docExVat: 30422.29 },
  { tz: "167", purchase: "З-2026-0038", lot: "300687", docLabel: "300687", qty: 30, docExVat: 10438.43 },
];
const NOTES3: Record<string, string> = {
  "158": "Сырьё — подрядчика (176 000 ₽/ед. × 3 по ТЗ-приложению), лота на складе нет: списаний нет намеренно (у ТЗ 121 такое сырьё заведено лотом «лиса» закупки З-2026-0001 по счёту №237; для ТЗ 158 документа с лотом/закупкой нет).",
  "75": "Сырья от заказчика нет (лоскут; файл «тут нет продажи 4%»): списаний нет намеренно, изделие по документам изготовлено и оплачено в партии 7.",
  "97": "Бобр и пошив входят в 16 980 ₽ за изделие (письмо 19.02.2026): сырья склада нет, списаний нет намеренно.",
  "104": "Бобр входит в цену 16 980 ₽: сырья склада нет, списаний нет намеренно.",
};

async function unit3(c: Ctx) {
  const touched = new Set<string>();
  for (const r of RAW) {
    const tag = `[open-items:raw TZ${r.tz} ${r.docLabel}]`;
    const o = await orderByTz(c, r.tz);
    if (!o) { say(c, `ТЗ ${r.tz}: не найдено`); continue; }
    const lot = await findLot(c, r.purchase, r.lot);
    if (!lot) { say(c, `ТЗ ${r.tz}: лот ${r.docLabel} → ${r.purchase}/${r.lot} не найден — НЕ списано`); continue; }
    if (await hasTagMovement(c, tag, o.id, lot.id)) { say(c, `✓ уже применено: ТЗ ${r.tz} ${r.docLabel} ×${r.qty}`); continue; }
    const expect = new Decimal(r.docExVat).div(1.04).mul(1.22);
    if (expect.sub(lot.unitCost).abs().greaterThan(0.03)) { say(c, `ТЗ ${r.tz}: ${r.docLabel} цена ТЗ/1,04×1,22 = ${fmt(expect)} ≠ лот ${fmt(lot.unitCost)} — НЕ списано`); continue; }
    const qty = new Decimal(r.qty);
    if (lot.quantityRemaining.lessThan(qty)) { say(c, `ТЗ ${r.tz}: ${r.docLabel} нужно ${r.qty}, остаток ${lot.quantityRemaining} — НЕ списано`); continue; }
    const { total } = await consume(c, lot.id, qty, o.id, `${tag} сырьё по ТЗ-документу Drive (лот ${r.purchase}/${r.lot})`, SRC3, true);
    say(c, `ТЗ ${r.tz}: ${r.docLabel} → ${r.purchase}/${r.lot} ×${r.qty} × ${fmt(lot.unitCost)} = ${fmt(total)}; остаток лота ${fmt(lot.quantityRemaining)} → ${fmt(lot.quantityRemaining.sub(qty))}`);
    touched.add(o.id);
  }
  for (const id of touched) await syncCompletedOrderCost(c, id, "сырьё ТЗ (п.3)");
  for (const [tz, text] of Object.entries(NOTES3)) {
    const o = await orderByTz(c, tz);
    if (!o) continue;
    if (await addNote(c, "ProductionOrder", o.id, "notes", "[open-items:no-stock]", text, "prod2026.md §5 п.11; pending-decisions-production №4–6, №14")) say(c, `ТЗ ${tz}: добавлена пометка «сырьё не склада»`);
    else say(c, `✓ уже применено: пометка ТЗ ${tz}`);
  }
}

// ================================================================= 4. ТЗ 116 «Ремонт пальто»

const SRC4 = "Drive: «21-08 ЕДИНЫЙ_РЕЕСТР_ПО_МЕХУ_MVST» — строка «ТЕХНИЧЕСКОЕ ЗАДАНИЕ № 116 / Ремонт пальто / Шкура норки серебристо-голубая 50 М / лот 10026 × 16 / 9 722»";
async function unit4(c: Ctx) {
  const { tx, orgId } = c;
  const exist = await orderByTz(c, "116");
  if (exist) return say(c, `✓ уже применено: ТЗ 116 есть (${exist.number})`);
  const lot = await findLot(c, "З-2026-0007", "10026");
  if (!lot) return say(c, "лот 10026 (З-2026-0007) не найден — пропущено");
  const adj = await tx.stockMovement.findMany({ where: { lotId: lot.id, type: "ADJUSTMENT_OUT", notes: { contains: "ТЗ №116" } } });
  if (adj.length !== 1 || !adj[0].quantity.eq(16) || !lot.unitCost.eq(9722)) return say(c, `лот 10026: ожидалось одно ADJUSTMENT_OUT 16 шт по 9 722 (найдено ${adj.length}, цена ${lot.unitCost}) — пропущено`);
  if (await tx.productionMaterialUsage.count({ where: { lotId: lot.id } })) return say(c, "лот 10026: уже есть списания в ТЗ — пропущено");
  let model = await tx.productModel.findFirst({ where: { organizationId: orgId, name: "Ремонт пальто" } });
  if (!model) model = await createRow(c, "ProductModel", { organizationId: orgId, name: "Ремонт пальто", category: "Ремонт", description: "Услуга: ремонт пальто (ТЗ №116, единый реестр Drive)" }, SRC4);
  const nums = (await tx.productionOrder.findMany({ where: { organizationId: orgId, number: { startsWith: "П-2026-" } }, select: { number: true } }))
    .map((o) => parseInt(o.number.slice(7), 10)).filter((n) => Number.isFinite(n));
  const number = `П-2026-${String(Math.max(...nums) + 1).padStart(4, "0")}`;
  const order = await createRow(c, "ProductionOrder", {
    organizationId: orgId, number, productModelId: model!.id, rawWarehouseId: lot.warehouseId, finishedWarehouseId: lot.warehouseId,
    status: "IN_PROGRESS", plannedQuantity: new Decimal(7), producedQuantity: new Decimal(0), workOrderNumber: "116",
    materialDescription: "Шкура норки серебристо-голубая 50 М",
    notes: "[open-items:tz116] ТЗ №116 «Ремонт пальто»: создано по строке единого реестра Drive (21-08 ЕДИНЫЙ_РЕЕСТР_ПО_МЕХУ_MVST, строки 520–521): " +
      "7 ед., работа 218 860 ₽ (итого по реестру), сырьё — лот 10026 × 16 шт по 9 722 ₽ = 155 552 ₽. Приложения ТЗ №116 в Drive нет — дата, заказчик, партия и размеры " +
      "не заполнены; статус IN_PROGRESS (факт завершения документом не подтверждён).",
  }, SRC4);
  await upd(c, "StockMovement", adj[0].id, {
    type: "PRODUCTION_OUT", productionOrderId: order.id,
    notes: `${adj[0].notes ?? ""} [open-items:tz116] привязано к ТЗ 116 (${number}).`.trim(),
  }, SRC4);
  await createRow(c, "ProductionMaterialUsage", {
    productionOrderId: order.id, rawMaterialId: lot.rawMaterialId, lotId: lot.id, quantity: new Decimal(16), unitCost: lot.unitCost,
    totalCost: r2(lot.unitCost.mul(16)), commission4: true, date: NOW,
  }, SRC4);
  say(c, `создан ТЗ 116 (${number}) «Ремонт пальто», списание лота 10026 ×16 = ${fmt(r2(lot.unitCost.mul(16)))} (остаток лота ${lot.quantityRemaining} без изменений)`);
}

// ================================================================= 5. счёт №265, партия 20

async function unit5(c: Ctx) {
  const b = await c.tx.productionBatch.findFirst({ where: { organizationId: c.orgId, number: 20 } });
  if (!b) return say(c, "партия 20 не найдена");
  const text = "по расчёту доплата 2 007 540, счёт №265 на 1 892 430 (занижен на 115 110: ТЗ 152 М002А работа 386 500 вместо 18 000 → 110 550 по 30%; МН03 9 500 вместо 7 600 → 4 560). Оплат не заведено.";
  if (await addNote(c, "ProductionBatch", b.id, "notes", "[open-items:inv265]", text, "prod2026.md §2, §6; расчёт доплаты по партии 20 (Drive)")) say(c, "партия 20: добавлена пометка про счёт №265");
  else say(c, "✓ уже применено: пометка партии 20");
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

const UNITS: [string, string, (c: Ctx) => Promise<unknown>][] = [
  ["1", "Реконструированные закупки З-2026-0030/0031", unit1],
  ["2", "Подкладка (старый склад, УПД №109)", unit2],
  ["3", "ТЗ 157/165/167 и сырьё не склада", unit3],
  ["4", "ТЗ 116 «Ремонт пальто»", unit4],
  ["5", "Счёт №265, партия 20", unit5],
];

async function main() {
  const dbUrl = (process.env.DATABASE_URL ?? "").replace(/:[^:@/]*@/, ":***@");
  console.log(`База: ${dbUrl}\nРежим: ${ROLLBACK_FILE ? "ОТКАТ" : APPLY ? "APPLY" : "DRY-RUN (транзакция откатывается)"}`);
  if (ROLLBACK_FILE) return rollback(ROLLBACK_FILE);
  const org = await prisma.organization.findFirstOrThrow();
  const units = UNITS.filter(([id]) => !ONLY || ONLY.has(id));
  const before = await prisma.$transaction((tx) => metrics(tx));
  printMetrics("ДО", before);

  const run = async (tx: Tx, list: typeof UNITS) => {
    const J: Entry[] = [];
    for (const [id, title, fn] of list) {
      const c: Ctx = { tx, J, log: [], orgId: org.id };
      await fn(c);
      console.log(`\n=== Пункт ${id}. ${title} ===`);
      for (const l of c.log) console.log(l);
    }
    return J;
  };

  if (!APPLY) {
    let after: Metrics | null = null;
    let nJ = 0;
    try {
      await prisma.$transaction(async (tx) => {
        const J = await run(tx, units);
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
  for (const u of units) {
    await prisma.$transaction(async (tx) => {
      const J = await run(tx, [u]);
      appendJournal(J); // пишем до коммита: если запись упала — транзакция откатится; если коммит упадёт, журнал содержит «after», откат пропустит неприменённое
      total += J.length;
    }, { timeout: 300000, maxWait: 30000 });
  }
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
