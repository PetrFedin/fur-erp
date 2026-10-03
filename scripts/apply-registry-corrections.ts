/**
 * Исправления по шагу 8 отчёта сверки docs-inventory/registry-reconciliation.md (единый реестр ↔ БД).
 * Правило владельца: единый реестр xlsx — источник истины по истории; данные только из документов/реестра, без догадок;
 * спорное (реестр против документа Drive, реестр молчит, реестр неоднозначен) НЕ меняется и описано в
 * docs-inventory/pending-decisions-registry.md.
 *
 * Данные реестра/отчёта читаются из scripts/registry_corrections_data.json (разовая выгрузка нужных строк xlsx;
 * сами xlsx скрипту не нужны). Документы Drive — из docs-inventory/extract/prod*.json (как они были прочитаны ранее).
 *
 * Запуск (по умолчанию DRY-RUN: вся логика выполняется в одной транзакции по живым данным, печатается план и
 * сверка «до/после», затем транзакция ОТКАТЫВАЕТСЯ — в базе ничего не остаётся):
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-registry-corrections.ts
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-registry-corrections.ts --apply
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-registry-corrections.ts --rollback docs-inventory/corrections-journal-registry.json [--apply]
 *   --with-beaver-draft  — ДОПОЛНИТЕЛЬНО (по умолчанию ВЫКЛЮЧЕНО, см. pending п. 1) завести черновик закупки «бобр»,
 *                          только после подтверждения владельцем поставщика/валюты/НДС/даты.
 *
 * ПЕРЕД --apply СДЕЛАЙТЕ БЭКАП БАЗЫ (scripts/backup.sh).
 *
 * Что делает (всё остальное — только отчёт «не менять» с причиной):
 *   1. ТЗ 116 «Ремонт пальто» (П-2026-0183): в реестре (лист «Реестр (единый)», стр. 520) 7 ед., «стоимость работ за все
 *      ед.» 218 860, цена за единицу в реестре не указана → clientWorkPricePerUnit = 218 860 / 7 = 31 265,71 (поле хранит
 *      2 знака: 7 × 31 265,71 = 218 859,97, −0,03 ₽ округления). Только если сейчас поле пусто и plannedQuantity = 7.
 *      Дата, заказчик, партия, размеры — реестр их не содержит, не трогаются.
 *      ТЗ 75, 110, 122, 131, 144, 146 — сверяются и печатаются, НЕ меняются (почему — в pending).
 *   2. Платежи поставщику по реестру («TTL сырье», стр. 16–31, п/п + дата + сумма): сопоставляются с Payment по сумме и
 *      дате. Если в БД нет номера п/п (и платёж не «подтверждён») — docRef проставляется из реестра, confirmed = true
 *      (сейчас это один платёж: 1 632 000 от 30.05.2025, п/п 48466, счёт №81). Если дата или номер в БД другие
 *      (2 000 000 по счёту №96: п/п 56327 от 15.07.2025 против 53423 от 27.06.2025 в УПД №96; 24 556 500: п/п 33979 против
 *      33980 в УПД №103) — это конфликт реестра и документов Drive → НЕ меняется, в pending.
 *   3. (--with-beaver-draft) Закупка «бобр» Invoice 1-2026: DRAFT без лотов, 3 позиции, итого 4 490 090,00.
 *
 * Идемпотентно (повторный запуск печатает «уже применено»). Журнал docs-inventory/corrections-journal-registry.json
 * дописывается после КАЖДОЙ транзакции: записи {time, entity, id, field, before, after, source}; field = "__create__"
 * (создано — откат удалит), "__delete__" (удалено — before содержит полный снимок строки).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { purchaseTotalInclVat } from "../src/lib/purchase-totals";

const prisma = new PrismaClient();
const argv = process.argv;
const APPLY = argv.includes("--apply");
const WITH_BEAVER = argv.includes("--with-beaver-draft");
const rbIdx = argv.indexOf("--rollback");
const ROLLBACK_FILE = rbIdx >= 0 ? argv[rbIdx + 1] : null;
const ROOT = resolve(__dirname, "..");
const JOURNAL = resolve(ROOT, "docs-inventory", "corrections-journal-registry.json");

type Tx = Prisma.TransactionClient;
type Entry = { time: string; entity: string; id: string; field: string; before: unknown; after: unknown; source: string };
type Ctx = { tx: Tx; J: Entry[]; log: string[]; orgId: string };

const MODEL: Record<string, string> = {
  Purchase: "purchase", PurchaseItem: "purchaseItem", RawMaterial: "rawMaterial", Supplier: "supplier",
  Payment: "payment", ProductionOrder: "productionOrder",
};
const JSON_FIELDS = new Set(["costPlan", "costBreakdown", "extra"]);
class DryRunDone extends Error {}

type RegTz = { tz: number; row: number; qty: number | null; workPerUnit: number | null; extraPerUnit: number | null; workTotal: number | null };
type RegPay = { row: number; invoiceText: string; kind: string; amount: number; ppNumber: string; paidAt: string; ppText: string };
type RegData = {
  tz: RegTz[]; payments: RegPay[];
  beaver: { sheet: string; invoice: string; dateRaw: string; billTo: string; total: number; rows: { row: number; name: string; qty: number; unitPrice: number; total: number }[] };
};
const DATA: RegData = JSON.parse(readFileSync(resolve(__dirname, "registry_corrections_data.json"), "utf-8"));

const D = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "∅");
const dmy = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
const r2 = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const snap = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const say = (c: Ctx, s: string) => c.log.push(s);

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

/** Обновление полей с журналом before/after (значения «после» перечитываются из БД). */
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

// ================================================================= 1. ТЗ: работа

/** Цена работы за единицу по приложениям ТЗ в Drive (docs-inventory/extract/prod*.json), только для сверки. */
function docWorkPerUnit(tz: number): number | null {
  for (const f of ["prod2026", "prod2025b", "prod2025a"]) {
    const p = resolve(ROOT, "docs-inventory", "extract", `${f}.json`);
    if (!existsSync(p)) continue;
    for (const e of JSON.parse(readFileSync(p, "utf-8")) as { title: string; workOrders?: Record<string, any>[] }[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
      for (const w of e.workOrders ?? []) {
        if ((w.tzNumber ?? w.tz) !== tz) continue;
        const v = w.workPricePerUnit;
        if (typeof v === "number") return v;
        if (v && typeof v === "object" && typeof v.vat22 === "number") return v.vat22;
      }
    }
  }
  return null;
}

async function unitTz(c: Ctx) {
  const { tx, orgId } = c;
  const money = (v: Decimal | null | undefined) => (v ? v.toFixed(2) : "∅");
  for (const reg of DATA.tz) {
    const rows = await tx.productionOrder.findMany({ where: { organizationId: orgId, workOrderNumber: String(reg.tz) } });
    const head = `ТЗ ${reg.tz} (реестр, стр. ${reg.row}: ${reg.qty} ед., работа/ед. ${reg.workPerUnit ?? "∅"}, доп.материалы/ед. ${reg.extraPerUnit ?? "∅"}, итого ${reg.workTotal})`;
    if (rows.length !== 1) { say(c, `${head}: в БД строк ${rows.length} (ожидалась одна) — не менялось`); continue; }
    const o = rows[0];
    const db = o.clientWorkPricePerUnit;
    const doc = docWorkPerUnit(reg.tz);
    const state = `БД ${o.number}: ${o.plannedQuantity} ед. × ${money(db)}; приложение Drive: ${doc ?? "нет"}`;

    if (reg.tz === 116) {
      const src = "единый реестр, лист «Реестр (единый)», стр. 520: ТЗ 116 «Ремонт пальто», 7 ед., «Стоимость работ за все ед.» 218 860 (цена за ед. не указана; приложения ТЗ 116 в Drive нет)";
      if (!reg.workTotal || !reg.qty) { say(c, `${head}: нет данных — не менялось`); continue; }
      const price = r2(new Decimal(reg.workTotal).div(reg.qty));
      if (db && db.gt(0)) {
        say(c, db.eq(price) ? `✓ уже применено: ${head} → ${state}` : `${head}: в БД уже ${money(db)} (реестр даёт ${price}) — не менялось`);
        continue;
      }
      if (!o.plannedQuantity.equals(reg.qty)) { say(c, `${head}: количество в БД ${o.plannedQuantity} ≠ реестр ${reg.qty} — не менялось`); continue; }
      const note = `[registry-corrections:tz116] Работа по реестру: ${reg.workTotal} ₽ за ${reg.qty} ед. → ${price} ₽/ед. (${price.mul(reg.qty).toFixed(2)} ₽ при округлении до копеек; реестр 218 860,00).`;
      await upd(c, "ProductionOrder", o.id, { clientWorkPricePerUnit: price, notes: o.notes ? `${o.notes}\n${note}` : note }, src);
      say(c, `ИСПРАВЛЕНО ${head}: clientWorkPricePerUnit ∅ → ${price} (итого ${price.mul(o.plannedQuantity).toFixed(2)})`);
      continue;
    }

    // остальные — только сверка, без изменений
    let verdict: string;
    switch (reg.tz) {
      case 122: case 131: {
        const calc = reg.workPerUnit != null && reg.extraPerUnit != null && reg.qty != null ? (reg.workPerUnit + reg.extraPerUnit) * reg.qty : null;
        verdict = db && reg.workPerUnit != null && db.eq(reg.workPerUnit) && calc != null && Math.abs(calc - (reg.workTotal ?? 0)) < 0.01
          ? `НЕ МЕНЯТЬ: цена работы в БД = реестр = приложение (${reg.workPerUnit}); разница сумм — доп.материалы ${reg.extraPerUnit}/ед. ×${reg.qty}, они входят в итог реестра ((работа+доп)×кол-во = ${calc})`
          : "ТРЕБУЕТ РАЗБОРА: цена в БД не совпала с реестром";
        break;
      }
      case 144:
        verdict = "НЕ МЕНЯТЬ: в реестре работа не заполнена (0), в БД 263 000 по приложению Drive — реестр молчит";
        break;
      case 146:
        verdict = `НЕ МЕНЯТЬ (pending): реестр ${reg.workPerUnit}/ед. против письма/приложения ${doc ?? "?"}; БД = документ (исправлялось ранее)`;
        break;
      case 75:
        verdict = `НЕ МЕНЯТЬ (pending): реестр ${reg.workPerUnit} (=8500×1,22/1,20, не округлено) против приложения ${doc ?? "?"} (округлено вниз); разница 2,67 ₽ — округление`;
        break;
      case 110:
        verdict = `НЕ МЕНЯТЬ (pending): конфликт количества — реестр ${reg.qty} изд. (×${reg.workPerUnit}), приложение Drive 1 изд. (${doc ?? "?"}), БД ${o.plannedQuantity}`;
        break;
      default:
        verdict = "не обрабатывается";
    }
    say(c, `${head}\n      ${state}\n      → ${verdict}`);
  }
}

// ================================================================= 2. платежи поставщику: п/п из реестра

const ppRefOf = (docRef: string | null) => (docRef ?? "").replace(/счёт[^;(]*/gi, ""); // без «счёт Веллмех №81 …»: остаётся только то, что относится к платёжке

async function unitPayments(c: Ctx) {
  const { tx, orgId } = c;
  for (const r of DATA.payments) {
    const amt = new Decimal(r.amount);
    const date = D(r.paidAt);
    const label = `п/п ${r.ppNumber} от ${dmy(r.paidAt)}, ${amt.toFixed(2)} (реестр «TTL сырье», стр. ${r.row}; ${r.invoiceText})`;
    const byAmount = (await tx.payment.findMany({ where: { organizationId: orgId } })).filter((p) => p.amount.equals(amt));
    const exact = byAmount.filter((p) => eq(p.paidAt, date));
    const hasNum = (p: { docRef: string | null }) => new RegExp(`№\\s*0*${r.ppNumber}(?!\\d)`).test(p.docRef ?? "");

    if (exact.length === 1) {
      const p = exact[0];
      if (hasNum(p)) { say(c, `✓ ${label}: в БД уже есть (${p.docRef})`); continue; }
      const other = /№\s*\d+/.test(ppRefOf(p.docRef));
      if (other) { say(c, `КОНФЛИКТ ${label}: в БД другой номер «${p.docRef}» (по документам Drive) — НЕ МЕНЯЛОСЬ, pending`); continue; }
      if (p.confirmed && /п\/п/.test(p.docRef ?? "")) { say(c, `${label}: у платежа есть п/п без номера «${p.docRef}» — не менялось`); continue; }
      const base = (p.docRef ?? "").replace(/\s*\(платёжка не названа\)/i, "").trim();
      const docRef = `п/п №${r.ppNumber} от ${dmy(r.paidAt)}${base ? `; ${base}` : ""}`;
      const src = `единый реестр, лист «TTL сырье», стр. ${r.row}: ${r.invoiceText}, ${r.kind}, ${amt.toFixed(2)}, п/п ${r.ppText}; дата и сумма совпали с БД; документы Drive иного номера не называют`;
      const note = `[registry-corrections:pp] п/п №${r.ppNumber} от ${dmy(r.paidAt)} и подтверждение оплаты — по единому реестру («TTL сырье», стр. ${r.row}).`;
      await upd(c, "Payment", p.id, { docRef, confirmed: true, notes: p.notes ? `${p.notes}\n${note}` : note }, src);
      say(c, `ИСПРАВЛЕНО ${label}: docRef «${p.docRef}» → «${docRef}»; confirmed ${p.confirmed} → true`);
      continue;
    }
    if (exact.length > 1) { say(c, `${label}: в БД ${exact.length} платежей с той же суммой и датой — не менялось`); continue; }
    if (byAmount.length) {
      const p = byAmount[0];
      say(c, `КОНФЛИКТ ${label}: в БД платёж на ту же сумму с датой ${ymd(p.paidAt)} и «${p.docRef}» — НЕ МЕНЯЛОСЬ, pending`);
      continue;
    }
    // разнесён на несколько записей (45637: 3 935 761,96 + 7 211 188,04)
    const parts = (await tx.payment.findMany({ where: { organizationId: orgId, paidAt: date } })).filter(hasNum);
    const sum = parts.reduce((s, p) => s.add(p.amount), new Decimal(0));
    say(c, parts.length && sum.equals(amt)
      ? `✓ ${label}: в БД разнесён на ${parts.length} записи (Σ ${sum.toFixed(2)}), п/п указан`
      : `${label}: в БД не найден (в Payment нет суммы/даты; возможно это ProductionPayment) — не менялось`);
  }
}

// ================================================================= 3. «бобр» Invoice 1-2026 (по флагу)

async function unitBeaver(c: Ctx) {
  const { tx, orgId } = c;
  const B = DATA.beaver;
  const session = "Invoice 1-2026 (бобр)";
  const existing = await tx.purchase.findFirst({ where: { organizationId: orgId, auctionSession: session, invoiceNumber: B.invoice } });
  const sum = B.rows.reduce((s, r) => s.add(r.total), new Decimal(0));
  if (!WITH_BEAVER) {
    say(c, `НЕ ЗАВОДИЛОСЬ (pending п. 1, флаг --with-beaver-draft не указан): «бобр» Invoice ${B.invoice} от ${B.dateRaw}, ${B.rows.reduce((s, r) => s + r.qty, 0)} шт, ${sum.toFixed(2)}${existing ? " — ВНИМАНИЕ: закупка уже есть в БД" : ""}`);
    return;
  }
  if (existing) return say(c, `✓ уже применено: закупка бобра есть (${existing.number})`);
  if (!sum.equals(B.total)) return say(c, `Σ строк ${sum} ≠ итог ${B.total} — не заводилось`);
  const warehouse = await tx.warehouse.findFirstOrThrow({ where: { organizationId: orgId, isDefault: true } });
  const src = `отчёт 08_06_2026_Отчет_по_закупке_мехового_сырья_MVST.xlsx, лист «${B.sheet}», стр. ${B.rows.map((r) => r.row).join("–")}: Invoice Nr ${B.invoice}, Date ${B.dateRaw}, Client/Bill to ${B.billTo}`;
  let supplier = await tx.supplier.findFirst({ where: { organizationId: orgId, name: B.billTo } });
  if (!supplier) supplier = await createRow(c, "Supplier", { organizationId: orgId, name: B.billTo }, src);
  const all = await tx.purchase.findMany({ where: { organizationId: orgId }, select: { number: true } });
  const mx = Math.max(0, ...all.map((p) => Number(p.number.match(/^З-2026-(\d+)$/)?.[1] ?? 0)));
  const number = `З-2026-${String(mx + 1).padStart(4, "0")}`;
  const [dd, mm, yy] = B.dateRaw.split(".");
  const purchase = await createRow(c, "Purchase", {
    organizationId: orgId, number, supplierId: supplier.id, warehouseId: warehouse.id, status: "DRAFT", currency: "RUB", exchangeRate: 1,
    auctionSession: session, invoiceNumber: B.invoice, orderDate: D(`${yy}-${mm}-${dd}`),
    notes: `[registry-corrections:beaver] Бобр выделанный по инвойсу ${B.invoice} от ${B.dateRaw} (${B.billTo}), 587 шт, ${sum.toFixed(2)} ₽ (цены в отчёте без НДС и без курса, трактованы как ₽). Приход не подтверждён (УПД/платёжек нет): DRAFT, лотов нет. Источник: ${src}.`,
  }, src);
  for (const r of B.rows) {
    let mat = await tx.rawMaterial.findFirst({ where: { organizationId: orgId, name: r.name } });
    if (!mat) mat = await createRow(c, "RawMaterial", { organizationId: orgId, name: r.name, unit: "PIECE" }, src);
    await createRow(c, "PurchaseItem", { purchaseId: purchase.id, rawMaterialId: mat.id, quantity: new Decimal(r.qty), unitPrice: new Decimal(r.unitPrice), subtotal: new Decimal(r.total), vatRate: 0 }, src);
  }
  say(c, `СОЗДАНА ${number}: DRAFT, ${B.billTo}, ${B.rows.length} позиции, ${sum.toFixed(2)}`);
}

// ================================================================= метрики

async function metrics(tx: Tx, orgId: string) {
  const pay = await tx.payment.findMany({ where: { organizationId: orgId } });
  const sumOf = (a: { amount: Decimal }[]) => a.reduce((s, p) => s.add(p.amount), new Decimal(0));
  const unconf = pay.filter((p) => !p.confirmed);
  const noRef = pay.filter((p) => !(p.docRef ?? "").trim());
  const orders = await tx.productionOrder.findMany({ where: { organizationId: orgId }, select: { plannedQuantity: true, clientWorkPricePerUnit: true } });
  const work = orders.reduce((s, o) => s.add((o.clientWorkPricePerUnit ?? new Decimal(0)).mul(o.plannedQuantity)), new Decimal(0));
  const withPrice = orders.filter((o) => o.clientWorkPricePerUnit && o.clientWorkPricePerUnit.gt(0)).length;
  const purchases = await tx.purchase.findMany({ where: { organizationId: orgId }, include: { items: true, expenses: true } });
  const byStatus = new Map<string, { n: number; sum: Decimal }>();
  for (const p of purchases) {
    const x = byStatus.get(p.status) ?? { n: 0, sum: new Decimal(0) };
    x.n++; x.sum = x.sum.add(purchaseTotalInclVat(p as never));
    byStatus.set(p.status, x);
  }
  return { nPay: pay.length, sumPay: sumOf(pay), nUnconf: unconf.length, sumUnconf: sumOf(unconf), nNoRef: noRef.length, nOrders: orders.length, withPrice, work, byStatus };
}
type Metrics = Awaited<ReturnType<typeof metrics>>;
function printMetrics(title: string, m: Metrics) {
  console.log(`\n--- ${title} ---`);
  console.log(`  Платежей поставщику: ${m.nPay}, Σ ${m.sumPay.toFixed(2)}; не подтверждено (confirmed=false): ${m.nUnconf} на ${m.sumUnconf.toFixed(2)}; без docRef: ${m.nNoRef}`);
  console.log(`  ТЗ-строк: ${m.nOrders}, с ценой работы: ${m.withPrice}, Σ работа (цена × кол-во) ${m.work.toFixed(2)}`);
  for (const [s, x] of [...m.byStatus].sort()) console.log(`  Закупки ${s}: ${x.n}, ${x.sum.toFixed(2)}`);
}

// ================================================================= main / apply / rollback

function appendJournal(entries: Entry[]) {
  if (!entries.length) return;
  const cur: Entry[] = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : [];
  writeFileSync(JOURNAL, JSON.stringify(cur.concat(entries), null, 1));
}

const UNITS: [string, (c: Ctx) => Promise<unknown>][] = [
  ["1. ТЗ: работа (116 — внести; 75, 110, 122, 131, 144, 146 — сверка)", unitTz],
  ["2. Платежи поставщику: п/п из реестра", unitPayments],
  ["3. Закупка «бобр» (только с --with-beaver-draft)", unitBeaver],
];

async function main() {
  const dbUrl = (process.env.DATABASE_URL ?? "").replace(/:[^:@/]*@/, ":***@");
  console.log(`База: ${dbUrl}\nРежим: ${ROLLBACK_FILE ? "ОТКАТ" : APPLY ? "APPLY" : "DRY-RUN (транзакция откатывается)"}${WITH_BEAVER ? " + бобр" : ""}`);
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
          if (e.entity === "Purchase" && ((await tx.payment.count({ where: { purchaseId: e.id } })) || (await tx.rawMaterialLot.count({ where: { purchaseId: e.id } })))) { console.log(`  закупка ${e.id}: есть оплаты/лоты — не удалена`); skipped++; continue; }
          if (e.entity === "RawMaterial" && ((await tx.rawMaterialLot.count({ where: { rawMaterialId: e.id } })) || (await tx.purchaseItem.count({ where: { rawMaterialId: e.id } })))) { console.log(`  материал ${e.id}: есть ссылки — не удалён`); skipped++; continue; }
          if (e.entity === "Supplier" && ((await tx.purchase.count({ where: { supplierId: e.id } })) || (await tx.payment.count({ where: { supplierId: e.id } })))) { console.log(`  поставщик ${e.id}: есть ссылки — не удалён`); skipped++; continue; }
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
