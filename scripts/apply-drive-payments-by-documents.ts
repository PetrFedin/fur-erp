/**
 * Оплаты по ДОКУМЕНТАМ Google Drive «мех»: то, что документы прямо называют ОПЛАЧЕННЫМ.
 * «Согласовано / можно оплачивать» оплатой НЕ считается и сюда не попадает.
 *
 * Запуск (по умолчанию DRY-RUN — ничего не пишет, печатает план):
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-payments-by-documents.ts
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-payments-by-documents.ts --apply
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-payments-by-documents.ts --rollback
 * ПЕРЕД --apply: scripts/backup.sh. Идемпотентно (метки [fix:D..] / [fix:AP-..] в notes). Журнал: docs-inventory/corrections-journal-drive-payments.json
 *
 * A. ПЛАТЕЖИ ПОСТАВЩИКУ (новые, confirmed=false: платёжки/п/п в Drive нет)
 *   D01  SAGA 03-26, аванс 2 по счёту №105 — 22 891 800,00.
 *        Документ: «Закупка ММ SAGA 03-26 (fin).xlsx», строка «Оплата 2 — 22891800 — оплачено — 3/14/2026».
 *        Месяц «3» невозможен (счёт №105 выставлен 06.04.2026, срок 09.04) — день 14 принят, месяц по счёту: 14.04.2026.
 *        Переплата аукциона 83 875,32: зачтена в счёте AME №253 (fin AME: «переплата SAGA 83 875,37»).
 *   D02  СП 05-26 («СОЮЗПУШНИНА 05-26»), аванс 3 по счёту №149 — 19 628 147,54.
 *        Документ: письмо Василия от 09.07.2026 «Было оплачено: аванс 1 27 912 500; аванс 2 60 271 506,34;
 *        аванс 3 19 628 147,54; итого 107 812 153,88; итого к доплате 7 236 812,03» (пересылки 13–17.07.2026).
 *        Дата платежа в письме не названа — ставится дата письма 09.07.2026.
 *   НЕ вносится (в документах только «согласовано»/«планируем»): FH аванс 2 85 063 078, доплата по счёту №197 7 236 812,03,
 *   AME финал 214 522,92, подкладка спец. 13 5 400 000 (только косвенно: зачёт 55 594,50), доп. материалы 19 870,
 *   СП 12.25 4 836 327,52, счёт №143 финал 2 533 779,20, красная лиса 1 408 000, СП 09-26 60 831 100.
 *
 * B. АВАНС ЗА ПОШИВ 2025 → ПАРТИИ 1–8 (деление на строки по партиям; сумма сохраняется)
 *   Источник: «Расчет по оплатам.xlsx» (колонка «Оплачено аванс 04.08.25» по партиям 1–8 = 22 553 099,80) и сверка
 *   chain-production.md: авансы №110 (21 627 900) + №209 (1 766 870) = 23 394 770 расходуются до копейки.
 *   №110 закрывает партии 1–4 целиком и 5 526 500 из партий 5–8 (пропорционально xlsx); остальное партий 5–8 (925 199,80) —
 *   из №209 (пропорционально xlsx), плюс 6 265 аванса партии 7 (счёт №1). Остаток №209 835 405,20 (831 825,20 — зачёт в счёте №7 партий 8–9,
 *   3 580 — ТЗ 97 по счёту №41) остаётся без привязки: по документам он относится к неоплаченным счетам.
 *   Авансы 2026 (№141/№143) НЕ разносятся: документа с разнесением по ТЗ нет («оценка приблизительная», chain-production).
 *
 * C. ТОЛЬКО ПРЕДЛАГАЕТСЯ (скрипт не меняет): платёж 2 000 000 по счёту №96 — дата 27.06.2025 → 15.07.2025 (п/п 56327);
 *    аванс 30 666 300 (п/п 53423) — не разнесён между СП 05.25 и РП 05.25 (документа с разнесением нет).
 */
import "./lib/drive-links-disabled";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();
const INV = join(__dirname, "..", "docs-inventory");
const JOURNAL = join(INV, "corrections-journal-drive-payments.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");

const fmt = (v: Decimal.Value) => new Decimal(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ").replace(".", ",");
const D = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2);
const dateIso = (d: string) => new Date(`${d}T00:00:00.000Z`);

type JournalEntry = { time: string; entity: string; id: string; field: string; before: unknown; after: unknown; source: string };
const readJournal = (): JournalEntry[] => (existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : []);
const appendJournal = (e: JournalEntry[]) => e.length && writeFileSync(JOURNAL, JSON.stringify(readJournal().concat(e), null, 1));
const jr = (entity: string, id: string, field: string, before: unknown, after: unknown, source: string): JournalEntry => ({
  time: new Date().toISOString(), entity, id, field, before, after, source,
});

// ------------------------------------------------------------------ A. платежи поставщику
type SupPay = {
  key: string; auction: string; amount: string; paidAt: string; docRef: string; notes: string; source: string;
  docFiles: string[]; overpayNote?: string;
};
const SUP: SupPay[] = [
  {
    key: "D01", auction: "SAGA 03-26", amount: "22891800.00", paidAt: "2026-04-14",
    docRef: "счёт Веллмех №105 от 06.04.2026; дата по fin-расчёту (в документе «3/14/2026», месяц невозможен — принят 14.04.2026), п/п уточнить",
    notes: "Аванс 2 по Спец. №9 (SAGA 03-26), счёт №105 от 06.04.2026. «Оплачено» — «Закупка ММ SAGA 03-26 (fin).xlsx», строка «Оплата 2» 22 891 800 (в письме 08–09.04.2026 опечатка 22 891 000). Дата в fin записана как 3/14/2026 — невозможна (счёт выставлен 06.04.2026, срок 09.04): принято 14.04.2026. Платёжки в Drive нет.",
    source: "Закупка ММ SAGA 03-26 (fin).xlsx: «Оплата 2 — 22891800 — оплачено — 3/14/2026»; письмо 08–09.04.2026; счёт №105",
    docFiles: ["1IMa5KT1a_nprQpB9c7JhE4lHk_B18bQH", "1oRD5St0jhu8iGWJZ1Qtmv9TitS6loeCW", "1PH70z18oOUYONem1CnlesucSCDZ1XqwG"],
    overpayNote: " Оплачено по аукциону больше УПД №229 на 83 875,32 ₽ — переплата зачтена в счёте AME №253 (fin AME: «переплата SAGA 83 875,37»).",
  },
  {
    key: "D02", auction: "СОЮЗПУШНИНА 05-26", amount: "19628147.54", paidAt: "2026-07-09",
    docRef: "счёт Веллмех №149 от 22.05.2026; дата по письму от 09.07.2026 («Было оплачено: аванс 3 19 628 147,54»), п/п уточнить",
    notes: "Аванс 3 по Спец. №10 (шкурки соболя, СП 05-26), счёт №149 от 22.05.2026. «Было оплачено: аванс 3 19 628 147,54, итого 107 812 153,88» — письмо Василия от 09.07.2026 (пересылки Коношенко 13–17.07.2026). Дата самой оплаты в письме не названа — поставлена дата письма; п/п в Drive нет.",
    source: "письмо Василия 09.07.2026 «Было оплачено» (RE финальная оплата за сырье соболя… 3 015 шкур.msg); счёт №149",
    docFiles: ["1qj9OGmiwkIkzwsvldi822yDFyiU3IfMw", "14uyYhkshlps9mL1OVJczoDetCeQkhDSi", "1ZFN8rLA85JtOVufZGuOYs6jgTkhc6V0h"],
  },
];

// ------------------------------------------------------------------ B. аванс 2025 → партии
const XLSX_ADV: Record<number, string> = {
  1: "4603900", 2: "2840600", 3: "4714500", 4: "3942400", 5: "2455600", 6: "1114750", 7: "2066400", 8: "814949.80",
};
const EXTRA_B7 = D(6265); // аванс партии 7 в её счёте №1: 2 072 665 против 2 066 400 в xlsx
const SRC_B = "Расчет по оплатам.xlsx («Оплачено аванс 04.08.25» по партиям 1–8 = 22 553 099,80); chain-production.md (авансы №110 + №209 = 23 394 770 расходуются до копейки)";

type Alloc = { batch: number; from: "110" | "209"; amount: Decimal; text: string };
function buildAllocs(): Alloc[] {
  const xl = (b: number) => D(XLSX_ADV[b]);
  const out: Alloc[] = [];
  for (const b of [1, 2, 3, 4]) out.push({ batch: b, from: "110", amount: xl(b), text: `аванс партии ${b} по «Расчёту по оплатам» ${fmt(xl(b))}` });
  const rest = [5, 6, 7, 8];
  const restSum = rest.reduce((s, b) => s.add(xl(b)), new Decimal(0)); // 6 451 699,80
  const from110 = D("21627900").sub([1, 2, 3, 4].reduce((s, b) => s.add(xl(b)), new Decimal(0))); // 5 526 500
  let left110 = from110;
  rest.forEach((b, i) => {
    const part110 = i === rest.length - 1 ? left110 : D(xl(b).mul(from110).div(restSum));
    left110 = left110.sub(part110);
    const part209 = xl(b).sub(part110);
    out.push({ batch: b, from: "110", amount: part110, text: `аванс партии ${b} по «Расчёту по оплатам» ${fmt(xl(b))}: часть из №110 (пропорционально, ${fmt(from110)} из ${fmt(restSum)})` });
    out.push({
      batch: b, from: "209", amount: b === 7 ? part209.add(EXTRA_B7) : part209,
      text: `аванс партии ${b} по «Расчёту по оплатам» ${fmt(xl(b))}: часть из №209 (пропорционально, ${fmt(restSum.sub(from110))} из ${fmt(restSum)})${b === 7 ? `; плюс ${fmt(EXTRA_B7)} — аванс партии 7 в её счёте №1 (2 072 665 против 2 066 400 в xlsx)` : ""}`,
    });
  });
  return out;
}

async function main() {
  const org = await prisma.organization.findFirstOrThrow();
  const organizationId = org.id;
  const exist = await prisma.payment.findFirstOrThrow({ where: { organizationId, notes: { contains: "Аванс по Спец. №9" } } });
  const supplierId = exist.supplierId;
  console.log(APPLY ? "РЕЖИМ: APPLY" : "РЕЖИМ: DRY-RUN (ничего не записывается)");

  // ---------- A
  console.log("\n===== A. ПЛАТЕЖИ ПОСТАВЩИКУ ПО ДОКУМЕНТАМ =====");
  const plannedA: SupPay[] = [];
  for (const s of SUP) {
    const mark = `[fix:${s.key}]`;
    const dup = await prisma.payment.findFirst({
      where: { organizationId, status: { not: "CANCELLED" }, OR: [{ notes: { contains: mark } }, { supplierId, auctionSession: s.auction, amount: D(s.amount) }] },
    });
    if (dup) { console.log(`  ✓ ${s.key}: уже есть (${dup.id}) — пропуск`); continue; }
    const purchases = await prisma.purchase.findMany({ where: { organizationId, auctionSession: { startsWith: s.auction }, status: { not: "CANCELLED" } }, include: { items: true, expenses: true } });
    const { purchaseTotalInclVat } = await import("../src/lib/purchase-totals");
    const total = purchases.reduce((a, p) => a.add(purchaseTotalInclVat(p)), new Decimal(0));
    const paid = (await prisma.payment.aggregate({ _sum: { amount: true }, where: { organizationId, status: "COMPLETED", auctionSession: s.auction } }))._sum.amount ?? new Decimal(0);
    const viaPurchases = (await prisma.payment.aggregate({ _sum: { amount: true }, where: { organizationId, status: "COMPLETED", purchase: { auctionSession: { startsWith: s.auction } } } }))._sum.amount ?? new Decimal(0);
    const after = paid.add(viaPurchases).add(D(s.amount));
    console.log(`  СОЗДАТЬ ${s.key}: ${s.paidAt} ${fmt(s.amount)} ₽ ADVANCE → аукцион «${s.auction}», confirmed=false`);
    console.log(`      docRef: ${s.docRef}`);
    console.log(`      стоимость аукциона ${fmt(total)}, оплачено станет ${fmt(after)} (${after.greaterThan(total) ? "ПЕРЕПЛАТА " + fmt(after.sub(total)) : "остаток " + fmt(total.sub(after))})`);
    plannedA.push(s);
  }

  // ---------- B
  console.log("\n===== B. АВАНС 2025 → ПАРТИИ 1–8 =====");
  const p110 = await prisma.productionPayment.findFirst({ where: { organizationId, docRef: { contains: "Счёт №110" } }, orderBy: { createdAt: "asc" } });
  const p209 = await prisma.productionPayment.findFirst({ where: { organizationId, docRef: { contains: "Счёт №209" }, paymentType: "ADVANCE" }, orderBy: { createdAt: "asc" } });
  if (!p110 || !p209) { console.log("  ПРОПУЩЕНО: не найдены платежи №110/№209"); return; }
  const allocs = buildAllocs();
  const sum110 = allocs.filter((a) => a.from === "110").reduce((s, a) => s.add(a.amount), new Decimal(0));
  const sum209 = allocs.filter((a) => a.from === "209").reduce((s, a) => s.add(a.amount), new Decimal(0));
  const done110 = (p110.notes ?? "").includes("[fix:AP-110-b1]");
  if (!done110 && !D("21627900").equals(sum110)) throw new Error(`Сумма №110 по партиям ${sum110} ≠ 21 627 900`);
  console.log(`  №110: 21 627 900,00 → ${allocs.filter((a) => a.from === "110").length} строк (сумма ${fmt(sum110)})`);
  console.log(`  №209: 1 766 870,00 → ${allocs.filter((a) => a.from === "209").length} строк на ${fmt(sum209)}; остаток без привязки ${fmt(D("1766870").sub(sum209))}`);
  const batches = await prisma.productionBatch.findMany({
    where: { organizationId, number: { in: [1, 2, 3, 4, 5, 6, 7, 8] } },
    include: { orders: { where: { status: { not: "CANCELLED" } }, select: { id: true, number: true } } },
  });
  const byNum = new Map(batches.map((b) => [b.number, b]));
  for (const a of allocs) {
    const b = byNum.get(a.batch);
    console.log(`    партия ${a.batch} ← №${a.from}: ${fmt(a.amount)} ₽ (${b?.orders.length ?? 0} ТЗ)  ${a.text}`);
  }
  console.log("  Итого по партиям (аванс): " + [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${n}: ${fmt(allocs.filter((a) => a.batch === n).reduce((s, a) => s.add(a.amount), new Decimal(0)))}`).join("; "));

  // ---------- C
  console.log("\n===== C. ПРЕДЛОЖЕНИЯ (скрипт НЕ меняет) =====");
  console.log("  1) Платёж 2 000 000 по счёту №96: дата 27.06.2025 → 15.07.2025, п/п 56327 (реестр «TTL сырье»; п/п 53423 = аванс 30 666 300). Решает владелец.");
  console.log("  2) Аванс 30 666 300 (п/п 53423, 27.06.2025) остаётся без привязки: СП 05.25 и РП 05.25 по УПД №143 = 29 605 789,30 + 3 594 289,90; документа с разнесением нет.");

  if (!APPLY) { console.log("\nDRY-RUN: ничего не записано. Для применения добавьте --apply (сначала scripts/backup.sh)."); return; }

  // ---------- применение A
  for (const s of plannedA) {
    const entries = await prisma.$transaction(async (tx) => {
      const out: JournalEntry[] = [];
      const mark = `[fix:${s.key}]`;
      if (await tx.payment.findFirst({ where: { organizationId, notes: { contains: mark } } })) return out;
      const pay = await tx.payment.create({
        data: {
          organizationId, supplierId, purchaseId: null, auctionSession: s.auction, amount: D(s.amount), currency: "RUB",
          method: "BANK_TRANSFER", status: "COMPLETED", paidAt: dateIso(s.paidAt), kind: "ADVANCE", confirmed: false,
          docRef: s.docRef, notes: `${s.notes}${s.overpayNote ?? ""} ${mark}`,
        },
      });
      out.push(jr("Payment", pay.id, "__create__", null, { amount: s.amount, paidAt: s.paidAt, auctionSession: s.auction, confirmed: false, docRef: s.docRef }, s.source));
      out.push(...(await cloneDocs(tx, organizationId, s.docFiles, { paymentId: pay.id }, s.source, `${s.key}, ${s.paidAt}, ${fmt(s.amount)} ₽`)));
      return out;
    });
    appendJournal(entries);
    console.log(`  A ${s.key}: записей в журнале ${entries.length}`);
  }

  // ---------- применение B
  const entriesB = await prisma.$transaction(async (tx) => {
    const out: JournalEntry[] = [];
    const docsOf = async (id: string) => (await tx.driveDocument.findMany({ where: { organizationId, productionPaymentId: id } })).map((d) => d.driveFileId);
    const links = async (b: number) => (byNum.get(b)?.orders ?? []).map((o) => ({ productionOrderId: o.id }));

    // №110: исходная строка → партия 1; остальное — новые строки.
    const docs110 = await docsOf(p110.id);
    const docs209 = await docsOf(p209.id);
    const list110 = allocs.filter((a) => a.from === "110");
    if (!(p110.notes ?? "").includes("[fix:AP-110-b1]")) {
      const first = list110[0];
      const notes = `${p110.notes ?? ""} [fix:AP-110-b1] Разнесён по партиям 1–8 по «Расчёту по оплатам»: здесь часть партии ${first.batch} — ${fmt(first.amount)} (было ${fmt(p110.amount)} одной суммой без привязки).`.trim();
      await tx.productionPayment.update({ where: { id: p110.id }, data: { amount: first.amount, notes, orders: { create: await links(first.batch) } } });
      out.push(jr("ProductionPayment", p110.id, "amount", p110.amount.toFixed(2), first.amount.toFixed(2), SRC_B));
      out.push(jr("ProductionPayment", p110.id, "notes", p110.notes, notes, SRC_B));
      out.push(jr("ProductionPayment", p110.id, "orders", [], `партия ${first.batch}`, SRC_B));
      for (const a of list110.slice(1)) out.push(...(await newRow(tx, organizationId, p110, a, "110", docs110, await links(a.batch))));
    }
    // №209: исходная строка остаётся без привязки на остаток, новые — по партиям.
    if (!(p209.notes ?? "").includes("[fix:AP-209]")) {
      const list209 = allocs.filter((a) => a.from === "209");
      const rest = p209.amount.sub(sum209);
      const notes = `${p209.notes ?? ""} [fix:AP-209] Часть аванса (${fmt(sum209)}) отнесена к партиям 5–8 отдельными строками по «Расчёту по оплатам»; здесь остаток ${fmt(rest)} без привязки: 831 825,20 — зачёт в счёте №7 (партии 8–9, не оплачен), 3 580 — ТЗ 97 по счёту №41.`.trim();
      await tx.productionPayment.update({ where: { id: p209.id }, data: { amount: rest, notes } });
      out.push(jr("ProductionPayment", p209.id, "amount", p209.amount.toFixed(2), rest.toFixed(2), SRC_B));
      out.push(jr("ProductionPayment", p209.id, "notes", p209.notes, notes, SRC_B));
      for (const a of list209) out.push(...(await newRow(tx, organizationId, p209, a, "209", docs209, await links(a.batch))));
    }
    return out;
  });
  appendJournal(entriesB);
  console.log(`  B: записей в журнале ${entriesB.length}`);
  console.log("\nГотово. Журнал:", JOURNAL);
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
async function newRow(
  tx: Tx, organizationId: string,
  orig: { amount: Decimal; method: never | string; paidAt: Date; clientId: string | null; docRef: string | null; paymentType: string; confirmed: boolean; status: string; id: string },
  a: Alloc, from: string, docFiles: string[], links: { productionOrderId: string }[],
): Promise<JournalEntry[]> {
  const mark = `[fix:AP-${from}-b${a.batch}]`;
  const row = await tx.productionPayment.create({
    data: {
      organizationId, amount: a.amount, method: orig.method as "BANK_TRANSFER", status: orig.status as "COMPLETED", paidAt: orig.paidAt,
      clientId: orig.clientId, paymentType: orig.paymentType as "ADVANCE", confirmed: orig.confirmed, docRef: orig.docRef,
      notes: `Часть аванса по счёту №${from} (${from === "110" ? "21 627 900, 04.08.2025" : "1 766 870, 27.11.2025"}) на партию ${a.batch}: ${fmt(a.amount)}; ${a.text}. Выделена из одной суммы без привязки, общая сумма сохранена. ${mark}`,
      orders: { create: links },
    },
  });
  const out: JournalEntry[] = [
    jr("ProductionPayment", row.id, "__create__", null, { amount: a.amount.toFixed(2), batch: a.batch, from, splitFrom: orig.id }, SRC_B),
  ];
  out.push(...(await cloneDocs(tx, organizationId, docFiles, { productionPaymentId: row.id }, SRC_B, `${mark} ${fmt(a.amount)} ₽`)));
  return out;
}

async function cloneDocs(tx: Tx, organizationId: string, files: string[], link: { paymentId?: string; productionPaymentId?: string }, source: string, label: string): Promise<JournalEntry[]> {
  const out: JournalEntry[] = [];
  for (const f of files) {
    const src = await tx.driveDocument.findFirst({ where: { organizationId, driveFileId: f }, orderBy: { createdAt: "asc" } });
    if (!src) { console.log(`      (нет документа в базе: ${f})`); continue; }
    const row = await tx.driveDocument.create({
      data: {
        organizationId, driveFileId: src.driveFileId, title: src.title, docType: src.docType, mimeType: src.mimeType, sizeBytes: src.sizeBytes,
        drivePath: src.drivePath, viewUrl: src.viewUrl, docDate: src.docDate, docNumber: src.docNumber, year: src.year,
        notes: `${src.notes ?? ""} Основание: ${label}`.trim(), ...link,
      },
    });
    out.push(jr("DriveDocument", row.id, "__create__", null, { driveFileId: f, ...link }, source));
  }
  return out;
}

async function rollback() {
  const j = readJournal();
  if (!j.length) { console.log("Журнал пуст — откатывать нечего."); return; }
  console.log(`Откат по журналу: ${j.length} записей`);
  await prisma.$transaction(async (tx) => {
    for (const e of [...j].reverse()) {
      if (e.field === "__create__") {
        if (e.entity === "Payment") await tx.payment.deleteMany({ where: { id: e.id } });
        else if (e.entity === "ProductionPayment") await tx.productionPayment.deleteMany({ where: { id: e.id } });
        else if (e.entity === "DriveDocument") await tx.driveDocument.deleteMany({ where: { id: e.id } });
      } else if (e.entity === "ProductionPayment") {
        if (e.field === "amount") await tx.productionPayment.update({ where: { id: e.id }, data: { amount: new Decimal(String(e.before)) } });
        else if (e.field === "notes") await tx.productionPayment.update({ where: { id: e.id }, data: { notes: e.before as string | null } });
        else if (e.field === "orders") await tx.productionPaymentOrder.deleteMany({ where: { productionPaymentId: e.id } });
      }
    }
  });
  writeFileSync(JOURNAL.replace(".json", `.rolled-back-${Date.now()}.json`), JSON.stringify(j, null, 1));
  writeFileSync(JOURNAL, "[]");
  console.log("Откат выполнен, журнал сохранён с пометкой rolled-back.");
}

(ROLLBACK ? rollback() : main())
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
