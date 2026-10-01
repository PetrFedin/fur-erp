/**
 * Применяет к базе исправления по закупкам сырья, ПОДТВЕРЖДЁННЫЕ документами Google Drive
 * «Приобретение мехового сырья» (отчёты docs-inventory/extract/p2025a|p2025b|p2026a|p2026b.md|json).
 * Спорное здесь НЕ применяется — оно перечислено в docs-inventory/pending-decisions-purchases.md.
 *
 * Запуск (по умолчанию DRY-RUN: ничего не пишет, печатает план «сущность: поле: было → стало, источник»):
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-purchase-corrections.ts
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-purchase-corrections.ts --apply
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-purchase-corrections.ts --rollback docs-inventory/corrections-journal-purchases.json
 *
 * --apply: одна транзакция на закупку (поля, позиции, лоты, движения), затем создание новых закупок
 *   (одна транзакция на закупку) и платежей (одна транзакция на платёж, с блокировкой аукциона и повторной
 *   проверкой переплаты по живой базе). Идемпотентно: повторный запуск пишет «уже применено».
 *   Если значение в базе уже не равно ни «было», ни «стало» (кто-то правил руками) — закупка пропускается
 *   целиком, об этом печатается КОНФЛИКТ. Журнал docs-inventory/corrections-journal-purchases.json
 *   пополняется после КАЖДОЙ закупки (массив {time, entity, id, field, before, after, source}).
 * --rollback <журнал>: возвращает «было» для записанных полей (в обратном порядке) и удаляет созданные
 *   этим скриптом записи (платежи, новые закупки с лотами). Поле, изменённое после применения, не трогается.
 *
 * Что делает (категории в плане):
 *   1. НДС 2025: у закупок 2025 года ставка 22 → 20 в PurchaseItem и RawMaterialLot; цена без НДС = цена с НДС / 1,2.
 *      Цена с НДС (unitCost) и totalCost НЕ меняются, расходная часть лота (expense*) у этих лотов нулевая и не меняется.
 *   2. Поля закупок по документам: auctionSession, transferDocument, даты (2025-12 соболь СП 12.25), дата прихода лотов 2025 = дата УПД.
 *   3. Цены лотов по подписанным УПД №201/199/229 (только лоты без списаний в ТЗ): unitCost/totalCost, материал без НДС/НДС,
 *      позиция закупки, движение PURCHASE_IN и (для 27 лотов МП-Прогресс) строка «Транспорт» в costBreakdown.
 *   4. SAGA: 4 лота (355159, 500083, 300687, 165270) — позиции из З-2026-0030 переносятся в «свои» закупки с
 *      количеством по УПД №229; totalCost лота = количество × цена (списания и остатки не трогаются).
 *   5. Новые закупки RECEIVED: AME 05-26 (УПД №253) и красная лиса (УПД №209) — лот, позиция, движение PURCHASE_IN
 *      (та же логика, что createRawMaterialLot в src/lib/stock.ts: сам модуль «server-only», вне Next его не загрузить).
 *   6. Реквизиты: ИНН Веллмех и Меркури Мода (поля КПП в схеме нет — пропущено).
 *   П. Платежи поставщику ООО «Веллмех» — только с подтверждённой датой и суммой, без переплаты (см. src/lib/auction-payments.ts).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { purchaseTotalInclVat } from "../src/lib/purchase-totals";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const rbIdx = process.argv.indexOf("--rollback");
const ROLLBACK_FILE = rbIdx >= 0 ? process.argv[rbIdx + 1] : null;
const JOURNAL = resolve(__dirname, "..", "docs-inventory", "corrections-journal-purchases.json");
const DATA = JSON.parse(readFileSync(join(__dirname, "purchase_corrections_data.json"), "utf-8"));
const PAY_EPS = new Decimal("0.005");

// ---------------------------------------------------------------- типы полей

type FType = "dec2" | "dec3" | "date" | "json" | "str";
type Ent = "Purchase" | "PurchaseItem" | "RawMaterialLot" | "StockMovement" | "Supplier" | "Client" | "Payment";
const MODEL: Record<Ent, string> = {
  Purchase: "purchase", PurchaseItem: "purchaseItem", RawMaterialLot: "rawMaterialLot",
  StockMovement: "stockMovement", Supplier: "supplier", Client: "client", Payment: "payment",
};
const FT: Record<string, FType> = {
  "Purchase.auctionSession": "str", "Purchase.transferDocument": "str",
  "Purchase.orderDate": "date", "Purchase.receivedDate": "date",
  "PurchaseItem.vatRate": "dec2", "PurchaseItem.unitPrice": "dec2", "PurchaseItem.subtotal": "dec2",
  "PurchaseItem.quantity": "dec3", "PurchaseItem.purchaseId": "str",
  "RawMaterialLot.vatRate": "dec2", "RawMaterialLot.materialCostExclVat": "dec2", "RawMaterialLot.materialVatAmount": "dec2",
  "RawMaterialLot.unitCost": "dec2", "RawMaterialLot.totalCost": "dec2", "RawMaterialLot.receivedDate": "date",
  "RawMaterialLot.costBreakdown": "json",
  "StockMovement.unitCost": "dec2", "StockMovement.totalCost": "dec2",
  "Supplier.inn": "str", "Client.inn": "str",
};
function ftype(e: Ent, f: string): FType {
  const t = FT[`${e}.${f}`];
  if (!t) throw new Error(`Нет типа поля ${e}.${f}`);
  return t;
}
/** Каноническая строка для сравнения значений. */
function norm(t: FType, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  switch (t) {
    case "dec2": return new Decimal(v as never).toFixed(2);
    case "dec3": return new Decimal(v as never).toFixed(3);
    case "date": return new Date(v as never).toISOString();
    case "json": return JSON.stringify(v);
    default: return String(v);
  }
}
function toDb(t: FType, v: unknown): unknown {
  if (v === null || v === undefined) return t === "json" ? Prisma.DbNull : null;
  switch (t) {
    case "dec2": case "dec3": return new Decimal(v as never);
    case "date": return new Date(v as never);
    default: return v;
  }
}
/** Значение для журнала/печати: Decimal → строка, Date → ISO. */
function canon(t: FType, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (t === "dec2") return new Decimal(v as never).toFixed(2);
  if (t === "dec3") return new Decimal(v as never).toFixed(3);
  if (t === "date") return new Date(v as never).toISOString();
  return v;
}
const show = (t: FType, v: unknown) => {
  if (v === null || v === undefined) return "∅";
  if (t === "date") return String(v).slice(0, 10);
  if (t === "json") return "{…}";
  return `«${String(v)}»`.replace(/^«(-?[\d.]+)»$/, "$1");
};

const r2 = (d: Decimal.Value) => new Decimal(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const dateIso = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`).toISOString();

// ---------------------------------------------------------------- журнал / операции

type JournalEntry = { time: string; entity: string; id: string; field: string; before: unknown; after: unknown; source: string };
type Op = {
  cat: string; unit: string; entity: Ent; id: string; label: string; field: string;
  before: unknown; after: unknown; source: string;
};
type Create = {
  cat: string; unit: string; key: string; label: string; source: string; lines: string[];
  exists: () => Promise<boolean>;
  run: (tx: Prisma.TransactionClient) => Promise<JournalEntry[]>;
};

const CAT = {
  vat: "1. НДС 2025: 22% → 20%",
  fields: "2. Поля закупок по документам",
  prices: "3. Цены лотов по подписанным УПД",
  saga: "4. SAGA: 4 лота в свои закупки (УПД №229)",
  create: "5. Недостающие закупки по УПД",
  req: "6. Реквизиты контрагентов",
  pay: "П. Платежи поставщику",
};

const ops: Op[] = [];
const creates: Create[] = [];
const skipped: { cat: string; text: string }[] = [];
const skip = (cat: string, text: string) => skipped.push({ cat, text });

function addOp(o: Omit<Op, "before" | "after"> & { before: unknown; after: unknown }) {
  const t = ftype(o.entity, o.field);
  if (norm(t, o.before) === norm(t, o.after)) return false;
  ops.push({ ...o, before: canon(t, o.before), after: canon(t, o.after) });
  return true;
}

// ---------------------------------------------------------------- загрузка состояния

type LoadedPurchase = Awaited<ReturnType<typeof loadPurchases>>[number];
async function loadPurchases(organizationId: string) {
  return prisma.purchase.findMany({
    where: { organizationId },
    orderBy: { number: "asc" },
    include: {
      items: { include: { lot: true } },
      expenses: true,
      payments: true,
      rawMaterialLots: {
        include: { purchaseItems: true, stockMovements: true, _count: { select: { usages: true } } },
      },
    },
  });
}

// Состояние для проверок переплаты (с учётом запланированных правок и платежей).
type PItem = { id: string; purchaseId: string; subtotal: Decimal; vatRate: Decimal; quantity: Decimal; costPlan: unknown };
const S = {
  items: new Map<string, PItem>(),
  meta: new Map<string, { number: string; exchangeRate: Decimal; status: string; auction: string | null; expenses: { amount: Decimal; vatRate: Decimal }[] }>(),
  paidPurchase: new Map<string, Decimal>(),
  paidAuction: new Map<string, Decimal>(),
};
const auctionName = (s: string | null | undefined) => s?.split(/\r?\n/)[0].trim() || null;
function projTotal(pid: string): Decimal {
  const m = S.meta.get(pid)!;
  const items = [...S.items.values()].filter((i) => i.purchaseId === pid);
  return purchaseTotalInclVat({ exchangeRate: m.exchangeRate as never, items: items as never, expenses: m.expenses as never }) as Decimal;
}
function projAuctionTotal(name: string): Decimal {
  let t = new Decimal(0);
  for (const [pid, m] of S.meta) if (m.auction === name && m.status !== "CANCELLED") t = t.add(projTotal(pid));
  return t;
}
function projAuctionPaid(name: string): Decimal {
  let p = S.paidAuction.get(name) ?? new Decimal(0);
  for (const [pid, m] of S.meta) if (m.auction === name) p = p.add(S.paidPurchase.get(pid) ?? 0);
  return p;
}

// ---------------------------------------------------------------- источники по закупкам

const VAT_SOURCES: Record<string, string> = {
  "З-2026-0002": "УПД №103 от 03.07.2025, НДС 20% (p2025a §2.1)",
  "З-2026-0003": "УПД №127 от 13.08.2025, НДС 20% (p2025a §2.1)",
  "З-2026-0004": "УПД №283 от 30.12.2025 и счёт Веллмех №241 от 22.12.2025, НДС 20% (p2025b §4.3, p2026b §3.3)",
  "З-2026-0005": "УПД №124 от 29.07.2025, НДС 20% (p2025a §2.1)",
  "З-2026-0006": "УПД №122 от 26.08.2025 (стр.1), НДС 20% (p2025a §2.1)",
  "З-2026-0007": "УПД №122 от 26.08.2025 (стр.2), НДС 20% (p2025a §2.1)",
  "З-2026-0008": "УПД №80 от 04.06.2025, НДС 20% (p2025a §2.1)",
  "З-2026-0009": "УПД №96 от 15.07.2025, НДС 20% (p2025a §2.1)",
  "З-2026-0032": "УПД №109 от 11.07.2025 (Спец. №7, подкладка 2140 ₽/м с НДС 20%), p2025b §4.4/§5.1",
};
for (const n of [14, 15, 16, 17, 18]) VAT_SOURCES[`З-2026-${String(n).padStart(4, "0")}`] = "УПД №77 от 16.05.2025 (РП 03.25), НДС 20% (p2025b §4.1)";
for (const n of [20, 21, 22, 23, 24, 25, 26]) VAT_SOURCES[`З-2026-${String(n).padStart(4, "0")}`] = "УПД №78 от 16.05.2025 (СП 03.25), НДС 20% (p2025b §4.1)";
for (const n of [19, 27, 28, 29]) VAT_SOURCES[`З-2026-${String(n).padStart(4, "0")}`] = "УПД №143 от 22.09.2025 (СП/РП 05.25), НДС 20% (p2025b §4.2)";

const FIELD_FIXES: Record<string, { auctionSession?: string; transferDocument?: string; orderDate?: string; receivedDate?: string; src: string }> = {
  "З-2026-0002": { auctionSession: "SAGA 03-25", src: "расчёты «SAGA 03-25» и Спец. №2 (p2025a §2.2, §6.2)" },
  "З-2026-0003": { auctionSession: "SAGA 06-25", src: "расчёт «SAGA 06-2025», счёт аукциона SAGA 0022-001 (p2025a §2.2, §6.2)" },
  "З-2026-0005": { auctionSession: "КФХ Дуденко Л. Н.", src: "колонка «Аукцион» в расчётах себестоимости (источник — ферма, не аукцион; p2025a §2.2)" },
  "З-2026-0006": { auctionSession: "КФХ Дуденко Л. Н.", src: "колонка «Аукцион» в расчётах себестоимости Приложения 6 (ферма; p2025a §2.2)" },
  "З-2026-0007": { auctionSession: "КФХ Дуденко Л. Н.", src: "колонка «Аукцион» в расчётах себестоимости Приложения 6 (ферма; p2025a §2.2)" },
  "З-2026-0004": {
    auctionSession: "СП 12.25", transferDocument: "№ 283 от 30.12.2025 г.", orderDate: "2025-12-22", receivedDate: "2025-12-30",
    src: "УПД №283 от 30.12.2025 (дата прихода), Спец. №8 и счёт Веллмех №241 от 22.12.2025 (дата заказа), счёт Союзпушнины 12-25 (p2025b §4.3, p2026b §3.3)",
  },
  "З-2026-0040": { auctionSession: "SAGA 03-26", src: "УПД №229 п.19 «сага 03-26», инвойс SAGA от 30.03.2026 вместо вставленного текста спецификации (p2026a §3.2)" },
};
for (const n of [33, 34, 35, 36, 37, 38, 39, 40]) {
  const k = `З-2026-00${n}`;
  FIELD_FIXES[k] = { ...(FIELD_FIXES[k] ?? { src: "" }), transferDocument: "№ 229 от 04.08.2026 г.", src: (FIELD_FIXES[k]?.src ? FIELD_FIXES[k].src + "; " : "") + "УПД №229 от 04.08.2026 (p2026a §4.1.2)" };
}
for (const n of [41, 42, 43, 44, 45, 46]) {
  FIELD_FIXES[`З-2026-00${n}`] = { transferDocument: "№ 201 от 09.07.2026 г.", src: "УПД №201 от 09.07.2026, 60 строк, счета Русьпушнины 4079–4085 (p2026b §3.1)" };
}
for (const n of [47, 48]) {
  FIELD_FIXES[`З-2026-00${n}`] = { transferDocument: "№ 199 от 09.07.2026 г.", src: "УПД №199 от 09.07.2026, счета Союзпушнины 2019/2020 (p2026b §3.2)" };
}

/** Дата прихода лотов = дата УПД (в базе у всех лотов стоит дата импорта 2026-10-01). */
const LOT_RECEIVED: Record<string, { date: string; src: string }> = {
  "З-2026-0002": { date: "2025-07-03", src: "УПД №103 от 03.07.2025" },
  "З-2026-0003": { date: "2025-08-13", src: "УПД №127 от 13.08.2025" },
  "З-2026-0004": { date: "2025-12-30", src: "УПД №283 от 30.12.2025" },
  "З-2026-0005": { date: "2025-07-29", src: "УПД №124 от 29.07.2025" },
  "З-2026-0006": { date: "2025-08-26", src: "УПД №122 от 26.08.2025" },
  "З-2026-0007": { date: "2025-08-26", src: "УПД №122 от 26.08.2025" },
  "З-2026-0008": { date: "2025-06-04", src: "УПД №80 от 04.06.2025" },
  "З-2026-0009": { date: "2025-07-15", src: "УПД №96 от 15.07.2025" },
};
for (const n of [14, 15, 16, 17, 18]) LOT_RECEIVED[`З-2026-00${n}`] = { date: "2025-05-16", src: "УПД №77 от 16.05.2025" };
for (const n of [20, 21, 22, 23, 24, 25, 26]) LOT_RECEIVED[`З-2026-00${n}`] = { date: "2025-05-16", src: "УПД №78 от 16.05.2025" };
for (const n of [19, 27, 28, 29]) LOT_RECEIVED[`З-2026-00${n}`] = { date: "2025-09-22", src: "УПД №143 от 22.09.2025" };

// ---------------------------------------------------------------- планирование

async function plan() {
  const org = await prisma.organization.findFirstOrThrow();
  const organizationId = org.id;
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { organizationId, isDefault: true } });
  const supplier = await prisma.supplier.findFirst({ where: { organizationId, name: { contains: "Веллмех", mode: "insensitive" } } });
  const client = await prisma.client.findFirst({ where: { organizationId, name: { contains: "Меркури", mode: "insensitive" } } });
  if (!supplier) throw new Error("Поставщик «Веллмех» не найден");
  const purchases = await loadPurchases(organizationId);
  const byNum = new Map(purchases.map((p) => [p.number, p]));

  // состояние для проверок
  for (const p of purchases) {
    S.meta.set(p.id, { number: p.number, exchangeRate: p.exchangeRate, status: p.status, auction: auctionName(p.auctionSession), expenses: p.expenses });
    for (const i of p.items)
      S.items.set(i.id, { id: i.id, purchaseId: p.id, subtotal: i.subtotal, vatRate: i.vatRate, quantity: i.quantity, costPlan: i.costPlan });
    const done = p.payments.filter((x) => x.status === "COMPLETED").reduce((s, x) => s.add(x.amount), new Decimal(0));
    S.paidPurchase.set(p.id, done);
  }
  const existingAuctionPays = await prisma.payment.findMany({ where: { organizationId, purchaseId: null, auctionSession: { not: null }, status: "COMPLETED" } });
  for (const x of existingAuctionPays) S.paidAuction.set(x.auctionSession!, (S.paidAuction.get(x.auctionSession!) ?? new Decimal(0)).add(x.amount));

  // ---- 6. реквизиты
  if (!supplier.inn) addOp({ cat: CAT.req, unit: "Реквизиты", entity: "Supplier", id: supplier.id, label: supplier.name, field: "inn", before: null, after: "9729114877", source: "УПД/счета Веллмех 2025–2026 (p2026a §1: ИНН 9729114877)" });
  else if (supplier.inn !== "9729114877") skip(CAT.req, `Поставщик «${supplier.name}»: в базе ИНН ${supplier.inn}, по документам 9729114877 — не перезаписан`);
  if (client && !client.inn) addOp({ cat: CAT.req, unit: "Реквизиты", entity: "Client", id: client.id, label: client.name, field: "inn", before: null, after: "5032277847", source: "УПД/счета 2026: покупатель ООО «Меркури Мода» ИНН 5032277847 (p2026a §1)" });
  else if (client && client.inn !== "5032277847") skip(CAT.req, `Клиент «${client.name}»: в базе ИНН ${client.inn}, по документам 5032277847 — не перезаписан`);
  skip(CAT.req, "КПП Веллмех 772901001 и КПП Меркури Мода 997350001 — в схеме Supplier/Client нет поля КПП (схему не меняем): пропущено");

  // ---- 1. НДС 2025
  for (const [num, src] of Object.entries(VAT_SOURCES)) {
    const p = byNum.get(num);
    if (!p) { skip(CAT.vat, `${num}: закупка не найдена`); continue; }
    for (const item of p.items) {
      const lot = item.lot;
      const lotLabel = `${item.lotNumber ?? lot?.lotNumber ?? "без номера"}`;
      if (!lot) { skip(CAT.vat, `${num} позиция ${item.id}: нет лота — НДС не менялся`); continue; }
      if (!item.vatRate.equals(22) && !item.vatRate.equals(20)) { skip(CAT.vat, `${num} лот ${lotLabel}: ставка позиции ${item.vatRate} — не 22/20, пропущено`); continue; }
      if (!lot.vatRate.equals(22) && !lot.vatRate.equals(20)) { skip(CAT.vat, `${num} лот ${lotLabel}: ставка лота ${lot.vatRate} — не 22/20, пропущено`); continue; }
      if (!lot.expenseCostExclVat.isZero() || !lot.expenseVatAmount.isZero()) { skip(CAT.vat, `${num} лот ${lotLabel}: у лота есть расходная часть — пересчёт НДС не однозначен, пропущено`); continue; }
      if (item.lotId !== lot.id) continue;
      const unit = lot.unitCost; // с НДС: у этих лотов materialExcl + materialVat = unitCost
      const m = r2(unit.div(1.2));
      const v = unit.sub(m);
      const inclTotal = item.quantity.equals(lot.quantityReceived) ? lot.totalCost : r2(unit.mul(item.quantity));
      const sub = r2(inclTotal.div(1.2));
      const base = { cat: CAT.vat, unit: num, source: src };
      addOp({ ...base, entity: "PurchaseItem", id: item.id, label: `поз. лот ${lotLabel}`, field: "vatRate", before: item.vatRate, after: 20 });
      addOp({ ...base, entity: "PurchaseItem", id: item.id, label: `поз. лот ${lotLabel}`, field: "unitPrice", before: item.unitPrice, after: m });
      addOp({ ...base, entity: "PurchaseItem", id: item.id, label: `поз. лот ${lotLabel}`, field: "subtotal", before: item.subtotal, after: sub });
      addOp({ ...base, entity: "RawMaterialLot", id: lot.id, label: `лот ${lotLabel}`, field: "vatRate", before: lot.vatRate, after: 20 });
      addOp({ ...base, entity: "RawMaterialLot", id: lot.id, label: `лот ${lotLabel}`, field: "materialCostExclVat", before: lot.materialCostExclVat, after: m });
      addOp({ ...base, entity: "RawMaterialLot", id: lot.id, label: `лот ${lotLabel}`, field: "materialVatAmount", before: lot.materialVatAmount, after: v });
      const st = S.items.get(item.id)!; st.vatRate = new Decimal(20); st.subtotal = sub;
    }
  }

  // ---- 2. поля закупок и дата прихода лотов
  for (const [num, fx] of Object.entries(FIELD_FIXES)) {
    const p = byNum.get(num);
    if (!p) { skip(CAT.fields, `${num}: закупка не найдена`); continue; }
    const base = { cat: CAT.fields, unit: num, entity: "Purchase" as Ent, id: p.id, label: `закупка ${num}`, source: fx.src };
    if (fx.auctionSession !== undefined) {
      if (addOp({ ...base, field: "auctionSession", before: p.auctionSession, after: fx.auctionSession })) S.meta.get(p.id)!.auction = fx.auctionSession;
    }
    if (fx.transferDocument !== undefined) addOp({ ...base, field: "transferDocument", before: p.transferDocument, after: fx.transferDocument });
    if (fx.orderDate) addOp({ ...base, field: "orderDate", before: p.orderDate, after: dateIso(fx.orderDate) });
    if (fx.receivedDate) addOp({ ...base, field: "receivedDate", before: p.receivedDate, after: dateIso(fx.receivedDate) });
  }
  for (const [num, d] of Object.entries(LOT_RECEIVED)) {
    const p = byNum.get(num);
    if (!p) continue;
    if (!FIELD_FIXES[num]?.receivedDate && p.receivedDate && p.receivedDate.toISOString().slice(0, 10) !== d.date)
      skip(CAT.fields, `${num}: дата получения закупки в базе ${p.receivedDate.toISOString().slice(0, 10)} ≠ дате УПД ${d.date} — даты лотов всё равно приводятся к дате УПД`);
    for (const lot of p.rawMaterialLots)
      addOp({ cat: CAT.fields, unit: num, entity: "RawMaterialLot", id: lot.id, label: `лот ${lot.lotNumber ?? lot.id}`, field: "receivedDate", before: lot.receivedDate, after: dateIso(d.date), source: `${d.src} вместо даты импорта (p2025a §6.3)` });
  }

  // ---- 3. цены лотов по УПД
  const UPDS: { key: "upd201" | "upd199" | "upd229"; special: string }[] = [
    { key: "upd201", special: "transport" }, { key: "upd199", special: "" }, { key: "upd229", special: "" },
  ];
  const MOVE_LOTS = new Set(["355159", "500083", "300687", "165270"]);
  for (const { key, special } of UPDS) {
    const D = DATA[key];
    const nums: string[] = D.purchases;
    for (const line of D.lines as { lot: string; qty: number; priceIncl: number; sumIncl: number; priceExcl: number; sumExcl: number }[]) {
      if (key === "upd229" && MOVE_LOTS.has(line.lot)) continue; // обрабатываются в категории 4
      const cands = nums.flatMap((n) => byNum.get(n)?.rawMaterialLots ?? []).filter((l) => l.lotNumber === line.lot || l.lotNumber === `FW26-${line.lot}`);
      const where = `${D.doc} лот ${line.lot}`;
      if (cands.length !== 1) { skip(CAT.prices, `${where}: найдено лотов в базе ${cands.length} — пропущено`); continue; }
      const lot = cands[0];
      const pur = purchases.find((p) => p.id === lot.purchaseId)!;
      const lotLabel = `лот ${lot.lotNumber}`;
      if (!lot.quantityReceived.equals(line.qty)) { skip(CAT.prices, `${pur.number} ${lotLabel}: количество ${lot.quantityReceived} ≠ УПД ${line.qty} — пропущено`); continue; }
      const want = { unitCost: r2(line.priceIncl), totalCost: r2(line.sumIncl), m: r2(line.priceExcl), sub: r2(line.sumExcl) };
      const diffLot = !lot.unitCost.equals(want.unitCost) || !lot.totalCost.equals(want.totalCost) || !lot.materialCostExclVat.equals(want.m);
      const item = lot.purchaseItems.find((i) => i.purchaseId === pur.id);
      const diffItem = item && (!item.unitPrice.equals(want.m) || !item.subtotal.equals(want.sub));
      const bd = lot.costBreakdown as { items?: { label: string; value: number }[] } | null;
      const trLabel = "Транспорт на выделку и обратно";
      const trItem = special === "transport" && (pur.number === "З-2026-0045" || pur.number === "З-2026-0046") ? bd?.items?.find((x) => x.label === trLabel) : undefined;
      const needTransport = !!trItem && Math.abs(trItem.value - 18.87116104868914) < 1e-6;
      if (!diffLot && !diffItem && !needTransport) continue;
      // охранники: лот не должен быть задействован
      const moves = lot.stockMovements;
      if (lot._count.usages > 0 || moves.some((x) => x.type !== "PURCHASE_IN") || !lot.quantityRemaining.equals(lot.quantityReceived)) {
        skip(CAT.prices, `${pur.number} ${lotLabel}: лот уже списан/использован в ТЗ — цена НЕ менялась (нужен пересчёт ТЗ, см. pending)`);
        continue;
      }
      const pin = moves.filter((x) => x.type === "PURCHASE_IN");
      if (!item || pin.length !== 1 || !lot.expenseCostExclVat.isZero() || !lot.expenseVatAmount.isZero()) {
        skip(CAT.prices, `${pur.number} ${lotLabel}: нестандартная структура (позиций ${lot.purchaseItems.length}, приходов ${pin.length}, расходная часть) — пропущено`);
        continue;
      }
      const src = `${D.doc}, строка лота ${line.lot}`;
      const base = { cat: CAT.prices, unit: pur.number, source: src };
      addOp({ ...base, entity: "RawMaterialLot", id: lot.id, label: lotLabel, field: "unitCost", before: lot.unitCost, after: want.unitCost });
      addOp({ ...base, entity: "RawMaterialLot", id: lot.id, label: lotLabel, field: "totalCost", before: lot.totalCost, after: want.totalCost });
      addOp({ ...base, entity: "RawMaterialLot", id: lot.id, label: lotLabel, field: "materialCostExclVat", before: lot.materialCostExclVat, after: want.m });
      addOp({ ...base, entity: "RawMaterialLot", id: lot.id, label: lotLabel, field: "materialVatAmount", before: lot.materialVatAmount, after: want.unitCost.sub(want.m) });
      addOp({ ...base, entity: "PurchaseItem", id: item.id, label: `поз. ${lotLabel}`, field: "unitPrice", before: item.unitPrice, after: want.m });
      addOp({ ...base, entity: "PurchaseItem", id: item.id, label: `поз. ${lotLabel}`, field: "subtotal", before: item.subtotal, after: want.sub });
      addOp({ ...base, entity: "StockMovement", id: pin[0].id, label: `приход ${lotLabel}`, field: "unitCost", before: pin[0].unitCost, after: want.unitCost });
      addOp({ ...base, entity: "StockMovement", id: pin[0].id, label: `приход ${lotLabel}`, field: "totalCost", before: pin[0].totalCost, after: want.totalCost });
      if (needTransport && bd?.items) {
        const nb = JSON.parse(JSON.stringify(bd));
        nb.items.find((x: { label: string }) => x.label === trLabel).value = 8.4792;
        addOp({ ...base, source: `${src}; «закупка РП 04-2026.xlsx» (финал): транспорт МП-Прогресс 8,4792 ₽/шт вместо 18,871`, entity: "RawMaterialLot", id: lot.id, label: lotLabel, field: "costBreakdown", before: bd, after: nb });
      }
      const st = S.items.get(item.id)!; st.subtotal = want.sub;
    }
  }

  // ---- 4. SAGA: 4 лота в свои закупки
  const U229: { lot: string; qty: number; priceIncl: number; sumIncl: number; priceExcl: number; sumExcl: number }[] = DATA.upd229.lines;
  for (const lotNum of MOVE_LOTS) {
    const line = U229.find((l) => l.lot === lotNum)!;
    const lots = (DATA.upd229.purchases as string[]).flatMap((n) => byNum.get(n)?.rawMaterialLots ?? []).filter((l) => l.lotNumber === lotNum);
    if (lots.length !== 1) { skip(CAT.saga, `лот ${lotNum}: найдено лотов ${lots.length} — пропущено`); continue; }
    const lot = lots[0];
    const target = purchases.find((p) => p.id === lot.purchaseId)!;
    const label = `лот ${lotNum}`;
    const items = lot.purchaseItems;
    const wantTotal = r2(line.sumIncl);
    if (!lot.quantityReceived.equals(line.qty) || r2(line.sumIncl).div(line.qty).sub(lot.unitCost).abs().greaterThan("0.011") || (items[0] && items[0].unitPrice.sub(line.priceExcl).abs().greaterThan("0.011"))) {
      skip(CAT.saga, `${target.number} ${label}: количество/цена в базе не совпадают с УПД №229 (${lot.quantityReceived} шт, ${lot.unitCost}) — пропущено`);
      continue;
    }
    if (items.length !== 1) { skip(CAT.saga, `${target.number} ${label}: позиций у лота ${items.length} (ожидалась 1) — пропущено`); continue; }
    const item = items[0];
    const src = `УПД №229 от 04.08.2026: ${line.qty} шт × ${line.priceExcl} без НДС, итого ${line.sumIncl} с НДС (p2026a §3.1, §4.1.1)`;
    const base = { cat: CAT.saga, unit: target.number, source: src };
    const fromNum = purchases.find((p) => p.id === item.purchaseId)?.number;
    if (item.purchaseId !== target.id) {
      addOp({ ...base, entity: "PurchaseItem", id: item.id, label: `поз. ${label} (из ${fromNum})`, field: "purchaseId", before: item.purchaseId, after: target.id });
      const st = S.items.get(item.id)!; st.purchaseId = target.id;
    }
    if (addOp({ ...base, entity: "PurchaseItem", id: item.id, label: `поз. ${label}`, field: "quantity", before: item.quantity, after: line.qty })) S.items.get(item.id)!.quantity = new Decimal(line.qty);
    if (addOp({ ...base, entity: "PurchaseItem", id: item.id, label: `поз. ${label}`, field: "subtotal", before: item.subtotal, after: r2(line.sumExcl) })) S.items.get(item.id)!.subtotal = r2(line.sumExcl);
    addOp({ ...base, entity: "RawMaterialLot", id: lot.id, label, field: "totalCost", before: lot.totalCost, after: wantTotal });
  }

  // ---- 5. новые закупки
  const material = async (name: string) => {
    const m = await prisma.rawMaterial.findFirst({ where: { organizationId, name } });
    return m?.id ?? null; // создаётся в транзакции, если нет
  };
  const yearNow = new Date().getFullYear();
  const nums = purchases.map((p) => p.number.match(new RegExp(`^З-${yearNow}-(\\d+)$`))).filter(Boolean).map((m) => Number(m![1]));
  let nextN = (nums.length ? Math.max(...nums) : 0) + 1;

  type NewP = {
    key: string; auction: string | null; invoice: string; transfer: string; order: string; received: string; material: string;
    lotNumber: string | null; grade: string; qty: number; priceIncl: number; priceExcl: number; sumExcl: number; sumIncl: number; src: string; title: string;
  };
  const NEW: NewP[] = [
    {
      key: "ame-0526", title: "AME 05-26 (норка махагон)", auction: "AME 05-26", invoice: "253", transfer: "№ 253 от 09.09.2026 г.", order: "2026-05-21", received: "2026-09-09",
      material: "Норка", lotNumber: "204742", grade: "Норка коричневая (махагон)", qty: 371, priceIncl: 9654.49, priceExcl: 7913.52, sumExcl: 2935914.58, sumIncl: 3581815.79,
      src: "УПД №253 от 09.09.2026 (371 шт × 7 913,52 без НДС 22%), Спец. №11 от 21.05.2026 (p2026a §3.4, §4.1.7)",
    },
    {
      key: "fox-209", title: "красная лиса (спец. 19)", auction: null, invoice: "209", transfer: "№ 209 от 16.07.2026 г.", order: "2026-07-16", received: "2026-07-16",
      material: "Лиса красная", lotNumber: null, grade: "Лисица красная", qty: 88, priceIncl: 16000, priceExcl: 13114.75, sumExcl: 1154098.36, sumIncl: 1408000,
      src: "УПД №209 от 16.07.2026 (88 шт × 13 114,75 без НДС 22%), Спец. №19 от 16.07.2026 (p2026a §3.5, §4.1.8)",
    },
  ];
  for (const n of NEW) {
    const tag = `fix-drive:${n.key}`;
    const number = `З-${yearNow}-${String(nextN).padStart(4, "0")}`;
    const exists = async () =>
      !!(await prisma.purchase.findFirst({ where: { organizationId, notes: { startsWith: tag } } })) ||
      !!(await prisma.purchase.findFirst({ where: { organizationId, transferDocument: n.transfer, supplierId: supplier.id } }));
    if (await exists()) { skip(CAT.create, `уже применено: ${n.title} — закупка уже есть в базе (метка ${tag} или УПД ${n.transfer}), не создаётся`); continue; }
    nextN++;
    const pid = `NEW:${n.key}`;
    S.meta.set(pid, { number, exchangeRate: new Decimal(1), status: "RECEIVED", auction: n.auction, expenses: [] });
    S.items.set(`NEWI:${n.key}`, { id: `NEWI:${n.key}`, purchaseId: pid, subtotal: r2(n.sumExcl), vatRate: new Decimal(22), quantity: new Decimal(n.qty), costPlan: null });
    S.paidPurchase.set(pid, new Decimal(0));
    creates.push({
      cat: CAT.create, unit: `Новая закупка: ${n.title}`, key: tag, label: `закупка ${number} — ${n.title}`, source: n.src,
      lines: [
        `Purchase ${number}: RECEIVED, поставщик ${supplier.name}, RUB/1, аукцион ${n.auction ?? "∅"}, счёт/УПД ${n.invoice}, УПД ${n.transfer}, заказ ${n.order}, получено ${n.received}`,
        `PurchaseItem: ${n.material}, лот ${n.lotNumber ?? "без номера"}, ${n.qty} шт × ${n.priceExcl} без НДС (подитог ${n.sumExcl}), НДС 22%`,
        `RawMaterialLot: unitCost ${n.priceIncl}, totalCost ${n.sumIncl}, материал без НДС ${n.priceExcl}, НДС ${r2(n.priceIncl).sub(n.priceExcl).toFixed(2)}; StockMovement PURCHASE_IN`,
      ],
      exists,
      run: async (tx) => {
        const when = new Date().toISOString();
        const J: JournalEntry[] = [];
        const log = (entity: string, id: string, after: unknown) => J.push({ time: when, entity, id, field: "__create__", before: null, after, source: n.src });
        let matId = await material(n.material);
        if (!matId) {
          matId = (await tx.rawMaterial.create({ data: { organizationId, name: n.material, unit: "PIECE" } })).id;
          log("RawMaterial", matId, { name: n.material });
        }
        const all = await tx.purchase.findMany({ where: { organizationId }, select: { number: true } });
        const mx = Math.max(0, ...all.map((p) => Number(p.number.match(new RegExp(`^З-${yearNow}-(\\d+)$`))?.[1] ?? 0)));
        const num = `З-${yearNow}-${String(mx + 1).padStart(4, "0")}`;
        const pur = await tx.purchase.create({
          data: {
            organizationId, number: num, supplierId: supplier.id, warehouseId: warehouse.id, status: "RECEIVED", currency: "RUB", exchangeRate: 1,
            auctionSession: n.auction, invoiceNumber: n.invoice, transferDocument: n.transfer,
            orderDate: new Date(dateIso(n.order)), receivedDate: new Date(dateIso(n.received)),
            notes: `${tag} — создана по документам Drive: ${n.src}`,
          },
        });
        log("Purchase", pur.id, { number: num, key: tag });
        const quantity = new Decimal(n.qty);
        const unitCost = r2(n.priceIncl);
        const totalCost = r2(n.sumIncl);
        const m = r2(n.priceExcl);
        const item = await tx.purchaseItem.create({
          data: { purchaseId: pur.id, rawMaterialId: matId, quantity, unitPrice: m, subtotal: r2(n.sumExcl), vatRate: 22, lotNumber: n.lotNumber, grade: n.grade },
        });
        log("PurchaseItem", item.id, { qty: n.qty });
        // то же, что createRawMaterialLot (src/lib/stock.ts)
        const lot = await tx.rawMaterialLot.create({
          data: {
            organizationId, warehouseId: warehouse.id, rawMaterialId: matId, lotNumber: n.lotNumber, grade: n.grade, color: null,
            quantityReceived: quantity, quantityRemaining: quantity, unitCost, totalCost, vatRate: 22,
            materialCostExclVat: m, materialVatAmount: unitCost.sub(m), expenseCostExclVat: 0, expenseVatAmount: 0,
            purchaseId: pur.id, receivedDate: new Date(dateIso(n.received)),
          },
        });
        log("RawMaterialLot", lot.id, { lotNumber: n.lotNumber, qty: n.qty });
        await tx.purchaseItem.update({ where: { id: item.id }, data: { lotId: lot.id } });
        const mv = await tx.stockMovement.create({
          data: { organizationId, warehouseId: warehouse.id, rawMaterialId: matId, lotId: lot.id, type: "PURCHASE_IN", quantity, unitCost, totalCost, purchaseId: pur.id, date: new Date(dateIso(n.received)) },
        });
        log("StockMovement", mv.id, { type: "PURCHASE_IN" });
        return J;
      },
    });
  }

  // ---- П. платежи
  await planPayments({ organizationId, supplierId: supplier.id, byNum });

  return { organizationId, purchases };
}

// ---------------------------------------------------------------- платежи

type PaySpec = {
  key: string; amount: number; paidAt: string; kind: "ADVANCE" | "PARTIAL" | "FINAL"; confirmed: boolean;
  docRef: string; notes: string; source: string;
  target: { purchase: string } | { auction: string } | { newPurchase: string } | { none: true };
};

async function planPayments(ctx: { organizationId: string; supplierId: string; byNum: Map<string, LoadedPurchase> }) {
  const { organizationId, supplierId, byNum } = ctx;
  const specs: PaySpec[] = [];
  const A = (key: string, amount: number, paidAt: string, kind: PaySpec["kind"], confirmed: boolean, docRef: string, notes: string, source: string, target: PaySpec["target"]) =>
    specs.push({ key, amount, paidAt, kind, confirmed, docRef, notes, source, target });

  // --- 2025
  A("P01", 24556500, "2025-03-14", "ADVANCE", true, "п/п №33980 от 14.03.2025; счёт Веллмех №40 от 10.03.2025",
    "Аванс 50% по Спец. №2 к договору №2502 (SAGA 03-25), счёт №40 от 10.03.2025. Дата и номер платёжки — из УПД №103 п.(8).",
    "УПД №103 от 03.07.2025 п.(8), счёт №40, письмо 20.03.2025 (p2025a §3)", { purchase: "З-2026-0002" });
  A("P02", 11950000, "2025-03-26", "PARTIAL", true, "п/п №36343 от 26.03.2025; счёт Веллмех №46 от 14.03.2025",
    "Второй аванс по Спец. №2 к договору №2502 (SAGA 03-25), счёт №46 от 14.03.2025. Дата и номер платёжки — из УПД №103 п.(8).",
    "УПД №103 от 03.07.2025 п.(8), счёт №46 (p2025a §3)", { purchase: "З-2026-0002" });
  A("P03", 1632000, "2025-05-30", "ADVANCE", false, "счёт Веллмех №81 от 26.05.2025 (платёжка не названа)",
    "Аванс по Спец. №3 (норка коричневая, КФХ Дуденко), счёт №81 от 26.05.2025. Дата — из финального расчёта себестоимости («Аванс 5/30/2025»); номер платёжки в документах не назван.",
    "финальный расчёт себестоимости норка коричневая; письмо 26–28.05.2025 (p2025a §3)", { purchase: "З-2026-0005" });
  A("P04", 1210000, "2025-06-19", "ADVANCE", true, "п/п №51723 от 19.06.2025; счёт Веллмех №92 от 16.06.2025",
    "Аванс по Приложению 5 (каракуль, SAGA 06-25), счёт №92 от 16.06.2025. Дата и номер платёжки — из УПД №127.",
    "УПД №127 от 13.08.2025, письмо 16–17.06.2025 (p2025a §3)", { purchase: "З-2026-0003" });
  A("P05", 2000000, "2025-06-27", "ADVANCE", true, "п/п от 27.06.2025 (в УПД №96 назван №53423); счёт Веллмех №96 от 24.06.2025",
    "Предоплата 100% по счёту №96 от 24.06.2025 (норка белая выбеленная, 200 шт). Дата — из УПД №96 п.(8) и срока счёта; номер платёжки в УПД №96 (53423) повторяется в УПД №143 — реквизит двоится.",
    "УПД №96 от 15.07.2025 п.(8), счёт №96 (p2025a §3, §4.3)", { purchase: "З-2026-0009" });
  A("P06", 34825000, "2025-02-28", "ADVANCE", true, "п/п №440 от 28.02.2025; счёт Веллмех №31 от 27.02.2025",
    "Аванс 35% по Спец. №1 к договору №2502, партия соболя СП 03.25 + РП 03.25 (два аукциона, один платёж). Разнесение по аукционам не подтверждено документами — платёж записан без привязки, распределите вручную в разделе «Оплаты».",
    "счёт №31 от 27.02.2025; УПД №77 п.(5), письмо юристов (p2025b §7)", { none: true });
  A("P07", 30666300, "2025-06-27", "ADVANCE", true, "п/п №53423 от 27.06.2025; счёт Веллмех №83",
    "Аванс по Спец. №4 к договору №2502, доп. закупка соболя СП 05.25 + РП 05.25 (два аукциона, один платёж). Разнесение по аукционам не подтверждено документами — платёж записан без привязки, распределите вручную в разделе «Оплаты».",
    "счёт №83; УПД №143 п.(5), письмо 24.09.2025 (p2025b §7)", { none: true });
  A("P08", 1455842, "2025-07-03", "ADVANCE", true, "п/п №54214 от 03.07.2025; счёт Веллмех №100 от 01.07.2025",
    "Подкладка по Спец. №7 (8 тканей, 680,3 м), 100% по счёту №100 от 01.07.2025; УПД №109 от 11.07.2025. Не привязан к закупке: в базе подкладка только сводной закупкой З-2026-0032 (347,1 м), стоимость которой меньше суммы платежа — привязка за владельцем.",
    "УПД №109 п.(5), счёт №100, письма (p2025b §7)", { none: true });

  // --- 2026
  A("P09", 24200000, "2026-03-30", "ADVANCE", false, "счёт Веллмех №93",
    "Аванс по Спец. №9 (SAGA 03-26), счёт №93. Дата — из расчёта «Закупка ММ SAGA 03-26 (fin)» и письма 25–27.03.2026; номер платёжки в документах не назван.",
    "Закупка ММ SAGA 03-26 (fin).xlsx, письма (p2026a §6)", { auction: "SAGA 03-26" });
  A("P10", 2380500, "2026-07-20", "ADVANCE", false, "счёт Веллмех №195 от 03.07.2026",
    "Аванс по Спец. №18 (SAGA 03-26, дозакупка лота 302127), счёт №195. Дата — из расчёта SAGA 03-26 (fin).",
    "Закупка ММ SAGA 03-26 (fin).xlsx, счёт №195 (p2026a §6)", { auction: "SAGA 03-26" });
  A("P11", 27912500 - 6304375, "2026-04-22", "ADVANCE", true, "п/п №40593 от 22.04.2026; счёт Веллмех №117 от 13.04.2026",
    "Аванс 1 по Спец. №10 (25% × 2900 шкур = 27 912 500), часть для Русьпушнины РП 04-26: 25% × 2245 шкур = 21 608 125; остаток 6 304 375 — на Союзпушнину (отдельная запись той же платёжки).",
    "УПД №201 п.(5), письма 04.05 и 22.05.2026 (p2026b §5.1)", { auction: "Закупка меха 04-26" });
  A("P12", 6304375, "2026-04-22", "ADVANCE", true, "п/п №40593 от 22.04.2026; счёт Веллмех №117 от 13.04.2026",
    "Аванс 1 по Спец. №10: часть платёжки 27 912 500, перенесённая на Союзпушнину (СП 05-26), по письмам 04.05 и 22.05.2026.",
    "УПД №201 п.(5), письма 04.05 и 22.05.2026 (p2026b §5.1)", { auction: "СОЮЗПУШНИНА 05-26" });
  A("P13", 60271506.34, "2026-05-12", "PARTIAL", true, "п/п №43831 от 12.05.2026; счёт Веллмех №131 от 04.05.2026",
    "Аванс 2 по Спец. №10 (Русьпушнина, РП 04-26), счёт №131 от 04.05.2026.",
    "УПД №201 п.(5), письмо 22.05.2026 (p2026b §5.1)", { auction: "Закупка меха 04-26" });
  A("P14", 30660000, "2026-05-28", "ADVANCE", false, "счёт Веллмех №155 от 22.05.2026",
    "Аванс 1 по Спец. №12 (рысь, FH 06-26), счёт №155 от 22.05.2026. Дата — из «расчет закупки.xlsx»; номер платёжки в документах не назван.",
    "расчет закупки.xlsx, письмо 26.05.2026 (p2026a §6)", { purchase: "З-2026-0049" });
  A("P15", 761250, "2026-05-28", "ADVANCE", true, "п/п №46538 от 28.05.2026; счёт Веллмех №153",
    "Аванс 1 по Спец. №11 (норка махагон, AME 05-26), счёт №153.",
    "УПД №253 от 09.09.2026, расчёт себестоимости fin (p2026a §3.4)", { newPurchase: "fix-drive:ame-0526" });
  A("P16", 2466573, "2026-06-04", "PARTIAL", false, "счёт Веллмех №167",
    "Аванс 2 по Спец. №11 (норка махагон, AME 05-26), счёт №167. Дата — из расчёта себестоимости fin; номер платёжки в документах не назван.",
    "расчет себестоимости fin.xlsx (p2026a §3.4)", { newPurchase: "fix-drive:ame-0526" });

  for (const s of specs) {
    const amount = r2(s.amount);
    const label = `платёж ${s.key} ${s.paidAt} ${amount.toFixed(2)} ₽ (${s.kind})`;
    let lines: string;
    let ok = true;
    // разрешение цели
    const targets: { pid: string | null; auction: string | null; amount: Decimal; suffix: string; tkey: string }[] = [];
    const t = s.target;
    if ("purchase" in t) {
      const p = byNum.get(t.purchase);
      if (!p) { skip(CAT.pay, `${label}: закупка ${t.purchase} не найдена — платёж не создаётся`); continue; }
      targets.push({ pid: p.id, auction: null, amount, suffix: "", tkey: s.key });
      lines = `закупка ${t.purchase}`;
    } else if ("newPurchase" in t) {
      const key = t.newPurchase.replace("fix-drive:", "");
      const pid = `NEW:${key}`;
      if (!S.meta.has(pid)) {
        // закупка уже существует в базе — ищем по метке
        const existing = [...byNum.values()].find((p) => p.notes?.startsWith(t.newPurchase));
        if (!existing) { skip(CAT.pay, `${label}: новой закупки ${t.newPurchase} нет — платёж не создаётся`); continue; }
        targets.push({ pid: existing.id, auction: null, amount, suffix: "", tkey: s.key });
        lines = `закупка ${existing.number}`;
      } else {
        targets.push({ pid, auction: null, amount, suffix: "", tkey: s.key });
        lines = `новая закупка ${S.meta.get(pid)!.number}`;
      }
    } else if ("auction" in t) {
      const names = t.auction.split("|");
      if (names.length === 1) {
        targets.push({ pid: null, auction: names[0], amount, suffix: "", tkey: s.key });
        lines = `аукцион «${names[0]}»`;
      } else {
        const tot = names.map((n) => projAuctionTotal(n));
        const sum = tot.reduce((a, b) => a.add(b), new Decimal(0));
        if (sum.isZero()) { skip(CAT.pay, `${label}: в аукционах ${names.join("/")} нет закупок — платёж не создаётся`); continue; }
        let left = amount;
        names.forEach((n, i) => {
          const part = i === names.length - 1 ? left : r2(amount.mul(tot[i]).div(sum));
          left = left.sub(part);
          targets.push({ pid: null, auction: n, amount: part, suffix: `-${i + 1}`, tkey: `${s.key}-${i + 1}` });
        });
        lines = `аукционы ${names.map((n, i) => `«${n}» ${targets[i].amount.toFixed(2)}`).join(" + ")} (пропорционально стоимости)`;
      }
    } else {
      targets.push({ pid: null, auction: null, amount, suffix: "", tkey: s.key });
      lines = "не привязан (аванс поставщику без закупки/аукциона)";
    }

    // уже записанные раньше (повторный запуск) — в проверке переплаты и в плане не участвуют: они уже в загруженном состоянии
    const totalParts = targets.length;
    const fresh: typeof targets = [];
    for (const tg of targets) {
      const key = `[fix:${tg.tkey}]`;
      const byKey = await prisma.payment.findFirst({ where: { organizationId, notes: { contains: key } } });
      const dup = byKey ?? (await prisma.payment.findFirst({ where: { organizationId, supplierId, amount: tg.amount, paidAt: new Date(dateIso(s.paidAt)), status: { not: "CANCELLED" } } }));
      if (dup) skip(CAT.pay, `уже применено: ${s.paidAt} ${tg.amount.toFixed(2)} ₽ (${key}) уже есть в базе`);
      else fresh.push(tg);
    }
    if (!fresh.length) continue;
    targets.splice(0, targets.length, ...fresh);
    // проверка переплаты по плановому состоянию
    for (const tg of targets) {
      if (tg.pid) {
        const total = projTotal(tg.pid);
        const paid = (S.paidPurchase.get(tg.pid) ?? new Decimal(0)).add(tg.amount);
        if (paid.sub(total).greaterThan(PAY_EPS)) {
          skip(CAT.pay, `${label} → закупка ${S.meta.get(tg.pid)!.number}: оплачено станет ${paid.toFixed(2)} при стоимости ${total.toFixed(2)} (переплата ${paid.sub(total).toFixed(2)}) — в pending`);
          ok = false;
        }
      } else if (tg.auction) {
        const total = projAuctionTotal(tg.auction);
        const paid = projAuctionPaid(tg.auction).add(tg.amount);
        if (paid.sub(total).greaterThan(PAY_EPS)) {
          skip(CAT.pay, `${label} → аукцион «${tg.auction}»: оплачено станет ${paid.toFixed(2)} при стоимости ${total.toFixed(2)} (переплата ${paid.sub(total).toFixed(2)}) — в pending`);
          ok = false;
        }
      }
    }
    if (!ok) continue;
    for (const tg of targets) {
      if (tg.pid) S.paidPurchase.set(tg.pid, (S.paidPurchase.get(tg.pid) ?? new Decimal(0)).add(tg.amount));
      else if (tg.auction) S.paidAuction.set(tg.auction, (S.paidAuction.get(tg.auction) ?? new Decimal(0)).add(tg.amount));
    }
    for (const tg of targets) {
      const key = `[fix:${tg.tkey}]`;
      const part = totalParts > 1 ? ` (часть ${tg.suffix.slice(1)} из ${totalParts} платёжки на ${amount.toFixed(2)})` : "";
      const noteText = `${s.notes}${part} ${key}`;
      const idemTarget = tg;
      creates.push({
        cat: CAT.pay, unit: "Платежи", key, source: s.source,
        label: `${s.paidAt} ${tg.amount.toFixed(2)} ₽ ${s.kind}${s.confirmed ? "" : " (платёжка не названа)"}: ${targets.length > 1 ? `${tg.auction} — ` : ""}${lines!}`,
        lines: [],
        exists: async () => {
          const byKey = await prisma.payment.findFirst({ where: { organizationId, notes: { contains: key } } });
          if (byKey) return true;
          const dup = await prisma.payment.findFirst({ where: { organizationId, supplierId, amount: tg.amount, paidAt: new Date(dateIso(s.paidAt)), status: { not: "CANCELLED" } } });
          return !!dup;
        },
        run: async (tx) => {
          // цель разрешается по живой базе
          let purchaseId: string | null = null;
          let auctionSession: string | null = null;
          if (idemTarget.pid && !idemTarget.pid.startsWith("NEW:")) purchaseId = idemTarget.pid;
          else if (idemTarget.pid) {
            const tag = (s.target as { newPurchase: string }).newPurchase;
            const pu = await tx.purchase.findFirst({ where: { organizationId, notes: { startsWith: tag } } });
            if (!pu) throw new Error(`Закупка ${tag} не найдена (создана ли она?)`);
            purchaseId = pu.id;
          } else auctionSession = idemTarget.auction;
          if (auctionSession) await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${"auction-pay:" + organizationId + ":" + auctionSession}))) t`;
          // повторная проверка переплаты по живым данным
          if (purchaseId) {
            const full = await tx.purchase.findFirstOrThrow({ where: { id: purchaseId }, include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" } } } });
            const total = purchaseTotalInclVat(full) as Decimal;
            const paid = full.payments.reduce((a, x) => a.add(x.amount), new Decimal(0)).add(idemTarget.amount);
            if (paid.sub(total).greaterThan(PAY_EPS)) return [{ time: "", entity: "SKIP", id: "", field: "переплата", before: null, after: `закупка ${full.number}: ${paid.toFixed(2)} > ${total.toFixed(2)}`, source: "" }];
          } else if (auctionSession) {
            const ps = await tx.purchase.findMany({ where: { organizationId, auctionSession: { not: null } }, include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" } } } });
            const mine = ps.filter((p) => auctionName(p.auctionSession) === auctionSession);
            const total = mine.filter((p) => p.status !== "CANCELLED").reduce((a, p) => a.add(purchaseTotalInclVat(p) as Decimal), new Decimal(0));
            let paid = mine.reduce((a, p) => p.payments.reduce((b, x) => b.add(x.amount), a), new Decimal(0));
            const ap = await tx.payment.findMany({ where: { organizationId, purchaseId: null, auctionSession, status: "COMPLETED" } });
            paid = ap.reduce((a, x) => a.add(x.amount), paid).add(idemTarget.amount);
            if (paid.sub(total).greaterThan(PAY_EPS)) return [{ time: "", entity: "SKIP", id: "", field: "переплата", before: null, after: `аукцион ${auctionSession}: ${paid.toFixed(2)} > ${total.toFixed(2)}`, source: "" }];
          }
          const pay = await tx.payment.create({
            data: {
              organizationId, supplierId, purchaseId, auctionSession, amount: idemTarget.amount, currency: "RUB", method: "BANK_TRANSFER",
              status: "COMPLETED", paidAt: new Date(dateIso(s.paidAt)), kind: s.kind, docRef: s.docRef, confirmed: s.confirmed, notes: noteText,
            },
          });
          return [{ time: new Date().toISOString(), entity: "Payment", id: pay.id, field: "__create__", before: null, after: { amount: idemTarget.amount.toFixed(2), paidAt: s.paidAt, kind: s.kind, purchaseId, auctionSession, docRef: s.docRef }, source: s.source }];
        },
      });
    }
  }
}

// ---------------------------------------------------------------- печать плана

function printPlan() {
  const cats = Object.values(CAT);
  console.log(`\n===== ПЛАН (${APPLY ? "будет записан" : "DRY-RUN, в базу ничего не пишется"}) =====`);
  for (const cat of cats) {
    const co = ops.filter((o) => o.cat === cat);
    const cc = creates.filter((c) => c.cat === cat);
    const cs = skipped.filter((s) => s.cat === cat);
    if (!co.length && !cc.length && !cs.length) continue;
    const ents = new Set(co.map((o) => `${o.entity}:${o.id}`));
    console.log(`\n### ${cat} — полей: ${co.length}, записей: ${ents.size}, создаваемых: ${cc.length}, пропущено/в pending: ${cs.length}`);
    // группируем по закупке/единице → сущность → источник
    const units = [...new Set(co.map((o) => o.unit))];
    for (const u of units) {
      console.log(`  [${u}]`);
      const mine = co.filter((o) => o.unit === u);
      const groups = new Map<string, Op[]>();
      for (const o of mine) {
        const k = `${o.entity}:${o.id}:${o.source}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(o);
      }
      for (const g of groups.values()) {
        const o0 = g[0];
        const fields = g.map((o) => { const t = ftype(o.entity, o.field); return `${o.field}: ${show(t, o.before)} → ${show(t, o.after)}`; }).join("; ");
        console.log(`    ${o0.entity} ${o0.label}: ${fields}  | источник: ${o0.source}`);
      }
    }
    for (const c of cc) {
      console.log(`  СОЗДАТЬ ${c.label}  | источник: ${c.source}`);
      for (const l of c.lines) console.log(`      ${l}`);
    }
    for (const s of cs) console.log(s.text.startsWith("уже применено") ? `  ✓ ${s.text}` : `  ПРОПУЩЕНО: ${s.text}`);
  }
  console.log(`\n===== ИТОГО: изменяемых полей ${ops.length} в ${new Set(ops.map((o) => `${o.entity}:${o.id}`)).size} записях; создаётся: закупок ${creates.filter((c) => c.cat === CAT.create).length}, платежей ${creates.filter((c) => c.cat === CAT.pay).length}; пропущено ${skipped.length} =====`);
  for (const cat of cats) {
    const co = ops.filter((o) => o.cat === cat);
    console.log(`  ${cat}: полей ${co.length}, записей ${new Set(co.map((o) => `${o.entity}:${o.id}`)).size}, закупок/единиц ${new Set(co.map((o) => o.unit)).size}`);
  }
}

// ---------------------------------------------------------------- применение

function appendJournal(entries: JournalEntry[]) {
  if (!entries.length) return;
  const cur: JournalEntry[] = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : [];
  writeFileSync(JOURNAL, JSON.stringify(cur.concat(entries), null, 1));
}

async function applyAll(organizationId: string) {
  void organizationId;
  let applied = 0, already = 0, conflicts = 0, created = 0, createdExisting = 0, skippedOverpay = 0;
  const units = [...new Set(ops.map((o) => o.unit))];
  for (const u of units) {
    const mine = ops.filter((o) => o.unit === u);
    try {
      const journal: JournalEntry[] = [];
      let n = 0, a = 0;
      await prisma.$transaction(async (tx) => {
        // группируем по (entity,id)
        const groups = new Map<string, Op[]>();
        for (const o of mine) { const k = `${o.entity}:${o.id}`; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(o); }
        for (const g of groups.values()) {
          const model = (tx as unknown as Record<string, { findUnique: (a: unknown) => Promise<Record<string, unknown> | null>; update: (a: unknown) => Promise<unknown> }>)[MODEL[g[0].entity]];
          const cur = await model.findUnique({ where: { id: g[0].id } });
          if (!cur) throw new Error(`КОНФЛИКТ: ${g[0].entity} ${g[0].id} не найден`);
          const data: Record<string, unknown> = {};
          for (const o of g) {
            const t = ftype(o.entity, o.field);
            const nowV = norm(t, cur[o.field]);
            if (nowV === norm(t, o.after)) { a++; continue; }
            if (nowV !== norm(t, o.before)) throw new Error(`КОНФЛИКТ: ${o.entity} ${o.label} поле ${o.field}: в базе ${show(t, cur[o.field])}, ожидалось «было» ${show(t, o.before)} или «стало» ${show(t, o.after)}`);
            data[o.field] = toDb(t, o.after);
            journal.push({ time: new Date().toISOString(), entity: o.entity, id: o.id, field: o.field, before: o.before, after: o.after, source: o.source });
            n++;
          }
          if (Object.keys(data).length) await model.update({ where: { id: g[0].id }, data });
        }
      }, { timeout: 120000, maxWait: 30000 });
      appendJournal(journal);
      applied += n; already += a;
      console.log(`  ${u}: записано полей ${n}${a ? `, уже применено ${a}` : ""}`);
    } catch (e) {
      conflicts++;
      console.log(`  ${u}: ПРОПУЩЕНА (транзакция откачена): ${(e as Error).message}`);
    }
  }
  // создание закупок, затем платежей
  for (const c of creates) {
    try {
      if (await c.exists()) { createdExisting++; console.log(`  ${c.label}: уже применено`); continue; }
      let J: JournalEntry[] = [];
      await prisma.$transaction(async (tx) => { J = await c.run(tx); }, { timeout: 60000, maxWait: 30000 });
      if (J[0]?.entity === "SKIP") { skippedOverpay++; console.log(`  ${c.label}: ПРОПУЩЕН, переплата (${J[0].after}) — в pending`); continue; }
      appendJournal(J);
      created++;
      console.log(`  создано: ${c.label}`);
    } catch (e) {
      conflicts++;
      console.log(`  ${c.label}: ОШИБКА (транзакция откачена): ${(e as Error).message}`);
    }
  }
  console.log(`\nГотово: записано полей ${applied}, уже применено полей ${already}, создано записей ${created}, уже было ${createdExisting}, пропущено по переплате ${skippedOverpay}, конфликтов/ошибок ${conflicts}. Журнал: ${JOURNAL}`);
}

// ---------------------------------------------------------------- откат

async function rollback(file: string) {
  const entries: JournalEntry[] = JSON.parse(readFileSync(resolve(file), "utf-8"));
  console.log(`Откат по журналу ${file}: ${entries.length} записей (${APPLY ? "ПРИМЕНЯЕТСЯ" : "DRY-RUN; для применения добавьте --apply"})`);
  const rev = [...entries].reverse();
  let done = 0, skippedN = 0;
  for (const e of rev) {
    const ent = e.entity as Ent;
    const model = (prisma as unknown as Record<string, { findUnique: (a: unknown) => Promise<Record<string, unknown> | null>; update: (a: unknown) => Promise<unknown>; delete: (a: unknown) => Promise<unknown>; count: (a: unknown) => Promise<number> }>)[MODEL[ent] ?? e.entity.charAt(0).toLowerCase() + e.entity.slice(1)];
    if (!model) { console.log(`  пропуск: неизвестная сущность ${e.entity}`); skippedN++; continue; }
    const cur = await model.findUnique({ where: { id: e.id } });
    if (e.field === "__create__") {
      if (!cur) { console.log(`  ${e.entity} ${e.id}: уже удалён`); continue; }
      if (e.entity === "RawMaterialLot") {
        const used = await prisma.productionMaterialUsage.count({ where: { lotId: e.id } });
        if (used) { console.log(`  ${e.entity} ${e.id}: ИСПОЛЬЗУЕТСЯ в ТЗ — не удалён`); skippedN++; continue; }
      }
      console.log(`  удалить ${e.entity} ${e.id}`);
      if (APPLY) await model.delete({ where: { id: e.id } });
      done++;
      continue;
    }
    if (!cur) { console.log(`  ${e.entity} ${e.id}: не найден — пропуск`); skippedN++; continue; }
    const t = ftype(ent, e.field);
    const nowV = norm(t, cur[e.field]);
    if (nowV === norm(t, e.before)) { continue; } // уже в исходном состоянии
    if (nowV !== norm(t, e.after)) { console.log(`  ${e.entity} ${e.id}.${e.field}: изменён после применения (${show(t, cur[e.field])}) — НЕ откатывается`); skippedN++; continue; }
    console.log(`  ${e.entity} ${e.id}.${e.field}: ${show(t, e.after)} → ${show(t, e.before)}`);
    if (APPLY) await model.update({ where: { id: e.id }, data: { [e.field]: toDb(t, e.before) } });
    done++;
  }
  console.log(`Откат: ${done} операций${APPLY ? "" : " (план)"}, пропущено ${skippedN}`);
}

// ---------------------------------------------------------------- main

async function main() {
  const dbUrl = (process.env.DATABASE_URL ?? "").replace(/:[^:@/]*@/, ":***@");
  console.log(`База: ${dbUrl}`);
  if (ROLLBACK_FILE) { await rollback(ROLLBACK_FILE); return; }
  const { organizationId } = await plan();
  printPlan();
  if (!APPLY) { console.log("\nDRY-RUN: ничего не записано. Для применения: добавьте --apply (сначала сделайте бэкап базы)."); return; }
  console.log("\n===== ПРИМЕНЕНИЕ =====");
  await applyAll(organizationId);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
