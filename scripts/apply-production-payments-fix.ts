/**
 * Оплаты производства: сверка с актом сверки Меркури Мода ↔ Веллмех на 30.06.2026 (договор подряда №1605)
 * — Drive «мех» → «доп материал» → «акт сверки» → «баланс всех оплат мех.xlsx». Только 100% подтверждённое документами.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-production-payments-fix.ts            # сухой прогон (БД не меняется), отчёт
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-production-payments-fix.ts --apply    # применить (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-production-payments-fix.ts --rollback # откат по журналу
 *
 * Что делает:
 *  1) Заводит 8 платежей, которых не было в базе, но которые есть в акте сверки с п/п, датой и суммой:
 *       26829 11.02.2026 427 227,39 (счёт №7) · 29370 25.02.2026 303 372 (№41) · 30903 04.03.2026 347 895 (№51) · 32580 12.03.2026 1 183 135 (№65)
 *       40307 21.04.2026 217 350 (№63, ТЗ 110) · 40308 21.04.2026 183 400 (№71) · 46523 28.05.2026 218 860 (№135, ТЗ 116) · 46537 28.05.2026 248 000 (№145, ТЗ 117).
 *  2) Привязывает их к ТЗ (ProductionPaymentOrder) и разносит (PaymentAllocation): платежи 29370/30903/32580/40307/40308/46537 = работе ТЗ до копейки;
 *     аванс 760880 (835 405,20, остаток по счёту №209): 3 580 → ТЗ 97 (расчёт партии 10: «Оплачено аванс 3 580») и остальное в зачёт работы
 *     партий 8–9 (счёт №7 = доплата партии 8 400 625,59 + партии 9 858 427,00 − зачёт аванса 831 825,20 = 427 227,39).
 *  3) К 20 существующим платежам, подтверждённым актом, дописывает п/п № и ссылку на акт (в notes). Суммы и даты существующих не меняются.
 * НЕ делает (решения владельца, см. OPEN-QUESTIONS К): сумма п/п 22618 (6 265), разделение «работа / шкуры подрядчика», сторно З-2026-0001/0010…0013,
 *   авансы №141/№143 (после периода акта и без разбивки по ТЗ).
 * Безопасность: всё в одной транзакции; ДО/ПОСЛЕ считаются долг заказчиков (без фильтров) и итоги партий (работа/себестоимость не должны меняться;
 *   долг должен измениться ровно на ожидаемую сумму). Нарушение — откат без записи. Идемпотентно (метка [fix:ACT-30062026] в notes).
 * Журнал: docs-inventory/corrections-journal-production-payments-fix.json. Отчёт: docs-inventory/production-payments-fix-report.md.
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
const TAG = "[fix:ACT-30062026]";
const ACT = "акт сверки ММ ↔ Веллмех на 30.06.2026 (Drive «мех»/доп материал/акт сверки/баланс всех оплат мех.xlsx, договор подряда №1605)";

class DryRun extends Error {}
const rub = (c: number) => (c / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ");
const cid = () => "c" + randomBytes(12).toString("hex");

type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string;
  payments: string[]; links: string[]; allocations: string[];
  notes: { id: string; before: string | null; after: string }[];
};

type NewPay = {
  pp: string; date: string; amount: string; docRef: string; type: "PARTIAL";
  text: string;
  /** выбор ТЗ набора */
  sel: (o: Ord) => boolean;
};
type Ord = { id: string; number: string; wo: string | null; batch: number | null; status: string; planned: unknown; produced: unknown; price: unknown; clientId: string | null };

const NEW: NewPay[] = [
  { pp: "26829", date: "2026-02-11", amount: "427227.39", docRef: "Счёт №7 от 04.02.2026", type: "PARTIAL",
    text: "Доплата за пошив (26 ед.), договор подряда №1605. Счёт №7 = доплата партии 8 (400 625,59) + партии 9 (858 427,00: работа 427 387 + шкуры подрядчика 431 040) − зачёт остатка аванса №209 (831 825,20) = 427 227,39 (расчёты «расчет пошива 8 партии», «расчет доплаты за пошив партия 9», баланс 040226). Разнесение: работа партий 8–9 закрыта авансом 760880 (831 825,20) в первую очередь; этот платёж остаётся «сверх работы» (шкуры подрядчика: партия 8 — 32 918,39, партия 9 — 431 040,00 = З-2026-0013).",
    sel: (o) => o.batch === 8 || o.batch === 9 },
  { pp: "29370", date: "2026-02-25", amount: "303372.00", docRef: "Счёт №41 от 18.02.2026", type: "PARTIAL",
    text: "Доплата за пошив (26 ед.), партия 10 (ТЗ 97–100): 149 240 (ТЗ 97 за вычетом аванса 3 580) + 86 922 + 26 535 + 40 675 по расчёту «расчет доплаты за пошив (партия 10)». Разнесено по работе ТЗ полностью.",
    sel: (o) => o.batch === 10 },
  { pp: "30903", date: "2026-03-04", amount: "347895.00", docRef: "Счёт №51 от 24.02.2026", type: "PARTIAL",
    text: "Доплата за пошив (14 ед.), партия 11 (ТЗ 101–104), расчёт «расчет доплаты за пошив (партия 11)» = 347 895. Разнесено по работе ТЗ полностью.",
    sel: (o) => o.batch === 11 },
  { pp: "32580", date: "2026-03-12", amount: "1183135.00", docRef: "Счёт №65 от 02.03.2026", type: "PARTIAL",
    text: "Пошив ТЗ 105–109 (партия 12, аксессуары): 8 135 + 225 000 + 300 000 + 400 000 + 250 000 по расчёту «расчет доплаты за пошив (партия 12)». Разнесено по работе ТЗ полностью.",
    sel: (o) => o.batch === 12 && o.wo != null && Number(o.wo) >= 105 && Number(o.wo) <= 109 },
  { pp: "40307", date: "2026-04-21", amount: "217350.00", docRef: "Счёт №63 от 02.03.2026", type: "PARTIAL",
    text: "Жилет М003 из соболя, ТЗ 110 (партия 12): 217 350 по расчёту партии 12. В акте назначение платежа названо «Договор купли-продажи №2502 … ТЗ 110», по сумме и ТЗ это счёт №63 на пошив. Разнесено полностью.",
    sel: (o) => o.wo === "110" },
  { pp: "40308", date: "2026-04-21", amount: "183400.00", docRef: "Счёт №71 от 06.03.2026", type: "PARTIAL",
    text: "Доплата за пошив (20 ед.), партия 13 (ТЗ 111, 112): 77 200 + 106 200 по расчёту «расчет доплаты за пошив Партия 13». Разнесено полностью.",
    sel: (o) => o.batch === 13 },
  { pp: "46523", date: "2026-05-28", amount: "218860.00", docRef: "Счёт №135 от 07.05.2026", type: "PARTIAL",
    text: "Ремонт пальто (7 ед.), ТЗ 116 (П-2026-0183): работа 218 860 по счёту №135 (материал 164 470,44 в этот платёж не входит). У ТЗ 116 в приложении нет заказчика — работа ТЗ вне «Долга заказчиков», поэтому разнесение на ТЗ долг не меняет. 0,03 ₽ — округление цены работы в приложении (31 265,71 × 7 = 218 859,97).",
    sel: (o) => o.wo === "116" },
  { pp: "46537", date: "2026-05-28", amount: "248000.00", docRef: "Счёт №145 от 21.05.2026", type: "PARTIAL",
    text: "Производство кейпа из меха соболя, ТЗ 117 (П-2026-0122): 248 000 (100% работы). Разнесено полностью.",
    sel: (o) => o.wo === "117" },
];

/** Существующие платежи: суффикс id → п/п и дата по акту. */
const EXISTING_PP: { ids: string[]; pp: string; date: string; total: string; why: string }[] = [
  { ids: ["cab13b", "45ki5n", "t67j3d", "qzjnlc", "a15cim", "6m68kk", "ijxx7i", "ooz117"], pp: "60610", date: "04.08.2025", total: "21 627 900,00", why: "аванс 70% от предварительного расчёта за пошив (одна п/п разнесена по партиям 1–8)" },
  { ids: ["3e4b8f"], pp: "71143", date: "02.10.2025", total: "1 866 490,00", why: "доплата за пошив, 41 ед." },
  { ids: ["7319d0"], pp: "73674", date: "15.10.2025", total: "1 208 570,00", why: "доплата за пошив, 23 ед." },
  { ids: ["efccf7"], pp: "74972", date: "22.10.2025", total: "2 081 360,00", why: "доплата за пошив, 34 ед." },
  { ids: ["4f843e"], pp: "80511", date: "20.11.2025", total: "1 759 800,00", why: "доплата за пошив, 30 ед." },
  { ids: ["760880", "prnz67", "10edop", "lw4bml", "k0f4a9"], pp: "82173", date: "27.11.2025", total: "1 766 870,00", why: "аванс 70% за пошив аксессуаров (одна п/п разнесена по частям)" },
  { ids: ["e2a53b"], pp: "87386", date: "22.12.2025", total: "5 669 120,00", why: "доплата за пошив, 25 ед. (в т.ч. шкуры подрядчика)" },
  { ids: ["956863"], pp: "88911", date: "26.12.2025", total: "946 870,00", why: "доплата за пошив, 37 ед. (в т.ч. шкуры подрядчика)" },
  { ids: ["bb7937"], pp: "22618", date: "21.01.2026", total: "2 081 387,54", why: "доплата за пошив, 50 ед. (в т.ч. шкуры подрядчика)" },
];

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { planAutoAllocations, orderWorkCents, loadClientDebt, AUTO_NOTE } = await import("../src/lib/payment-alloc");
  const { checkAllocation, fromCents, toCents } = await import("../src/lib/payment-alloc-core");
  const { batchOrderInclude, batchTotals } = await import("../src/lib/batch-stats");
  const prisma = new PrismaClient();
  const OUT = process.env.FIX_OUT_DIR ?? INV;
  const JOURNAL = join(OUT, "corrections-journal-production-payments-fix.json");
  const REPORT = join(OUT, "production-payments-fix-report.md");

  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    await prisma.$transaction(async (tx) => {
      const a = await tx.paymentAllocation.deleteMany({ where: { id: { in: j.allocations } } });
      const l = await tx.productionPaymentOrder.deleteMany({ where: { id: { in: j.links } } });
      const p = await tx.productionPayment.deleteMany({ where: { id: { in: j.payments } } });
      let n = 0;
      for (const x of j.notes) {
        const cur = await tx.productionPayment.findUnique({ where: { id: x.id }, select: { notes: true } });
        if (cur && cur.notes === x.after) { await tx.productionPayment.update({ where: { id: x.id }, data: { notes: x.before } }); n++; }
      }
      console.log(`Откат: разнесений ${a.count}, связей ${l.count}, платежей ${p.count}, notes восстановлено ${n} из ${j.notes.length}.`);
    });
    writeJson(JOURNAL, { ...j, status: "rolled-back", rolledBackAt: new Date().toISOString() });
    await prisma.$disconnect();
    return;
  }

  const anchor = await prisma.productionPayment.findFirst({ where: { id: { endsWith: "e2a53b" } }, select: { organizationId: true } });
  if (!anchor) throw new Error("Не найден платёж …e2a53b (ожидалась боевая база)");
  const org = (await prisma.organization.findUnique({ where: { id: anchor.organizationId }, select: { id: true, name: true } }))!;
  const orgId = org.id;

  const out: string[] = [`# Оплаты производства: сверка с актом сверки на 30.06.2026 — ${APPLY ? "ПРИМЕНЕНИЕ" : "сухой прогон"}`, "", `Дата: ${new Date().toISOString()}`, `Источник: ${ACT}.`, ""];
  let failure: string | null = null;
  let backupDone = false;
  const created: Journal = { script: "apply-production-payments-fix.ts", status: "applied", at: "", payments: [], links: [], allocations: [], notes: [] };

  const run = async (tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => {
    const snap = async () => {
      const debt = await loadClientDebt(tx, orgId, { year: "all" });
      const batches = await tx.productionBatch.findMany({ where: { organizationId: orgId }, include: { orders: { include: batchOrderInclude } }, orderBy: { number: "asc" } });
      return { debt, batches: batches.map((b) => ({ number: b.number, t: batchTotals(b.orders) })) };
    };
    const before = await snap();

    const ordsRaw = await tx.productionOrder.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" } },
      select: { id: true, number: true, workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, clientId: true, batch: { select: { number: true } } },
    });
    const ords: Ord[] = ordsRaw.map((o) => ({ id: o.id, number: o.number, wo: o.workOrderNumber, batch: o.batch?.number ?? null, status: o.status, planned: o.plannedQuantity, produced: o.producedQuantity, price: o.clientWorkPricePerUnit, clientId: o.clientId }));
    const ordById = new Map(ords.map((o) => [o.id, o]));
    const workOf = (o: Ord) => orderWorkCents({ status: o.status, plannedQuantity: o.planned as never, producedQuantity: o.produced as never, clientWorkPricePerUnit: o.price as never });
    const lab = (o: Ord) => `ТЗ ${o.wo ?? "?"} (${o.number}${o.batch ? `, п.${o.batch}` : ""})`;

    const allPays = await tx.productionPayment.findMany({ where: { organizationId: orgId }, select: { id: true, amount: true, notes: true, clientId: true, status: true } });
    const mmClient = allPays.find((p) => p.id.endsWith("e2a53b"))?.clientId ?? null;
    if (!mmClient) throw new Error("Не найден заказчик (платёж …e2a53b)");

    // существующие разнесения по ТЗ (платежи не отменены)
    const existing = new Map<string, number>();
    for (const a of await tx.paymentAllocation.findMany({ where: { organizationId: orgId, productionPayment: { status: { not: "CANCELLED" } } }, select: { productionOrderId: true, amount: true } }))
      existing.set(a.productionOrderId, (existing.get(a.productionOrderId) ?? 0) + toCents(a.amount));

    const rows: { pp: string; id: string; date: string; amount: number; links: string[]; lines: { orderId: string; c: number }[]; rest: number; state: string; why: string; source: string }[] = [];
    const problems: string[] = [];

    // ---- 1) новые платежи
    const newIds = new Map<string, string>();
    for (const n of NEW) {
      const mark = `п/п №${n.pp}`;
      const dup = allPays.find((p) => (p.notes ?? "").includes(TAG) && (p.notes ?? "").includes(`${mark} от`));
      const set = ords.filter(n.sel);
      if (!set.length) { problems.push(`п/п ${n.pp}: не найден набор ТЗ`); continue; }
      if (dup) { rows.push({ pp: n.pp, id: dup.id, date: n.date, amount: toCents(n.amount), links: set.map(lab), lines: [], rest: 0, state: "уже заведён (пропуск)", why: "", source: "" }); newIds.set(n.pp, dup.id); continue; }
      const id = cid();
      newIds.set(n.pp, id);
      const dd = n.date.split("-").reverse().join(".");
      await tx.productionPayment.create({
        data: {
          id, organizationId: orgId, amount: n.amount, method: "BANK_TRANSFER", status: "COMPLETED", paidAt: new Date(`${n.date}T00:00:00.000Z`),
          clientId: mmClient, paymentType: n.type, confirmed: true, docRef: n.docRef,
          notes: `${n.text}\nПодтверждено: ${mark} от ${dd}, ${ACT}. ${TAG}`,
        },
      });
      created.payments.push(id);
      const linkRows = set.map((o) => ({ id: cid(), productionPaymentId: id, productionOrderId: o.id }));
      await tx.productionPaymentOrder.createMany({ data: linkRows });
      for (const l of linkRows) created.links.push(l.id);
    }

    // ---- 2) аванс 760880: 3 580 → ТЗ 97, остальное → работа партий 8–9 (если ещё не разнесён)
    const p1 = allPays.find((p) => p.id.endsWith("760880"))!;
    const p1Allocs = await tx.paymentAllocation.count({ where: { productionPaymentId: p1.id } });
    const p1Lines: { orderId: string; c: number }[] = [];
    if (p1Allocs === 0) {
      const tz97 = ords.find((o) => o.wo === "97");
      if (!tz97) throw new Error("ТЗ 97 не найден");
      const set89 = ords.filter((o) => o.batch === 8 || o.batch === 9);
      p1Lines.push({ orderId: tz97.id, c: 358000 });
      let sum = 0;
      for (const o of set89) {
        const rem = Math.max(0, workOf(o) - (existing.get(o.id) ?? 0));
        if (rem > 0) { p1Lines.push({ orderId: o.id, c: rem }); sum += rem; }
      }
      if (sum > 83182520) problems.push(`аванс 760880: работа партий 8–9 (${rub(sum)}) больше зачёта по счёту №7 (831 825,20)`);
      const err = checkAllocation(toCents(p1.amount), p1Lines.map((l) => ({ orderId: l.orderId, amountCents: l.c })));
      if (err) problems.push(`аванс 760880: ${err}`);
      const links = set89.map((o) => o.id); // ТЗ 97 — только строкой разнесения (иначе остаток аванса попадал бы в «неразнесено» партии 10)
      const have = new Set((await tx.productionPaymentOrder.findMany({ where: { productionPaymentId: p1.id }, select: { productionOrderId: true } })).map((x) => x.productionOrderId));
      const add = links.filter((id) => !have.has(id)).map((id) => ({ id: cid(), productionPaymentId: p1.id, productionOrderId: id }));
      if (add.length) { await tx.productionPaymentOrder.createMany({ data: add }); for (const l of add) created.links.push(l.id); }
      const arows = p1Lines.map((l) => ({
        id: cid(), organizationId: orgId, productionPaymentId: p1.id, productionOrderId: l.orderId, amount: fromCents(l.c), source: "MANUAL" as const,
        note: l.orderId === tz97.id ? `3 580 — аванс по ТЗ 97 в расчёте партии 10 (счёт №41) ${TAG}` : `Зачёт аванса в счёте №7 (партии 8–9): остаток работы ТЗ ${TAG}`,
      }));
      await tx.paymentAllocation.createMany({ data: arows });
      for (const r of arows) created.allocations.push(r.id);
      for (const l of p1Lines) existing.set(l.orderId, (existing.get(l.orderId) ?? 0) + l.c);
      rows.push({ pp: "82173 (аванс …760880)", id: p1.id, date: "2025-11-27", amount: toCents(p1.amount), links: [`ТЗ 97 + ${set89.length} ТЗ партий 8–9`], lines: p1Lines, rest: toCents(p1.amount) - p1Lines.reduce((s, l) => s + l.c, 0), state: "разнесён", why: "3 580 → ТЗ 97; остаток работы партий 8–9 по счёту №7", source: "MANUAL" });
      const tag = `${TAG} Разнесение: 3 580,00 → ТЗ 97 (расчёт партии 10: «Оплачено аванс 3 580»); ${rub(sum)} → работа ТЗ партий 8–9 (зачёт аванса 831 825,20 в счёте №7 от 04.02.2026); остаток ${rub(toCents(p1.amount) - p1Lines.reduce((s, l) => s + l.c, 0))} — часть зачёта, пошедшая на шкуры подрядчика партий 8–9 (463 958,56 = 32 918,39 + 431 040,00 + 0,17 округление работы).`;
      created.notes.push({ id: p1.id, before: p1.notes, after: "" });
      p1.notes = `${p1.notes ?? ""}\n${tag}`;
      created.notes[created.notes.length - 1].after = p1.notes;
      await tx.productionPayment.update({ where: { id: p1.id }, data: { notes: p1.notes } });
    }

    // ---- 3) авторазнесение новых платежей по работе ТЗ (по порядку оплаты)
    const todo = NEW.filter((n) => created.payments.includes(newIds.get(n.pp)!));
    const plan = planAutoAllocations(
      todo.map((n) => ({ id: newIds.get(n.pp)!, amountCents: toCents(n.amount), paidAt: new Date(`${n.date}T00:00:00.000Z`).getTime(), createdAt: Date.now(), linkedOrderIds: ords.filter(n.sel).map((o) => o.id) })),
      new Map(ords.map((o) => [o.id, { id: o.id, workCents: workOf(o), live: true }])),
      existing,
    );
    for (const r of plan) {
      const n = NEW.find((x) => newIds.get(x.pp) === r.paymentId)!;
      const err = checkAllocation(toCents(n.amount), r.lines);
      if (err) problems.push(`п/п ${n.pp}: ${err}`);
      const arows = r.lines.map((l) => ({ id: cid(), organizationId: orgId, productionPaymentId: r.paymentId, productionOrderId: l.orderId, amount: fromCents(l.amountCents), source: "AUTO" as const, note: `${AUTO_NOTE} ${TAG}` }));
      if (arows.length) await tx.paymentAllocation.createMany({ data: arows });
      for (const a of arows) created.allocations.push(a.id);
      rows.push({ pp: n.pp, id: r.paymentId, date: n.date, amount: toCents(n.amount), links: ords.filter(n.sel).map(lab), lines: r.lines.map((l) => ({ orderId: l.orderId, c: l.amountCents })), rest: r.unallocatedCents, state: "заведён", why: r.why, source: "AUTO" });
      // ожидания: платежи по ТЗ без смешанного зачёта должны закрыть работу до копейки
      if (!["26829", "46523"].includes(n.pp) && Math.abs(r.unallocatedCents) > 1) problems.push(`п/п ${n.pp}: не разнесено ${rub(r.unallocatedCents)} (ожидалось 0)`);
      if (n.pp === "46523" && r.unallocatedCents !== 3) problems.push(`п/п 46523: остаток ${rub(r.unallocatedCents)} (ожидалось 0,03)`);
      if (n.pp === "26829" && r.lines.length) problems.push("п/п 26829: ожидалось, что работа партий 8–9 уже закрыта авансом 760880");
    }

    // ---- 4) дописать п/п № существующим платежам
    const noteLog: string[] = [];
    for (const g of EXISTING_PP) {
      for (const suf of g.ids) {
        const p = allPays.find((x) => x.id.endsWith(suf));
        if (!p) { problems.push(`платёж …${suf} не найден`); continue; }
        if ((p.notes ?? "").includes(`${TAG} п/п №${g.pp}`)) continue;
        if (suf === "760880" && p1Allocs === 0) { // уже дописали выше — добавим п/п отдельной строкой
        }
        let add = `${TAG} п/п №${g.pp} от ${g.date}: ${g.why}; сумма п/п целиком ${g.total} — ${ACT}.`;
        if (suf === "bb7937") add += ` ВНИМАНИЕ: в акте сумма п/п 2 081 387,54, в приложении 2 075 122,54 (по счёту №1); разница 6 265,00 — решение владельца, сумма не менялась.`;
        const after = `${p.notes ?? ""}\n${add}`;
        const ex = created.notes.find((x) => x.id === p.id);
        if (ex) ex.after = after; else created.notes.push({ id: p.id, before: p.notes, after });
        p.notes = after;
        await tx.productionPayment.update({ where: { id: p.id }, data: { notes: after } });
        noteLog.push(`…${suf}`);
      }
    }

    const after = await snap();

    // ---- 5) проверки: работа/себестоимость не меняются; долг — ровно на ожидаемую величину
    if (Math.abs(after.debt.billable - before.debt.billable) > 0.005) problems.push("работа заказчиков изменилась");
    for (const b of before.batches) {
      const a = after.batches.find((x) => x.number === b.number)!;
      if (!a.t.work.equals(b.t.work) || !a.t.cost.equals(b.t.cost)) problems.push(`партия ${b.number}: изменилась работа/себестоимость`);
    }
    // ожидание: долг уменьшается на сумму новых платежей минус часть, разнесённая на ТЗ без заказчика (ТЗ 116)
    let expected = 0;
    for (const r of rows) {
      if (r.state.startsWith("уже")) continue;
      if (r.source === "MANUAL") continue; // аванс 760880 уже учтён в долге как неразнесённый — перенос на ТЗ долг не меняет
      expected += r.amount - r.lines.filter((l) => !ordById.get(l.orderId)?.clientId).reduce((s, l) => s + l.c, 0);
    }
    const p1NoClient = p1Lines.filter((l) => !ordById.get(l.orderId)?.clientId).reduce((s, l) => s + l.c, 0);
    expected -= p1NoClient;
    const dDebt = Math.round((before.debt.balance - after.debt.balance) * 100);
    if (Math.abs(dDebt - expected) > 1) problems.push(`долг изменился на ${rub(dDebt)}, ожидалось ${rub(expected)}`);
    return { before, after, rows, problems, expected, dDebt, noteLog, ordById, lab };
  };

  type Res = Awaited<ReturnType<typeof run>>;
  let res: Res | null = null;
  try {
    await prisma.$transaction(async (tx) => { Object.assign(created, { payments: [], links: [], allocations: [], notes: [] }); res = await run(tx); throw new DryRun(); }, { timeout: 180000, maxWait: 30000 });
  } catch (e) { if (!(e instanceof DryRun)) throw e; }
  const r = res as unknown as Res;

  out.push(`## ${org.name}`, "");
  out.push("| п/п | Дата | Сумма | Набор ТЗ | Разнесено | Не разнесено | Статус |", "|---|---|---:|---|---:|---:|---|");
  for (const x of r.rows) out.push(`| ${x.pp} | ${x.date} | ${rub(x.amount)} | ${x.links.length > 3 ? `${x.links.length} ТЗ` : x.links.join("; ")} | ${rub(x.lines.reduce((s, l) => s + l.c, 0))} | ${rub(x.rest)} | ${x.state}${x.why ? `: ${x.why}` : ""} |`);
  out.push("", `Дописан п/п № в notes существующих платежей: ${r.noteLog.length} (${r.noteLog.join(", ")}).`);
  out.push("", "### Итоги ДО → ПОСЛЕ", "");
  out.push(`- Долг заказчиков без фильтров: ${r.before.debt.balance.toFixed(2)} → ${r.after.debt.balance.toFixed(2)} (изменение ${rub(r.dDebt)}, ожидалось ${rub(r.expected)})`);
  out.push(`- Работа: ${r.before.debt.billable.toFixed(2)} → ${r.after.debt.billable.toFixed(2)}; оплачено: ${r.before.debt.paid.toFixed(2)} → ${r.after.debt.paid.toFixed(2)}`);
  out.push(`- Разнесено ${r.before.debt.allocated.toFixed(2)} → ${r.after.debt.allocated.toFixed(2)}; неразнесено (в долге) ${r.before.debt.unallocated.toFixed(2)} → ${r.after.debt.unallocated.toFixed(2)}; из них аванс ${r.before.debt.unallocatedByKind.advance.toFixed(2)} → ${r.after.debt.unallocatedByKind.advance.toFixed(2)}, сверх работы ${r.before.debt.unallocatedByKind.excess.toFixed(2)} → ${r.after.debt.unallocatedByKind.excess.toFixed(2)}`);
  out.push("", "| Партия | Работа | Оплачено до | Оплачено после | Остаток после | Неразнесено после |", "|---:|---:|---:|---:|---:|---:|");
  for (const b of r.before.batches) {
    const a = r.after.batches.find((x) => x.number === b.number)!;
    if (b.t.orders === 0) continue;
    out.push(`| ${b.number} | ${b.t.work.toFixed(2)} | ${b.t.paid.toFixed(2)} | ${a.t.paid.toFixed(2)} | ${a.t.remaining.toFixed(2)} | ${a.t.unallocated.toFixed(2)} |`);
  }
  if (r.problems.length) { out.push("", "### ПРОБЛЕМЫ — применять нельзя", ...r.problems.map((p) => `- ${p}`)); failure = r.problems.join("; "); }

  console.log(`[${org.name}] новых платежей: ${r.rows.filter((x) => x.state === "заведён").length}; п/п дописан: ${r.noteLog.length}`);
  for (const x of r.rows) console.log(`  п/п ${x.pp} ${x.date} ${rub(x.amount)}: разнесено ${rub(x.lines.reduce((s, l) => s + l.c, 0))}, остаток ${rub(x.rest)} — ${x.state}`);
  console.log(`  долг: ${r.before.debt.balance.toFixed(2)} → ${r.after.debt.balance.toFixed(2)} (Δ ${rub(r.dDebt)}; ожидалось ${rub(r.expected)})`);
  if (r.problems.length) console.log("  ПРОБЛЕМЫ: " + r.problems.join("; "));

  const nothing = r.rows.every((x) => x.state.startsWith("уже")) && r.noteLog.length === 0;
  if (APPLY && !r.problems.length && !nothing) {
    if (!NO_BACKUP && !backupDone) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); backupDone = true; }
    const live: Journal = { script: "apply-production-payments-fix.ts", status: "applied", at: new Date().toISOString(), payments: [], links: [], allocations: [], notes: [] };
    await prisma.$transaction(async (tx) => {
      Object.assign(created, { payments: [], links: [], allocations: [], notes: [] });
      const r2 = await run(tx);
      if (r2.problems.length) throw new Error(r2.problems.join("; "));
      Object.assign(live, { payments: created.payments, links: created.links, allocations: created.allocations, notes: created.notes });
      writeJson(JOURNAL, live);
    }, { timeout: 180000, maxWait: 30000 });
    console.log(`Применено: платежей ${live.payments.length}, связей ${live.links.length}, разнесений ${live.allocations.length}, notes ${live.notes.length}. Журнал: ${JOURNAL}`);
    out.push("", `Применено: платежей ${live.payments.length}, связей ${live.links.length}, разнесений ${live.allocations.length}, notes ${live.notes.length}. Журнал: corrections-journal-production-payments-fix.json`);
    writeFileSync(REPORT, out.join("\n"));
  } else if (APPLY && nothing) {
    console.log("Нечего применять (идемпотентно).");
  } else if (!APPLY) {
    console.log("Сухой прогон: БД не изменена. Для применения: --apply");
    writeFileSync(REPORT, out.join("\n"));
  }
  console.log(`Отчёт: ${REPORT}`);
  await prisma.$disconnect();
  if (failure) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
