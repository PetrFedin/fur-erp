/**
 * ТЗ № 183 (П-2026-0200) и даты оплат по выписке 1С — решения владельца от 15.10.2026.
 * По умолчанию — пробный прогон (БД не меняется).
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-tz183-2026-10-15.ts                        # пробный прогон
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-tz183-2026-10-15.ts --apply --live         # боевая база: сам делает bash scripts/backup.sh
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-tz183-2026-10-15.ts --rollback --apply [--live]
 *   (на копии базы: DATABASE_URL на копию, --apply без --live; бэкап не делается)
 *
 * Что делает:
 *   1. Оплата 19 870 ₽ (п/п 51258, строка 35 реестра): дата 02.07.2026 → 01.07.2026 (выписка 1С).
 *   2. Оплата по счёту №197 (п/п 53717, строка 37; две записи 1 798 287,54 + 5 438 524,49): дата 17.07.2026 → 20.07.2026,
 *      «подтверждена» тем же способом, что остальные подтверждённые оплаты: confirmed=true + confirmedAt + confirmedBy
 *      (текстом — основание: выписка 1С, п/п); подтверждение — по выписке 1С, скан п/п в карточку не прикладывается.
 *   3. ТЗ 183 (П-2026-0200): списание лота 15317 (З-2026-0004, СП 12.25) 10 шт — consumeFromLot (движение PRODUCTION_OUT по цене лота)
 *      + ProductionMaterialUsage (commission4=true, vatRate NULL — как у ТЗ 169–182). Остаток лота 45 → 35.
 *   4. Партия ТЗ 183: партия № 22 (как у ТЗ 169–182).
 *   СТАТУС ТЗ НЕ МЕНЯЕТСЯ (решение владельца): остаётся тем, что есть (PLANNED). consumeFromLot статус не трогает; скрипт это проверяет.
 * Журнал отката: docs-inventory/corrections-journal-tz183-2026-10-15.json (было/стало по каждой записи). Запись — createAuditedClient("script:tz183").
 */
import "./stubs/server-only-shim";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const SCRIPT = "apply-tz183-2026-10-15";
const ACTOR = "script:tz183";
const TZ_NO = "183";
const LOT = "15317";
const PURCHASE = "З-2026-0004";
const QTY = 10;
const BATCH_NO = 22;
const SRC = "выписка 1С «Копия_Копия_Спецификации_счета_ТОРГ_12.xls» (реестр списаний ММ → Веллмех, 15.10.2026)";
/** Оплаты: ищем по п/п и сумме; новая дата — дата выписки. */
const PAYS = [
  { row: 35, pp: "51258", total: 19870, from: "2026-07-02", to: "2026-07-01", confirm: false },
  { row: 37, pp: "53717", total: 7236812.03, from: "2026-07-17", to: "2026-07-20", confirm: true },
];
const STALE_NOTE = `Списание лота ${LOT} не заведено (статус «Запланировано»).`;

const r2 = (n: number) => Math.round(n * 100) / 100;
const rub = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ruDate = (iso: string) => iso.split("-").reverse().join(".");
const dayOf = (x: Date) => x.toISOString().slice(0, 10);

type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string;
  payments: { id: string; row: number; before: Record<string, unknown>; after: Record<string, unknown> }[];
  order: { id: string; number: string; before: { batchId: string | null; status: string; notes: string | null }; after: { batchId: string | null; status: string; notes: string | null } } | null;
  usages: { id: string; lotId: string; quantity: string; unitCost: string; totalCost: string }[];
  movements: string[];
  lot: { id: string; lotNumber: string | null; remainingBefore: string; remainingAfter: string } | null;
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { Decimal } = await import("@prisma/client/runtime/library");
  const { lineCostWith4 } = await import("../src/lib/commission4");
  const prisma = createAuditedClient(ACTOR);
  const JOURNAL = join(INV, "corrections-journal-tz183-2026-10-15.json");
  const url = process.env.DATABASE_URL ?? "";
  const isLive = /\/fur_erp(\?|$)/.test(url);
  const dbName = /\/([^/?]+)(\?|$)/.exec(url)?.[1] ?? "?";
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const orgId = org.id;
  console.log(`База: ${dbName}${isLive ? " (БОЕВАЯ)" : ""}; режим: ${ROLLBACK ? "откат" : "внесение"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}`);
  if (APPLY && isLive && !LIVE) { console.log("Это боевая база: для записи нужен флаг --live (он сам сделает бэкап). Ничего не изменено."); process.exitCode = 1; await prisma.$disconnect(); return; }
  const backup = () => { console.log("Копия базы перед записью: bash scripts/backup.sh …"); execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") }); };

  // ----- Откат -----
  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат: оплат ${j.payments.length}, списаний ${j.usages.length}, движений ${j.movements.length}, ТЗ ${j.order?.number ?? "—"}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    const problems: string[] = [];
    if (j.order) {
      const extraU = await prisma.productionMaterialUsage.count({ where: { productionOrderId: j.order.id, id: { notIn: j.usages.map((x) => x.id) } } });
      const extraM = await prisma.stockMovement.count({ where: { productionOrderId: j.order.id, id: { notIn: j.movements } } });
      if (extraU) problems.push(`у ТЗ есть списания, добавленные после скрипта: ${extraU}`);
      if (extraM) problems.push(`у ТЗ есть движения склада, добавленные после скрипта: ${extraM}`);
      const cur = await prisma.productionOrder.findUnique({ where: { id: j.order.id }, select: { status: true } });
      if (cur && cur.status !== j.order.after.status) problems.push(`статус ТЗ изменён после скрипта (${j.order.after.status} → ${cur.status}) — откат статуса не делаю, решите вручную`);
    }
    if (problems.length) { console.log("ОТКАТ НЕВОЗМОЖЕН:"); problems.forEach((x) => console.log(`  - ${x}`)); process.exitCode = 1; await prisma.$disconnect(); return; }
    if (APPLY) {
      if (isLive) backup();
      await prisma.$transaction(async (tx) => {
        if (j.movements.length) await tx.stockMovement.deleteMany({ where: { id: { in: j.movements } } });
        if (j.usages.length) await tx.productionMaterialUsage.deleteMany({ where: { id: { in: j.usages.map((x) => x.id) } } });
        if (j.lot) {
          const lot = await tx.rawMaterialLot.findUniqueOrThrow({ where: { id: j.lot.id } });
          const back = lot.quantityRemaining.add(new Decimal(j.lot.remainingBefore).sub(new Decimal(j.lot.remainingAfter)));
          await tx.rawMaterialLot.update({ where: { id: j.lot.id }, data: { quantityRemaining: back } });
        }
        if (j.order) await tx.productionOrder.update({ where: { id: j.order.id }, data: { batchId: j.order.before.batchId, notes: j.order.before.notes } });
        for (const p of j.payments) {
          const data: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(p.before)) data[k] = k === "paidAt" || k === "confirmedAt" ? (v ? new Date(v as string) : null) : v;
          await tx.payment.update({ where: { id: p.id }, data });
        }
      }, { timeout: 60000 });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  // ----- Проверки и план -----
  const problems: string[] = [];
  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") problems.push("журнал уже содержит применённое внесение — сначала --rollback --apply");
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { organizationId: orgId, name: { contains: "Веллмех" } } });

  // оплаты
  const payPlan: { id: string; row: number; label: string; before: Record<string, unknown>; after: Record<string, unknown> }[] = [];
  for (const p of PAYS) {
    const rows = await prisma.payment.findMany({ where: { organizationId: orgId, supplierId: supplier.id, status: "COMPLETED", ppNo: p.pp }, orderBy: { amount: "asc" } });
    const sum = r2(rows.reduce((s, x) => s + Number(x.amount), 0));
    if (!rows.length || sum !== r2(p.total)) { problems.push(`строка ${p.row} (п/п ${p.pp}): найдено ${rows.length} зап. на ${rub(sum)}, ожидалось ${rub(p.total)}`); continue; }
    for (const x of rows) {
      const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
      if (dayOf(x.paidAt) !== p.to) {
        if (dayOf(x.paidAt) !== p.from) { problems.push(`строка ${p.row}: дата оплаты в базе ${dayOf(x.paidAt)}, ожидалась ${p.from} — не меняю`); continue; }
        before.paidAt = x.paidAt.toISOString(); after.paidAt = d(p.to).toISOString();
        before.notes = x.notes; after.notes = `${x.notes ? x.notes + " " : ""}[Дата оплаты по выписке 1С — ${ruDate(p.to)} (в базе было ${ruDate(p.from)}), п/п №${p.pp}; решение владельца 15.10.2026.]`.slice(0, 2000);
      }
      if (p.confirm && !(x.confirmed && x.confirmedAt)) {
        before.confirmed = x.confirmed; before.confirmedAt = x.confirmedAt?.toISOString() ?? null; before.confirmedBy = x.confirmedBy;
        after.confirmed = true; after.confirmedAt = "NOW"; after.confirmedBy = `${SRC}: п/п №${p.pp} от ${ruDate(p.to)}, ${rub(p.total)}`;
      }
      if (Object.keys(after).length) payPlan.push({ id: x.id, row: p.row, label: `${rub(Number(x.amount))}, п/п ${p.pp}`, before, after });
    }
  }

  // ТЗ, лот, партия
  const orders = await prisma.productionOrder.findMany({ where: { organizationId: orgId, workOrderNumber: TZ_NO }, select: { id: true, number: true, status: true, batchId: true, notes: true, plannedQuantity: true } });
  const order = orders.length === 1 ? orders[0] : null;
  if (!order) problems.push(`ТЗ ${TZ_NO}: найдено ${orders.length}, ожидалось 1`);
  const batch = await prisma.productionBatch.findFirst({ where: { organizationId: orgId, number: BATCH_NO } });
  if (!batch) problems.push(`партия № ${BATCH_NO} не найдена`);
  const lots = await prisma.rawMaterialLot.findMany({ where: { organizationId: orgId, lotNumber: LOT }, include: { purchase: { select: { number: true, status: true } }, rawMaterial: { select: { name: true } } } });
  const lot = lots.length === 1 ? lots[0] : null;
  if (!lot) problems.push(`лот ${LOT}: найдено ${lots.length}, ожидался 1`);
  else {
    if (lot.purchase?.number !== PURCHASE) problems.push(`лот ${LOT} в закупке ${lot.purchase?.number}, ожидалась ${PURCHASE}`);
    if (lot.purchase?.status !== "RECEIVED") problems.push(`закупка ${lot.purchase?.number} в статусе ${lot.purchase?.status}, не RECEIVED`);
    if (lot.quantityRemaining.lessThan(QTY)) problems.push(`в лоте остаток ${lot.quantityRemaining} < ${QTY}`);
  }
  let alreadyUsed = 0;
  if (order) {
    alreadyUsed = await prisma.productionMaterialUsage.count({ where: { productionOrderId: order.id } });
    const mv = await prisma.stockMovement.count({ where: { productionOrderId: order.id } });
    if (alreadyUsed || mv) problems.push(`у ТЗ ${TZ_NO} уже есть списания (${alreadyUsed}) / движения склада (${mv}) — скрипт не дублирует`);
    if (batch && order.batchId && order.batchId !== batch.id) problems.push(`у ТЗ ${TZ_NO} уже другая партия`);
  }

  // ----- Отчёт -----
  const unit = lot ? Number(lot.unitCost) : 0, vat = lot ? Number(lot.vatRate) : 20;
  const cost = r2(unit * QTY), cost4 = r2(lineCostWith4(unit, vat, true) * QTY);
  const out: string[] = [];
  out.push("", "## 1. Даты оплат по выписке 1С", "", "| строка | оплата | было | станет |", "|---|---|---|---|");
  for (const e of payPlan) out.push(`| ${e.row} | ${e.id} (${e.label}) | ${JSON.stringify({ ...e.before, notes: undefined })} | ${JSON.stringify({ ...e.after, notes: undefined })} |`);
  if (!payPlan.length) out.push("| — | нечего менять | | |");
  out.push("", `## 2. ТЗ ${TZ_NO} (${order?.number ?? "?"}): списание, партия`, "",
    "| поле | было | станет |", "|---|---|---|",
    `| статус ТЗ | ${order?.status ?? "?"} | ${order?.status ?? "?"} (НЕ меняется) |`,
    `| партия | ${order?.batchId ? "назначена" : "не назначена"} | № ${BATCH_NO} |`,
    `| лот ${LOT} (${lot?.purchase?.number ?? "?"}), остаток, шт | ${lot?.quantityRemaining ?? "?"} | ${lot ? lot.quantityRemaining.sub(QTY).toString() : "?"} |`,
    `| списание ТЗ (ProductionMaterialUsage) | нет | ${QTY} шт × ${rub(unit)} = ${rub(cost)} (с НДС ${vat}%); с 4% — ${rub(cost4)} |`,
    `| заметка ТЗ | «${STALE_NOTE}» | «Лот ${LOT}: списано ${QTY} шт (…)» |`);
  out.push("", `Сверка с материалами заказчика по УПД МФВМ/99 (358 817,74 ₽ с НДС 22%): списание с 4% = ${rub(cost4)}; разница ${rub(358817.74 - cost4)} — это переход НДС 20% → 22% на ${rub(294112.9)} (≈ ${rub(r2(294112.9 * 0.02))}, разница в копейках — округление); так же у ТЗ 169–182 (в учёте цена лота, НДС «как в лоте»).`);
  if (problems.length) out.push("", "## ПРОБЛЕМЫ — запись не выполняется", ...problems.map((x) => `- ${x}`));
  console.log(out.join("\n"));
  if (problems.length) { console.log(`\nНайдено проблем: ${problems.length}. Запись невозможна.`); process.exitCode = 1; await prisma.$disconnect(); return; }
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply (на боевой ещё --live)."); await prisma.$disconnect(); return; }

  // ----- Применение -----
  mkdirSync(INV, { recursive: true }); // журнал пишем после коммита — папка должна быть до записи
  if (isLive) backup();
  const { consumeFromLot } = await import("../src/lib/stock");
  const journal: Journal = { script: `${SCRIPT}.ts`, status: "applied", at: new Date().toISOString(), payments: [], order: null, usages: [], movements: [], lot: null };
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    for (const e of payPlan) {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(e.after)) data[k] = k === "paidAt" ? new Date(v as string) : v === "NOW" ? now : v;
      await tx.payment.update({ where: { id: e.id }, data });
      journal.payments.push({ id: e.id, row: e.row, before: e.before, after: { ...e.after, ...(e.after.confirmedAt === "NOW" ? { confirmedAt: now.toISOString() } : {}) } });
    }
    const o = order!, l = lot!;
    const lotBefore = (await tx.rawMaterialLot.findUniqueOrThrow({ where: { id: l.id } })).quantityRemaining;
    const r = await consumeFromLot(tx, { organizationId: orgId, lotId: l.id, quantity: QTY, productionOrderId: o.id });
    const mv = await tx.stockMovement.findMany({ where: { productionOrderId: o.id, lotId: l.id }, select: { id: true } });
    journal.movements = mv.map((m) => m.id);
    const us = await tx.productionMaterialUsage.create({
      data: { productionOrderId: o.id, rawMaterialId: r.rawMaterialId, lotId: l.id, quantity: QTY, unitCost: r.unitCost, totalCost: r.totalCost, commission4: true },
      select: { id: true, quantity: true, unitCost: true, totalCost: true },
    });
    journal.usages.push({ id: us.id, lotId: l.id, quantity: us.quantity.toString(), unitCost: us.unitCost.toString(), totalCost: us.totalCost.toString() });
    const lotAfter = await tx.rawMaterialLot.findUniqueOrThrow({ where: { id: l.id } });
    if (lotAfter.quantityRemaining.isNegative()) throw new Error("остаток лота ушёл ниже 0 — откат транзакции");
    journal.lot = { id: l.id, lotNumber: l.lotNumber, remainingBefore: lotBefore.toString(), remainingAfter: lotAfter.quantityRemaining.toString() };
    const note = `Лот ${LOT} (${PURCHASE}, СП 12.25): списано ${QTY} шт × ${rub(unit)} (с НДС ${vat}% по цене лота) = ${rub(Number(us.totalCost))}; остаток лота ${lotBefore} → ${lotAfter.quantityRemaining} (${SCRIPT}.ts).`;
    const newNotes = (o.notes ?? "").includes(STALE_NOTE) ? o.notes!.replace(STALE_NOTE, note) : `${o.notes ? o.notes + " " : ""}${note}`;
    const upd = await tx.productionOrder.update({ where: { id: o.id }, data: { batchId: batch!.id, notes: newNotes }, select: { status: true, batchId: true, notes: true } });
    if (upd.status !== o.status) throw new Error(`статус ТЗ изменился (${o.status} → ${upd.status}) — откат транзакции`);
    journal.order = { id: o.id, number: o.number, before: { batchId: o.batchId, status: o.status, notes: o.notes }, after: { batchId: upd.batchId, status: upd.status, notes: upd.notes } };
  }, { timeout: 60000, maxWait: 15000 });
  writeJson(JOURNAL, journal);
  console.log(`\nПрименено: оплат ${journal.payments.length}, списаний ${journal.usages.length}, движений ${journal.movements.length}, ТЗ ${journal.order?.number} (статус ${journal.order?.after.status}, партия ${BATCH_NO}). Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
