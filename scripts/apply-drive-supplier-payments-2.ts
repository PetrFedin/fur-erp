/**
 * Оплаты ПОСТАВЩИКУ (ООО «Веллмех») — вторая партия, по документам Google Drive «мех».
 * Правило владельца: данные — только из документов; нет документа с суммой И датой оплаты — нет записи.
 * Спорное/неподтверждённое — docs-inventory/pending-supplier-payments-2.md (скрипт этого не трогает).
 *
 * Запуск (по умолчанию DRY-RUN: ничего не пишет, печатает план):
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-supplier-payments-2.ts
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-supplier-payments-2.ts --apply
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-supplier-payments-2.ts --rollback docs-inventory/corrections-journal-supplier-payments-2.json
 * ПЕРЕД --apply сделайте бэкап базы (scripts/backup.sh). Скрипт идемпотентен: метка [fix:Rnn] в Payment.notes.
 * (Метки R11…R14: R01 уже занята первым скриптом — перепривязка подкладки УПД №109.)
 *
 *   R11  новый Payment: доплата SAGA 06-25 1 061 306,00 (п/п №64014 от 22.08.2025, счёт №127) → закупка З-2026-0003.
 *        Решение владельца: переплату НЕ БОЛЕЕ 1 ₽ принять (здесь 0,74 ₽ — округление счёта), с отметкой в notes.
 *        Любая большая переплата по-прежнему блокирует запись.
 *   R12  аванс 34 825 000,00 (28.02.2025, п/п №440, [fix:P06]) → аукцион «РП 03.25»        (УПД №77 п.(5) = п/п 440).
 *   R13  промежуточный 79 898 902,00 (14.03.2025, п/п №33979, [fix:Q01]) → аукцион «СП 03.25» (УПД №78 п.(5) = п/п 33979).
 *   R14  окончательный 11 146 950,00 (16.05.2025, п/п №45637, [fix:Q02]) делится на две строки по остаткам УПД:
 *        3 935 761,96 → «РП 03.25» (38 760 761,96 − 34 825 000)  и  7 211 188,04 → «СП 03.25» (87 110 090,04 − 79 898 902).
 *        Итоговая сумма сохраняется (11 146 950,00); переплаты нет (стоимость аукционов в БД чуть выше УПД).
 *   НЕ делает: разнесение аванса 30 666 300 (Спец. №4, п/п 53423) — один счёт №83 и один УПД №143 на СП 05.25 + РП 05.25.
 *
 * Для каждого нового платежа прикрепляются DriveDocument (paymentId). Журнал: docs-inventory/corrections-journal-supplier-payments-2.json
 * (дописывается после КАЖДОЙ операции; «было → стало» по каждому изменённому полю).
 * --rollback <журнал>: удаляет созданные платежи и DriveDocument, возвращает «было» (amount, auctionSession, notes),
 *   если поле с тех пор не менялось руками.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { purchaseTotalInclVat } from "../src/lib/purchase-totals";

const prisma = new PrismaClient();
const ROOT = resolve(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const JOURNAL = join(INV, "corrections-journal-supplier-payments-2.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rbIdx = args.indexOf("--rollback");
const ROLLBACK = rbIdx >= 0 ? args[rbIdx + 1] : null;
const PAY_EPS = new Decimal("0.005");
/** Решение владельца: переплата по закупке до 1 ₽ (округление счёта) допустима — с отметкой в notes. */
const ROUNDING_TOLERANCE = new Decimal("1.00");

const r2 = (d: Decimal.Value) => new Decimal(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const dateIso = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const auctionName = (s: string | null | undefined) => s?.split(/\r?\n/)[0].trim() || null;
const fmt = (d: Decimal.Value) => new Decimal(d).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ").replace(".", ",");

// ---------------------------------------------------------------- данные

type DocType =
  | "AUCTION_INVOICE" | "UPD" | "CALC_SHEET" | "SPECIFICATION" | "CONTRACT" | "TZ_APPENDIX"
  | "PAYMENT_PROOF" | "PAYMENT_INVOICE" | "APPROVAL_EMAIL" | "BALANCE" | "OTHER";
type DocSpec = { f: string; type: DocType; num?: string; date?: string; note: string };

const REG: DocSpec = { f: "11LrdlppXk6yjQgg3LQZA47r-HeJ48ahQ", type: "OTHER", note: "Единый реестр: таблица оплат Веллмеху (счёт — назначение — сумма — п/п от даты)" };
const LETTER_FINAL: DocSpec = { f: "1QTIPs-FSia6PO5XdL5Ow190DEd5POy2I", type: "APPROVAL_EMAIL", note: "Письмо-согласование (цепочка Коношенко — Решетняк): согласование оплаты, не платёжка" };
const UPD77: DocSpec = { f: "1bmsHNNxZgTIk8EL_Tu23JaSGYLHu6aSA", type: "UPD", num: "77", date: "2025-05-16", note: "УПД №77 (РП 03.25), итог 38 760 761,96; п.(5) «К платёжно-расчётному документу» — только п/п №440" };
const UPD78: DocSpec = { f: "1B012EyfhP8G_yRXddMvS6jHdGkir8DFH", type: "UPD", num: "78", date: "2025-05-16", note: "УПД №78 (СП 03.25), итог 87 110 090,04; п.(5) «К платёжно-расчётному документу» — только п/п №33979" };
const CONTRACT_SPEC12: DocSpec = { f: "1lqmosmdRsZWw20KW15JnfMO9AfZ5k87M", type: "CONTRACT", num: "2502", date: "2025-02-26", note: "Договор №2502 + Спец. №1 (один комплект СП 03.25 + РП 03.25; «окончательная стоимость = сумма всех УПД к Спецификации») и №2" };
const INV75: DocSpec = { f: "1Cxd10vDTjGQJPYM8E8MacODoVooZEzAy", type: "PAYMENT_INVOICE", num: "75", date: "2025-05-13", note: "Счёт Веллмех №75: окончательный платёж по Спец. №1, 11 146 950,00" };

// --- R11: новый платёж
const R11 = {
  key: "R11", amount: 1061306, paidAt: "2025-08-22", kind: "FINAL" as const, confirmed: true,
  purchase: "З-2026-0003",
  docRef: "п/п №64014 от 22.08.2025; счёт Веллмех №127 от 13.08.2025",
  notes: "Доплата по Приложению 5 (каракуль, SAGA 06-25), счёт №127 от 13.08.2025. Сумма — счёт №127 и письмо 19–20.08.2025 (согласовано); дата и п/п — «Единый реестр» (64014 от 22.08.2025).",
  source: "Единый реестр; счёт №127; письмо 19–20.08.2025",
  docs: [
    REG,
    { f: "17phLbMUwjhVIxM_-i3MnpdodUacdny7Y", type: "PAYMENT_INVOICE", num: "127", date: "2025-08-13", note: "Счёт Веллмех №127: доплата по Приложению 5, 1 061 306,00" },
    { f: "1_a27MS-fnhoVb4Tej4anLIyKaCqEc0Lu", type: "APPROVAL_EMAIL", note: "Письмо: финальная оплата 1 061 306 — подтверждена 20.08.2025" },
    { f: "1vL70wvkGAX7roBi-Bwp9BCts8GSMaDyv", type: "UPD", num: "127", date: "2025-08-13", note: "УПД №127 от 13.08.2025 (итог 2 271 305,54): аванс 1 210 000 + доплата 1 061 306 = 2 271 306" },
  ] as DocSpec[],
};

// --- R12…R14: разнесение платежей по аукционам
type Part = { amount: string; auction: string; text: string };
type Rebind = {
  key: string; find: string; total: string; paidAt: string; parts: Part[];
  source: string; docsFirst: DocSpec[]; docsSecond: DocSpec[];
};
const SRC_SP1 =
  "Спец. №1 (один комплект СП 03.25 + РП 03.25, итог = сумма УПД); УПД №77 (РП 03.25) = 38 760 761,96, п.(5): п/п №440; " +
  "УПД №78 (СП 03.25) = 87 110 090,04, п.(5): п/п №33979 (14.03.2025); оба УПД датированы 16.05.2025, каждый называет по одному п/п; " +
  "п/п 440 + 33979 + остаток = 34 825 000 + 79 898 902 + 11 146 950 = 125 870 852,00 = УПД №77 + №78 до копейки.";
const REBINDS: Rebind[] = [
  {
    key: "R12", find: "[fix:P06]", total: "34825000.00", paidAt: "2025-02-28", source: SRC_SP1,
    parts: [{ amount: "34825000.00", auction: "РП 03.25", text: "УПД №77 (РП 03.25) называет п/п №440 — это п/п от 28.02.2025 (счёт №31, аванс 35%); 34 825 000,00 ≤ итога УПД №77 38 760 761,96." }],
    docsFirst: [UPD77, CONTRACT_SPEC12], docsSecond: [],
  },
  {
    key: "R13", find: "[fix:Q01]", total: "79898902.00", paidAt: "2025-03-14", source: SRC_SP1,
    parts: [{ amount: "79898902.00", auction: "СП 03.25", text: "УПД №78 (СП 03.25) называет п/п №33979 от 14.03.2025 — это промежуточный платёж 79 898 902,00; ≤ итога УПД №78 87 110 090,04." }],
    docsFirst: [CONTRACT_SPEC12], docsSecond: [],
  },
  {
    key: "R14", find: "[fix:Q02]", total: "11146950.00", paidAt: "2025-05-16", source: SRC_SP1,
    parts: [
      { amount: "3935761.96", auction: "РП 03.25", text: "остаток УПД №77: 38 760 761,96 − 34 825 000,00 (п/п 440)" },
      { amount: "7211188.04", auction: "СП 03.25", text: "остаток УПД №78: 87 110 090,04 − 79 898 902,00 (п/п 33979)" },
    ],
    docsFirst: [UPD77, CONTRACT_SPEC12],
    docsSecond: [REG, INV75, LETTER_FINAL, UPD78, CONTRACT_SPEC12],
  },
];

// ---------------------------------------------------------------- журнал

type JournalEntry = { time: string; entity: string; id: string; field: string; before: unknown; after: unknown; source: string };
const appendJournal = (entries: JournalEntry[]) => {
  if (!entries.length) return;
  const cur: JournalEntry[] = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : [];
  writeFileSync(JOURNAL, JSON.stringify(cur.concat(entries), null, 1));
};
const jr = (entity: string, id: string, field: string, before: unknown, after: unknown, source: string): JournalEntry =>
  ({ time: new Date().toISOString(), entity, id, field, before, after, source });

// ---------------------------------------------------------------- состояние для проверки переплаты

type Db = PrismaClient | Prisma.TransactionClient;
async function loadState(db: Db, organizationId: string) {
  const purchases = await db.purchase.findMany({
    where: { organizationId },
    include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" } } },
  });
  const apay = await db.payment.findMany({ where: { organizationId, purchaseId: null, auctionSession: { not: null }, status: "COMPLETED" } });
  const purchTotal = new Map<string, Decimal>();
  const purchPaid = new Map<string, Decimal>();
  const aucTotal = new Map<string, Decimal>();
  const aucPaid = new Map<string, Decimal>();
  const byNumber = new Map<string, (typeof purchases)[number]>();
  const add = (m: Map<string, Decimal>, k: string, v: Decimal) => m.set(k, (m.get(k) ?? new Decimal(0)).add(v));
  for (const p of purchases) {
    byNumber.set(p.number, p);
    const done = p.payments.reduce((s, x) => s.add(x.amount), new Decimal(0));
    purchPaid.set(p.id, done);
    const a = auctionName(p.auctionSession);
    if (a) add(aucPaid, a, done);
    if (p.status === "CANCELLED") continue;
    const t = purchaseTotalInclVat(p) as Decimal;
    purchTotal.set(p.id, t);
    if (a) add(aucTotal, a, t);
  }
  for (const x of apay) if (x.auctionSession) add(aucPaid, auctionName(x.auctionSession)!, x.amount);
  return { purchases, byNumber, purchTotal, purchPaid, aucTotal, aucPaid };
}

// ---------------------------------------------------------------- документы

type Json = any;
const manifest: Json[] = JSON.parse(readFileSync(join(INV, "drive-manifest.json"), "utf-8"));
const manById = new Map<string, Json>(manifest.map((m) => [m.id, m]));

async function addDocs(tx: Prisma.TransactionClient, organizationId: string, payId: string, docs: DocSpec[], paidAt: string, label: string, amount: Decimal, source: string): Promise<JournalEntry[]> {
  const out: JournalEntry[] = [];
  for (const d of docs) {
    const has = await tx.driveDocument.findFirst({ where: { organizationId, driveFileId: d.f, paymentId: payId } });
    if (has) continue;
    const m = manById.get(d.f);
    const row = await tx.driveDocument.create({
      data: {
        organizationId, driveFileId: d.f, title: m.title, docType: d.type, mimeType: m.mimeType ?? null,
        sizeBytes: m.size ?? null, drivePath: m.path ?? null, viewUrl: m.viewUrl ?? null,
        docDate: d.date ? dateIso(d.date) : null, docNumber: d.num ?? null, year: Number(paidAt.slice(0, 4)),
        notes: `${d.note}. Основание ${label} (${paidAt}, ${fmt(amount)} ₽)`, paymentId: payId,
      },
    });
    out.push(jr("DriveDocument", row.id, "__create__", null, { driveFileId: d.f, paymentId: payId, docType: d.type }, source));
  }
  return out;
}

// ---------------------------------------------------------------- план и применение

async function main() {
  const org = await prisma.organization.findFirstOrThrow();
  const organizationId = org.id;
  const st0 = await loadState(prisma, organizationId);
  const supplierIds = new Set(st0.purchases.map((p) => p.supplierId));
  if (supplierIds.size !== 1) throw new Error("Ожидался один поставщик, найдено " + supplierIds.size);
  const supplierId = [...supplierIds][0];
  const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } });
  console.log(`${APPLY ? "ПРИМЕНЕНИЕ" : "DRY-RUN (в БД ничего не пишется)"}; поставщик ${supplier.name}; БД: ${(process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@")}`);
  for (const d of [...R11.docs, ...REBINDS.flatMap((r) => [...r.docsFirst, ...r.docsSecond])]) if (!manById.has(d.f)) throw new Error(`fileId ${d.f} нет в drive-manifest.json`);

  const paidP = new Map(st0.purchPaid);
  const paidA = new Map(st0.aucPaid);

  // ---- R11
  console.log("\n===== R11: НОВЫЙ ПЛАТЁЖ =====");
  const amount11 = r2(R11.amount);
  const key11 = `[fix:${R11.key}]`;
  const pur = st0.byNumber.get(R11.purchase);
  let blocked11: string | null = null;
  let overpay11 = new Decimal(0);
  if (!pur) blocked11 = `закупка ${R11.purchase} не найдена`;
  else {
    const total = st0.purchTotal.get(pur.id) ?? new Decimal(0);
    const paid = (paidP.get(pur.id) ?? new Decimal(0)).add(amount11);
    const over = paid.sub(total);
    if (over.greaterThan(PAY_EPS)) {
      if (over.lessThanOrEqualTo(ROUNDING_TOLERANCE)) overpay11 = over;
      else blocked11 = `ПЕРЕПЛАТА ${fmt(over)} ₽ больше допустимых 1 ₽: оплачено станет ${fmt(paid)} при стоимости ${fmt(total)}`;
    }
  }
  const dup11 = await prisma.payment.findFirst({ where: { organizationId, notes: { contains: key11 } } })
    ?? (await prisma.payment.findFirst({ where: { organizationId, supplierId, amount: amount11, paidAt: dateIso(R11.paidAt), status: { not: "CANCELLED" } } }));
  const head11 = `${R11.paidAt} ${fmt(amount11)} ₽ ${R11.kind} → закупка ${R11.purchase}; ${R11.docRef}`;
  if (dup11) {
    const have = new Set((await prisma.driveDocument.findMany({ where: { organizationId, paymentId: dup11.id } })).map((d) => d.driveFileId));
    console.log(`  ✓ уже применено: ${head11}${R11.docs.filter((d) => !have.has(d.f)).length ? ` (не хватает документов: ${R11.docs.filter((d) => !have.has(d.f)).length})` : ""}`);
  } else if (blocked11) console.log(`  ПРОПУЩЕНО: ${head11}\n      причина: ${blocked11}`);
  else {
    console.log(`  СОЗДАТЬ ${head11}${overpay11.greaterThan(0) ? `\n      переплата ${fmt(overpay11)} ₽ (округление счёта) — допустима по решению владельца, будет отмечена в notes` : ""}\n      источник: ${R11.source}`);
    for (const d of R11.docs) console.log(`      + документ [${d.type}] ${manById.get(d.f).title.replace(/\s+/g, " ")}`);
    paidP.set(pur!.id, (paidP.get(pur!.id) ?? new Decimal(0)).add(amount11));
  }
  const will11 = !dup11 && !blocked11;

  // ---- R12…R14
  type RbPlan = { rb: Rebind; state: "done" | "todo" | "skip"; note: string; first?: Awaited<ReturnType<typeof prisma.payment.findFirst>> };
  const rbPlans: RbPlan[] = [];
  console.log("\n===== R12–R14: РАЗНЕСЕНИЕ ПО АУКЦИОНАМ СП/РП =====");
  for (const rb of REBINDS) {
    const mark = `[fix:${rb.key}]`;
    const done = await prisma.payment.findMany({ where: { organizationId, notes: { contains: mark } } });
    if (done.length >= rb.parts.length) { rbPlans.push({ rb, state: "done", note: "уже применено" }); console.log(`  ✓ ${rb.key}: уже применено (${done.length} шт.)`); continue; }
    const cands = await prisma.payment.findMany({ where: { organizationId, supplierId, notes: { contains: rb.find } } });
    if (cands.length !== 1) { const note = `ПРОПУЩЕНО: платежей с ${rb.find} найдено ${cands.length}`; rbPlans.push({ rb, state: "skip", note }); console.log(`  ${rb.key}: ${note}`); continue; }
    const c = cands[0];
    if (c.purchaseId || c.auctionSession || c.status !== "COMPLETED" || !c.amount.equals(r2(rb.total)) || c.paidAt.toISOString().slice(0, 10) !== rb.paidAt) {
      const note = `ПРОПУЩЕНО: платёж ${c.id} уже изменён (привязка/сумма/дата/статус)`; rbPlans.push({ rb, state: "skip", note }); console.log(`  ${rb.key}: ${note}`); continue;
    }
    let bad: string | null = null;
    const sum = rb.parts.reduce((s, p) => s.add(p.amount), new Decimal(0));
    if (!sum.equals(r2(rb.total))) bad = `части (${fmt(sum)}) не равны сумме платежа (${fmt(rb.total)})`;
    for (const p of rb.parts) {
      const total = st0.aucTotal.get(p.auction);
      if (!total) { bad = `в аукционе «${p.auction}» нет закупок`; break; }
      const paid = (paidA.get(p.auction) ?? new Decimal(0)).add(p.amount);
      if (paid.sub(total).greaterThan(PAY_EPS)) { bad = `ПЕРЕПЛАТА «${p.auction}»: оплачено станет ${fmt(paid)} при стоимости ${fmt(total)}`; break; }
    }
    if (bad) { rbPlans.push({ rb, state: "skip", note: `ПРОПУЩЕНО: ${bad}` }); console.log(`  ${rb.key}: ПРОПУЩЕНО: ${bad}`); continue; }
    for (const p of rb.parts) paidA.set(p.auction, (paidA.get(p.auction) ?? new Decimal(0)).add(p.amount));
    rbPlans.push({ rb, state: "todo", note: "", first: c });
    console.log(`  ${rb.key}: ${rb.paidAt} платёж ${fmt(rb.total)} ₽ (${c.docRef ?? ""})`);
    for (const p of rb.parts) {
      const total = st0.aucTotal.get(p.auction)!;
      console.log(`      → «${p.auction}»: ${fmt(p.amount)} ₽ (оплачено станет ${fmt(paidA.get(p.auction)!)} из ${fmt(total)}); ${p.text}`);
    }
    if (rb.key === REBINDS[0].key) console.log(`      источник (общий для R12–R14): ${rb.source}`);
    for (const d of rb.docsFirst) console.log(`      + документ (строка 1) [${d.type}] ${manById.get(d.f).title.replace(/\s+/g, " ")}`);
    for (const d of rb.docsSecond) console.log(`      + документ (новая строка) [${d.type}] ${manById.get(d.f).title.replace(/\s+/g, " ")}`);
  }

  const nTodo = rbPlans.filter((p) => p.state === "todo").length;
  console.log(`\n===== ИТОГО: новых платежей ${will11 ? 1 : 0} на ${will11 ? fmt(amount11) : "0,00"} ₽ (2025: ${will11 ? fmt(amount11) : "0,00"}); разнесений по аукционам: ${nTodo} из ${REBINDS.length} (новых строк при делении: ${rbPlans.filter((p) => p.state === "todo" && p.rb.parts.length > 1).length}) =====`);
  if (!APPLY) { console.log("\nDRY-RUN: ничего не записано. Для применения добавьте --apply (сначала бэкап!)."); return; }

  // ---- применение R11: одна транзакция
  if (will11) {
    const entries = await prisma.$transaction(async (tx) => {
      const out: JournalEntry[] = [];
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${"purchase-pay:" + organizationId + ":" + R11.purchase}))) t`;
      const prev = await tx.payment.findFirst({ where: { organizationId, notes: { contains: key11 } } })
        ?? (await tx.payment.findFirst({ where: { organizationId, supplierId, amount: amount11, paidAt: dateIso(R11.paidAt), status: { not: "CANCELLED" } } }));
      if (prev) return out;
      const live = await loadState(tx, organizationId);
      const p = live.byNumber.get(R11.purchase)!;
      const total = live.purchTotal.get(p.id) ?? new Decimal(0);
      const over = (live.purchPaid.get(p.id) ?? new Decimal(0)).add(amount11).sub(total);
      if (over.greaterThan(ROUNDING_TOLERANCE)) { console.log(`  R11 ПРОПУЩЕНО: переплата ${fmt(over)} ₽ > 1 ₽`); return out; }
      const roundingNote = over.greaterThan(PAY_EPS)
        ? ` Переплата ${fmt(over)} ₽ принята решением владельца (округление счёта №127: стоимость закупки ${fmt(total)}, по УПД №127 — 2 271 305,54; аванс 1 210 000,00 + доплата 1 061 306,00 = 2 271 306,00).`
        : "";
      const pay = await tx.payment.create({
        data: {
          organizationId, supplierId, purchaseId: p.id, auctionSession: null, amount: amount11, currency: "RUB",
          method: "BANK_TRANSFER", status: "COMPLETED", paidAt: dateIso(R11.paidAt), kind: R11.kind, docRef: R11.docRef,
          confirmed: R11.confirmed, notes: `${R11.notes}${roundingNote} ${key11}`,
        },
      });
      out.push(jr("Payment", pay.id, "__create__", null,
        { amount: amount11.toFixed(2), paidAt: R11.paidAt, kind: R11.kind, purchaseId: p.id, auctionSession: null, docRef: R11.docRef, overpay: over.greaterThan(PAY_EPS) ? over.toFixed(2) : "0.00" }, R11.source));
      out.push(...(await addDocs(tx, organizationId, pay.id, R11.docs, R11.paidAt, R11.key, amount11, R11.source)));
      return out;
    });
    appendJournal(entries);
    console.log(`  R11: записей в журнале ${entries.length}`);
  }

  // ---- применение R12…R14: одно разнесение = одна транзакция
  for (const pl of rbPlans) {
    if (pl.state !== "todo") continue;
    const rb = pl.rb;
    const mark = `[fix:${rb.key}]`;
    const entries = await prisma.$transaction(async (tx) => {
      const out: JournalEntry[] = [];
      for (const a of rb.parts.map((p) => p.auction).sort()) {
        await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${"auction-pay:" + organizationId + ":" + a}))) t`;
      }
      const cur = await tx.payment.findFirst({ where: { organizationId, supplierId, notes: { contains: rb.find } } });
      if (!cur || cur.purchaseId || cur.auctionSession || !cur.amount.equals(r2(rb.total)) || (cur.notes ?? "").includes(mark)) { console.log(`  ${rb.key}: платёж уже изменён — пропуск`); return out; }
      const live = await loadState(tx, organizationId);
      for (const p of rb.parts) {
        const total = live.aucTotal.get(p.auction);
        const paid = (live.aucPaid.get(p.auction) ?? new Decimal(0)).add(p.amount);
        if (!total || paid.sub(total).greaterThan(PAY_EPS)) { console.log(`  ${rb.key}: переплата/нет аукциона «${p.auction}» — пропуск`); return out; }
      }
      const first = rb.parts[0];
      const split = rb.parts.length > 1;
      const addText = split
        ? ` ${mark} Разнесено по аукционам по остаткам УПД №77/№78: часть для «${first.auction}» — ${fmt(first.amount)} (${first.text}); остальное (${fmt(rb.parts[1].amount)}, «${rb.parts[1].auction}») выделено отдельной строкой. Было: ${fmt(rb.total)} без привязки.`
        : ` ${mark} Привязан к аукциону «${first.auction}»: ${first.text}`;
      const newNotes = `${cur.notes ?? ""}${addText}`.trim();
      await tx.payment.update({ where: { id: cur.id }, data: { auctionSession: first.auction, amount: r2(first.amount), notes: newNotes } });
      out.push(jr("Payment", cur.id, "auctionSession", null, first.auction, rb.source));
      if (split) out.push(jr("Payment", cur.id, "amount", cur.amount.toFixed(2), r2(first.amount).toFixed(2), rb.source));
      out.push(jr("Payment", cur.id, "notes", cur.notes, newNotes, rb.source));
      out.push(...(await addDocs(tx, organizationId, cur.id, rb.docsFirst, rb.paidAt, rb.key, r2(first.amount), rb.source)));
      for (const part of rb.parts.slice(1)) {
        const np = await tx.payment.create({
          data: {
            organizationId, supplierId, purchaseId: null, auctionSession: part.auction, amount: r2(part.amount), currency: cur.currency,
            method: cur.method, status: cur.status, paidAt: cur.paidAt, kind: cur.kind, docRef: cur.docRef, confirmed: cur.confirmed,
            notes: `${cur.kind === "FINAL" ? "Окончательный платёж по Спец. №1" : "Платёж по Спец. №1"} (счёт №75 от 13.05.2025, п/п №45637 от 16.05.2025) — часть для аукциона «${part.auction}»: ${fmt(part.amount)} (${part.text}). Выделена из платежа ${fmt(rb.total)}: ${fmt(first.amount)} → «${first.auction}», ${fmt(part.amount)} → «${part.auction}»; сумма сохранена. ${mark}`,
          },
        });
        out.push(jr("Payment", np.id, "__create__", null,
          { amount: r2(part.amount).toFixed(2), paidAt: rb.paidAt, kind: cur.kind, purchaseId: null, auctionSession: part.auction, docRef: cur.docRef, splitFrom: cur.id }, rb.source));
        out.push(...(await addDocs(tx, organizationId, np.id, rb.docsSecond, rb.paidAt, rb.key, r2(part.amount), rb.source)));
      }
      return out;
    });
    appendJournal(entries);
    console.log(`  ${rb.key}: записей в журнале ${entries.length}`);
  }
  console.log("\nГотово. Журнал:", JOURNAL);
}

async function rollback(file: string) {
  const entries = JSON.parse(readFileSync(resolve(file), "utf-8")) as JournalEntry[];
  const docs = entries.filter((e) => e.entity === "DriveDocument" && e.field === "__create__");
  const pays = entries.filter((e) => e.entity === "Payment" && e.field === "__create__");
  console.log(`Откат по журналу ${file}: документов ${docs.length}, платежей ${pays.length}, изменений полей ${entries.filter((e) => e.field !== "__create__").length}`);
  const rd = await prisma.driveDocument.deleteMany({ where: { id: { in: docs.map((e) => e.id) } } });
  console.log(`  DriveDocument удалено ${rd.count}`);
  const created = new Set(pays.map((e) => e.id));
  // поля существующих платежей — в обратном порядке; уже удаляемые строки пропускаем
  const changes = [...entries].reverse().filter((x) => x.entity === "Payment" && x.field !== "__create__" && !created.has(x.id));
  for (const e of changes) {
    const cur = await prisma.payment.findUnique({ where: { id: e.id } });
    if (!cur) continue;
    if (e.field === "auctionSession") {
      if (cur.auctionSession !== e.after) { console.log(`  Payment ${e.id}: auctionSession изменён после применения — не трогаю`); continue; }
      await prisma.payment.update({ where: { id: e.id }, data: { auctionSession: e.before as string | null } });
      console.log(`  Payment ${e.id}: auctionSession «${e.after}» → ${e.before === null ? "∅" : e.before}`);
    } else if (e.field === "amount") {
      if (!cur.amount.equals(new Decimal(e.after as string))) { console.log(`  Payment ${e.id}: amount изменён после применения — не трогаю`); continue; }
      await prisma.payment.update({ where: { id: e.id }, data: { amount: new Decimal(e.before as string) } });
      console.log(`  Payment ${e.id}: amount ${e.after} → ${e.before}`);
    } else if (e.field === "notes") {
      if (cur.notes !== e.after) { console.log(`  Payment ${e.id}: notes изменены после применения — не трогаю`); continue; }
      await prisma.payment.update({ where: { id: e.id }, data: { notes: e.before as string | null } });
      console.log(`  Payment ${e.id}: notes возвращены`);
    }
  }
  const rp = await prisma.payment.deleteMany({ where: { id: { in: [...created] } } });
  console.log(`  Payment удалено ${rp.count}`);
}

(ROLLBACK ? rollback(ROLLBACK) : main())
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
