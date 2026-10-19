/**
 * Оплаты, продолжение (ответы владельца 19.10.2026): пункты 1, 4 и 6 — ПРЕДЛОЖЕНИЕ, НЕ ПРИМЕНЕНО.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-payments-followup-2026-10-19.ts                    # пробный прогон (БД не меняется): «платёж/закупка / что меняется / было → стало / основание»
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-payments-followup-2026-10-19.ts --apply            # применить на НЕ боевой базе (копия, scratch)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-payments-followup-2026-10-19.ts --apply --live     # применить на боевой базе fur_erp (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-payments-followup-2026-10-19.ts --rollback [--apply [--live]]
 *
 * ПУНКТ 1. Четыре мелких п/п по договору №2502 (488 630,10) заводятся закупками-услугами с оплатой: 81455 (УПД №201), 83556 (УПД №217), 30413 (УПД №237), 48847 (УПД №171).
 *   Закупка: ООО «Веллмех», без позиций и без аукциона, одна строка расхода «Услуги по УПД» (сумма без НДС + ставка), статус «Принята», УПД/счёт и документ-основание в полях закупки.
 *   Лотов нет, поэтому в «Куплено мех / подкладка» эти суммы не попадают; оплата = сумма УПД, долг не меняется. Показ — отдельной статьёй «Услуги по УПД» (см. payments-overview.ts).
 * ПУНКТ 4. Авансы №247, №251, №259, №261 (12 376 000,00) НЕ разносятся по ТЗ: в документах нет номеров ТЗ, часть изделий без ТЗ, остальные сопоставляются не однозначно.
 *   Скрипт только подписывает назначение (основание платежа) — «аванс по счёту №… за изделия … (ТЗ будут оформлены)».
 * ПУНКТ 6. 528 000 за сырьё подрядчика ТЗ 158 (3 изд. × 11 шкур × 16 000) выносятся из оплаты работы п/п 65109 (счёт №265, партия 20) в оплату закупки З-2026-0059 (УПД №209):
 *   закупка закрывается целиком (880 000 из п/п 61001 + 528 000 = 1 408 000). Условие: арифметика документов сходится до копейки
 *   ((1 892 430 − 528 000) = 30 % от работы партии 20 по расчёту подрядчика 4 548 100 = 4 931 800 − 383 700 известных ошибок расчёта); иначе запись не проводится.
 *   Оплата работы п/п 65109 уменьшается до 1 364 430,00, её разнесение по ТЗ партии 20 пересчитывается тем же правилом (пропорционально остатку работы).
 *
 * БЕЗОПАСНОСТЬ: всё в одной транзакции; ДО/ПОСЛЕ считаются долг поставщику, долг по работе, Σ оплат; любое отклонение от ожидаемого — откат без записи.
 * Идемпотентно (метка [pay-followup:2026-10-19]). Журнал отката: docs-inventory/corrections-journal-payments-followup-2026-10-19.json (для копии — с суффиксом имени базы).
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
const TAG = "[pay-followup:2026-10-19]";
const SRC = "реестр списаний ММ → Веллмех «Оплаты.xls» (19.10.2026)";
const CAT_NAME = "Услуги по УПД";

class DryRun extends Error {}
const cid = () => "c" + randomBytes(12).toString("hex");
const rub = (v: number | string) => Number(v).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ddmmyyyy = (iso: string) => iso.split("-").reverse().join(".");
const r2 = (v: number) => Math.round(v * 100) / 100;

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

// ───────── пункт 1: закупки-услуги
type Svc = { pp: string; row: number; payDate: string; amount: string; inv: string; invDate: string; vat: 20 | 22; title: string; basis: string };
const SERVICES: Svc[] = [
  { pp: "81455", row: 25, payDate: "2025-11-25", amount: "27960.00", inv: "201", invDate: "2025-11-06", vat: 20, title: "чески для меха (ателье)",
    basis: "назначение в п/п: «Оплата по счету N 201 от 06.11.2025, Чесок для меха, 27 960,00, в т.ч. НДС 4 660,00»; в сверке бухгалтерии 08.10.2026 — «чески для меха, ателье»" },
  { pp: "83556", row: 27, payDate: "2025-12-04", amount: "24500.00", inv: "217", invDate: "2025-12-01", vat: 20, title: "брелок из хвоста соболя (ивент ДЛТ)",
    basis: "назначение в п/п: «Оплата по счету N 217 от 01.12.2025, брелок из хвоста соболя, 24 500,00, в т.ч. НДС 4 083,33»; в сверке бухгалтерии 08.10.2026 — брелки 35 шт., ивент ДЛТ" },
  { pp: "30413", row: 34, payDate: "2026-03-02", amount: "19600.00", inv: "237", invDate: "2025-12-12", vat: 20, title: "брелки из хвоста соболя",
    basis: "назначение в п/п: «Оплата по счету N 237 от 12.12.2025, брелки из хвоста соболя, 19 600,00, в т.ч. НДС 3 266,67»; акт сверки по договору №2502 (9 месяцев 2026): «Оплата (30413 от 02.03.2026) 19 600,00»" },
  { pp: "48847", row: 51, payDate: "2026-06-15", amount: "416570.10", inv: "171", invDate: "2026-06-02", vat: 22, title: "доп. услуги по спецификации №14",
    basis: "назначение в п/п: «Оплата по договору 2502 от 26.02.2025, счет 171 от 02.06.2026, за доп. услуги по спецификации №14, 416 570,10, в т.ч. НДС 75 119,20»; акт сверки по договору №2502 (9 месяцев 2026): «Приход (171 от 02.06.2026) 416 570,10» и «Оплата (48847 от 15.06.2026) 416 570,10»; по сверке 08.10.2026 — командировка на осмотр рыси в Турции" },
];

// ───────── пункт 4: подписи авансов (шкур в тексте быть не должно: слово «шкур» в основании делает платёж «сырьём подрядчика», см. isHidesBasis)
type Adv = { pp: string; inv: string; amount: string; row: number; purpose: string; evidence: string };
const ADVANCES: Adv[] = [
  { pp: "61785", inv: "247", amount: "2272060.00", row: 61,
    purpose: "аванс 2 по счёту №247 от 01.09.2026 за изделия из перечня «07092026» (26 изд. «без подклада», 70 % от стоимости пошива; ТЗ будут оформлены)",
    evidence: "Письма Василия 01.09 и 03.09.2026 («перечень изделий, готовящихся на приёмку 07.09.2026», «с 58 изделий стало 68»), Коношенко 02.09.2026; файл «07092026.xlsx» (перечень по артикулам и размерам, номеров ТЗ нет). Часть изделий перечня совпадает с ТЗ партии 19, часть — с изделиями других партий, часть не оформлена: однозначного соответствия по ТЗ нет, аванс не разнесён." },
  { pp: "61929", inv: "251", amount: "8290940.00", row: 60,
    purpose: "аванс 3 по счёту №251 от 02.09.2026 за 55 изделий, взятых в работу на 01.09.2026 без аванса (70 % от 11 844 200; ТЗ будут оформлены)",
    evidence: "Письмо Василия 02.09.2026 «Аванс за пошив 3» («перечень изделий, запущенных в работу и по которым нет аванса»); файл «в работе на 01.09.2026 (без аванса)» (по артикулам, номеров ТЗ нет; в перечне изделия, на которые ТЗ нет: М031 ×7, М030, М040, М054 и др.); согласовано Киржнером 03.09.2026. Часть изделий получила ТЗ позже (партии 20–22), часть ТЗ не имеет: однозначного соответствия по ТЗ нет, аванс не разнесён." },
  { pp: "63604", inv: "259", amount: "1008000.00", row: 64,
    purpose: "аванс 70 % по счёту №259 от 15.09.2026 за дозаказ: 6 изд. М001Е (лиса арктическая, 6 × 240 000 = 1 440 000; ТЗ будет оформлен)",
    evidence: "Письма Василия 15.09.2026 («заказ от 12.09.2026»; мех заказчика, к стоимости пошива добавится органза подрядчика), Коношенко/Киржнера 16–17.09.2026 (согласовано); в базе ТЗ на этот дозаказ нет." },
  { pp: "63603", inv: "261", amount: "805000.00", row: 63,
    purpose: "аванс 70 % по счёту №261 от 15.09.2026 за дозаказ: 10 изд. М029 (красная лиса, 10 × 115 000 = 1 150 000; ТЗ будут оформлены)",
    evidence: "Письма Василия 15.09.2026 («заказ от 12.09.2026», сырьё подрядчика выставляется по факту сдачи), Коношенко/Киржнера 16–17.09.2026 (согласовано); в базе ТЗ на этот дозаказ нет (ТЗ 158 — 3 изд. М029 основного заказа партии 20)." },
];

// ───────── пункт 6: сырьё подрядчика ТЗ 158 в п/п 65109
const HIDES_PP = "65109", HIDES_AMOUNT = 528000, HIDES_PURCHASE = "З-2026-0059", HIDES_ROW = 66;
// расчёт партии 20: понижающие ошибки в расчёте подрядчика (старая версия), по которым счёт №265 занижен: ТЗ 152 (М002А) 18 000 вместо 386 500, ТЗ 160 (МН03) 7 600 вместо 9 500 × 8 шт.
const BATCH20_ERRORS = (386500 - 18000) + 8 * (9500 - 7600); // 383 700

type Upd = { table: "ProductionPayment" | "Payment" | "Purchase"; id: string; before: Record<string, unknown>; after: Record<string, unknown> };
type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string; db: string;
  created: { purchases: string[]; expenses: string[]; categories: string[]; payments: string[]; allocations: string[] };
  deletedAllocations: { id: string; organizationId: string; productionPaymentId: string; productionOrderId: string; amount: string; note: string | null; source: "AUTO" | "MANUAL"; createdAt: string }[];
  updates: Upd[];
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { planAutoAllocations, orderWorkCents, loadClientDebt, AUTO_NOTE, allocatedCentsByOrder } = await import("../src/lib/payment-alloc");
  const { loadSupplierDebt } = await import("../src/lib/supplier-debt");
  const { purchaseTotalInclVat } = await import("../src/lib/purchase-totals");
  const { checkAllocation, fromCents, toCents } = await import("../src/lib/payment-alloc-core");
  const url = process.env.DATABASE_URL ?? "";
  const dbName = url.split("?")[0].split("/").pop() ?? "";
  const isLive = dbName === "fur_erp";
  if (APPLY && isLive && !LIVE) throw new Error(`База «${dbName}» боевая: для записи нужен --live (для репетиции укажите копию через DATABASE_URL).`);
  if (APPLY && !isLive && LIVE) throw new Error(`--live указан, но DATABASE_URL смотрит на «${dbName}», а не на fur_erp.`);
  const prisma = createAuditedClient("script:apply-payments-followup-2026-10-19");
  const JOURNAL = join(INV, `corrections-journal-payments-followup-2026-10-19${isLive ? "" : `-${dbName}`}.json`);
  const org = (await prisma.organization.findFirst({ select: { id: true } }))!.id;

  // ───────── откат
  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат (${dbName}): закупок ${j.created.purchases.length}, оплат ${j.created.payments.length}, строк разнесения: создано ${j.created.allocations.length}, удалено ${j.deletedAllocations.length}, правок строк ${j.updates.length}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        await tx.paymentAllocation.deleteMany({ where: { id: { in: j.created.allocations } } });
        await tx.payment.deleteMany({ where: { id: { in: j.created.payments } } });
        await tx.purchaseExpense.deleteMany({ where: { id: { in: j.created.expenses } } });
        await tx.purchase.deleteMany({ where: { id: { in: j.created.purchases } } });
        await tx.expenseCategory.deleteMany({ where: { id: { in: j.created.categories } } });
        for (const u of j.updates) {
          const t = (u.table === "Payment" ? tx.payment : u.table === "Purchase" ? tx.purchase : tx.productionPayment) as unknown as { findUnique: (a: unknown) => Promise<Record<string, unknown> | null>; update: (a: unknown) => Promise<unknown> };
          const cur = await t.findUnique({ where: { id: u.id } });
          if (!cur) continue;
          // откатываем только поля, которые сейчас равны записанным «после» (чужие правки позже не затираем)
          const data: Record<string, unknown> = {};
          for (const k of Object.keys(u.before)) {
            const now = cur[k] instanceof Date ? (cur[k] as Date).toISOString() : cur[k] != null && typeof cur[k] === "object" ? String(cur[k]) : cur[k];
            // суммы (Decimal) сравниваем как числа: «1364430» и «1364430.00» — одно и то же
            const numeric = (v: unknown) => (typeof v === "string" || typeof v === "number") && v !== "" && Number.isFinite(Number(v)) && /^-?\d+(\.\d+)?$/.test(String(v));
            const same = k === "amount" && numeric(now) && numeric(u.after[k]) ? Number(now) === Number(u.after[k]) : JSON.stringify(now ?? null) === JSON.stringify(u.after[k] ?? null);
            if (same) data[k] = k === "paidAt" || k === "confirmedAt" ? (u.before[k] ? new Date(String(u.before[k])) : null) : u.before[k];
          }
          if (Object.keys(data).length) await t.update({ where: { id: u.id }, data });
        }
        if (j.deletedAllocations.length) await tx.paymentAllocation.createMany({ data: j.deletedAllocations.map((a) => ({ ...a, createdAt: new Date(a.createdAt) })) });
      }, { timeout: 120000, maxWait: 15000 });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  const created: Journal["created"] = { purchases: [], expenses: [], categories: [], payments: [], allocations: [] };
  const deletedAllocations: Journal["deletedAllocations"] = [];
  const updates: Upd[] = [];
  const table: string[][] = [];
  const problems: string[] = [];
  const num = (v: unknown) => Number(String(v));
  const now = new Date();

  const run = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    created.purchases.length = 0; created.expenses.length = 0; created.categories.length = 0; created.payments.length = 0; created.allocations.length = 0;
    deletedAllocations.length = 0; updates.length = 0; table.length = 0; problems.length = 0;
    const snap = async () => {
      const sd = await loadSupplierDebt(tx as never, org, "all");
      const cd = await loadClientDebt(tx, org, { year: "all" });
      const sumP = (await tx.payment.aggregate({ where: { organizationId: org, status: "COMPLETED" }, _sum: { amount: true } }))._sum.amount ?? 0;
      const sumPP = (await tx.productionPayment.aggregate({ where: { organizationId: org, status: "COMPLETED" }, _sum: { amount: true } }))._sum.amount ?? 0;
      return { supplierDebt: sd.debt.toNumber(), supplierTotal: sd.total.toNumber(), billable: cd.billable, work: cd.work, workPaid: cd.paid, workBalance: cd.balance, unallocated: cd.unallocated, allocated: cd.allocated, hides: cd.hides, sumP: num(sumP), sumPP: num(sumPP) };
    };
    const before = await snap();

    const pays = await tx.payment.findMany({ where: { organizationId: org }, select: { id: true, ppNo: true, amount: true, purchaseId: true } });
    const pps = await tx.productionPayment.findMany({ where: { organizationId: org }, select: { id: true, ppNo: true, amount: true, docRef: true, notes: true, confirmedBy: true, status: true } });
    const file = new Map(FILE_ROWS.map((r) => [r[1], r]));

    // ---- пункт 1: закупки-услуги
    const ref = await tx.purchase.findFirst({ where: { organizationId: org, number: "З-2026-0062" }, select: { supplierId: true, warehouseId: true } });
    if (!ref) throw new Error("Не найдена З-2026-0062 (ожидалась боевая база или её копия)");
    const numbers = (await tx.purchase.findMany({ where: { organizationId: org, number: { startsWith: "З-2026-" } }, select: { number: true } })).map((p) => Number(p.number.slice(7))).filter((n) => Number.isFinite(n));
    let seq = Math.max(0, ...numbers);
    let cat = await tx.expenseCategory.findFirst({ where: { organizationId: org, name: CAT_NAME, kind: "PURCHASE" } });
    for (const s of SERVICES.sort((a, b) => a.payDate.localeCompare(b.payDate))) {
      const fr = file.get(s.pp);
      if (!fr || Math.abs(Number(fr[3]) - Number(s.amount)) > 0.005 || fr[2] !== s.payDate) { problems.push(`п/п ${s.pp}: не совпадает со строкой реестра`); continue; }
      const dd = ddmmyyyy(s.payDate), di = ddmmyyyy(s.invDate);
      const have = pays.find((p) => p.ppNo === s.pp);
      if (have) { table.push([`п/п ${s.pp} · УПД №${s.inv} от ${di} · ${rub(s.amount)}`, "закупка-услуга и оплата", "уже есть в базе (пропуск)", `Оплаты.xls, строка ${s.row}`]); continue; }
      const incl = Number(s.amount);
      const excl = r2(incl / (1 + s.vat / 100));
      if (Math.abs(r2(excl * (1 + s.vat / 100)) - incl) > 0.005) { problems.push(`п/п ${s.pp}: сумма без НДС ${excl} при ставке ${s.vat} % не даёт ${incl}`); continue; }
      if (!cat) { cat = await tx.expenseCategory.create({ data: { id: cid(), organizationId: org, name: CAT_NAME, kind: "PURCHASE", isActive: true } }); created.categories.push(cat.id); }
      seq += 1;
      const number = `З-2026-${String(seq).padStart(4, "0")}`;
      const pid = cid(), eid = cid(), payId = cid();
      const notes = `Закупка-услуга по договору купли-продажи №2502 от 26.02.2025 (ООО «Веллмех»): ${s.title}. УПД и счёт №${s.inv} от ${di}, ${rub(incl)} ₽ с НДС ${s.vat} % (без НДС ${rub(excl)}). Не сырьё: позиций и лотов нет, в «Куплено мех / подкладка» не входит. ` +
        `Оплачена полностью: п/п №${s.pp} от ${dd} (${SRC}, строка ${s.row}). Основание: ${s.basis}. Закупка заведена по решению владельца 19.10.2026 (ответ на вопрос 1). ${TAG}`;
      await tx.purchase.create({
        data: {
          id: pid, organizationId: org, number, supplierId: ref.supplierId, warehouseId: ref.warehouseId, status: "RECEIVED", currency: "RUB",
          orderDate: new Date(`${s.invDate}T00:00:00.000Z`), receivedDate: new Date(`${s.invDate}T12:00:00.000Z`), notes,
          invoiceNumber: s.inv, transferDocument: `№ ${s.inv} от ${di} г.`, listLabel: `услуги, УПД №${s.inv}`,
        },
      });
      await tx.purchaseExpense.create({ data: { id: eid, purchaseId: pid, categoryId: cat.id, amount: excl.toFixed(2), vatRate: String(s.vat), date: new Date(`${s.invDate}T00:00:00.000Z`), description: `${s.title}; УПД №${s.inv} от ${di}` } });
      await tx.payment.create({
        data: {
          id: payId, organizationId: org, supplierId: ref.supplierId, purchaseId: pid, amount: incl.toFixed(2), method: "BANK_TRANSFER", status: "COMPLETED",
          paidAt: new Date(`${s.payDate}T00:00:00.000Z`), kind: "FINAL", confirmed: true, confirmedAt: now, ppNo: s.pp, invoiceNo: s.inv,
          confirmedBy: `${SRC}: п/п №${s.pp} от ${dd}, ${rub(incl)} ₽, счёт №${s.inv}`,
          docRef: `п/п №${s.pp} от ${dd}; Счёт №${s.inv} от ${di}`,
          notes: `Оплата закупки-услуги ${number} (УПД №${s.inv} от ${di}, ${s.title}): ${rub(incl)} ₽ = сумме УПД. Подтверждено: п/п №${s.pp} от ${dd} в ${SRC}, строка ${s.row}, договор №2502. ${TAG}`,
        },
      });
      created.purchases.push(pid); created.expenses.push(eid); created.payments.push(payId);
      table.push([`${number} · УПД №${s.inv} от ${di} · ${rub(incl)} (${s.title})`, "новая закупка-услуга + оплата п/п " + s.pp + " от " + dd, `нет → есть; закупка ${rub(incl)} = оплата ${rub(incl)}, долг 0,00; НДС ${s.vat} %: ${rub(incl - excl)}`, `Оплаты.xls, строка ${s.row}; ${s.basis}`]);
    }

    // ---- пункт 4: подписи авансов
    for (const a of ADVANCES) {
      const cur = pps.find((p) => p.ppNo === a.pp && p.status !== "CANCELLED");
      const fr = file.get(a.pp);
      if (!cur || !fr) { problems.push(`п/п ${a.pp}: аванс по счёту №${a.inv} не найден в базе`); continue; }
      if (Math.abs(num(cur.amount) - Number(a.amount)) > 0.005) { problems.push(`п/п ${a.pp}: сумма в базе ${rub(cur.amount.toString())} ≠ ${rub(a.amount)}`); continue; }
      if (/шкур/i.test(a.purpose + a.evidence)) { problems.push(`п/п ${a.pp}: в подписи не должно быть слова «шкур» (isHidesBasis)`); continue; }
      if ((cur.notes ?? "").includes(TAG)) { table.push([`п/п ${a.pp} · счёт №${a.inv} · ${rub(a.amount)}`, "назначение аванса", "уже подписано (пропуск)", `Оплаты.xls, строка ${a.row}`]); continue; }
      const baseRef = cur.docRef ?? `п/п №${a.pp}; Счёт №${a.inv}`;
      const docRef = `${baseRef}; ${a.purpose}`;
      const notes = `${cur.notes ?? ""}\nНазначение: ${a.purpose}. Не разнесён по ТЗ (решение 19.10.2026 по ответу владельца): ${a.evidence} ${TAG}`;
      updates.push({ table: "ProductionPayment", id: cur.id, before: { docRef: cur.docRef, notes: cur.notes }, after: { docRef, notes } });
      await tx.productionPayment.update({ where: { id: cur.id }, data: { docRef, notes } });
      table.push([`п/п ${a.pp} · счёт №${a.inv} · ${rub(a.amount)} (аванс)`, "назначение аванса; остаётся неразнесённым", `основание: «${baseRef}» → «${docRef}»`, `Оплаты.xls, строка ${a.row}; ${a.evidence}`]);
    }

    // ---- пункт 6: сырьё подрядчика ТЗ 158 из п/п 65109 в оплату З-2026-0059 (УПД №209)
    {
      const frow = file.get(HIDES_PP);
      const pur = await tx.purchase.findFirst({ where: { organizationId: org, number: HIDES_PURCHASE }, include: { items: true, expenses: true } });
      const cur = await tx.productionPayment.findFirst({ where: { organizationId: org, ppNo: HIDES_PP, status: { not: "CANCELLED" } }, include: { allocations: true, orders: { select: { productionOrderId: true } } } });
      const done = pays.find((p) => p.ppNo === HIDES_PP);
      if (done) table.push([`п/п ${HIDES_PP} · часть ${rub(HIDES_AMOUNT)} (сырьё подрядчика ТЗ 158)`, "оплата закупки " + HIDES_PURCHASE, "уже вынесено (пропуск)", `Оплаты.xls, строка ${HIDES_ROW}`]);
      else if (!pur || !cur || !frow) problems.push(`п/п ${HIDES_PP}: не найдены закупка ${HIDES_PURCHASE} или платёж`);
      else {
        const total209 = purchaseTotalInclVat(pur).toNumber();
        const paid209 = (await tx.payment.aggregate({ where: { purchaseId: pur.id, status: "COMPLETED" }, _sum: { amount: true } }))._sum.amount;
        const paid209n = paid209 ? num(paid209) : 0;
        if (Math.abs(total209 - 1408000) > 0.005) problems.push(`${HIDES_PURCHASE}: стоимость ${rub(total209)} ≠ 1 408 000,00 (УПД №209)`);
        if (Math.abs(paid209n - 880000) > 0.005) problems.push(`${HIDES_PURCHASE}: оплачено ${rub(paid209n)}, ожидалось 880 000,00 (п/п 61001); остаток к оплате должен быть ${rub(HIDES_AMOUNT)}`);
        if (Math.abs(num(cur.amount) - 1892430) > 0.005 || Math.abs(Number(frow[3]) - 1892430) > 0.005) problems.push(`п/п ${HIDES_PP}: сумма ${rub(cur.amount.toString())} ≠ 1 892 430,00`);
        // арифметика документов: счёт №265 = 30 % от работы партии 20 по расчёту подрядчика + сырьё ТЗ 158
        const batch = await tx.productionOrder.findMany({ where: { organizationId: org, batch: { number: 20 }, status: { not: "CANCELLED" } }, select: { id: true, workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true } });
        const work20 = batch.reduce((s, o) => s + orderWorkCents({ status: o.status, plannedQuantity: o.plannedQuantity, producedQuantity: o.producedQuantity, clientWorkPricePerUnit: o.clientWorkPricePerUnit }), 0) / 100;
        const base = (1892430 - HIDES_AMOUNT) / 0.3;
        if (Math.abs(work20 - 4931800) > 0.005) problems.push(`работа партии 20 в базе ${rub(work20)} ≠ 4 931 800,00`);
        if (Math.abs(base - (work20 - BATCH20_ERRORS)) > 0.01) problems.push(`арифметика не сходится: (1 892 430 − 528 000) / 0,3 = ${rub(base)}, а работа партии 20 минус известные ошибки расчёта = ${rub(work20 - BATCH20_ERRORS)}`);
        const t158 = batch.find((o) => o.workOrderNumber === "158");
        if (!t158) problems.push("ТЗ 158 не найдено в партии 20");
        if (problems.length === 0) {
          const dd = ddmmyyyy("2026-09-29");
          const newAmount = (num(cur.amount) - HIDES_AMOUNT).toFixed(2);
          // 1) оплата закупки З-2026-0059
          const payId = cid();
          await tx.payment.create({
            data: {
              id: payId, organizationId: org, supplierId: pur.supplierId, purchaseId: pur.id, amount: HIDES_AMOUNT.toFixed(2), method: "BANK_TRANSFER", status: "COMPLETED",
              paidAt: new Date("2026-09-29T00:00:00.000Z"), kind: "PARTIAL", confirmed: true, confirmedAt: now, ppNo: HIDES_PP, invoiceNo: "265",
              confirmedBy: `${SRC}: п/п №${HIDES_PP} от ${dd}, 1 892 430,00 ₽ (в том числе 528 000,00 — шкуры красной лисы подрядчика, ТЗ 158)`,
              docRef: `п/п №${HIDES_PP} от ${dd}; Счёт №265 от 22.09.2026`,
              notes: `Шкуры красной лисы подрядчика (33 шт. × 16 000, ТЗ 158: 3 изд. × 11 шкур) в составе п/п №${HIDES_PP} по счёту №265: относятся к УПД/счёту №209 (${HIDES_PURCHASE}); вместе с 880 000 из п/п 61001 (ТЗ 121) закрывают УПД целиком (1 408 000 = 88 шкур). ${TAG}`,
            },
          });
          created.payments.push(payId);
          // 2) оплата работы п/п 65109 уменьшается; разнесение по ТЗ партии 20 пересчитывается
          const note = `${cur.notes ?? ""}\n${TAG} Из п/п №${HIDES_PP} (1 892 430,00) вынесено ${rub(HIDES_AMOUNT)} — сырьё подрядчика ТЗ 158 (33 красной лисы × 16 000) — в оплату закупки ${HIDES_PURCHASE} (УПД №209). Оплата работы: 1 892 430,00 → ${rub(newAmount)} (= 30 % от работы партии 20 по расчёту подрядчика ${rub(base)}); разнесение по ТЗ партии 20 пересчитано.`;
          updates.push({ table: "ProductionPayment", id: cur.id, before: { amount: num(cur.amount).toFixed(2), notes: cur.notes }, after: { amount: newAmount, notes: note } });
          await tx.productionPayment.update({ where: { id: cur.id }, data: { amount: newAmount, notes: note } });
          const old = cur.allocations;
          if (old.some((x) => x.source !== "AUTO")) problems.push(`п/п ${HIDES_PP}: есть ручное разнесение — автоматически не пересчитываю`);
          for (const x of old) deletedAllocations.push({ id: x.id, organizationId: x.organizationId, productionPaymentId: x.productionPaymentId, productionOrderId: x.productionOrderId, amount: x.amount.toString(), note: x.note, source: x.source, createdAt: x.createdAt.toISOString() });
          await tx.paymentAllocation.deleteMany({ where: { productionPaymentId: cur.id } });
          const linked = cur.orders.map((l) => l.productionOrderId);
          const used = await allocatedCentsByOrder(tx, org, linked, cur.id);
          const ords = await tx.productionOrder.findMany({ where: { id: { in: linked } }, select: { id: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true } });
          const plan = planAutoAllocations(
            [{ id: cur.id, amountCents: toCents(newAmount), paidAt: cur.paidAt.getTime(), createdAt: cur.createdAt.getTime(), linkedOrderIds: linked, docRef: cur.docRef, notes: note }],
            new Map(ords.map((o) => [o.id, { id: o.id, workCents: orderWorkCents(o), live: true }])), used,
          );
          const r = plan[0];
          const err = checkAllocation(toCents(newAmount), r.lines);
          if (err) problems.push(`п/п ${HIDES_PP}: ${err}`);
          if (r.unallocatedCents > 1) problems.push(`п/п ${HIDES_PP}: после пересчёта остаётся неразнесённым ${rub(r.unallocatedCents / 100)}`);
          const arows = r.lines.map((l) => ({ id: cid(), organizationId: org, productionPaymentId: cur.id, productionOrderId: l.orderId, amount: fromCents(l.amountCents), source: "AUTO" as const, note: `${AUTO_NOTE} ${TAG}` }));
          if (arows.length) await tx.paymentAllocation.createMany({ data: arows });
          for (const a of arows) created.allocations.push(a.id);
          const nOf = new Map(batch.map((o) => [o.id, o.workOrderNumber]));
          const oldBy = new Map(old.map((x) => [x.productionOrderId, num(x.amount)]));
          table.push([`п/п ${HIDES_PP} · часть ${rub(HIDES_AMOUNT)} (сырьё подрядчика ТЗ 158) → закупка ${HIDES_PURCHASE} (УПД №209)`, "оплата закупки; закупка закрывается", `оплачено по УПД №209: 880 000,00 → 1 408 000,00; долг по УПД №209: 528 000,00 → 0,00`, `ТЗ 158 (3 изд. × 11 × 16 000); письма Коношенко/Киржнера 17.07.2026 («88 шкур = 8 изд. × 11»), Василия 22.09.2026 («расчёт доплаты за работу и за шкуры»), Федина 23.09.2026 («расчёты все ок»); (1 892 430 − 528 000) / 0,3 = ${rub(base)} = 4 931 800 − ${rub(BATCH20_ERRORS)}`]);
          table.push([`п/п ${HIDES_PP} · счёт №265 от 22.09.2026 · оплата работы (партия 20)`, "сумма оплаты работы и разнесение по ТЗ", `${rub(1892430)} → ${rub(newAmount)}; разнесено ${rub(old.reduce((s, x) => s + num(x.amount), 0))} → ${rub(r.lines.reduce((s, l) => s + l.amountCents, 0) / 100)}`, `Оплаты.xls, строка ${HIDES_ROW}`]);
          for (const l of r.lines.sort((x, y) => Number(nOf.get(x.orderId)) - Number(nOf.get(y.orderId)))) table.push([`    ТЗ ${nOf.get(l.orderId)}`, "разнесение", `${rub(oldBy.get(l.orderId) ?? 0)} → ${rub(l.amountCents / 100)}`, "пропорционально остатку работы"]);
        }
      }
    }

    const after = await snap();

    // ---- инварианты
    const addedSvc = created.purchases.length ? SERVICES.filter((s) => !pays.some((p) => p.ppNo === s.pp)).reduce((s, x) => s + Number(x.amount), 0) : 0;
    const hidesMoved = created.allocations.length || updates.some((u) => u.table === "ProductionPayment" && u.after.amount != null) ? HIDES_AMOUNT : 0;
    const d = (a: number, b: number) => Math.round((a - b) * 100) / 100;
    if (Math.abs(d(after.supplierDebt, before.supplierDebt) + hidesMoved) > 0.01) problems.push(`долг поставщику изменился на ${rub(d(after.supplierDebt, before.supplierDebt))}, ожидалось ${rub(-hidesMoved)} (пункты 1 и 4 долг не меняют; пункт 6 закрывает УПД №209)`);
    if (Math.abs(d(after.supplierTotal, before.supplierTotal) - addedSvc) > 0.01) problems.push(`стоимость закупок изменилась на ${rub(d(after.supplierTotal, before.supplierTotal))}, ожидалось ${rub(addedSvc)}`);
    if (Math.abs(d(after.work, before.work)) > 0.005) problems.push("работа по ТЗ изменилась");
    if (Math.abs(d(after.workBalance, before.workBalance) - hidesMoved) > 0.01) problems.push(`долг по работе изменился на ${rub(d(after.workBalance, before.workBalance))}, ожидалось +${rub(hidesMoved)}`);
    if (Math.abs(d(after.unallocated, before.unallocated)) > 0.01) problems.push(`неразнесённые авансы изменились на ${rub(d(after.unallocated, before.unallocated))}, ожидалось 0,00`);
    if (Math.abs(d(after.sumP + after.sumPP, before.sumP + before.sumPP) - addedSvc) > 0.01) problems.push(`Σ оплат изменилась на ${rub(d(after.sumP + after.sumPP, before.sumP + before.sumPP))}, ожидалось ${rub(addedSvc)}`);
    // каждый п/п реестра = Σ базы по п/п; даты совпадают; Σ реестра = Σ базы
    const allP = await tx.payment.findMany({ where: { organizationId: org, status: "COMPLETED" }, select: { ppNo: true, amount: true, paidAt: true } });
    const allPP = await tx.productionPayment.findMany({ where: { organizationId: org, status: "COMPLETED" }, select: { ppNo: true, amount: true, paidAt: true } });
    let bad = 0, regSum = 0;
    for (const [row, pp, date, amount] of FILE_ROWS) {
      regSum += Number(amount);
      const rs = [...allP, ...allPP].filter((x) => x.ppNo === pp);
      const sum = rs.reduce((s, x) => s + num(x.amount), 0);
      if (Math.abs(sum - Number(amount)) > 0.005 || rs.some((x) => x.paidAt.toISOString().slice(0, 10) !== date)) { bad++; problems.push(`после записи п/п ${pp} (строка ${row}): в базе ${rub(sum)} ≠ реестр ${rub(amount)} или другая дата`); }
    }
    const totalAfter = after.sumP + after.sumPP;
    if (Math.abs(totalAfter - regSum) > 0.01) problems.push(`Σ оплат в базе ${rub(totalAfter)} ≠ Σ реестра ${rub(regSum)} (Δ ${rub(totalAfter - regSum)})`);
    return { before, after, bad, regSum, addedSvc, hidesMoved };
  };

  type Res = Awaited<ReturnType<typeof run>>;
  let res: Res | null = null;
  try {
    await prisma.$transaction(async (tx) => { res = await run(tx); throw new DryRun(); }, { timeout: 300000, maxWait: 30000 });
  } catch (e) { if (!(e instanceof DryRun)) throw e; }
  const r = res as unknown as Res;
  const out: string[] = [`# Оплаты, продолжение (пункты 1, 4, 6) — ${APPLY ? "ПРИМЕНЕНИЕ" : "пробный прогон"} (${new Date().toISOString()}), база «${dbName}»`, "", "| Платёж / закупка | Что меняется | Было → стало | Основание |", "|---|---|---|---|"];
  for (const t of table) out.push(`| ${t.join(" | ")} |`);
  out.push("", "## ДО → ПОСЛЕ", "");
  out.push(`- Оплачено всего (Payment + ProductionPayment): ${rub(r.before.sumP + r.before.sumPP)} → ${rub(r.after.sumP + r.after.sumPP)}; реестр «Оплаты.xls»: ${rub(r.regSum)}`);
  out.push(`- Оплаты поставщику: ${rub(r.before.sumP)} → ${rub(r.after.sumP)}; оплаты производства: ${rub(r.before.sumPP)} → ${rub(r.after.sumPP)}`);
  out.push(`- Закупки у поставщика: ${rub(r.before.supplierTotal)} → ${rub(r.after.supplierTotal)}; долг по сырью: ${rub(r.before.supplierDebt)} → ${rub(r.after.supplierDebt)}`);
  const wl = (x: typeof r.before) => r2(x.billable - x.allocated);
  out.push(`- «К оплате всего» (новый показ: долг по сырью + остаток работы по заведённым ТЗ, аванс отдельно): ${rub(r.before.supplierDebt + wl(r.before))} → ${rub(r.after.supplierDebt + wl(r.after))}; из них долг по сырью ${rub(r.before.supplierDebt)} → ${rub(r.after.supplierDebt)}, остаток работы ${rub(wl(r.before))} → ${rub(wl(r.after))}; «Аванс подрядчику (неразнесённый)» ${rub(r.before.unallocated)} → ${rub(r.after.unallocated)}`);
  out.push(`- Работа по ТЗ: ${rub(r.before.work)} → ${rub(r.after.work)}; разнесено на ТЗ: ${rub(r.before.allocated)} → ${rub(r.after.allocated)}; неразнесённые авансы: ${rub(r.before.unallocated)} → ${rub(r.after.unallocated)}; долг по работе (общий баланс): ${rub(r.before.workBalance)} → ${rub(r.after.workBalance)}`);
  if (problems.length) out.push("", "## ПРОБЛЕМЫ — применять нельзя", ...problems.map((p) => `- ${p}`));
  console.log(out.join("\n"));
  if (problems.length) { console.log("\nПРОБЛЕМЫ — запись отменена."); await prisma.$disconnect(); process.exit(1); }
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply (копия) или --apply --live (боевая)."); await prisma.$disconnect(); return; }

  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое — повторно не применяю (сначала --rollback --apply)."); await prisma.$disconnect(); return; }
  if (created.purchases.length === 0 && updates.length === 0 && created.payments.length === 0) { console.log("Нечего применять (идемпотентно): всё уже в базе."); await prisma.$disconnect(); return; }
  if (isLive && !NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  const live: Journal = { script: "apply-payments-followup-2026-10-19.ts", status: "applied", at: new Date().toISOString(), db: dbName, created: { purchases: [], expenses: [], categories: [], payments: [], allocations: [] }, deletedAllocations: [], updates: [] };
  await prisma.$transaction(async (tx) => {
    await run(tx);
    if (problems.length) throw new Error(problems.join("; "));
    live.created = { purchases: [...created.purchases], expenses: [...created.expenses], categories: [...created.categories], payments: [...created.payments], allocations: [...created.allocations] };
    live.deletedAllocations = [...deletedAllocations];
    live.updates = [...updates];
    writeJson(JOURNAL, live);
  }, { timeout: 300000, maxWait: 30000 });
  console.log(`Применено на «${dbName}»: закупок ${live.created.purchases.length}, оплат ${live.created.payments.length}, строк разнесения: создано ${live.created.allocations.length}, удалено ${live.deletedAllocations.length}, правок строк ${live.updates.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
