/**
 * Структурные исправления закупок по документам Google Drive «мех» (ничего не берётся «из головы»:
 * каждая правка снабжена источником; нет документа — нет изменения; спорное — в
 * docs-inventory/pending-decisions-purchase-structure.md).
 *
 * Запуск (по умолчанию DRY-RUN: вся логика выполняется в одной транзакции по живым данным, печатается план и
 * сверка «до/после», затем транзакция ОТКАТЫВАЕТСЯ — в базе ничего не остаётся):
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-purchase-structure.ts
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-purchase-structure.ts --apply
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-purchase-structure.ts --rollback docs-inventory/corrections-journal-purchase-structure.json [--apply]
 *
 * ПЕРЕД --apply СДЕЛАЙТЕ БЭКАП БАЗЫ (scripts/backup.sh).
 *
 * Что делает:
 *   1. РЫСЬ FH 06-26 (З-2026-0049): УПД нет, поставка по Спец. №12 — октябрь–ноябрь 2026, значит закупка не получена.
 *      Если ни один лот не списан в ТЗ и на лоты нигде нет ссылок — закупка возвращается в DRAFT: снимок лотов и движений
 *      пишется в журнал, лоты и движения PURCHASE_IN удаляются, PurchaseItem.lotId = NULL, costPlan позиции заполняется из
 *      лота (формат приложения, см. parseCostPlan в purchases/actions.ts — приёмка даст ту же стоимость), receivedDate = NULL,
 *      expectedDate = 30.11.2026. Иначе НИЧЕГО не меняется, причина печатается.
 *   2. Закупки «из реестра/ТЗ» без документов (З-2026-0001, 0010…0013, 0030, 0031): не удаляются. Где документы Drive
 *      однозначны — в notes дописывается пометка «по документам Drive: …» (и даты 2026 для 0001/0030/0031 по УПД/счёту).
 *   3. ПОДКЛАДКА 2025 по УПД №109 (Спец. №7, 8 тканей, 680,3 м, НДС 20%): недостающие метры по каждой ткани (УПД − уже
 *      учтено в пуле) оформляются закупкой RECEIVED (пул подкладки — один лот на ткань, как addOrPoolLiningLot; ткань №38
 *      создаётся). Реквизиты и даты З-2026-0032 приводятся к УПД №109. К закупке привязываются DriveDocument (УПД, спец.,
 *      счёт №100, письма); оплата 1 455 842 привязывается к паре закупок по auctionSession, если нет переплаты.
 *      Подкладка 2026 (Спец. №13, №16) НЕ заводится: УПД/подтверждения прихода в Drive нет.
 *   4. ДАТЫ ИМПОРТА (2026-10-01 у лотов и движений PURCHASE_IN, 1-е число у закупок) → даты УПД/счетов там, где документ
 *      однозначен (РП 04-26, СП 05-26, SAGA 03-26, подкладка УПД №109, З-2026-0001/0030/0031). Меняются только значения-заглушки.
 *
 * Идемпотентно (повторный запуск печатает «уже применено»). Журнал docs-inventory/corrections-journal-purchase-structure.json
 * дописывается после КАЖДОЙ транзакции: записи {time, entity, id, field, before, after, source}; field = "__create__" (создано —
 * откат удалит), "__delete__" (удалено — before содержит полный снимок строки, откат создаст её заново с тем же id).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { purchaseTotalInclVat } from "../src/lib/purchase-totals";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const rbIdx = process.argv.indexOf("--rollback");
const ROLLBACK_FILE = rbIdx >= 0 ? process.argv[rbIdx + 1] : null;
const JOURNAL = resolve(__dirname, "..", "docs-inventory", "corrections-journal-purchase-structure.json");

type Tx = Prisma.TransactionClient;
type Entry = { time: string; entity: string; id: string; field: string; before: unknown; after: unknown; source: string };
type Ctx = { tx: Tx; J: Entry[]; log: string[]; orgId: string };

const MODEL: Record<string, string> = {
  Purchase: "purchase", PurchaseItem: "purchaseItem", RawMaterialLot: "rawMaterialLot", StockMovement: "stockMovement",
  RawMaterial: "rawMaterial", DriveDocument: "driveDocument", Payment: "payment",
};
const JSON_FIELDS = new Set(["costPlan", "costBreakdown", "extra"]);
class DryRunDone extends Error {}

const D = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "∅");
const r2 = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const snap = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

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
const isStubDate = (d: Date | null) => !!d && (d.getUTCDate() === 1 && d.getUTCHours() === 0 || ymd(d) === "2026-10-01");

// ================================================================= 1. РЫСЬ FH 06-26

async function unitFH(c: Ctx) {
  const { tx, orgId } = c;
  const num = "З-2026-0049";
  const src = "Спец. №12 от 22.05.2026: «СРОК ПОСТАВКИ ТОВАРОВ: октябрь-ноябрь 2026»; УПД по рыси в Drive нет (p2026a §3.3)";
  const p = await tx.purchase.findFirst({
    where: { organizationId: orgId, number: num },
    include: { items: true, rawMaterialLots: { include: { stockMovements: true, purchaseItems: true, driveDocuments: true } } },
  });
  if (!p) return say(c, `${num}: закупка не найдена — пропущено`);
  if (p.status === "DRAFT" && p.rawMaterialLots.length === 0) return say(c, `✓ уже применено: ${num} в DRAFT, лотов нет`);
  if (p.status !== "RECEIVED") return say(c, `${num}: статус ${p.status}, ожидался RECEIVED — не менялось`);
  const lots = p.rawMaterialLots;
  const lotIds = lots.map((l) => l.id);
  // --- охранники: убеждаемся, что лоты нигде не используются
  const problems: string[] = [];
  const usages = await tx.productionMaterialUsage.count({ where: { lotId: { in: lotIds } } });
  if (usages) problems.push(`списаний в ТЗ (ProductionMaterialUsage): ${usages}`);
  const moves = lots.flatMap((l) => l.stockMovements);
  const bad = moves.filter((m) => m.type !== "PURCHASE_IN");
  if (bad.length) problems.push(`движений не PURCHASE_IN: ${bad.length}`);
  if (lots.some((l) => l.stockMovements.filter((m) => m.type === "PURCHASE_IN").length !== 1)) problems.push("у лота не ровно один приход");
  if (lots.some((l) => !l.quantityRemaining.equals(l.quantityReceived))) problems.push("остаток лота ≠ полученному");
  if (lots.some((l) => l.purchaseItems.some((i) => i.purchaseId !== p.id))) problems.push("на лот ссылается позиция другой закупки");
  if (lots.some((l) => l.purchaseItems.length !== 1)) problems.push("у лота не ровно одна позиция закупки");
  if (lots.some((l) => l.driveDocuments.length)) problems.push("к лотам привязаны DriveDocument (каскадное удаление)");
  const itemsNoLot = p.items.filter((i) => !i.lotId || !lotIds.includes(i.lotId));
  if (itemsNoLot.length) problems.push(`позиций без лота этой закупки: ${itemsNoLot.length}`);
  if (lots.length !== p.items.length) problems.push(`лотов ${lots.length} ≠ позиций ${p.items.length}`);
  const otherRefs = await tx.stockMovement.count({ where: { lotId: { in: lotIds }, purchaseId: { not: p.id } } });
  if (otherRefs) problems.push(`движений других закупок на лотах: ${otherRefs}`);
  const withPlan = p.items.filter((i) => i.costPlan != null);
  if (withPlan.length) problems.push(`у ${withPlan.length} позиций уже есть costPlan (не перезаписываем)`);
  if (problems.length) {
    say(c, `${num}: НЕ ИЗМЕНЕНО — лоты используются/нестандартная структура: ${problems.join("; ")}`);
    return;
  }
  const qty = lots.reduce((s, l) => s.add(l.quantityReceived), new Decimal(0));
  const val = lots.reduce((s, l) => s.add(l.totalCost), new Decimal(0));
  say(c, `${num}: ${lots.length} лотов, ${qty} шт, ${val.toFixed(2)} ₽ без списаний и ссылок → возврат в DRAFT (${src})`);
  const lotById = new Map(lots.map((l) => [l.id, l]));
  // 1) позиции: costPlan из лота, lotId = NULL
  for (const item of p.items) {
    const l = lotById.get(item.lotId!)!;
    const costPlan = {
      unitCostInclVat: l.unitCost.toString(),
      materialExclVat: l.materialCostExclVat.toString(),
      materialVat: l.materialVatAmount.toString(),
      expenseExclVat: l.expenseCostExclVat.toString(),
      expenseVat: l.expenseVatAmount.toString(),
      costBreakdown: l.costBreakdown ?? null,
    };
    await upd(c, "PurchaseItem", item.id, { costPlan, lotId: null }, `${src}; costPlan = стоимость единицы лота ${l.lotNumber}`);
  }
  // 2) движения и лоты — удаляем (полный снимок в журнале)
  for (const m of moves) await deleteRow(c, "StockMovement", m.id, src);
  for (const l of lots) await deleteRow(c, "RawMaterialLot", l.id, src);
  // 3) закупка
  const note = `[fix-structure:fh-draft] Возвращена в DRAFT: УПД на рысь в Drive нет, поставка по Спец. №12 — октябрь–ноябрь 2026. Стоимость лотов сохранена в costPlan позиций.`;
  await upd(c, "Purchase", p.id, {
    status: "DRAFT", receivedDate: null, expectedDate: D("2026-11-30"),
    notes: p.notes ? `${p.notes}\n${note}` : note,
  }, src + " (expectedDate = конец срока «октябрь-ноябрь 2026»)");
}

// ================================================================= 2. закупки «из реестра/ТЗ»

async function addNote(c: Ctx, number: string, tag: string, text: string, source: string) {
  const p = await c.tx.purchase.findFirst({ where: { organizationId: c.orgId, number } });
  if (!p) return say(c, `${number}: закупка не найдена`);
  if (p.notes?.includes(`[${tag}]`)) return say(c, `✓ уже применено: пометка в notes ${number}`);
  const note = `[${tag}] ${text}`;
  await upd(c, "Purchase", p.id, { notes: p.notes ? `${p.notes}\n${note}` : note }, source);
  say(c, `${number}: notes += «${text}»`);
}

async function unitNotes(c: Ctx) {
  await addNote(c, "З-2026-0001", "fix-structure:note",
    "По документам Drive: это не отдельная закупка у Веллмех, а сырьё подрядчика для ТЗ 121 (М029): 55 шкур красной лисы × 16 000 = 880 000 ₽, включено в доплату счёта №237 от 25.08.2026 (партия 18, ТЗ 119–135). Дата 2025-06-01 в реестре — заглушка, фактически 2026 год, НДС 22%. Не удалена (правило «не удалять без доказательств»); см. pending-decisions-purchase-structure.md п.2.",
    "prod2026 §партия 18 (доплата 3 397 795 = 30% + сырьё подрядчика 880 000), ТЗ 121 от 25.08.2026, счёт №237 (25.08)");
  await addNote(c, "З-2026-0010", "fix-structure:note",
    "По документам Drive: не отдельная закупка, а шкуры свакары подрядчика (4 584 500 ₽ = 346 шк. × 13 250), оплаченные в «доплате» партии 5: счёт №235 от 04.12.2025 на 5 669 120 ₽ включает эти 4 584 500 ₽ (согласовано 15.12.2025). Не удалена; возможен двойной учёт с оплатой партии 5 — см. pending-decisions-purchase-structure.md п.2.",
    "prod2025a §партия 5 (счёт №235 от 04.12.2025: «+4 584 500 шкуры свакары подрядчика»), ТЗ 55–58 «свакара по 13 250»");
  await addNote(c, "З-2026-0011", "fix-structure:note",
    "По документам Drive: не отдельная закупка, а шкуры свакары подрядчика партии 6 (463 750 ₽ = 35 шк. × 13 250), включённые в доплату: работа 1 597 870 + шкуры 463 750 − аванс 1 114 750 = 946 870 (счёт №239 от 18.12.2025, оплачено 26.12.2025). Не удалена — см. pending-decisions-purchase-structure.md п.2.",
    "prod2025b §партия 6 (счёт №239 от 18.12.2025, письмо 23–24.12.2025)");
  for (const n of ["З-2026-0012", "З-2026-0013"])
    say(c, `${n}: документы неоднозначны (сумма «шкур подрядчика» не сходится со счётом/ТЗ) — закупка не менялась, см. pending п.2`);
}

// ================================================================= 4. даты (общая часть)

type DateRule = { numbers: string[]; order?: string; received: string; src: string };
const DATE_RULES: DateRule[] = [
  { numbers: ["З-2026-0041", "З-2026-0042", "З-2026-0043", "З-2026-0044", "З-2026-0045", "З-2026-0046"], order: "2026-04-22", received: "2026-07-09",
    src: "РП 04-26: счета аукциона Русьпушнины 4079–4085 датированы 22.04.2026, УПД №201 от 09.07.2026 (p2026b §1, §3.1)" },
  { numbers: ["З-2026-0047", "З-2026-0048"], order: "2026-05-20", received: "2026-07-09",
    src: "СП 05-26: счета Союзпушнины 2019/2020 от 20.05.2026, УПД №199 от 09.07.2026 (p2026a/p2026b §3.2)" },
  { numbers: ["З-2026-0033", "З-2026-0034", "З-2026-0035", "З-2026-0036", "З-2026-0037", "З-2026-0038", "З-2026-0039", "З-2026-0040"], received: "2026-08-04",
    src: "SAGA 03-26: УПД №229 от 04.08.2026 (p2026a §3.1; графа «дата получения» в УПД пуста — берётся дата УПД, как для УПД 2025)" },
  { numbers: ["З-2026-0030"], order: "2026-07-09", received: "2026-07-09",
    src: "лоты СП0526.N совпадают по номеру и цене со строками УПД №199 от 09.07.2026 (лоты FW26-N/N закупок З-2026-0047/0048)" },
  { numbers: ["З-2026-0031"], order: "2026-07-09", received: "2026-07-09",
    src: "лоты РП0426.N совпадают по номеру и цене со строками 1–5 УПД №201 от 09.07.2026 (закупка З-2026-0041)" },
  { numbers: ["З-2026-0001"], order: "2026-08-25", received: "2026-08-25",
    src: "сырьё подрядчика ТЗ 121 (М029): ТЗ от 25.08.2026, доплата по счёту №237 от 25.08.2026 (prod2026)" },
];

/** Заглушки дат у одной закупки: закупка, её лоты и движения PURCHASE_IN. Меняются только значения-заглушки. */
async function setPurchaseDates(c: Ctx, number: string, order: string | undefined, received: string, src: string) {
  const { tx, orgId } = c;
  const p = await tx.purchase.findFirst({
    where: { organizationId: orgId, number },
    include: { rawMaterialLots: { include: { stockMovements: { where: { type: "PURCHASE_IN" } } } } },
  });
  if (!p) return say(c, `${number}: закупка не найдена`);
  const out: string[] = [];
  const pd: Record<string, unknown> = {};
  if (order && !eq(p.orderDate, D(order))) {
    if (isStubDate(p.orderDate)) pd.orderDate = D(order); else out.push(`orderDate ${ymd(p.orderDate)} не заглушка — не тронут`);
  }
  if (p.status === "RECEIVED" && !eq(p.receivedDate, D(received))) {
    if (isStubDate(p.receivedDate)) pd.receivedDate = D(received); else out.push(`receivedDate ${ymd(p.receivedDate)} не заглушка — не тронут`);
  }
  const before = `${ymd(p.orderDate)}/${ymd(p.receivedDate)}`;
  if (Object.keys(pd).length) await upd(c, "Purchase", p.id, pd, src);
  let lotsN = 0, movN = 0;
  for (const l of p.rawMaterialLots) {
    if (!eq(l.receivedDate, D(received)) && ymd(l.receivedDate) === "2026-10-01") {
      await upd(c, "RawMaterialLot", l.id, { receivedDate: D(received) }, src); lotsN++;
    }
    for (const m of l.stockMovements)
      if (!eq(m.date, D(received)) && ymd(m.date) === "2026-10-01") { await upd(c, "StockMovement", m.id, { date: D(received) }, src + " (дата прихода)"); movN++; }
  }
  if (!Object.keys(pd).length && !lotsN && !movN && !out.length) return say(c, `✓ уже применено: даты ${number}`);
  say(c, `${number}: даты закупки ${before} → ${ymd((pd.orderDate as Date) ?? p.orderDate)}/${ymd((pd.receivedDate as Date) ?? p.receivedDate)}; лотов ${lotsN}, движений ${movN}; ${src}${out.length ? "; " + out.join("; ") : ""}`);
}

async function unitDates(c: Ctx) {
  for (const r of DATE_RULES) for (const n of r.numbers) await setPurchaseDates(c, n, r.order, r.received, r.src);
  // Лоты 2025, у которых дата прихода уже приведена к УПД (apply-drive-purchase-corrections), а движение PURCHASE_IN осталось с датой импорта.
  const stale = await c.tx.stockMovement.findMany({
    where: { organizationId: c.orgId, type: "PURCHASE_IN", date: { gte: D("2026-10-01"), lt: D("2026-10-02") }, lot: { receivedDate: { lt: D("2026-10-01") } } },
    include: { lot: true },
  });
  for (const m of stale)
    await upd(c, "StockMovement", m.id, { date: m.lot!.receivedDate }, "дата прихода лота (УПД) вместо даты импорта");
  say(c, stale.length ? `движений PURCHASE_IN, выровненных по дате прихода лота (УПД): ${stale.length}` : "✓ уже применено: движения PURCHASE_IN выровнены по датам лотов");
}

// ================================================================= 3. ПОДКЛАДКА 2025 (УПД №109)

/** УПД №109 от 11.07.2025 (Спец. №7): № ткани в УПД → название в справочнике, метры. Цена 1 783,33 без НДС (2 140 с НДС 20%). */
const UPD109 = [
  { upd: "№2", name: "Подкладочная ткань №2", qty: "47.2" },
  { upd: "№24", name: "Подкладочная ткань №24", qty: "144" },
  { upd: "№41", name: "Подкладочная ткань №41", qty: "148.2" },
  { upd: "№38", name: "Подкладочная ткань №38", qty: "49.5" },
  { upd: "№04", name: "Подкладочная ткань №4", qty: "47.8" },
  { upd: "№28", name: "Подкладочная ткань №28", qty: "47" },
  { upd: "№27", name: "Подкладочная ткань №27", qty: "50.4" },
  { upd: "№37", name: "Подкладочная ткань №37", qty: "146.2" },
];
const UPD109_SRC = "УПД №109 от 11.07.2025 (Спец. №7 от 01.07.2025, счёт №100 от 01.07.2025): 8 тканей, 680,3 м, 2 140 ₽/м с НДС 20% (1 783,33 без НДС), итого 1 455 842,00 (p2025b §4.4)";
const LINING_TAG = "fix-structure:lining-upd109";
const LINING_SESSION = "Подкладка Спец. 7 (УПД 109)";
const UPD_PRICE_INCL = new Decimal(2140);
const DOCS109 = [
  "1qj2oY_r4PsjRW974I0a48u2ZaOCoADYJ", // УПД №109
  "1YqOfjQMXnEv_1XPkJj1YJwGxEUypR3Ye", // Спец. 7
  "1xntI0mZhdvsrpzP4N9RtYDOOz6gCZRur", // счёт №100
  "1ljKjQX0aM52HMB-PaRLbLLbchzyayNw8", // письмо
  "1rabzNkiEHzSuto-T5ptEMz2sZK5hjaAo", // письмо «согласовано»
];

async function unitLining(c: Ctx) {
  const { tx, orgId } = c;
  const existing = await tx.purchase.findFirst({ where: { organizationId: orgId, notes: { contains: `[${LINING_TAG}]` } } });
  const old = await tx.purchase.findFirst({ where: { organizationId: orgId, number: "З-2026-0032" }, include: { items: true } });
  if (!old) return say(c, "З-2026-0032 не найдена — подкладка не заводится");
  const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: old.supplierId } });
  const warehouse = await tx.warehouse.findFirstOrThrow({ where: { organizationId: orgId, isDefault: true } });

  // --- план: недостающие метры по каждой ткани
  type Row = { upd: string; name: string; qtyUpd: Decimal; matId: string | null; pool: Awaited<ReturnType<typeof loadPool>> | null; need: Decimal };
  const loadPool = async (matId: string) => tx.rawMaterialLot.findMany({ where: { organizationId: orgId, rawMaterialId: matId }, include: { purchaseItems: true, _count: { select: { usages: true } } } });
  const rows: Row[] = [];
  const problems: string[] = [];
  for (const u of UPD109) {
    const mat = await tx.rawMaterial.findFirst({ where: { organizationId: orgId, name: u.name } });
    let pool: Awaited<ReturnType<typeof loadPool>> | null = null;
    let accounted = new Decimal(0);
    if (mat) {
      pool = await loadPool(mat.id);
      if (pool.length > 1) problems.push(`${u.name}: лотов ${pool.length} вместо одного пула`);
      if (pool.length === 1) {
        const sumItems = pool[0].purchaseItems.reduce((s, i) => s.add(i.quantity), new Decimal(0));
        if (!sumItems.equals(pool[0].quantityReceived)) problems.push(`${u.name}: Σ позиций ${sumItems} ≠ получено в пуле ${pool[0].quantityReceived}`);
        if (pool[0].quantityRemaining.isNegative()) problems.push(`${u.name}: отрицательный остаток`);
        accounted = pool[0].quantityReceived;
      }
    }
    rows.push({ upd: u.upd, name: u.name, qtyUpd: new Decimal(u.qty), matId: mat?.id ?? null, pool, need: new Decimal(u.qty).sub(accounted) });
  }
  if (problems.length) return say(c, `Подкладка УПД №109: НЕ ИЗМЕНЕНО — ${problems.join("; ")}`);

  if (existing) {
    say(c, `✓ уже применено: закупка подкладки по УПД №109 есть (${existing.number})`);
  } else {
    const neg = rows.filter((r) => r.need.lessThan(0));
    if (neg.length) return say(c, `Подкладка УПД №109: в пулах уже больше метров, чем в УПД (${neg.map((r) => r.name).join(", ")}) — НЕ ИЗМЕНЕНО`);
    const todo = rows.filter((r) => r.need.greaterThan(0));
    if (!todo.length) say(c, "Подкладка УПД №109: недостающих метров нет");
    else {
      const all = await tx.purchase.findMany({ where: { organizationId: orgId }, select: { number: true } });
      const mx = Math.max(0, ...all.map((p) => Number(p.number.match(/^З-2026-(\d+)$/)?.[1] ?? 0)));
      const number = `З-2026-${String(mx + 1).padStart(4, "0")}`;
      const purchase = await createRow(c, "Purchase", {
        organizationId: orgId, number, supplierId: supplier.id, warehouseId: warehouse.id, status: "RECEIVED", currency: "RUB", exchangeRate: 1,
        auctionSession: LINING_SESSION, invoiceNumber: "100", transferDocument: "№ 109 от 11.07.2025 г.",
        orderDate: D("2025-07-01"), receivedDate: D("2025-07-11"),
        notes: `[${LINING_TAG}] Подкладка по УПД №109 от 11.07.2025 (Спец. №7, счёт №100): недостающие метры = УПД минус уже учтённые в пулах (З-2026-0032, расход по ТЗ). Создано скриптом apply-drive-purchase-structure.`,
      }, UPD109_SRC);
      say(c, `СОЗДАНА закупка ${number}: RECEIVED, ${supplier.name}, УПД №109 от 11.07.2025, счёт №100, заказ 01.07.2025, НДС 20%`);
      let totalIncl = new Decimal(0), totalM = new Decimal(0);
      for (const r of todo) {
        let matId = r.matId;
        if (!matId) {
          const m = await createRow(c, "RawMaterial", { organizationId: orgId, name: r.name, unit: "M" }, UPD109_SRC + " (ткани №38 в справочнике не было)");
          matId = m.id;
          say(c, `  создан материал «${r.name}» (unit M)`);
        }
        const qty = r.need;
        const subtotal = r2(qty.mul(UPD_PRICE_INCL).div("1.2"));       // без НДС
        const incl = r2(qty.mul(UPD_PRICE_INCL));                       // с НДС 20%
        const unitCost = r2(incl.div(qty));
        const unitExcl = r2(subtotal.div(qty));
        const unitVat = unitCost.sub(unitExcl);
        const item = await createRow(c, "PurchaseItem", {
          purchaseId: purchase.id, rawMaterialId: matId, quantity: qty, unitPrice: r2("1783.33"), subtotal, vatRate: 20,
          notes: `${r.upd} по УПД №109: ${r.qtyUpd} м, из них уже учтено ${r.qtyUpd.sub(qty)} м`,
        }, UPD109_SRC);
        // ---- то же, что addOrPoolLiningLot (src/lib/stock.ts)
        let lotId: string;
        if (!r.pool || r.pool.length === 0) {
          const lot = await createRow(c, "RawMaterialLot", {
            organizationId: orgId, warehouseId: warehouse.id, rawMaterialId: matId, lotNumber: null, grade: null, color: null,
            quantityReceived: qty, quantityRemaining: qty, unitCost, totalCost: incl, vatRate: 20,
            materialCostExclVat: unitExcl, materialVatAmount: unitVat, expenseCostExclVat: 0, expenseVatAmount: 0,
            purchaseId: purchase.id, receivedDate: D("2025-07-11"),
          }, UPD109_SRC);
          lotId = lot.id;
          say(c, `  ${r.name}: новый лот-пул ${qty} м × ${unitCost} = ${incl}`);
        } else {
          const pool = r.pool[0];
          const newRec = pool.quantityReceived.add(qty);
          const newRem = pool.quantityRemaining.add(qty);
          const rem = pool.quantityRemaining;
          const w = (oldV: Decimal, newV: Decimal) => (newRem.isZero() ? newV : oldV.mul(rem).add(newV.mul(qty)).div(newRem));
          await upd(c, "RawMaterialLot", pool.id, {
            quantityReceived: newRec, quantityRemaining: newRem, unitCost: w(pool.unitCost, unitCost), totalCost: pool.totalCost.add(incl),
            materialCostExclVat: w(pool.materialCostExclVat, unitExcl), materialVatAmount: w(pool.materialVatAmount, unitVat),
            expenseCostExclVat: w(pool.expenseCostExclVat, new Decimal(0)), expenseVatAmount: w(pool.expenseVatAmount, new Decimal(0)),
            notes: pool.notes ? `${pool.notes} Пул увеличен новым поступлением (+${qty.toString()}).` : `Пул увеличен новым поступлением (+${qty.toString()}).`,
          }, UPD109_SRC);
          lotId = pool.id;
          say(c, `  ${r.name}: пул +${qty} м (было получено ${pool.quantityReceived}, остаток ${pool.quantityRemaining}) → получено ${newRec}, остаток ${newRem}`);
        }
        await upd(c, "PurchaseItem", item.id, { lotId }, UPD109_SRC);
        await createRow(c, "StockMovement", {
          organizationId: orgId, warehouseId: warehouse.id, rawMaterialId: matId, lotId, type: "PURCHASE_IN", quantity: qty,
          unitCost, totalCost: incl, purchaseId: purchase.id, date: D("2025-07-11"),
        }, UPD109_SRC);
        totalIncl = totalIncl.add(incl); totalM = totalM.add(qty);
      }
      say(c, `  итого новая закупка ${number}: ${totalM} м, ${totalIncl.toFixed(2)} ₽ с НДС (УПД 680,3 м, 1 455 842,00)`);
    }
  }

  // --- З-2026-0032: реквизиты и даты по тому же УПД
  const oldKeys = await upd(c, "Purchase", old.id, {
    auctionSession: LINING_SESSION, invoiceNumber: "100", transferDocument: "№ 109 от 11.07.2025 г.",
    ...(isStubDate(old.orderDate) ? { orderDate: D("2025-07-01") } : {}),
    ...(isStubDate(old.receivedDate) ? { receivedDate: D("2025-07-11") } : {}),
    notes: old.notes?.includes(`[${LINING_TAG}]`) ? old.notes : `${old.notes ? old.notes + "\n" : ""}[${LINING_TAG}] По документам: эти метры (расход по ТЗ) — часть поставки УПД №109 от 11.07.2025 (Спец. №7); остаток поставки оформлен отдельной закупкой по УПД №109.`,
  }, UPD109_SRC);
  if (oldKeys.length) say(c, `З-2026-0032: обновлены поля ${oldKeys.join(", ")} (УПД №109)`);
  const poolLots = await tx.rawMaterialLot.findMany({ where: { purchaseId: old.id, receivedDate: { gte: D("2026-10-01"), lt: D("2026-10-02") } }, include: { stockMovements: { where: { type: "PURCHASE_IN" } } } });
  for (const l of poolLots) {
    await upd(c, "RawMaterialLot", l.id, { receivedDate: D("2025-07-11") }, UPD109_SRC + " (дата УПД вместо даты импорта)");
    for (const m of l.stockMovements) if (ymd(m.date) === "2026-10-01") await upd(c, "StockMovement", m.id, { date: D("2025-07-11") }, UPD109_SRC);
  }
  if (poolLots.length) say(c, `З-2026-0032: дата прихода пулов (${poolLots.length}) 2026-10-01 → 2025-07-11`);

  // --- DriveDocument
  const target = existing ?? (await tx.purchase.findFirst({ where: { organizationId: orgId, notes: { contains: `[${LINING_TAG}]` }, NOT: { id: old.id } } }));
  if (target) {
    for (const fid of DOCS109) {
      const tpl = await tx.driveDocument.findFirst({ where: { organizationId: orgId, driveFileId: fid, purchaseId: old.id } });
      if (!tpl) { say(c, `  DriveDocument ${fid}: шаблона привязки к З-2026-0032 нет — пропущено`); continue; }
      const have = await tx.driveDocument.findFirst({ where: { organizationId: orgId, driveFileId: fid, purchaseId: target.id } });
      if (have) continue;
      const { id: _id, createdAt: _c, purchaseId: _p, ...rest } = tpl; void _id; void _c; void _p;
      await createRow(c, "DriveDocument", { ...rest, purchaseId: target.id, notes: "Привязка по УПД №109 (подкладка 2025), apply-drive-purchase-structure" }, "manifest: файл из папки закупка 2025/подкладка");
      say(c, `  привязан документ Drive «${tpl.title}» к ${target.number}`);
    }
    // --- оплата 1 455 842 по auctionSession пары закупок (без переплаты)
    const pay = await tx.payment.findFirst({ where: { organizationId: orgId, notes: { contains: "[fix:P08]" } } });
    if (!pay) say(c, "  платёж 1 455 842 ([fix:P08]) не найден — не привязывался");
    else if (pay.auctionSession === LINING_SESSION) say(c, "✓ уже применено: платёж 1 455 842 привязан к сессии подкладки");
    else if (pay.purchaseId || pay.auctionSession) say(c, `  платёж 1 455 842 уже привязан (${pay.purchaseId ?? pay.auctionSession}) — не трогаю`);
    else {
      const ps = await tx.purchase.findMany({ where: { organizationId: orgId, auctionSession: LINING_SESSION }, include: { items: true, expenses: true } });
      const total = ps.reduce((s, p) => s.add(purchaseTotalInclVat(p) as Decimal), new Decimal(0));
      if (pay.amount.sub(total).greaterThan("0.005")) say(c, `  платёж ${pay.amount} > стоимость закупок подкладки ${total.toFixed(2)} — НЕ привязан (переплата), в pending`);
      else {
        await upd(c, "Payment", pay.id, { auctionSession: LINING_SESSION }, "УПД №109 п.(8): п/п 54214 от 03.07.2025 на 1 455 842 — оплата поставки подкладки по Спец. №7");
        say(c, `  платёж 1 455 842 (п/п 54214 от 03.07.2025) привязан к «${LINING_SESSION}» (закупки на ${total.toFixed(2)} ₽ с НДС)`);
      }
    }
  }
}

// ================================================================= сверка

async function metrics(tx: Tx, orgId: string) {
  const purchases = await tx.purchase.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" } }, include: { items: true, expenses: true } });
  const byStatus = new Map<string, { n: number; sum: Decimal }>();
  let all = new Decimal(0);
  for (const p of purchases) {
    const t = purchaseTotalInclVat(p) as Decimal;
    const x = byStatus.get(p.status) ?? { n: 0, sum: new Decimal(0) };
    x.n++; x.sum = x.sum.add(t); byStatus.set(p.status, x); all = all.add(t);
  }
  const lots = await tx.rawMaterialLot.findMany({ where: { organizationId: orgId }, include: { rawMaterial: true } });
  const used = await tx.productionMaterialUsage.groupBy({ by: ["lotId"], _sum: { quantity: true } });
  const usedMap = new Map(used.map((u) => [u.lotId, u._sum.quantity ?? new Decimal(0)]));
  const mv = await tx.stockMovement.groupBy({ by: ["lotId", "type"], _sum: { quantity: true } });
  const adjIn = new Map<string, Decimal>(), adjOut = new Map<string, Decimal>();
  for (const m of mv) {
    if (!m.lotId) continue;
    if (m.type === "ADJUSTMENT_IN") adjIn.set(m.lotId, m._sum.quantity ?? new Decimal(0));
    if (m.type === "ADJUSTMENT_OUT" || m.type === "TRANSFER_OUT") adjOut.set(m.lotId, (adjOut.get(m.lotId) ?? new Decimal(0)).add(m._sum.quantity ?? 0));
  }
  const byUnit = new Map<string, { lots: number; rec: Decimal; used: Decimal; rem: Decimal; remVal: Decimal; tot: Decimal }>();
  let neg = 0, mism = 0;
  for (const l of lots) {
    const u = usedMap.get(l.id) ?? new Decimal(0);
    const x = byUnit.get(l.rawMaterial.unit) ?? { lots: 0, rec: new Decimal(0), used: new Decimal(0), rem: new Decimal(0), remVal: new Decimal(0), tot: new Decimal(0) };
    x.lots++; x.rec = x.rec.add(l.quantityReceived); x.used = x.used.add(u); x.rem = x.rem.add(l.quantityRemaining);
    x.remVal = x.remVal.add(l.quantityRemaining.mul(l.unitCost)); x.tot = x.tot.add(l.totalCost);
    byUnit.set(l.rawMaterial.unit, x);
    if (l.quantityRemaining.isNegative()) neg++;
    const exp = l.quantityReceived.add(adjIn.get(l.id) ?? 0).sub(u).sub(adjOut.get(l.id) ?? 0);
    if (!exp.equals(l.quantityRemaining)) mism++;
  }
  const stubLots = lots.filter((l) => ymd(l.receivedDate) === "2026-10-01").length;
  const stubMov = await tx.stockMovement.count({ where: { organizationId: orgId, type: "PURCHASE_IN", date: { gte: D("2026-10-01"), lt: D("2026-10-02") } } });
  return { byStatus, all, byUnit, neg, mism, nLots: lots.length, stubLots, stubMov };
}
type Metrics = Awaited<ReturnType<typeof metrics>>;
function printMetrics(title: string, m: Metrics) {
  console.log(`\n--- ${title} ---`);
  console.log(`  Закупки (кроме CANCELLED), стоимость с НДС: всего ${m.all.toFixed(2)}`);
  for (const [s, x] of [...m.byStatus].sort()) console.log(`    ${s}: ${x.n} закупок, ${x.sum.toFixed(2)}`);
  console.log(`  Лотов: ${m.nLots}; с датой-заглушкой 2026-10-01: лотов ${m.stubLots}, приходов ${m.stubMov}`);
  for (const [u, x] of [...m.byUnit].sort())
    console.log(`  Сырьё ${u === "M" ? "подкладка (м)" : "мех (шт)"}: лотов ${x.lots}; получено ${x.rec}; списано в ТЗ ${x.used}; остаток ${x.rem}; стоимость остатка ${x.remVal.toFixed(2)}; Σ закуплено (totalCost) ${x.tot.toFixed(2)}`);
  console.log(`  Отрицательных остатков: ${m.neg}; лотов, где получено + корр. − списано − вывод ≠ остаток: ${m.mism}`);
}

// ================================================================= main / apply / rollback

function appendJournal(entries: Entry[]) {
  if (!entries.length) return;
  const cur: Entry[] = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : [];
  writeFileSync(JOURNAL, JSON.stringify(cur.concat(entries), null, 1));
}

const UNITS: [string, (c: Ctx) => Promise<void>][] = [
  ["1. Рысь FH 06-26 → DRAFT", unitFH],
  ["2. Закупки из реестра/ТЗ: пометки", unitNotes],
  ["3. Подкладка 2025 по УПД №109", unitLining],
  ["4. Даты импорта → даты УПД/счетов", unitDates],
];

async function main() {
  const dbUrl = (process.env.DATABASE_URL ?? "").replace(/:[^:@/]*@/, ":***@");
  console.log(`База: ${dbUrl}\nРежим: ${ROLLBACK_FILE ? "ОТКАТ" : APPLY ? "APPLY" : "DRY-RUN (транзакция откатывается)"}`);
  if (ROLLBACK_FILE) return rollback(ROLLBACK_FILE);
  const org = await prisma.organization.findFirstOrThrow();

  if (!APPLY) {
    try {
      await prisma.$transaction(async (tx) => {
        printMetrics("ДО", await metrics(tx, org.id));
        let total = 0;
        for (const [title, fn] of UNITS) {
          const c: Ctx = { tx, J: [], log: [], orgId: org.id };
          await fn(c);
          total += c.J.length;
          console.log(`\n### ${title} (записей журнала: ${c.J.length})`);
          for (const l of c.log) console.log("  " + l);
        }
        printMetrics("ПОСЛЕ (в транзакции, будет откачено)", await metrics(tx, org.id));
        console.log(`\nИТОГО записей журнала: ${total}`);
        throw new DryRunDone();
      }, { timeout: 300000, maxWait: 30000 });
    } catch (e) { if (!(e instanceof DryRunDone)) throw e; }
    console.log("\nDRY-RUN: ничего не записано (транзакция откачена). Для применения: --apply (сначала бэкап базы).");
    return;
  }

  printMetrics("ДО", await metrics(prisma, org.id));
  for (const [title, fn] of UNITS) {
    const c: Ctx = { tx: null as never, J: [], log: [], orgId: org.id };
    try {
      await prisma.$transaction(async (tx) => { c.tx = tx; await fn(c); }, { timeout: 300000, maxWait: 30000 });
      appendJournal(c.J);
      console.log(`\n### ${title}: записей журнала ${c.J.length}`);
      for (const l of c.log) console.log("  " + l);
    } catch (e) {
      console.log(`\n### ${title}: ОШИБКА, транзакция откачена: ${(e as Error).message}`);
    }
  }
  printMetrics("ПОСЛЕ", await metrics(prisma, org.id));
  console.log(`\nЖурнал: ${JOURNAL}`);
}

async function rollback(file: string) {
  const entries: Entry[] = JSON.parse(readFileSync(resolve(file), "utf-8"));
  console.log(`Откат по журналу ${file}: ${entries.length} записей`);
  const org = await prisma.organization.findFirstOrThrow();
  try {
    await prisma.$transaction(async (tx) => {
      printMetrics("ДО отката", await metrics(tx, org.id));
      let done = 0, skipped = 0;
      for (const e of [...entries].reverse()) {
        const m = delegate(tx, e.entity);
        if (!m) { console.log(`  неизвестная сущность ${e.entity}`); skipped++; continue; }
        const cur = await m.findUnique({ where: { id: e.id } });
        if (e.field === "__create__") {
          if (!cur) continue;
          if (e.entity === "RawMaterialLot" && (await tx.productionMaterialUsage.count({ where: { lotId: e.id } }))) { console.log(`  лот ${e.id}: ИСПОЛЬЗУЕТСЯ в ТЗ — не удалён`); skipped++; continue; }
          if (e.entity === "RawMaterial" && ((await tx.rawMaterialLot.count({ where: { rawMaterialId: e.id } })) || (await tx.purchaseItem.count({ where: { rawMaterialId: e.id } })))) { console.log(`  материал ${e.id}: есть ссылки — не удалён`); skipped++; continue; }
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
      printMetrics("ПОСЛЕ отката", await metrics(tx, org.id));
      if (!APPLY) throw new DryRunDone();
    }, { timeout: 300000, maxWait: 30000 });
  } catch (e) { if (!(e instanceof DryRunDone)) throw e; console.log("\nDRY-RUN отката: ничего не записано. Для применения добавьте --apply."); }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
