/**
 * Сведение оплат с реестром списаний «Оплаты.xls» (ММ → Веллмех, 28.02.2025 – 05.10.2026, 67 п/п) — ПРЕДЛОЖЕНИЕ от 19.10.2026, НЕ ПРИМЕНЕНО.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-payments-match-2026-10-19.ts                    # пробный прогон (БД не меняется), таблица «платёж / что меняется / было → стало / основание»
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-payments-match-2026-10-19.ts --apply            # применить на НЕ боевой базе (копия, scratch)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-payments-match-2026-10-19.ts --apply --live     # применить на боевой базе fur_erp (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-payments-match-2026-10-19.ts --rollback [--apply [--live]]
 *
 * ИСТОЧНИК: «Оплаты.xls» (реестр списаний с расчётного счёта ММ; колонки: дата, списание, вх. номер = номер п/п, контрагент, договор, назначение платежа).
 * Сверка по номеру п/п + дате + сумме с Payment (оплаты сырья) и ProductionPayment (оплаты работы). Из 67 п/п 53 уже в базе целиком; скрипт приводит базу к реестру:
 *   1) подтверждает два платежа поставщику «по указанию владельца без п/п»: счёт №253 (п/п 63545, дата в базе 15.09 → по банку 17.09.2026) и счёт №271 (п/п 65361, 05.10 → 01.10.2026);
 *   2) дописывает номер п/п авансам по счетам №141 (51834) и №143 (51835) от 06.07.2026 и переводит их подтверждение с «писем» на банк;
 *   3) п/п 22618 (счёт №1, 21.01.2026): сумма по банку 2 081 387,54, в базе 2 075 122,54 — поднимает оплату производства на 6 265,00 (К2);
 *   4) заводит 10 п/п оплаты работы по договору подряда №1605, которых нет в базе (на 20 465 460,00): счета №121, 207, 237, 247, 251, 257, 259, 261, 265, 275;
 *      платежи с названной в письмах партией (121→14, 207→17, 237→18, 257→19, 265→20, 275→21) привязаны к ТЗ партии и разнесены автоматически (как в приложении:
 *      пропорционально остатку работы, не больше остатка); авансы №247/№251/№259/№261 — без ТЗ (ТЗ на эти изделия в базе ещё нет): «неразнесённый аванс».
 * НЕ ВНОСИТ (решения владельца): четыре п/п 2502 «не сырьё» — 81455 (27 960,00), 83556 (24 500,00), 30413 (19 600,00), 48847 (416 570,10 = УПД №171): в базе нет закупок-документов,
 *   платёж без документа уменьшил бы долг поставщику (инвариант «долг = документы − оплаты»); аванс 60610 (21 627 900,00, «2502» в банке, пошив по назначению) в базе уже есть как оплата производства.
 * БЕЗОПАСНОСТЬ: всё в одной транзакции; ДО/ПОСЛЕ считаются долг поставщику (не должен меняться), работа по ТЗ (не меняется) и долг по работе (меняется ровно на новые п/п); отклонение — откат без записи.
 * Идемпотентно (п/п уже есть в базе — пропуск; метка [pay-match:2026-10-19] в notes). Журнал: docs-inventory/corrections-journal-payments-match-2026-10-19.json (для копии — с суффиксом имени базы).
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
import { randomBytes } from "crypto";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const LIVE = process.argv.includes("--live");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const TAG = "[pay-match:2026-10-19]";
const SRC = "реестр списаний ММ → Веллмех «Оплаты.xls» (19.10.2026)";

class DryRun extends Error {}
const cid = () => "c" + randomBytes(12).toString("hex");
const rub = (v: number | string) => Number(v).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ddmmyyyy = (iso: string) => iso.split("-").reverse().join(".");

/** Все 67 строк «Оплаты.xls»: [строка листа, п/п, дата, сумма, договор по колонке «Договор»]. */
const FILE_ROWS: [number, string, string, string, "2502" | "1605"][] = [
  [2, '440', '2025-02-28', '34825000.00', '2502'],
  [3, '33979', '2025-03-14', '24556500.00', '2502'],
  [4, '33980', '2025-03-14', '79898902.00', '2502'],
  [5, '36343', '2025-03-26', '11950000.00', '2502'],
  [6, '45675', '2025-05-16', '10924000.00', '2502'],
  [7, '45637', '2025-05-16', '11146950.00', '2502'],
  [8, '48466', '2025-05-30', '1632000.00', '2502'],
  [9, '49288', '2025-06-04', '1718400.00', '2502'],
  [10, '51723', '2025-06-19', '1210000.00', '2502'],
  [11, '53423', '2025-06-27', '30666300.00', '2502'],
  [12, '54214', '2025-07-03', '1455842.00', '2502'],
  [13, '54215', '2025-07-03', '1537404.00', '2502'],
  [14, '56327', '2025-07-15', '2000000.00', '2502'],
  [15, '60611', '2025-08-04', '1695778.00', '2502'],
  [16, '60610', '2025-08-04', '21627900.00', '2502'],
  [17, '64015', '2025-08-22', '195404.00', '2502'],
  [18, '64014', '2025-08-22', '1061306.00', '2502'],
  [19, '64499', '2025-08-26', '123836.00', '2502'],
  [20, '70941', '2025-10-01', '2533779.20', '2502'],
  [21, '71143', '2025-10-02', '1866490.00', '1605'],
  [22, '73674', '2025-10-15', '1208570.00', '1605'],
  [23, '74972', '2025-10-22', '2081360.00', '1605'],
  [24, '80511', '2025-11-20', '1759800.00', '1605'],
  [25, '81455', '2025-11-25', '27960.00', '2502'],
  [26, '82173', '2025-11-27', '1766870.00', '1605'],
  [27, '83556', '2025-12-04', '24500.00', '2502'],
  [28, '87386', '2025-12-22', '5669120.00', '1605'],
  [29, '88105', '2025-12-24', '4836327.52', '2502'],
  [30, '88911', '2025-12-26', '946870.00', '1605'],
  [31, '22618', '2026-01-21', '2081387.54', '1605'],
  [32, '26829', '2026-02-11', '427227.39', '1605'],
  [33, '29370', '2026-02-25', '303372.00', '1605'],
  [34, '30413', '2026-03-02', '19600.00', '2502'],
  [35, '30903', '2026-03-04', '347895.00', '1605'],
  [36, '32580', '2026-03-12', '1183135.00', '1605'],
  [37, '36054', '2026-03-30', '24200000.00', '2502'],
  [38, '38692', '2026-04-13', '22891800.00', '2502'],
  [39, '40308', '2026-04-21', '183400.00', '1605'],
  [40, '40307', '2026-04-21', '217350.00', '1605'],
  [41, '40593', '2026-04-22', '27912500.00', '2502'],
  [42, '43831', '2026-05-12', '60271506.34', '2502'],
  [43, '46540', '2026-05-28', '19628147.54', '2502'],
  [44, '46538', '2026-05-28', '30660000.00', '2502'],
  [45, '46539', '2026-05-28', '761250.00', '2502'],
  [46, '46523', '2026-05-28', '218860.00', '1605'],
  [47, '46537', '2026-05-28', '248000.00', '1605'],
  [48, '46963', '2026-06-01', '5400000.00', '2502'],
  [49, '47668', '2026-06-04', '2466573.00', '2502'],
  [50, '48642', '2026-06-11', '85063078.00', '2502'],
  [51, '48847', '2026-06-15', '416570.10', '2502'],
  [52, '51258', '2026-07-01', '19870.00', '2502'],
  [53, '51835', '2026-07-06', '3230780.00', '1605'],
  [54, '51834', '2026-07-06', '11860870.00', '1605'],
  [55, '53718', '2026-07-20', '2380500.00', '2502'],
  [56, '53717', '2026-07-20', '7236812.03', '2502'],
  [57, '58172', '2026-08-14', '158600.00', '1605'],
  [58, '58171', '2026-08-14', '71400.00', '1605'],
  [59, '61001', '2026-09-02', '3397795.00', '1605'],
  [60, '61929', '2026-09-08', '8290940.00', '1605'],
  [61, '61785', '2026-09-08', '2272060.00', '1605'],
  [62, '63545', '2026-09-17', '214522.92', '2502'],
  [63, '63603', '2026-09-18', '805000.00', '1605'],
  [64, '63604', '2026-09-18', '1008000.00', '1605'],
  [65, '64286', '2026-09-23', '2126255.00', '1605'],
  [66, '65109', '2026-09-29', '1892430.00', '1605'],
  [67, '65361', '2026-10-01', '60831100.00', '2502'],
  [68, '65857', '2026-10-05', '442980.00', '1605']
];

/** Четыре п/п 2502 вне сырья: в базе нет закупок-документов, не вносятся (список владельцу). */
const NOT_ENTERED: Record<string, string> = {
  "81455": "УПД №201 от 06.11.2025 «чески для меха» — не сырьё, закупки нет",
  "83556": "УПД №217 от 01.12.2025 «брелок из хвоста соболя» — не сырьё, закупки нет",
  "30413": "УПД №237 от 12.12.2025 «брелки из хвоста соболя» — не сырьё, закупки нет",
  "48847": "УПД/счёт №171 от 02.06.2026 «доп. услуги по спецификации №14» — закупки нет",
};

type NewPP = { pp: string; date: string; amount: string; inv: string; invDate: string; type: "ADVANCE" | "PARTIAL"; batch: number | null; row: number; text: string };
const NEW_PP: NewPP[] = [
  { pp: "58172", date: "2026-08-14", amount: "158600.00", inv: "121", invDate: "24.06.2026", type: "PARTIAL", batch: 14, row: 57, text: "Оплата за пошив мех. изделий, партия 14 (ТЗ 113–115): 158 600 = вся работа партии. В письме Веллмех от 16.07.2026 счёт №121 назван исправленным до 47 580 (30%) — по банку ушло 158 600 (см. список «решения»)." },
  { pp: "58171", date: "2026-08-14", amount: "71400.00", inv: "207", invDate: "07.07.2026", type: "PARTIAL", batch: 17, row: 58, text: "Доплата за пошив, партия 17 (ТЗ 118): 71 400 = 30% работы 238 000 (аванс 70% = 166 600 уже разнесён по счёту №143). В банковском назначении счёт №207 от 07.07.2026, в приложенном счёте — 16.07.2026." },
  { pp: "61001", date: "2026-09-02", amount: "3397795.00", inv: "237", invDate: "25.08.2026", type: "PARTIAL", batch: 18, row: 59, text: "Оплата за пошив, партия 18 (ТЗ 119–135), счёт №237 от 25.08.2026 (письма: «поставим на исполнение 02 или 03.09»). Больше остатка работы партии на сумму сырья подрядчика ТЗ 121 (880 000 по З-2026-0001) и разницу в расчёте — не разнесено, остаётся неразнесённым авансом до решения владельца." },
  { pp: "61929", date: "2026-09-08", amount: "8290940.00", inv: "251", invDate: "02.09.2026", type: "ADVANCE", batch: null, row: 60, text: "Аванс 3 (счёт №251 от 02.09.2026, «аванс 3, 55 изд.» по письмам Веллмех/Коношенко 03.09.2026): ТЗ на эти изделия в базе ещё нет — не разнесён." },
  { pp: "61785", date: "2026-09-08", amount: "2272060.00", inv: "247", invDate: "01.09.2026", type: "ADVANCE", batch: null, row: 61, text: "Аванс 2 (счёт №247 от 01.09.2026, «аванс 2, 26 изд.» по письмам 03.09.2026): ТЗ на эти изделия в базе ещё нет — не разнесён." },
  { pp: "63603", date: "2026-09-18", amount: "805000.00", inv: "261", invDate: "15.09.2026", type: "ADVANCE", batch: null, row: 63, text: "Дозаказ по счёту №261 от 15.09.2026 (красная лиса, 10 × М029, письмо Киржнера 17.09.2026): ТЗ на дозаказ в базе нет — не разнесён." },
  { pp: "63604", date: "2026-09-18", amount: "1008000.00", inv: "259", invDate: "15.09.2026", type: "ADVANCE", batch: null, row: 64, text: "Дозаказ по счёту №259 от 15.09.2026 (арктическая лиса, 6 × М001Е, письмо Киржнера 17.09.2026): ТЗ на дозаказ в базе нет — не разнесён." },
  { pp: "64286", date: "2026-09-23", amount: "2126255.00", inv: "257", invDate: "15.09.2026", type: "PARTIAL", batch: 19, row: 65, text: "Доплата за пошив, партия 19 (ТЗ 136–151), счёт №257 от 15.09.2026 (на 6 685 меньше 30% — старая цена ТЗ 146)." },
  { pp: "65109", date: "2026-09-29", amount: "1892430.00", inv: "265", invDate: "22.09.2026", type: "PARTIAL", batch: 20, row: 66, text: "Доплата за пошив, партия 20 (ТЗ 152–162), счёт №265 от 22.09.2026 (в письмах — занижен; в состав входит сырьё подрядчика ТЗ 158 — 528 000)." },
  { pp: "65857", date: "2026-10-05", amount: "442980.00", inv: "275", invDate: "01.10.2026", type: "PARTIAL", batch: 21, row: 68, text: "Доплата за пошив, партия 21 (ТЗ 163–168), счёт №275 от 01.10.2026 = 30% × 1 476 600." },
];

type Upd = { table: "Payment" | "ProductionPayment"; id: string; before: Record<string, unknown>; after: Record<string, unknown> };
type Journal = { script: string; status: "applied" | "rolled-back"; at: string; db: string; created: { payments: string[]; links: string[]; allocations: string[]; supplierPayments?: string[] }; updates: Upd[] };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { planAutoAllocations, orderWorkCents, loadClientDebt, AUTO_NOTE } = await import("../src/lib/payment-alloc");
  const { loadSupplierDebt } = await import("../src/lib/supplier-debt");
  const { purchaseTotalInclVat } = await import("../src/lib/purchase-totals");
  const { checkAllocation, fromCents, toCents } = await import("../src/lib/payment-alloc-core");
  const url = process.env.DATABASE_URL ?? "";
  const dbName = url.split("?")[0].split("/").pop() ?? "";
  const isLive = dbName === "fur_erp";
  if (APPLY && isLive && !LIVE) throw new Error(`База «${dbName}» боевая: для записи нужен --live (для репетиции укажите копию через DATABASE_URL).`);
  if (APPLY && !isLive && LIVE) throw new Error(`--live указан, но DATABASE_URL смотрит на «${dbName}», а не на fur_erp.`);
  const prisma = createAuditedClient("script:apply-payments-match-2026-10-19");
  const JOURNAL = join(INV, `corrections-journal-payments-match-2026-10-19${isLive ? "" : `-${dbName}`}.json`);
  const org = (await prisma.organization.findFirst({ select: { id: true } }))!.id;

  // ───────── откат
  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат (${dbName}): платежей ${j.created.payments.length}, связей ${j.created.links.length}, разнесений ${j.created.allocations.length}, правок строк ${j.updates.length}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        await tx.paymentAllocation.deleteMany({ where: { id: { in: j.created.allocations } } });
        await tx.productionPaymentOrder.deleteMany({ where: { id: { in: j.created.links } } });
        await tx.productionPayment.deleteMany({ where: { id: { in: j.created.payments } } });
        await tx.payment.deleteMany({ where: { id: { in: j.created.supplierPayments ?? [] } } });
        for (const u of j.updates) {
          const t = (u.table === "Payment" ? tx.payment : tx.productionPayment) as unknown as { findUnique: (a: unknown) => Promise<Record<string, unknown> | null>; update: (a: unknown) => Promise<unknown> };
          const cur = await t.findUnique({ where: { id: u.id } });
          if (!cur) continue;
          // откатываем поля, которые сейчас равны записанным «после» (чужие правки позже не затираем)
          const data: Record<string, unknown> = {};
          for (const k of Object.keys(u.before)) {
            const now = cur[k] instanceof Date ? (cur[k] as Date).toISOString() : cur[k] != null && typeof cur[k] === "object" ? String(cur[k]) : cur[k];
            if (JSON.stringify(now ?? null) === JSON.stringify(u.after[k] ?? null)) data[k] = k === "paidAt" || k === "confirmedAt" ? (u.before[k] ? new Date(String(u.before[k])) : null) : u.before[k];
          }
          if (Object.keys(data).length) await t.update({ where: { id: u.id }, data });
        }
      }, { timeout: 120000, maxWait: 15000 });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  const created: Journal["created"] & { supplierPayments: string[] } = { payments: [], links: [], allocations: [], supplierPayments: [] };
  const updates: Upd[] = [];
  const table: string[][] = [];
  const problems: string[] = [];
  const num = (v: unknown) => Number(String(v));
  const now = new Date();

  const run = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    created.supplierPayments.length = 0; created.payments.length = 0; created.links.length = 0; created.allocations.length = 0; updates.length = 0; table.length = 0; problems.length = 0;
    const snap = async () => {
      const sd = await loadSupplierDebt(tx as never, org, "all");
      const cd = await loadClientDebt(tx, org, { year: "all" });
      const sumP = (await tx.payment.aggregate({ where: { organizationId: org }, _sum: { amount: true } }))._sum.amount ?? 0;
      const sumPP = (await tx.productionPayment.aggregate({ where: { organizationId: org }, _sum: { amount: true } }))._sum.amount ?? 0;
      return { supplierDebt: sd.debt.toNumber(), work: cd.work, workPaid: cd.paid, workBalance: cd.balance, unallocated: cd.unallocated, hides: cd.hides, allocated: cd.allocated, sumP: num(sumP), sumPP: num(sumPP) };
    };
    const before = await snap();

    const pays = await tx.payment.findMany({ where: { organizationId: org }, select: { id: true, amount: true, paidAt: true, ppNo: true, invoiceNo: true, docRef: true, notes: true, confirmed: true, confirmedAt: true, confirmedBy: true } });
    const pps = await tx.productionPayment.findMany({ where: { organizationId: org }, select: { id: true, amount: true, paidAt: true, ppNo: true, invoiceNo: true, docRef: true, notes: true, confirmed: true, confirmedAt: true, confirmedBy: true, clientId: true, contractorId: true } });
    const anchor = pps.find((p) => p.ppNo === "82173" && p.clientId && p.contractorId);
    if (!anchor) throw new Error("Не найден платёж п/п 82173 (ожидалась боевая база или её копия)");
    const clientId = anchor.clientId!, contractorId = anchor.contractorId!;
    const file = new Map(FILE_ROWS.map((r) => [r[1], r]));

    // ---- 1) Payment №253 и №271: п/п, дата по банку, подтверждение
    const supplierFix: { pp: string; inv: string; amount: string; date: string; row: number; why: string }[] = [
      { pp: "63545", inv: "253", amount: "214522.92", date: "2026-09-17", row: 62, why: "счёт №253 от 09.09.2026 «за шкурки норки» (AME 05.26): остаток после зачётов SAGA 03.26 (83 875,37) и подкладки (55 594,50)" },
      { pp: "65361", inv: "271", amount: "60831100.00", date: "2026-10-01", row: 67, why: "счёт №271 от 30.09.2026 «за товар» (СП 09.26), аванс" },
    ];
    for (const s of supplierFix) {
      const cur = pays.find((p) => !p.ppNo && p.invoiceNo === s.inv && Math.abs(num(p.amount) - Number(s.amount)) < 0.005);
      const done = pays.find((p) => p.ppNo === s.pp);
      if (!cur) { if (done) table.push([`п/п ${s.pp} · ${ddmmyyyy(s.date)} · ${rub(s.amount)}`, "п/п, дата, подтверждение", "уже внесено", `Оплаты.xls, строка ${s.row}`]); else problems.push(`п/п ${s.pp}: не найден платёж по счёту №${s.inv} на ${rub(s.amount)} без п/п`); continue; }
      const dd = ddmmyyyy(s.date);
      const note = `${TAG} п/п №${s.pp} от ${dd} найден в реестре списаний (${SRC}, строка ${s.row}): ${s.why}. Было: дата ${cur.paidAt.toISOString().slice(0, 10)}, «по указанию владельца 08.10.2026, п/п нет».`;
      const after = {
        ppNo: s.pp, paidAt: new Date(`${s.date}T00:00:00.000Z`), confirmed: true, confirmedAt: now,
        confirmedBy: `${SRC}: п/п №${s.pp} от ${dd}, ${rub(s.amount)} ₽, счёт №${s.inv}`,
        docRef: `п/п №${s.pp} от ${dd}; счёт Веллмех №${s.inv}`, notes: `${cur.notes ?? ""}\n${note}`,
      };
      updates.push({ table: "Payment", id: cur.id, before: { ppNo: cur.ppNo, paidAt: cur.paidAt.toISOString(), confirmed: cur.confirmed, confirmedAt: cur.confirmedAt?.toISOString() ?? null, confirmedBy: cur.confirmedBy, docRef: cur.docRef, notes: cur.notes }, after: { ...after, paidAt: after.paidAt.toISOString(), confirmedAt: now.toISOString() } });
      await tx.payment.update({ where: { id: cur.id }, data: after });
      table.push([`п/п ${s.pp} · счёт №${s.inv} · ${rub(s.amount)} (оплата сырья)`, "п/п, дата, подтверждение", `п/п —, ${cur.paidAt.toISOString().slice(0, 10)}, не подтв. → п/п ${s.pp}, ${s.date}, подтв. выпиской`, `Оплаты.xls, строка ${s.row}: ${s.why}`]);
    }

    // ---- 2) ProductionPayment №141 / №143: п/п и подтверждение банком
    for (const f of [{ pp: "51834", inv: "141", amount: "11860870.00", row: 54, what: "аванс 70% за 82 изделия «в работе»" }, { pp: "51835", inv: "143", amount: "3230780.00", row: 53, what: "аванс 70% за пошив аксессуаров (245 шт.)" }]) {
      const cur = pps.find((p) => !p.ppNo && p.invoiceNo === f.inv && Math.abs(num(p.amount) - Number(f.amount)) < 0.005);
      const done = pps.find((p) => p.ppNo === f.pp);
      if (!cur) { if (done) table.push([`п/п ${f.pp} · счёт №${f.inv}`, "п/п, подтверждение", "уже внесено", `Оплаты.xls, строка ${f.row}`]); else problems.push(`п/п ${f.pp}: не найден платёж по счёту №${f.inv}`); continue; }
      const after = {
        ppNo: f.pp, docRef: `п/п №${f.pp} от 06.07.2026; ${cur.docRef ?? `Счёт №${f.inv} от 15.05.2026`}`, confirmedAt: now,
        confirmedBy: `${SRC}: п/п №${f.pp} от 06.07.2026, ${rub(f.amount)} ₽, счёт №${f.inv} (раньше — письма Василия и Коношенко 01.09.2026, п/п не было)`,
        notes: `${cur.notes ?? ""}\n${TAG} п/п №${f.pp} от 06.07.2026 найден в реестре списаний (${SRC}, строка ${f.row}); дата и сумма совпали.`,
      };
      updates.push({ table: "ProductionPayment", id: cur.id, before: { ppNo: cur.ppNo, docRef: cur.docRef, confirmedAt: cur.confirmedAt?.toISOString() ?? null, confirmedBy: cur.confirmedBy, notes: cur.notes }, after: { ...after, confirmedAt: now.toISOString() } });
      await tx.productionPayment.update({ where: { id: cur.id }, data: after });
      table.push([`п/п ${f.pp} · счёт №${f.inv} · ${rub(f.amount)} (${f.what})`, "п/п, подтверждение", "п/п —, подтв. письмами → п/п " + f.pp + ", подтв. выпиской", `Оплаты.xls, строка ${f.row}`]);
    }

    // ---- 3) п/п 22618: сумма по банку
    {
      const pay22 = pays.find((p) => p.ppNo === "22618");
      const cur = pps.find((p) => !p.ppNo && p.invoiceNo === "1" && Math.abs(num(p.amount) - 1147622.54) < 0.005);
      const done = pps.find((p) => p.ppNo === "22618");
      if (!cur) { if (done) table.push(["п/п 22618 · счёт №1", "сумма", "уже внесено", "Оплаты.xls, строка 31"]); else problems.push("п/п 22618: не найдена оплата производства по счёту №1 на 1 147 622,54"); }
      else if (!pay22 || Math.abs(num(pay22.amount) - 927500) > 0.005) problems.push("п/п 22618: часть «сырьё подрядчика» 927 500 в Payment не найдена");
      else {
        const total = 1147622.54 + 927500;
        const diff = 2081387.54 - total; // 6 265,00
        if (Math.abs(diff - 6265) > 0.005) problems.push(`п/п 22618: разница с банком ${rub(diff)} вместо 6 265,00`);
        const p12 = await tx.purchase.findFirst({ where: { organizationId: org, number: "З-2026-0012" }, include: { items: true, expenses: true } });
        const t12 = p12 ? purchaseTotalInclVat(p12).toNumber() : 0;
        const moveFondue = !!p12 && Math.abs(t12 - 942900) < 1 && Math.abs(num(pay22.amount) - 927500) < 0.005;
        if (moveFondue) {
          const nn = `${pay22.notes ?? ""}\n${TAG} Сырьё подрядчика по цене 13 470 за шкуру (ТЗ 79): 927 500,00 → 942 900,00; 15 400,00 перенесены из оплаты производства п/п 22618.`;
          await tx.payment.update({ where: { id: pay22.id }, data: { amount: "942900.00", notes: nn } });
          updates.push({ table: "Payment", id: pay22.id, before: { amount: "927500.00", notes: pay22.notes }, after: { amount: "942900.00", notes: nn } });
          table.push(["п/п 22618 · часть «сырьё подрядчика» (З-2026-0012)", "сумма", "927 500,00 → 942 900,00 (фондю 13 470; −15 400,00 в оплате производства)", "решение владельца по цене фондю"]);
        } else table.push(["п/п 22618 · фондю 13 470", "перенос 15 400,00", "пропуск: З-2026-0012 ещё не пересчитана по 13 470 (сначала apply-tz-owner-answers --fondue-price)", "—"]);
        const newAmount = (num(cur.amount) + diff - (moveFondue ? 15400 : 0)).toFixed(2);
        const after = {
          amount: newAmount, ppNo: "22618", docRef: `п/п №22618 от 21.01.2026; ${cur.docRef ?? "Счёт №1 от 15.01.2026"}`, confirmedAt: now,
          confirmedBy: `${SRC}: п/п №22618 от 21.01.2026, 2 081 387,54 ₽ (927 500,00 — сырьё подрядчика ТЗ 79 по З-2026-0012 + ${rub(newAmount)} — работа)`,
          notes: `${cur.notes ?? ""}\n${TAG} Сумма п/п №22618 по банку 2 081 387,54 (${SRC}, строка 31); в базе было 2 075 122,54 = 927 500,00 + ${rub(cur.amount.toString())}. Сумма платежа поднята на ${rub(diff)} (К2 в OPEN-QUESTIONS); распределение этих ${rub(diff)} по партиям документы не называют — не разнесено.`,
        };
        updates.push({ table: "ProductionPayment", id: cur.id, before: { amount: num(cur.amount).toFixed(2), ppNo: null, docRef: cur.docRef, confirmedAt: cur.confirmedAt?.toISOString() ?? null, confirmedBy: cur.confirmedBy, notes: cur.notes }, after: { ...after, confirmedAt: now.toISOString() } });
        await tx.productionPayment.update({ where: { id: cur.id }, data: after });
        table.push([`п/п 22618 · счёт №1 · 2 081 387,54 (доплата, партия 7, с сырьём подрядчика)`, "сумма, п/п", `${rub(cur.amount.toString())} → ${rub(newAmount)} (в паре с 927 500,00 по З-2026-0012 = банк)`, "Оплаты.xls, строка 31; К2"]);
      }
    }

    // ---- 4) новые оплаты работы (договор подряда №1605)
    const ordsRaw = await tx.productionOrder.findMany({
      where: { organizationId: org, status: { not: "CANCELLED" } },
      select: { id: true, number: true, workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, clientId: true, batch: { select: { number: true } } },
    });
    const workOf = (o: (typeof ordsRaw)[number]) => orderWorkCents({ status: o.status, plannedQuantity: o.plannedQuantity, producedQuantity: o.producedQuantity, clientWorkPricePerUnit: o.clientWorkPricePerUnit });
    const used = new Map<string, number>();
    for (const a of await tx.paymentAllocation.findMany({ where: { organizationId: org, productionPayment: { status: { not: "CANCELLED" } } }, select: { productionOrderId: true, amount: true } })) used.set(a.productionOrderId, (used.get(a.productionOrderId) ?? 0) + toCents(a.amount));
    const newRows: { n: NewPP; id: string; set: typeof ordsRaw }[] = [];
    for (const n of NEW_PP.sort((a, b) => a.date.localeCompare(b.date) || a.pp.localeCompare(b.pp))) {
      const fr = file.get(n.pp);
      if (!fr || Math.abs(Number(fr[3]) - Number(n.amount)) > 0.005 || fr[2] !== n.date) { problems.push(`п/п ${n.pp}: не совпадает со строкой реестра`); continue; }
      if (pps.some((p) => p.ppNo === n.pp)) { table.push([`п/п ${n.pp} · счёт №${n.inv} · ${rub(n.amount)}`, "новая оплата работы", "уже есть в базе (пропуск)", `Оплаты.xls, строка ${n.row}`]); continue; }
      const set = n.batch == null ? [] : ordsRaw.filter((o) => o.batch?.number === n.batch);
      if (n.batch != null && set.length === 0) { problems.push(`п/п ${n.pp}: в партии ${n.batch} нет ТЗ`); continue; }
      const id = cid();
      const dd = ddmmyyyy(n.date);
      await tx.productionPayment.create({
        data: {
          id, organizationId: org, clientId, contractorId, amount: n.pp === "61001" ? "2517795.00" : n.amount, method: "BANK_TRANSFER", status: "COMPLETED", paidAt: new Date(`${n.date}T00:00:00.000Z`),
          paymentType: n.type, confirmed: true, confirmedAt: now, ppNo: n.pp, invoiceNo: n.inv,
          confirmedBy: `${SRC}: п/п №${n.pp} от ${dd}, ${rub(n.amount)} ₽, счёт №${n.inv}`,
          docRef: `п/п №${n.pp} от ${dd}; Счёт №${n.inv} от ${n.invDate}`,
          notes: `${n.text}\nПодтверждено: п/п №${n.pp} от ${dd} в ${SRC}, строка ${n.row}, договор подряда №1605. ${TAG}`,
        },
      });
      created.payments.push(id);
      if (n.pp === "61001") {
        const p59 = await tx.purchase.findFirst({ where: { organizationId: org, number: "З-2026-0059" }, select: { id: true, supplierId: true, auctionSession: true } });
        if (!p59) problems.push("п/п 61001: закупка З-2026-0059 (УПД №209) не найдена");
        else {
          const sid = randomBytes(12).toString("hex");
          await tx.payment.create({ data: { id: "c" + sid, organizationId: org, supplierId: p59.supplierId, purchaseId: p59.id, amount: "880000.00", status: "COMPLETED", paidAt: new Date(`${n.date}T00:00:00.000Z`), kind: "PARTIAL", confirmed: true, confirmedAt: now, ppNo: n.pp, invoiceNo: n.inv, confirmedBy: `${SRC}: п/п №${n.pp} от ${dd}, ${rub(n.amount)} ₽ (в том числе 880 000,00 — шкуры красной лисы подрядчика, ТЗ 121)`, docRef: `п/п №${n.pp} от ${dd}; Счёт №${n.inv} от ${n.invDate}`, notes: `Шкуры красной лисы подрядчика (55 шт. × 16 000, ТЗ 121) в составе п/п №${n.pp} по счёту №${n.inv}: относятся к УПД/счёту №209 (З-2026-0059). ${TAG}` } });
          created.supplierPayments.push("c" + sid);
          table.push([`п/п 61001 · часть 880 000,00 (оплата сырья)`, "оплата закупки З-2026-0059 (УПД №209)", "нет → есть; долг по УПД №209 1 408 000,00 → 528 000,00", "письмо координатора: шкуры ТЗ 121 входят в счёт №237"]);
        }
      }
      if (set.length) {
        const links = set.map((o) => ({ id: cid(), productionPaymentId: id, productionOrderId: o.id }));
        await tx.productionPaymentOrder.createMany({ data: links });
        for (const l of links) created.links.push(l.id);
      }
      newRows.push({ n, id, set });
    }
    const plan = planAutoAllocations(
      newRows.map((r) => ({ id: r.id, amountCents: toCents(r.n.pp === "61001" ? "2517795.00" : r.n.amount), paidAt: new Date(`${r.n.date}T00:00:00.000Z`).getTime(), createdAt: now.getTime(), linkedOrderIds: r.set.map((o) => o.id) })),
      new Map(ordsRaw.map((o) => [o.id, { id: o.id, workCents: workOf(o), live: true }])),
      used,
    );
    for (const r of plan) {
      const nr = newRows.find((x) => x.id === r.paymentId)!;
      const err = checkAllocation(toCents(nr.n.pp === "61001" ? "2517795.00" : nr.n.amount), r.lines);
      if (err) problems.push(`п/п ${nr.n.pp}: ${err}`);
      const arows = r.lines.map((l) => ({ id: cid(), organizationId: org, productionPaymentId: r.paymentId, productionOrderId: l.orderId, amount: fromCents(l.amountCents), source: "AUTO" as const, note: `${AUTO_NOTE} ${TAG}` }));
      if (arows.length) await tx.paymentAllocation.createMany({ data: arows });
      for (const a of arows) created.allocations.push(a.id);
      const alloc = r.lines.reduce((s, l) => s + l.amountCents, 0);
      const label = nr.n.batch == null ? "без ТЗ (ТЗ на эти изделия в базе нет)" : `партия ${nr.n.batch}, ${nr.set.length} ТЗ`;
      table.push([`п/п ${nr.n.pp} · счёт №${nr.n.inv} от ${nr.n.invDate} · ${ddmmyyyy(nr.n.date)} · ${rub(nr.n.amount)}`, `новая оплата работы (${nr.n.type === "ADVANCE" ? "аванс" : "доплата"}), ${label}`, `нет → есть; разнесено ${rub(alloc / 100)}, неразнесённый остаток ${rub(r.unallocatedCents / 100)}`, `Оплаты.xls, строка ${nr.n.row}, договор 1605`]);
    }

    // ---- 5) не вносятся
    for (const [pp, why] of Object.entries(NOT_ENTERED)) {
      const fr = file.get(pp)!;
      table.push([`п/п ${pp} · ${ddmmyyyy(fr[2])} · ${rub(fr[3])}`, "НЕ вносится (решение владельца)", why, `Оплаты.xls, строка ${fr[0]}`]);
    }

    const after = await snap();

    // ---- 6) инварианты
    const split61001 = created.supplierPayments.length ? 880000 : 0;
    const dSup = Math.round((before.supplierDebt - after.supplierDebt) * 100) / 100;
    if (Math.abs(dSup - split61001) > 0.01) problems.push(`долг поставщику изменился на ${rub(dSup)}, ожидалось ${rub(split61001)} (только оплата шкур ТЗ 121 по УПД №209)`);
    if (Math.abs(after.work - before.work) > 0.005) problems.push("работа по ТЗ изменилась");
    const newSum = newRows.reduce((s, r) => s + Number(r.n.amount), 0);
    const d22 = updates.find((u) => u.table === "ProductionPayment" && u.after.amount != null);
    const delta22 = d22 ? Number(d22.after.amount) - Number(d22.before.amount) : 0;
    // «сумма к оплате» по работе падает на новые оплаты; п/п 22618 (+6 265) уходит в «сырьё подрядчика» и в оплату работы не входит
    const expectedWork = -(newSum - split61001);
    const dWork = Math.round((after.workBalance - before.workBalance) * 100) / 100;
    if (Math.abs(dWork - expectedWork) > 0.01) problems.push(`долг по работе изменился на ${rub(dWork)}, ожидалось ${rub(expectedWork)}`);
    const dTotal = Math.round((after.sumP + after.sumPP - before.sumP - before.sumPP) * 100) / 100;
    if (Math.abs(dTotal - (newSum + delta22)) > 0.01 && Math.abs(dTotal - (newSum + delta22 + 15400 * 0)) > 0.01) problems.push(`Σ оплат изменилась на ${rub(dTotal)}, ожидалось ${rub(newSum + delta22)}`);
    // каждый п/п реестра (кроме НЕ вносимых) = Σ базы по п/п; даты совпадают
    const allP = await tx.payment.findMany({ where: { organizationId: org, ppNo: { not: null } }, select: { ppNo: true, amount: true, paidAt: true } });
    const allPP = await tx.productionPayment.findMany({ where: { organizationId: org, ppNo: { not: null } }, select: { ppNo: true, amount: true, paidAt: true } });
    let bad = 0;
    for (const [row, pp, date, amount] of FILE_ROWS) {
      if (NOT_ENTERED[pp]) continue;
      const rs = [...allP, ...allPP].filter((x) => x.ppNo === pp);
      const sum = rs.reduce((s, x) => s + num(x.amount), 0);
      if (Math.abs(sum - Number(amount)) > 0.005 || rs.some((x) => x.paidAt.toISOString().slice(0, 10) !== date)) { bad++; problems.push(`после записи п/п ${pp} (строка ${row}): в базе ${rub(sum)} ≠ реестр ${rub(amount)} или другая дата`); }
    }
    return { before, after, newSum, delta22, dWork, dTotal, bad, newRows };
  };

  type Res = Awaited<ReturnType<typeof run>>;
  let res: Res | null = null;
  try {
    await prisma.$transaction(async (tx) => { res = await run(tx); throw new DryRun(); }, { timeout: 300000, maxWait: 30000 });
  } catch (e) { if (!(e instanceof DryRun)) throw e; }
  const r = res as unknown as Res;
  const out: string[] = [`# Сведение оплат с «Оплаты.xls» — ${APPLY ? "ПРИМЕНЕНИЕ" : "пробный прогон"} (${new Date().toISOString()}), база «${dbName}»`, "", "| Платёж | Что меняется | Было → стало | Основание |", "|---|---|---|---|"];
  for (const t of table) out.push(`| ${t.join(" | ")} |`);
  out.push("", "## ДО → ПОСЛЕ", "");
  out.push(`- Σ оплат поставщику (Payment): ${rub(r.before.sumP)} → ${rub(r.after.sumP)}; Σ оплат производства: ${rub(r.before.sumPP)} → ${rub(r.after.sumPP)}; всего ${rub(r.before.sumP + r.before.sumPP)} → ${rub(r.after.sumP + r.after.sumPP)} (по реестру 652 088 735,58 − не вносимые 488 630,10 = 651 600 105,48)`);
  out.push(`- Долг поставщику (сырьё): ${rub(r.before.supplierDebt)} → ${rub(r.after.supplierDebt)} (не должен меняться)`);
  out.push(`- Работа по ТЗ: ${rub(r.before.work)} → ${rub(r.after.work)}; оплачено за работу: ${rub(r.before.workPaid)} → ${rub(r.after.workPaid)}; долг по работе подрядчику: ${rub(r.before.workBalance)} → ${rub(r.after.workBalance)} (Δ ${rub(r.dWork)})`);
  out.push(`- Разнесено на ТЗ ${rub(r.before.allocated)} → ${rub(r.after.allocated)}; неразнесённые авансы в долге ${rub(r.before.unallocated)} → ${rub(r.after.unallocated)}; «сверх работы» (сырьё подрядчика) ${rub(r.before.hides)} → ${rub(r.after.hides)}`);
  if (problems.length) out.push("", "## ПРОБЛЕМЫ — применять нельзя", ...problems.map((p) => `- ${p}`));
  console.log(out.join("\n"));
  if (problems.length) { console.log("\nПРОБЛЕМЫ — запись отменена."); await prisma.$disconnect(); process.exit(1); }
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply (копия) или --apply --live (боевая)."); await prisma.$disconnect(); return; }

  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое сведение — повторно не применяю (сначала --rollback --apply)."); await prisma.$disconnect(); return; }
  if (r.newRows.length === 0 && updates.length === 0) { console.log("Нечего применять (идемпотентно): все п/п уже в базе."); await prisma.$disconnect(); return; }
  if (isLive && !NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  const live: Journal = { script: "apply-payments-match-2026-10-19.ts", status: "applied", at: new Date().toISOString(), db: dbName, created: { payments: [], links: [], allocations: [] }, updates: [] };
  await prisma.$transaction(async (tx) => {
    const r2 = await run(tx);
    if (problems.length) throw new Error(problems.join("; "));
    live.created = { supplierPayments: [...created.supplierPayments], payments: [...created.payments], links: [...created.links], allocations: [...created.allocations] };
    live.updates = [...updates];
    writeJson(JOURNAL, live);
    void r2;
  }, { timeout: 300000, maxWait: 30000 });
  console.log(`Применено на «${dbName}»: новых оплат ${live.created.payments.length}, связей с ТЗ ${live.created.links.length}, разнесений ${live.created.allocations.length}, правок строк ${live.updates.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
