/**
 * Шкуры подрядчика: разделение платежей доплаты на «работу» и «шкуры подрядчика» (решение владельца 08.10.2026, К8/К9/Е2).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-contractor-hides-split.ts            # сухой прогон (БД не меняется), отчёт
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-contractor-hides-split.ts --apply    # применить (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-contractor-hides-split.ts --rollback # откат по журналу
 *
 * Модель. Закупки З-2026-0010…0013 (шкуры подрядчика) ОСТАЮТСЯ: лоты, остатки меха и использование в ТЗ не меняются.
 * Шкурная часть уже оплаченных платежей производства оформляется отдельной оплатой этих закупок (Payment поставщику Веллмех,
 * привязан к закупке; п/п, дата и сумма — из документов), а в оплате производства остаётся только работа:
 *   п/п 87386 (22.12.2025, счёт №235)  5 669 120,00 = работа 1 084 620,00 + шкуры 4 584 500,00  → З-2026-0010
 *   п/п 88911 (26.12.2025, счёт №239)    946 870,00 = работа   483 120,00 + шкуры   463 750,00  → З-2026-0011
 *   п/п 22618 (21.01.2026, счёт №1)    2 075 122,54 = работа 1 147 622,54 + шкуры 927 500,00 (доказанная часть) → З-2026-0012;
 *        остаток шкур партии 7 (189 966,22) остаётся в оплате с пометкой «проверить»
 *   п/п 26829 (11.02.2026, счёт №7)      427 227,39 — целиком шкуры партии 9 (ТЗ 90)   → З-2026-0013 (часть 1 из 2)
 *   п/п 82173 (27.11.2025, аванс №209) − 3 812,61 из неразнесённой части аванса        → З-2026-0013 (часть 2 из 2): 427 227,39 + 3 812,61 = 431 040,00
 * Деньги по п/п не задваиваются: общая сумма (Payment + ProductionPayment) до и после одинакова.
 * Не меняет: партии 14 и 17–21, авансы №247/№251 (документов нет — «не оплачено»); З-2026-0001 (880 000,01 в неоплаченном счёте №237) остаётся долгом.
 * Также записывает решение владельца в SystemState (`owner-decision:double-0001-0010`, механизм «Контроль → Задачи → Решения владельца»).
 */
import Module from "module";
import { join } from "path";
import { writeFileSync } from "fs";
import { execSync } from "child_process";
import { randomBytes } from "crypto";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const TAG = "[fix:HIDES-SPLIT]";
const ACT = "акт сверки ММ ↔ Веллмех на 30.06.2026 (Drive «мех»/доп материал/акт сверки/баланс всех оплат мех.xlsx, договор подряда №1605)";
const DECISION_KEY = "owner-decision:double-0001-0010";

class DryRun extends Error {}
const cid = () => "c" + randomBytes(12).toString("hex");
const rub = (c: number) => (c / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ");
const cents = (v: { toString(): string } | number | string) => Math.round(Number(v.toString()) * 100);
const dec = (c: number) => (c / 100).toFixed(2);

/** Что переносим: сумма (коп.) из оплаты производства в оплату закупки. */
type Item = {
  purchase: string;          // номер закупки
  ppSuffix: string;          // хвост id ProductionPayment
  amountC: number;           // сколько переносим, коп.
  ppBeforeC: number;         // ожидаемая сумма ProductionPayment до
  num: string;               // номер п/п
  paidAt: string;            // YYYY-MM-DD
  kind: "PARTIAL" | "ADVANCE";
  docRef: string;
  /** подтверждена ли оплата закупки документами (акт сверки называет п/п, дату и сумму целиком). */
  confirmed: boolean;
  proof: string;             // основание суммы
  ppDocRef?: string;         // новая docRef оплаты производства (если меняется)
  ppNote: string;            // что дописать в notes оплаты производства
  prepend?: boolean;         // дописать в начало notes (для «проверить»)
  note: string;              // notes оплаты закупки
};

const ITEMS: Item[] = [
  {
    purchase: "З-2026-0010", ppSuffix: "e2a53b", amountC: 458450000, ppBeforeC: 566912000, num: "87386", paidAt: "2025-12-22", kind: "PARTIAL",
    docRef: "п/п №87386 от 22.12.2025 · счёт №235 от 04.12.2025 (шкуры свакары подрядчика, 346 шк.)", confirmed: true,
    proof: "расчёт доплаты за 5ю партию (стоимость шкур 4 584 500 = 346 шк. × 13 250), счёт №235 от 04.12.2025 на 5 669 120, акт сверки подряда №1605",
    ppDocRef: "Счёт №235 от 04.12.2025 · работа партии 5 (шкуры подрядчика 4 584 500 ₽ вынесены в оплату закупки З-2026-0010)",
    ppNote: "п/п №87386 от 22.12.2025 целиком 5 669 120,00 = работа 1 084 620,00 (эта запись) + шкуры подрядчика 4 584 500,00 (отдельная оплата закупки З-2026-0010, НЕ работа). Текст выше написан до разделения 08.10.2026.",
    note: "Шкуры подрядчика (свакара 346 шк. × 13 250), оплачены в составе п/п №87386 по счёту №235 — выделено из оплаты производства (работа 1 084 620,00 осталась там).",
  },
  {
    purchase: "З-2026-0011", ppSuffix: "956863", amountC: 46375000, ppBeforeC: 94687000, num: "88911", paidAt: "2025-12-26", kind: "PARTIAL",
    docRef: "п/п №88911 от 26.12.2025 · счёт №239 от 18.12.2025 (шкуры свакары подрядчика, 35 шк.)", confirmed: true,
    proof: "расчёт доплаты за 6ю партию (стоимость шкур 463 750 = 35 шк. × 13 250), счёт №239 от 18.12.2025 на 946 870, акт сверки подряда №1605",
    ppDocRef: "Счёт №239 от 18.12.2025 · работа партии 6 (шкуры подрядчика 463 750 ₽ вынесены в оплату закупки З-2026-0011)",
    ppNote: "п/п №88911 от 26.12.2025 целиком 946 870,00 = работа 483 120,00 (эта запись) + шкуры подрядчика 463 750,00 (отдельная оплата закупки З-2026-0011, НЕ работа). Текст выше написан до разделения 08.10.2026.",
    note: "Шкуры подрядчика (свакара фондю, 35 шк. × 13 250), оплачены в составе п/п №88911 по счёту №239 — выделено из оплаты производства (работа 483 120,00 осталась там).",
  },
  {
    purchase: "З-2026-0012", ppSuffix: "bb7937", amountC: 92750000, ppBeforeC: 207512254, num: "22618", paidAt: "2026-01-21", kind: "PARTIAL",
    docRef: "п/п №22618 от 21.01.2026 · счёт №1 от 15.01.2026 (шкуры подрядчика, ТЗ 79, 70 шк.)", confirmed: false,
    proof: "расчёт доплаты по Партии 7 («стоимость шкур» 1 117 464, из них свакара фондю ТЗ 79 — 952 540; ТЗ-приложение 942 900), счёт №1 от 15.01.2026; лот З-2026-0012 (70 шк. фондю) целиком списан в ТЗ 79 — 927 500 не больше шкур ТЗ 79 по обоим документам",
    ppDocRef: "Счёт №1 от 15.01.2026 · работа партии 7; шкуры подрядчика: 927 500 ₽ вынесены в оплату З-2026-0012, остаток 189 966,22 ₽ — проверить",
    ppNote: "п/п №22618 от 21.01.2026: из шкур подрядчика 1 117 466,22 доказанная документами часть 927 500,00 (закупка З-2026-0012, 70 шк. фондю ТЗ 79) вынесена в отдельную оплату закупки. ПРОВЕРИТЬ: остаток шкур 189 966,22 (разница 25 040 по ТЗ 79: 952 540 по расчёту против 927 500 закупки; мелкие шкуры ТЗ 70–78, 80–83 около 164 926; округление 2,52) остаётся в этой оплате — закупок на него нет. Сумма п/п в акте 2 081 387,54 против 2 075 122,54 здесь (6 265,00, решение владельца К2) не менялась. Текст ниже написан до разделения 08.10.2026.",
    prepend: true,
    note: "Шкуры подрядчика (свакара фондю, 70 шк., ТЗ 79) — доказанная часть шкур партии 7, оплаченных в составе п/п №22618 по счёту №1. Остаток шкур партии 7 (189 966,22) в оплате производства — проверить. Подтверждение ждёт: сумма п/п в акте 2 081 387,54 против 2 075 122,54 (К2), документа закупки нет.",
  },
  {
    purchase: "З-2026-0013", ppSuffix: "c6e48ce6c8fed42392d9f0033", amountC: 42722739, ppBeforeC: 42722739, num: "26829", paidAt: "2026-02-11", kind: "PARTIAL",
    docRef: "п/п №26829 от 11.02.2026 · счёт №7 от 04.02.2026 (шкуры подрядчика партии 9, ТЗ 90)", confirmed: true,
    proof: "расчёт доплаты за пошив партия 9 (шкуры подрядчика 431 040 = 32 шк. × 13 470), счёт №7 от 04.02.2026 (= доплата партии 8 400 625,59 + партии 9 858 427,00 − зачёт аванса №209 831 825,20 = 427 227,39), акт сверки подряда №1605",
    ppDocRef: "Счёт №7 от 04.02.2026 · целиком вынесен в оплату закупки З-2026-0013 (шкуры подрядчика)",
    ppNote: "п/п №26829 от 11.02.2026 целиком 427 227,39 — шкуры подрядчика партии 9 (ТЗ 90, закупка З-2026-0013): вынесен в отдельную оплату закупки, в оплате производства по этой п/п остаётся 0,00 (работа партий 8–9 по счёту №7 закрыта зачётом аванса №209). Текст выше написан до разделения 08.10.2026.",
    note: "Шкуры подрядчика партии 9 (фондю, 32 шк., ТЗ 90): п/п №26829 целиком, часть 1 из 2 (вторая часть 3 812,61 — зачёт аванса №209 в том же счёте №7). 427 227,39 + 3 812,61 = 431 040,00.",
  },
  {
    purchase: "З-2026-0013", ppSuffix: "760880", amountC: 381261, ppBeforeC: 83540520, num: "82173", paidAt: "2025-11-27", kind: "ADVANCE",
    docRef: "п/п №82173 от 27.11.2025 (аванс по счёту №209) · зачёт в счёте №7 от 04.02.2026 (шкуры подрядчика партии 9, ТЗ 90)", confirmed: true,
    proof: "счёт №7 (зачёт остатка аванса №209 831 825,20 = 795 094,03 работа + 36 731,17 на шкуры партий 8–9: 32 918,39 партия 8 ТЗ 84 + 431 040,00 партия 9 − 427 227,39 по п/п 26829 = 3 812,61 на партию 9), акт сверки подряда №1605 (п/п 82173)",
    ppNote: "Из неразнесённой части аванса 36 731,17 вынесено 3 812,61 в оплату закупки З-2026-0013 (шкуры подрядчика партии 9: 431 040,00 = 427 227,39 по п/п 26829 + 3 812,61 отсюда). Остаток неразнесённого 32 918,56 — шкуры подрядчика партии 8 (ТЗ 84), закупки на них нет — проверить. Сумма п/п 82173 целиком в акте 1 766 870,00. Текст выше написан до разделения 08.10.2026.",
    note: "Шкуры подрядчика партии 9, часть 2 из 2: зачёт аванса №209 (п/п №82173 от 27.11.2025) в счёте №7 — 3 812,61; вместе с п/п №26829 (427 227,39) = 431 040,00.",
  },
];

type PPChange = { id: string; amountBefore: string; amountAfter: string; docRefBefore: string | null; docRefAfter: string | null; notesBefore: string | null; notesAfter: string };
type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string;
  payments: string[]; pp: PPChange[];
  state: { key: string; id: string; created: boolean; before: unknown } | null;
};

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { loadClientDebt } = await import("../src/lib/payment-alloc");
  const { loadSupplierDebt } = await import("../src/lib/supplier-debt");
  const { batchOrderInclude, batchTotals } = await import("../src/lib/batch-stats");
  const prisma = new PrismaClient();
  const OUT = process.env.FIX_OUT_DIR ?? INV;
  const JOURNAL = join(OUT, "corrections-journal-contractor-hides-split.json");
  const REPORT = join(OUT, "contractor-hides-split-report.md");

  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    await prisma.$transaction(async (tx) => {
      const d = await tx.payment.deleteMany({ where: { id: { in: j.payments } } });
      let n = 0;
      for (const c of j.pp) {
        const cur = await tx.productionPayment.findUnique({ where: { id: c.id }, select: { notes: true, amount: true } });
        if (cur && cur.notes === c.notesAfter) {
          await tx.productionPayment.update({ where: { id: c.id }, data: { amount: c.amountBefore, docRef: c.docRefBefore, notes: c.notesBefore } });
          n++;
        } else console.log(`  ВНИМАНИЕ: оплата производства ${c.id} изменена после применения — не откатываю автоматически`);
      }
      if (j.state) {
        if (j.state.created) await tx.systemState.deleteMany({ where: { id: j.state.id } });
        else await tx.systemState.updateMany({ where: { id: j.state.id }, data: { value: j.state.before as never } });
      }
      console.log(`Откат: оплат закупок удалено ${d.count}, оплат производства восстановлено ${n} из ${j.pp.length}, решение владельца ${j.state ? (j.state.created ? "снято" : "восстановлено") : "—"}.`);
    });
    writeJson(JOURNAL, { ...j, status: "rolled-back", rolledBackAt: new Date().toISOString() });
    await prisma.$disconnect();
    return;
  }

  const anchor = await prisma.productionPayment.findFirst({ where: { id: { endsWith: "e2a53b" } }, select: { organizationId: true } });
  if (!anchor) throw new Error("Не найден платёж …e2a53b (ожидалась боевая база)");
  const orgId = anchor.organizationId;
  const org = (await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }))!;

  const created: Journal = { script: "apply-contractor-hides-split.ts", status: "applied", at: "", payments: [], pp: [], state: null };

  const run = async (tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => {
    const snap = async () => {
      const sd = await loadSupplierDebt(tx as never, orgId);
      const cd = await loadClientDebt(tx, orgId, { year: "all" });
      const batches = await tx.productionBatch.findMany({ where: { organizationId: orgId }, include: { orders: { include: batchOrderInclude } }, orderBy: { number: "asc" } });
      const sumPay = await tx.payment.aggregate({ where: { organizationId: orgId, status: "COMPLETED" }, _sum: { amount: true } });
      const sumPP = await tx.productionPayment.aggregate({ where: { organizationId: orgId, status: "COMPLETED" }, _sum: { amount: true } });
      const purch = await tx.purchase.findMany({ where: { organizationId: orgId, number: { in: ["З-2026-0010", "З-2026-0011", "З-2026-0012", "З-2026-0013", "З-2026-0001"] } }, select: { number: true, payments: { where: { status: "COMPLETED" }, select: { amount: true } } } });
      return {
        sd, cd, sumPay: cents(sumPay._sum.amount ?? 0), sumPP: cents(sumPP._sum.amount ?? 0),
        paidByPurchase: Object.fromEntries(purch.map((p) => [p.number, p.payments.reduce((s, x) => s + cents(x.amount), 0)])),
        batches: batches.map((b) => ({ number: b.number, t: batchTotals(b.orders) })),
      };
    };
    const before = await snap();
    const problems: string[] = [];
    const rows: { item: Item; ppId: string; purchaseId: string; state: string; ppAfterC: number }[] = [];

    // текущие суммы оплат производства (с учётом нескольких частей одной оплаты)
    const ppState = new Map<string, { amountC: number; docRef: string | null; notes: string | null; allocC: number; before: { amount: string; docRef: string | null; notes: string | null } }>();
    const getPP = async (suffix: string) => {
      const p = await tx.productionPayment.findFirst({ where: { organizationId: orgId, id: { endsWith: suffix } }, select: { id: true, amount: true, docRef: true, notes: true, allocations: { select: { amount: true } } } });
      if (!p) throw new Error(`Не найдена оплата производства …${suffix}`);
      if (!ppState.has(p.id)) ppState.set(p.id, { amountC: cents(p.amount), docRef: p.docRef, notes: p.notes, allocC: p.allocations.reduce((s, a) => s + cents(a.amount), 0), before: { amount: p.amount.toString(), docRef: p.docRef, notes: p.notes } });
      return p.id;
    };

    for (const it of ITEMS) {
      const ppId = await getPP(it.ppSuffix);
      const st = ppState.get(ppId)!;
      const pu = await tx.purchase.findFirst({ where: { organizationId: orgId, number: it.purchase }, select: { id: true, supplierId: true, supplier: { select: { name: true } } } });
      if (!pu) { problems.push(`Закупка ${it.purchase} не найдена`); continue; }
      if (!/Веллмех/i.test(pu.supplier.name)) problems.push(`${it.purchase}: поставщик «${pu.supplier.name}» — платим только посреднику Веллмех`);
      const dup = await tx.payment.findFirst({ where: { organizationId: orgId, purchaseId: pu.id, notes: { contains: TAG }, docRef: { contains: `№${it.num} ` } }, select: { id: true } });
      if (dup) { rows.push({ item: it, ppId, purchaseId: pu.id, state: "уже выполнено (пропуск)", ppAfterC: st.amountC }); continue; }
      if (st.amountC !== it.ppBeforeC) { problems.push(`${it.purchase}: оплата производства …${it.ppSuffix} = ${rub(st.amountC)}, ожидалось ${rub(it.ppBeforeC)}`); continue; }
      const afterC = st.amountC - it.amountC;
      if (afterC < st.allocC) { problems.push(`${it.purchase}: после переноса ${rub(afterC)} меньше разнесённого на ТЗ ${rub(st.allocC)} — работа бы потеряла оплату`); continue; }
      const paymentId = cid();
      await tx.payment.create({
        data: {
          id: paymentId, organizationId: orgId, supplierId: pu.supplierId, purchaseId: pu.id, amount: dec(it.amountC), currency: "RUB", method: "BANK_TRANSFER", status: "COMPLETED",
          paidAt: new Date(`${it.paidAt}T00:00:00.000Z`), kind: it.kind === "ADVANCE" ? "PARTIAL" : it.kind, docRef: it.docRef,
          confirmed: true, confirmedAt: it.confirmed ? new Date() : null, confirmedBy: it.confirmed ? `акт сверки Меркури Мода–Веллмех (подряд №1605) на 30.06.2026: п/п №${it.num}; основание суммы: ${it.proof}` : null,
          notes: `[шкуры подрядчика] ${it.note}\nОснование суммы: ${it.proof}.\nИсточник п/п: ${ACT}. Решение владельца 08.10.2026: закупки шкур подрядчика сохраняются, их оплата — отдельная запись, а не работа производства. ${TAG}`,
        },
      });
      created.payments.push(paymentId);
      st.amountC = afterC;
      st.docRef = it.ppDocRef ?? st.docRef;
      const add = `${TAG} ${it.ppNote}`;
      st.notes = it.prepend ? `${add}\n${st.notes ?? ""}` : `${st.notes ?? ""}\n${add}`;
      rows.push({ item: it, ppId, purchaseId: pu.id, state: "перенос", ppAfterC: afterC });
    }

    for (const [id, st] of ppState) {
      if (st.notes === st.before.notes && st.amountC === cents(st.before.amount)) continue;
      await tx.productionPayment.update({ where: { id }, data: { amount: dec(st.amountC), docRef: st.docRef, notes: st.notes } });
      created.pp.push({ id, amountBefore: st.before.amount, amountAfter: dec(st.amountC), docRefBefore: st.before.docRef, docRefAfter: st.docRef, notesBefore: st.before.notes, notesAfter: st.notes! });
    }

    // решение владельца в «Контроль → Задачи → Решения владельца»
    const existingState = await tx.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: DECISION_KEY } } });
    const value = {
      choice: "hides-model",
      label: "Решено владельцем: модель «шкуры подрядчика», закупки сохранены",
      note: "08.10.2026, решение владельца в чате: З-2026-0010, 0011, 0013 равны шкурам в уже оплаченных доплатах (5 479 290,00); З-2026-0012 — доказанная часть 927 500,00, остаток шкур партии 7 (189 966,22) — проверить; З-2026-0001 (880 000,01) входит в неоплаченный счёт №237 — остаётся долгом. Закупки не удалены: шкурная часть оплат вынесена в отдельные оплаты закупок (скрипт apply-contractor-hides-split.ts, откат --rollback).",
      at: new Date().toISOString(), by: null, byName: "Владелец (решение в чате 08.10.2026)",
    };
    if (!existingState || (existingState.value as { choice?: string }).choice !== "hides-model") {
      if (existingState) { await tx.systemState.update({ where: { id: existingState.id }, data: { value } }); created.state = { key: DECISION_KEY, id: existingState.id, created: false, before: existingState.value }; }
      else { const id = cid(); await tx.systemState.create({ data: { id, organizationId: orgId, key: DECISION_KEY, value, updatedAt: new Date() } }); created.state = { key: DECISION_KEY, id, created: true, before: null }; }
    }

    const after = await snap();

    // ---- проверки
    const moved = rows.filter((r) => r.state === "перенос").reduce((s, r) => s + r.item.amountC, 0);
    if (Math.abs(after.cd.billable - before.cd.billable) > 0.005) problems.push("работа заказчиков изменилась");
    for (const b of before.batches) {
      const a = after.batches.find((x) => x.number === b.number)!;
      if (!a.t.work.equals(b.t.work) || !a.t.cost.equals(b.t.cost)) problems.push(`партия ${b.number}: изменилась работа/себестоимость`);
      if (!a.t.paid.equals(b.t.paid)) problems.push(`партия ${b.number}: изменилось «оплачено по работе» (${b.t.paid} → ${a.t.paid})`);
    }
    if (before.sumPay + before.sumPP !== after.sumPay + after.sumPP) problems.push(`сумма денег по обеим таблицам изменилась: ${rub(before.sumPay + before.sumPP)} → ${rub(after.sumPay + after.sumPP)}`);
    if (after.sumPay - before.sumPay !== moved) problems.push(`оплаты поставщику выросли на ${rub(after.sumPay - before.sumPay)}, ожидалось ${rub(moved)}`);
    const dDebt = cents(before.sd.debt.toString()) - cents(after.sd.debt.toString());
    if (Math.abs(dDebt - moved) > 1) problems.push(`долг поставщику уменьшился на ${rub(dDebt)}, ожидалось ${rub(moved)}`);
    const dClient = cents(after.cd.balance) - cents(before.cd.balance);
    if (Math.abs(dClient - moved) > 1) problems.push(`долг заказчиков вырос на ${rub(dClient)}, ожидалось ${rub(moved)}`);
    return { before, after, rows, problems, moved, dDebt, dClient };
  };

  type Res = Awaited<ReturnType<typeof run>>;
  let res: Res | null = null;
  try {
    await prisma.$transaction(async (tx) => { Object.assign(created, { payments: [], pp: [], state: null }); res = await run(tx); throw new DryRun(); }, { timeout: 180000, maxWait: 30000 });
  } catch (e) { if (!(e instanceof DryRun)) throw e; }
  const r = res as unknown as Res;
  const f2 = (n: number | string | { toString(): string }) => Number(n.toString()).toFixed(2);

  const out: string[] = [`# Шкуры подрядчика: разделение «работа / шкуры» — ${APPLY ? "ПРИМЕНЕНИЕ" : "сухой прогон"}`, "", `Дата: ${new Date().toISOString()} · организация: ${org.name}`, "Основание: решение владельца 08.10.2026 (К8, К9, Е2). Закупки сохранены; шкурная часть вынесена в отдельные оплаты закупок.", ""];
  out.push("| Оплата производства (п/п) | Закупка | Перенос, ₽ | Документ (источник суммы) | Эффект |", "|---|---|---:|---|---|");
  for (const x of r.rows) {
    const it = x.item;
    out.push(`| п/п №${it.num} от ${it.paidAt.split("-").reverse().join(".")} (${rub(it.ppBeforeC)} → ${rub(x.ppAfterC)}) | ${it.purchase} | ${rub(it.amountC)} | ${it.proof} | ${x.state}; оплата закупки ${it.confirmed ? "подтверждена" : "ждёт подтверждения"} |`);
  }
  out.push("", "### ДО → ПОСЛЕ (внутри одной транзакции; тестовые записи агента клик-проверок вычитаются из дельт)", "");
  out.push(`- Долг поставщику: ${f2(r.before.sd.debt)} → ${f2(r.after.sd.debt)} (−${rub(r.dDebt)}); части: к оплате по УПД и счетам ${f2(r.before.sd.receivedNet)} → ${f2(r.after.sd.receivedNet)}, счёт выставлен ${f2(r.before.sd.invoiced)} → ${f2(r.after.sd.invoiced)}, ожидаемое ${f2(r.before.sd.expected)} → ${f2(r.after.sd.expected)}`);
  out.push(`- Оплаты закупкам и аукционам Σ: ${rub(r.before.sumPay)} → ${rub(r.after.sumPay)}; оплаты производства Σ: ${rub(r.before.sumPP)} → ${rub(r.after.sumPP)}; вместе: ${rub(r.before.sumPay + r.before.sumPP)} → ${rub(r.after.sumPay + r.after.sumPP)}`);
  out.push(`- Долг заказчиков: ${f2(r.before.cd.balance)} → ${f2(r.after.cd.balance)} (+${rub(r.dClient)}); работа ${f2(r.before.cd.billable)} → ${f2(r.after.cd.billable)}; оплачено ${f2(r.before.cd.paid)} → ${f2(r.after.cd.paid)}; неразнесено: аванс ${f2(r.before.cd.unallocatedByKind.advance)} → ${f2(r.after.cd.unallocatedByKind.advance)}, сверх работы ${f2(r.before.cd.unallocatedByKind.excess)} → ${f2(r.after.cd.unallocatedByKind.excess)}`);
  out.push(`- Оплачено по закупкам: ${Object.entries(r.after.paidByPurchase).map(([k, v]) => `${k} ${rub(r.before.paidByPurchase[k] ?? 0)} → ${rub(v)}`).join("; ")}`);
  out.push("", "| Партия | Работа | Оплачено по работе до | после | Валовая оплата до | после | Неразнесено до | после |", "|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const b of r.before.batches) {
    const a = r.after.batches.find((x) => x.number === b.number)!;
    if (b.t.orders === 0) continue;
    out.push(`| ${b.number} | ${f2(b.t.work)} | ${f2(b.t.paid)} | ${f2(a.t.paid)} | ${f2(b.t.paidGross)} | ${f2(a.t.paidGross)} | ${f2(b.t.unallocated)} | ${f2(a.t.unallocated)} |`);
  }
  if (r.problems.length) out.push("", "### ПРОБЛЕМЫ — применять нельзя", ...r.problems.map((p) => `- ${p}`));

  console.log(`[${org.name}] переносов: ${r.rows.filter((x) => x.state === "перенос").length} на ${rub(r.moved)}`);
  for (const x of r.rows) console.log(`  ${x.item.purchase} ← п/п ${x.item.num}: ${rub(x.item.amountC)} (оплата произв. → ${rub(x.ppAfterC)}) — ${x.state}`);
  console.log(`  долг поставщику: ${f2(r.before.sd.debt)} → ${f2(r.after.sd.debt)} (Δ ${rub(r.dDebt)})`);
  console.log(`  долг заказчиков: ${f2(r.before.cd.balance)} → ${f2(r.after.cd.balance)} (Δ +${rub(r.dClient)})`);
  console.log(`  Σ оплат поставщику: ${rub(r.before.sumPay)} → ${rub(r.after.sumPay)}; Σ оплат производства: ${rub(r.before.sumPP)} → ${rub(r.after.sumPP)}; вместе ${rub(r.before.sumPay + r.before.sumPP)} → ${rub(r.after.sumPay + r.after.sumPP)}`);
  if (r.problems.length) console.log("  ПРОБЛЕМЫ: " + r.problems.join("; "));

  const nothing = r.rows.every((x) => x.state.startsWith("уже")) && !created.state;
  if (APPLY && !r.problems.length && !nothing) {
    if (!NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
    const live: Journal = { script: "apply-contractor-hides-split.ts", status: "applied", at: new Date().toISOString(), payments: [], pp: [], state: null };
    let fin: Res | null = null;
    await prisma.$transaction(async (tx) => {
      Object.assign(created, { payments: [], pp: [], state: null });
      fin = await run(tx);
      if ((fin as Res).problems.length) throw new Error((fin as Res).problems.join("; "));
      Object.assign(live, { payments: created.payments, pp: created.pp, state: created.state });
      writeJson(JOURNAL, live);
    }, { timeout: 180000, maxWait: 30000 });
    console.log(`Применено: оплат закупок ${live.payments.length}, оплат производства изменено ${live.pp.length}, решение владельца ${live.state ? "записано" : "уже было"}. Журнал: ${JOURNAL}`);
    out.push("", `Применено: оплат закупок ${live.payments.length}, оплат производства изменено ${live.pp.length}. Журнал: corrections-journal-contractor-hides-split.json`);
    writeFileSync(REPORT, out.join("\n"));
  } else if (APPLY && nothing) {
    console.log("Нечего применять (идемпотентно).");
  } else if (!APPLY) {
    console.log("Сухой прогон: БД не изменена. Для применения: --apply");
    writeFileSync(REPORT, out.join("\n"));
  }
  console.log(`Отчёт: ${REPORT}`);
  await prisma.$disconnect();
  if (r.problems.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
