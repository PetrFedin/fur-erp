/**
 * Оплаты ПОСТАВЩИКУ (ООО «Веллмех») по документам Google Drive «мех».
 * Правило владельца: данные — только из документов; нет документа с суммой И датой оплаты — нет записи.
 * Спорное/неподтверждённое — docs-inventory/pending-supplier-payments.md (скрипт этого не трогает).
 *
 * Запуск (по умолчанию DRY-RUN: ничего не пишет, печатает план):
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-supplier-payments.ts
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-supplier-payments.ts --apply
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-drive-supplier-payments.ts --rollback docs-inventory/corrections-journal-supplier-payments.json
 * ПЕРЕД --apply сделайте бэкап базы (scripts/backup.sh).
 *
 * Что делает:
 *   Q01…Q09  новые Payment (COMPLETED) с датой, суммой и номером п/п из «Единого реестра» (таблица оплат:
 *            счёт — назначение — сумма — «п/п от даты»), подтверждённых счетами Веллмех, УПД и письмами.
 *            Идемпотентность: метка [fix:Qnn] в Payment.notes (+ запасная проверка «поставщик + сумма + дата»).
 *            Переплату не создаёт: перед записью (в транзакции, с блокировкой аукциона) сверяет оплачено ≤ стоимость
 *            закупки/аукциона, как src/lib/auction-payments.ts; иначе платёж пропускается и печатается причина.
 *            К каждому новому платежу прикрепляются DriveDocument (счёт, УПД, письмо, реестр) через paymentId.
 *   R01      перепривязка существующего платежа 1 455 842 (подкладка, УПД №109) к закупкам подкладки по УПД №109
 *            (аукционная группа «Подкладка Спец. 7 (УПД 109)»): UPDATE Payment.auctionSession, журнал «было → стало».
 *   НЕ делает: разнесение авансов 34 825 000 / 30 666 300 по аукционам СП/РП (документы разбивки не дают).
 * Журнал: docs-inventory/corrections-journal-supplier-payments.json (дописывается после КАЖДОГО платежа).
 * --rollback <журнал>: удаляет созданные платежи и DriveDocument, возвращает «было» в изменённых полях
 *   (если поле с тех пор не менялось руками).
 */
import "./lib/drive-links-disabled";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { purchaseTotalInclVat } from "../src/lib/purchase-totals";

const prisma = new PrismaClient();
const ROOT = resolve(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const JOURNAL = join(INV, "corrections-journal-supplier-payments.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rbIdx = args.indexOf("--rollback");
const ROLLBACK = rbIdx >= 0 ? args[rbIdx + 1] : null;
const PAY_EPS = new Decimal("0.005");

const r2 = (d: Decimal.Value) => new Decimal(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const dateIso = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const auctionName = (s: string | null | undefined) => s?.split(/\r?\n/)[0].trim() || null;
const fmt = (d: Decimal.Value) => new Decimal(d).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

// ---------------------------------------------------------------- данные

type DocType =
  | "AUCTION_INVOICE" | "UPD" | "CALC_SHEET" | "SPECIFICATION" | "CONTRACT" | "TZ_APPENDIX"
  | "PAYMENT_PROOF" | "PAYMENT_INVOICE" | "APPROVAL_EMAIL" | "BALANCE" | "OTHER";
type DocSpec = { f: string; type: DocType; num?: string; date?: string; note: string };
type Target = { purchase: string } | { auction: string } | { none: true };
type PaySpec = {
  key: string; amount: number; paidAt: string; kind: "ADVANCE" | "PARTIAL" | "FINAL"; confirmed: boolean;
  docRef: string; notes: string; source: string; target: Target; docs: DocSpec[];
};

// fileId документов (из drive-manifest.json)
const REG = { f: "11LrdlppXk6yjQgg3LQZA47r-HeJ48ahQ", type: "OTHER" as DocType, note: "Единый реестр: таблица оплат Веллмеху (счёт — назначение — сумма — п/п от даты)" };
const LETTER_FINAL = { f: "1QTIPs-FSia6PO5XdL5Ow190DEd5POy2I", type: "APPROVAL_EMAIL" as DocType, note: "Письмо-согласование (цепочка Коношенко — Решетняк): согласование оплаты, не платёжка" };
const UPD103 = { f: "18odrQUKnISm1yniylVr5Sks3ZlPZEd93", type: "UPD" as DocType, num: "103", date: "2025-07-03", note: "УПД №103: поле «К платёжно-расчётному документу» перечисляет п/п" };

const SPECS: PaySpec[] = [
  {
    key: "Q01", amount: 79898902, paidAt: "2025-03-14", kind: "PARTIAL", confirmed: true,
    docRef: "п/п от 14.03.2025 (№33979 по УПД №78, №33980 по реестру); счёт Веллмех №37 (по реестру)",
    notes: "Промежуточный платёж по Спец. №1 к договору №2502 (партия соболя СП 03.25 + РП 03.25: один платёж на два аукциона; разнесение между аукционами в документах не названо — платёж без привязки). Сумма — письмо 13.03.2025 (согласовано Решетняком 13.03.2025) и расчёт себестоимости («Промежуточный платеж 79898902»); дата и п/п — «Единый реестр» и УПД №78 п.(5). Номер п/п расходится (УПД №78 — 33979, реестр — 33980), дата одна — 14.03.2025. Файла счёта Веллмех на эту сумму в Drive нет (в реестре «Счет 37»).",
    source: "Единый реестр (таблица оплат); УПД №78 п.(5); письмо 13.03.2025 «Закупка соболя — финальный платеж»; расчёт себестоимости Соболь (итоговый)",
    target: { none: true },
    docs: [
      REG,
      { f: "1B012EyfhP8G_yRXddMvS6jHdGkir8DFH", type: "UPD", num: "78", date: "2025-05-16", note: "УПД №78 (СП 03.25): в поле (5) п/п 33979 от 14.03.2025" },
      LETTER_FINAL,
      { f: "1T5V2EQix0hQsg0JtA9h5dgruPrSHgnSR", type: "CALC_SHEET", note: "Расчёт себестоимости соболя: «Промежуточный платеж 79898902»" },
    ],
  },
  {
    key: "Q02", amount: 11146950, paidAt: "2025-05-16", kind: "FINAL", confirmed: true,
    docRef: "п/п №45637 от 16.05.2025; счёт Веллмех №75 от 13.05.2025",
    notes: "Окончательный платёж по Спец. №1 (СП 03.25 + РП 03.25), счёт №75 от 13.05.2025. Сумма — счёт №75 и письмо 15.05.2025 (подтверждено Решетняком 15.05.2025); дата и п/п — «Единый реестр» (45637 от 16.05.2025; срок по счёту 16.05.2025). Разнесение по аукционам в документах не названо — без привязки. С платежами 34 825 000 и 79 898 902 даёт 125 870 852,00 = УПД №77 + №78.",
    source: "Единый реестр; счёт №75; письмо 15.05.2025 («Подтверждаю оплату»)",
    target: { none: true },
    docs: [
      REG,
      { f: "1Cxd10vDTjGQJPYM8E8MacODoVooZEzAy", type: "PAYMENT_INVOICE", num: "75", date: "2025-05-13", note: "Счёт Веллмех №75: окончательный платёж по Спец. №1, 11 146 950,00" },
      LETTER_FINAL,
    ],
  },
  {
    key: "Q03", amount: 10924000, paidAt: "2025-05-16", kind: "PARTIAL", confirmed: true,
    docRef: "п/п №45675 от 16.05.2025; счёт Веллмех №76 от 13.05.2025",
    notes: "Промежуточный платёж по Спец. №2 к договору №2502 (SAGA 03-25), счёт №76 от 13.05.2025. Сумма — счёт №76 в «Счета.pdf» (10 924 000,00), письмо 15.05.2025 (согласовано), «Единый реестр»; дата и п/п — реестр (45675 от 16.05.2025) и УПД №103 п.(8). Отдельный файл счёта №76 на 12 744 000 в Drive — более ранняя редакция (35% вместо 30%), с УПД №103 не сходится (24 556 500 + 11 950 000 + 10 924 000 + 1 695 778 = 49 126 278 = УПД).",
    source: "Единый реестр; Счета.pdf (счёт №76); письмо 15.05.2025; УПД №103 п.(8)",
    target: { purchase: "З-2026-0002" },
    docs: [
      REG,
      { f: "1qt1ts_j31vvX5TwLqE1mSxujwT_c9IeB", type: "PAYMENT_INVOICE", num: "76", date: "2025-05-13", note: "Сводный PDF счетов Веллмех: счёт №76 от 13.05.2025 на 10 924 000,00" },
      { f: "1kGu6I1uVFlxYunj9kc4NzYBnDCUKVFnM", type: "APPROVAL_EMAIL", note: "Письмо 15.05.2025: просят согласовать промежуточный платёж, приложен счёт №76 на 10 924 000; согласовано" },
      { f: "1OV1ntOXv0sxSLIniI2yu7ZWaTIcxrhiz", type: "APPROVAL_EMAIL", note: "То же письмо (вторая копия цепочки)" },
      UPD103,
    ],
  },
  {
    key: "Q04", amount: 1695778, paidAt: "2025-08-04", kind: "FINAL", confirmed: true,
    docRef: "п/п №60611 от 04.08.2025; счёт Веллмех №103 от 03.07.2025",
    notes: "Окончательный платёж по Спец. №2 (SAGA 03-25), счёт №103 от 03.07.2025 (срок 08.07.2025). Сумма — счёт №103; дата и п/п — «Единый реестр» (60611 от 04.08.2025). С остальными платежами по закупке = 49 126 278,00 = УПД №103.",
    source: "Единый реестр; счёт №103 от 03.07.2025",
    target: { purchase: "З-2026-0002" },
    docs: [
      REG,
      { f: "15zHh7JFmtf9E13xztKb59nvpE6AEDepN", type: "PAYMENT_INVOICE", num: "103", date: "2025-07-03", note: "Счёт Веллмех №103: окончательный платёж по Спец. №2, 1 695 778,00" },
      UPD103,
    ],
  },
  {
    key: "Q05", amount: 195404, paidAt: "2025-08-22", kind: "FINAL", confirmed: true,
    docRef: "п/п №64015 от 22.08.2025; счёт Веллмех №117 от 29.07.2025",
    notes: "Доплата по Спец. №3 (норка коричневая, КФХ Дуденко), счёт №117 от 29.07.2025. Сумма — счёт №117 и письмо 19–20.08.2025 (согласовано); дата и п/п — «Единый реестр» (64015 от 22.08.2025). Вместе с авансом 1 632 000 = 1 827 404 = УПД №124.",
    source: "Единый реестр; счёт №117; письмо 19–20.08.2025",
    target: { purchase: "З-2026-0005" },
    docs: [
      REG,
      { f: "1nSY2vAIXoHuEAx_HaLUtWYXylZf_O6LW", type: "PAYMENT_INVOICE", num: "117", date: "2025-07-29", note: "Счёт Веллмех №117: доплата по Спец. №3, 195 404,00" },
      { f: "1XDtOR-ph09YesdADsH6Z9ebcKxmA0YGl", type: "APPROVAL_EMAIL", note: "Письмо: финальная оплата 195 404 — согласовано 20.08.2025" },
      { f: "1cu0UNtpHqnzi-pvmxgJzObB6FIvlIjks", type: "UPD", num: "124", date: "2025-07-29", note: "УПД №124 на 1 827 404,00 (= аванс 1 632 000 + доплата 195 404)" },
    ],
  },
  {
    key: "Q06", amount: 1537404, paidAt: "2025-07-03", kind: "ADVANCE", confirmed: true,
    docRef: "п/п №54215 от 03.07.2025; счёт Веллмех №95 от 24.06.2025",
    notes: "Аванс по Спец. №6 (норка коричневая 150 шт + серебристо-голубая 70 шт; закупки З-2026-0006 и З-2026-0007), счёт №95 от 24.06.2025. Сумма — счёт №95, письмо 26.06–02.07.2025 (согласовано 01.07.2025); дата и п/п — «Единый реестр» (54215 от 03.07.2025). Платёж один на две закупки, разбивка в документах не названа — привязан к группе «КФХ Дуденко Л. Н.».",
    source: "Единый реестр; счёт №95; письмо 26.06–02.07.2025",
    target: { auction: "КФХ Дуденко Л. Н." },
    docs: [
      REG,
      { f: "1-40DV93U_QKgXjkgQWavmnizzNazXoKs", type: "PAYMENT_INVOICE", num: "95", date: "2025-06-24", note: "Счёт Веллмех №95: аванс по Приложению №6, 1 537 404,00" },
      { f: "1I5AlrRh6FYPaPu433gv6dF-QQN-UDhYc", type: "APPROVAL_EMAIL", note: "Цепочка писем: согласование аванса 1 537 404 (01.07.2025) и финальной оплаты 123 836 (20.08.2025)" },
    ],
  },
  {
    key: "Q07", amount: 123836, paidAt: "2025-08-26", kind: "FINAL", confirmed: true,
    docRef: "п/п №64499 от 26.08.2025; счёт Веллмех №122 от 04.08.2025",
    notes: "Доплата по Спец. №6 (З-2026-0006 + З-2026-0007), счёт №122 от 04.08.2025. Сумма — счёт №122 и письмо 19–21.08.2025 (согласовано 20.08.2025); дата и п/п — «Единый реестр» (64499 от 26.08.2025). С авансом 1 537 404 = 1 661 240 = УПД №122. Разбивка на две закупки в документах не названа — привязан к группе «КФХ Дуденко Л. Н.».",
    source: "Единый реестр; счёт №122; письмо 19–21.08.2025",
    target: { auction: "КФХ Дуденко Л. Н." },
    docs: [
      REG,
      { f: "1HZbb_cdFXNWxjNDLl3ILWoX_kS6sGE4v", type: "PAYMENT_INVOICE", num: "122", date: "2025-08-04", note: "Счёт Веллмех №122: доплата по Приложению №6, 123 836,00" },
      { f: "1I5AlrRh6FYPaPu433gv6dF-QQN-UDhYc", type: "APPROVAL_EMAIL", note: "Цепочка писем: согласование финальной оплаты 123 836 (20.08.2025)" },
      { f: "1qFTXc8jXTIPqT0C7gLKQNSO4WP6yPqi8", type: "UPD", num: "122", date: "2025-08-26", note: "УПД №122 на 1 661 240,00 (З-2026-0006 + З-2026-0007)" },
    ],
  },
  {
    key: "Q08", amount: 1718400, paidAt: "2025-06-04", kind: "ADVANCE", confirmed: true,
    docRef: "п/п №49288 от 04.06.2025; счёт Веллмех №80 от 26.05.2025",
    notes: "Оплата 100% по счёту №80 от 26.05.2025 (норка белая выделанная 179 шт, З-2026-0008). Сумма — счёт №80 и письмо 26–29.05.2025 (согласовано 28.05.2025); дата и п/п — «Единый реестр» (49288 от 04.06.2025; УПД №80 от 04.06.2025). В xlsx-копии УПД №80 назван п/п 33980 от 14.03.2025 — ошибка реквизита (в pdf-оригинале поле пусто).",
    source: "Единый реестр; счёт №80; письмо 26–29.05.2025",
    target: { purchase: "З-2026-0008" },
    docs: [
      REG,
      { f: "1SO7Vn1YWQJhOpszOJLuFnhGSxaonOvB-", type: "PAYMENT_INVOICE", num: "80", date: "2025-05-26", note: "Счёт Веллмех №80: норка белая 179 шт, 1 718 400,00" },
      { f: "1rOlrO9mwSxxN60WwQ3XZc_ZPB_3e16_O", type: "APPROVAL_EMAIL", note: "Письмо: оплата счёта №80 согласована 28.05.2025" },
      { f: "19yfmwEyPOKjWZgUIF5Te5OdgsBAJdrmM", type: "UPD", num: "80", date: "2025-06-04", note: "УПД №80 от 04.06.2025 на 1 718 400,00" },
    ],
  },
  {
    // По документам платёж есть (реестр: п/п 64014 от 22.08.2025), но оплачено станет 2 271 306,00 при стоимости закупки
    // 2 271 305,26 (УПД 2 271 305,54): переплата 0,74 ₽ — скрипт заблокирует запись (см. pending-supplier-payments.md).
    key: "Q09", amount: 1061306, paidAt: "2025-08-22", kind: "FINAL", confirmed: true,
    docRef: "п/п №64014 от 22.08.2025; счёт Веллмех №127 от 13.08.2025",
    notes: "Доплата по Приложению 5 (каракуль, SAGA 06-25), счёт №127 от 13.08.2025. Сумма — счёт №127 и письмо 19–20.08.2025 (согласовано); дата и п/п — «Единый реестр» (64014 от 22.08.2025).",
    source: "Единый реестр; счёт №127; письмо 19–20.08.2025",
    target: { purchase: "З-2026-0003" },
    docs: [
      REG,
      { f: "17phLbMUwjhVIxM_-i3MnpdodUacdny7Y", type: "PAYMENT_INVOICE", num: "127", date: "2025-08-13", note: "Счёт Веллмех №127: доплата по Приложению 5, 1 061 306,00" },
      { f: "1_a27MS-fnhoVb4Tej4anLIyKaCqEc0Lu", type: "APPROVAL_EMAIL", note: "Письмо: финальная оплата 1 061 306 — подтверждена 20.08.2025" },
    ],
  },
];

// Перепривязка существующего платежа (R01)
const REBIND = {
  key: "R01", amount: 1455842, paidAt: "2025-07-03", fromSession: null as string | null,
  toSession: "Подкладка Спец. 7 (УПД 109)",
  source: "УПД №109 п.(5): п/п №54214 от 03.07.2025 (1 455 842,00 = итог УПД); счёт №100 от 01.07.2025; Спец. №7. Закупки подкладки по УПД №109 — З-2026-0032 (часть, учтённая в ТЗ) + З-2026-0060.",
};

// ---------------------------------------------------------------- журнал

type JournalEntry = { time: string; entity: string; id: string; field: string; before: unknown; after: unknown; source: string };
const appendJournal = (entries: JournalEntry[]) => {
  if (!entries.length) return;
  const cur: JournalEntry[] = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : [];
  writeFileSync(JOURNAL, JSON.stringify(cur.concat(entries), null, 1));
};

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
    if (a) add(aucPaid, a, done); // деньги, ушедшие по закупке, учитываем и у отменённой
    if (p.status === "CANCELLED") continue;
    const t = purchaseTotalInclVat(p) as Decimal;
    purchTotal.set(p.id, t);
    if (a) add(aucTotal, a, t);
  }
  for (const x of apay) if (x.auctionSession) add(aucPaid, x.auctionSession, x.amount);
  return { purchases, byNumber, purchTotal, purchPaid, aucTotal, aucPaid };
}
type State = Awaited<ReturnType<typeof loadState>>;

// ---------------------------------------------------------------- документы

type Json = any;
const manifest: Json[] = JSON.parse(readFileSync(join(INV, "drive-manifest.json"), "utf-8"));
const manById = new Map<string, Json>(manifest.map((m) => [m.id, m]));

// ---------------------------------------------------------------- план и применение

type Planned = {
  spec: PaySpec; amount: Decimal; targetLabel: string; purchaseId: string | null; auctionSession: string | null;
  exists: boolean; blocked: string | null; docsToAdd: DocSpec[]; docsExisting: number;
};

async function main() {
  const org = await prisma.organization.findFirstOrThrow();
  const organizationId = org.id;
  const st0 = await loadState(prisma, organizationId);
  const supplierIds = new Set(st0.purchases.map((p) => p.supplierId));
  if (supplierIds.size !== 1) throw new Error("Ожидался один поставщик, найдено " + supplierIds.size);
  const supplierId = [...supplierIds][0];
  const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } });

  console.log(`${APPLY ? "ПРИМЕНЕНИЕ" : "DRY-RUN (в БД ничего не пишется)"}; поставщик ${supplier.name}; БД: ${(process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@")}`);

  // проверка документов
  for (const sp of SPECS) for (const d of sp.docs) if (!manById.has(d.f)) throw new Error(`fileId ${d.f} (${sp.key}) нет в drive-manifest.json`);

  // ---- план платежей (накопительная проверка переплаты)
  const planned: Planned[] = [];
  const paidP = new Map(st0.purchPaid);
  const paidA = new Map(st0.aucPaid);
  for (const sp of SPECS) {
    const amount = r2(sp.amount);
    let purchaseId: string | null = null;
    let auctionSession: string | null = null;
    let targetLabel = "без привязки (платёж на несколько аукционов / закупок без разбивки в документах)";
    let blocked: string | null = null;
    const t = sp.target;
    if ("purchase" in t) {
      const p = st0.byNumber.get(t.purchase);
      if (!p) { blocked = `закупка ${t.purchase} не найдена`; targetLabel = `закупка ${t.purchase}`; }
      else {
        purchaseId = p.id; targetLabel = `закупка ${p.number}`;
        const total = st0.purchTotal.get(p.id) ?? new Decimal(0);
        const paid = (paidP.get(p.id) ?? new Decimal(0)).add(amount);
        if (paid.sub(total).greaterThan(PAY_EPS)) blocked = `ПЕРЕПЛАТА: оплачено станет ${fmt(paid)} при стоимости ${fmt(total)} (+${fmt(paid.sub(total))})`;
      }
    } else if ("auction" in t) {
      auctionSession = t.auction; targetLabel = `аукцион/группа «${t.auction}»`;
      const total = st0.aucTotal.get(t.auction);
      if (!total) blocked = `в группе «${t.auction}» нет закупок`;
      else {
        const paid = (paidA.get(t.auction) ?? new Decimal(0)).add(amount);
        if (paid.sub(total).greaterThan(PAY_EPS)) blocked = `ПЕРЕПЛАТА: оплачено станет ${fmt(paid)} при стоимости ${fmt(total)} (+${fmt(paid.sub(total))})`;
      }
    }
    const key = `[fix:${sp.key}]`;
    const byKey = await prisma.payment.findFirst({ where: { organizationId, notes: { contains: key } } });
    const dup = byKey ?? (await prisma.payment.findFirst({ where: { organizationId, supplierId, amount, paidAt: dateIso(sp.paidAt), status: { not: "CANCELLED" } } }));
    const existingDocs = dup ? await prisma.driveDocument.findMany({ where: { organizationId, paymentId: dup.id } }) : [];
    const have = new Set(existingDocs.map((d) => d.driveFileId));
    planned.push({
      spec: sp, amount, targetLabel, purchaseId, auctionSession, exists: !!dup, blocked,
      docsToAdd: dup ? sp.docs.filter((d) => !have.has(d.f)) : sp.docs, docsExisting: have.size,
    });
    if (!dup && !blocked) {
      if (purchaseId) paidP.set(purchaseId, (paidP.get(purchaseId) ?? new Decimal(0)).add(amount));
      if (auctionSession) paidA.set(auctionSession, (paidA.get(auctionSession) ?? new Decimal(0)).add(amount));
    }
  }

  // ---- план перепривязки R01
  const unbound = await prisma.payment.findMany({
    where: { organizationId, supplierId, purchaseId: null, auctionSession: null, amount: r2(REBIND.amount), paidAt: dateIso(REBIND.paidAt), status: "COMPLETED" },
  });
  const already = await prisma.payment.findMany({
    where: { organizationId, supplierId, auctionSession: REBIND.toSession, amount: r2(REBIND.amount), paidAt: dateIso(REBIND.paidAt) },
  });
  let rebindNote: string;
  let rebindPayment = unbound.length === 1 ? unbound[0] : null;
  const toTotal = st0.aucTotal.get(REBIND.toSession);
  if (already.length) { rebindNote = "уже применено (платёж уже привязан к группе подкладки УПД №109)"; rebindPayment = null; }
  else if (unbound.length !== 1) rebindNote = `ПРОПУЩЕНО: непривязанных платежей 1 455 842 от 03.07.2025 найдено ${unbound.length}`;
  else if (!toTotal) { rebindNote = `ПРОПУЩЕНО: нет закупок в группе «${REBIND.toSession}» (соседний скрипт ещё не создал закупку по УПД №109)`; rebindPayment = null; }
  else {
    const paid = (st0.aucPaid.get(REBIND.toSession) ?? new Decimal(0)).add(r2(REBIND.amount));
    if (paid.sub(toTotal).greaterThan(PAY_EPS)) { rebindNote = `ПРОПУЩЕНО: переплата группы (${fmt(paid)} > ${fmt(toTotal)})`; rebindPayment = null; }
    else rebindNote = `auctionSession: ∅ → «${REBIND.toSession}» (стоимость группы ${fmt(toTotal)}, оплачено станет ${fmt(paid)})`;
  }

  // ---- печать
  console.log("\n===== ПЛАТЕЖИ ПОСТАВЩИКУ (новые) =====");
  let sumNew = new Decimal(0);
  const byYear = new Map<string, Decimal>();
  for (const p of planned) {
    const s = p.spec;
    const head = `${s.key} ${s.paidAt} ${fmt(p.amount)} ₽ ${s.kind}${s.confirmed ? "" : " (платёжка не названа)"} → ${p.targetLabel}`;
    if (p.exists) console.log(`  ✓ уже применено: ${head}${p.docsToAdd.length ? ` (не хватает документов: ${p.docsToAdd.length})` : ""}`);
    else if (p.blocked) console.log(`  ПРОПУЩЕНО: ${head}\n      причина: ${p.blocked}`);
    else {
      console.log(`  СОЗДАТЬ ${head}\n      docRef: ${s.docRef}\n      источник: ${s.source}`);
      for (const d of p.docsToAdd) console.log(`      + документ [${d.type}] ${manById.get(d.f).title.replace(/\s+/g, " ")}`);
      sumNew = sumNew.add(p.amount);
      byYear.set(s.paidAt.slice(0, 4), (byYear.get(s.paidAt.slice(0, 4)) ?? new Decimal(0)).add(p.amount));
    }
  }
  console.log("\n===== ПЕРЕПРИВЯЗКА =====");
  console.log(`  ${REBIND.key} ${REBIND.paidAt} ${fmt(REBIND.amount)} ₽: ${rebindNote}\n      источник: ${REBIND.source}`);
  console.log(`\n===== ИТОГО: новых платежей ${planned.filter((p) => !p.exists && !p.blocked).length} на ${fmt(sumNew)} ₽ (${[...byYear].map(([y, v]) => `${y}: ${fmt(v)}`).join("; ") || "—"}); пропущено ${planned.filter((p) => p.blocked && !p.exists).length}; перепривязка: ${rebindPayment ? "1" : "0"} =====`);

  if (!APPLY) { console.log("\nDRY-RUN: ничего не записано. Для применения добавьте --apply (сначала бэкап!)."); return; }

  // ---- применение: один платёж = одна транзакция
  for (const p of planned) {
    const s = p.spec;
    if (p.blocked) continue;
    const key = `[fix:${s.key}]`;
    const entries = await prisma.$transaction(async (tx) => {
      const out: JournalEntry[] = [];
      if (p.auctionSession) {
        await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${"auction-pay:" + organizationId + ":" + p.auctionSession}))) t`;
      }
      let payId: string;
      const prev = await tx.payment.findFirst({ where: { organizationId, notes: { contains: key } } })
        ?? (await tx.payment.findFirst({ where: { organizationId, supplierId, amount: p.amount, paidAt: dateIso(s.paidAt), status: { not: "CANCELLED" } } }));
      if (prev) payId = prev.id;
      else {
        // повторная проверка переплаты по живым данным
        const live = await loadState(tx, organizationId);
        if (p.purchaseId) {
          const total = live.purchTotal.get(p.purchaseId) ?? new Decimal(0);
          const paid = (live.purchPaid.get(p.purchaseId) ?? new Decimal(0)).add(p.amount);
          if (paid.sub(total).greaterThan(PAY_EPS)) { console.log(`  ПРОПУЩЕНО ${s.key}: переплата (${fmt(paid)} > ${fmt(total)})`); return out; }
        } else if (p.auctionSession) {
          const total = live.aucTotal.get(p.auctionSession) ?? new Decimal(0);
          const paid = (live.aucPaid.get(p.auctionSession) ?? new Decimal(0)).add(p.amount);
          if (paid.sub(total).greaterThan(PAY_EPS)) { console.log(`  ПРОПУЩЕНО ${s.key}: переплата (${fmt(paid)} > ${fmt(total)})`); return out; }
        }
        const pay = await tx.payment.create({
          data: {
            organizationId, supplierId, purchaseId: p.purchaseId, auctionSession: p.auctionSession, amount: p.amount, currency: "RUB",
            method: "BANK_TRANSFER", status: "COMPLETED", paidAt: dateIso(s.paidAt), kind: s.kind, docRef: s.docRef,
            confirmed: s.confirmed, notes: `${s.notes} ${key}`,
          },
        });
        payId = pay.id;
        out.push({
          time: new Date().toISOString(), entity: "Payment", id: pay.id, field: "__create__", before: null,
          after: { amount: p.amount.toFixed(2), paidAt: s.paidAt, kind: s.kind, purchaseId: p.purchaseId, auctionSession: p.auctionSession, docRef: s.docRef }, source: s.source,
        });
      }
      // документы-основания
      for (const d of s.docs) {
        const has = await tx.driveDocument.findFirst({ where: { organizationId, driveFileId: d.f, paymentId: payId } });
        if (has) continue;
        const m = manById.get(d.f);
        const row = await tx.driveDocument.create({
          data: {
            organizationId, driveFileId: d.f, title: m.title, docType: d.type, mimeType: m.mimeType ?? null,
            sizeBytes: m.size ?? null, drivePath: m.path ?? null, viewUrl: m.viewUrl ?? null,
            docDate: d.date ? dateIso(d.date) : null, docNumber: d.num ?? null, year: Number(s.paidAt.slice(0, 4)),
            notes: `${d.note}. Основание платежа ${s.key} (${s.paidAt}, ${fmt(p.amount)} ₽)`, paymentId: payId,
          },
        });
        out.push({ time: new Date().toISOString(), entity: "DriveDocument", id: row.id, field: "__create__", before: null, after: { driveFileId: d.f, paymentId: payId, docType: d.type }, source: s.source });
      }
      return out;
    });
    appendJournal(entries);
    console.log(`  ${s.key}: записей в журнале ${entries.length}`);
  }

  if (rebindPayment) {
    const entries = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${"auction-pay:" + organizationId + ":" + REBIND.toSession}))) t`;
      const cur = await tx.payment.findUniqueOrThrow({ where: { id: rebindPayment!.id } });
      if (cur.purchaseId || cur.auctionSession) { console.log("  R01: платёж уже изменён — пропуск"); return [] as JournalEntry[]; }
      const live = await loadState(tx, organizationId);
      const total = live.aucTotal.get(REBIND.toSession);
      if (!total || (live.aucPaid.get(REBIND.toSession) ?? new Decimal(0)).add(cur.amount).sub(total).greaterThan(PAY_EPS)) { console.log("  R01: переплата/нет группы — пропуск"); return [] as JournalEntry[]; }
      await tx.payment.update({
        where: { id: cur.id },
        data: { auctionSession: REBIND.toSession, notes: `${cur.notes ?? ""} [fix:R01] Привязан к закупкам подкладки по УПД №109 (группа «${REBIND.toSession}»): УПД №109 п.(5) — п/п №54214 от 03.07.2025, итог УПД = 1 455 842,00.`.trim() },
      });
      return [
        { time: new Date().toISOString(), entity: "Payment", id: cur.id, field: "auctionSession", before: null, after: REBIND.toSession, source: REBIND.source },
        { time: new Date().toISOString(), entity: "Payment", id: cur.id, field: "notes", before: cur.notes, after: "(добавлена метка [fix:R01])", source: REBIND.source },
      ] as JournalEntry[];
    });
    appendJournal(entries);
    console.log(`  R01: записей в журнале ${entries.length}`);
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
  for (const e of [...entries].reverse().filter((x) => x.entity === "Payment" && x.field === "auctionSession")) {
    const cur = await prisma.payment.findUnique({ where: { id: e.id } });
    if (!cur) continue;
    if (cur.auctionSession !== e.after) { console.log(`  Payment ${e.id}: auctionSession изменён после применения — не трогаю`); continue; }
    const notes = (cur.notes ?? "").replace(/\s*\[fix:R01\][^\n]*$/, "");
    await prisma.payment.update({ where: { id: e.id }, data: { auctionSession: e.before as string | null, notes } });
    console.log(`  Payment ${e.id}: auctionSession «${e.after}» → ${e.before === null ? "∅" : e.before}`);
  }
  const rp = await prisma.payment.deleteMany({ where: { id: { in: pays.map((e) => e.id) } } });
  console.log(`  Payment удалено ${rp.count}`);
}

(ROLLBACK ? rollback(ROLLBACK) : main())
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
