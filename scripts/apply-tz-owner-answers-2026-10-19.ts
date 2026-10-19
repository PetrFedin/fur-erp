/**
 * Ответы владельца от 19.10.2026 по четырём спорным местам ТЗ/закупок — ПРЕДЛОЖЕНИЕ, НЕ ПРИМЕНЕНО.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-tz-owner-answers-2026-10-19.ts                 # пробный прогон (БД не меняется)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-tz-owner-answers-2026-10-19.ts --apply         # применить на НЕ боевой базе (копия)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-tz-owner-answers-2026-10-19.ts --apply --live  # на боевой fur_erp (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-tz-owner-answers-2026-10-19.ts --rollback [--apply [--live]]
 *   доп. ключ: --only=116,52,121,79 (только эти пункты; 121 = двойной учёт красной лисы, закупка З-2026-0001)
 *
 * ЧТО ДЕЛАЕТ (основание — документы и письма, ничего не выдумано; платежи и разнесения НЕ трогает):
 *   ТЗ 116 — только ПРИМЕЧАНИЕ: строка 10026 × 9 шт. остаётся в списаниях, отметка «Доп. 9 шкур 10026 по письму Василия от 03.06.2026 (УПД МФВМ/000030 от 05.06.2026); в Приложении от 07.05.2026 не указаны».
 *   ТЗ 52  — только ПРИМЕЧАНИЕ: цена лота 1498-1 (18 366,51 ₽) верна, в Приложении — средняя бухгалтерии 11 579,80 ₽; стоимость ТЗ и лотов НЕ меняется; лот «1498-2» (З-2026-0018, 12 шт × 11 580) проверяется на неизменность.
 *   ТЗ 121 — двойной учёт 55 шкур красной лисы: списание 55 шт. переносится с лота З-2026-0001 на лот З-2026-0059 (УПД/счёт №209 от 16.07.2026, 88 шк. = 8 изд. × 11: ТЗ 121 — 55, ТЗ 158 — 33; остаток лота 55 → 0);
 *            закупка З-2026-0001 отменяется (статус «Отменена», лот и приход этой закупки убираются — нужная копия строк в журнале откат-а); долг поставщику уменьшается на 880 000,01 ₽; сумма ТЗ 121 не меняется.
 *   ТЗ 79  — по умолчанию только ПРИМЕЧАНИЕ: верная цена шкуры фондю по последним документам 13 470 ₽ (ТЗ №79 от 12.01.2026 и итоговое от 17.02.2026; расчёт доплаты партии 7 от 14.01.2026 — шкуры 942 900);
 *            деньги не меняются: корректировка +15 400 ₽ (70 × 220) уже внесена расходом «Корректировка по документу ТЗ», итог ТЗ = документу.
 *            Ключ --fondue-price (отдельный журнал): привести лот «фондю-3» / закупку З-2026-0012 штатным пересчётом приложения (lot-reprice) 13 250 → 13 470 (70 шт. = 942 900 ₽) и уменьшить расход на те же 15 400 ₽ (остаётся 230,22 ₽ НДС по подкладке).
 *            ВНИМАНИЕ: оплата закупки 927 500 ₽ не меняется (платежи не трогаем) — до переноса 15 400 ₽ из оплаты производства (п/п №22618) в оплату закупки долг по закупке +15 399,69 ₽, а сверка (test-reconciliation) покажет 8 расхождений по годам.
 * Журнал — для отката (--rollback возвращает всё: лот и приход З-2026-0001, списание, цену лота, расход, примечания, остатки склада ГП).
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
import { Decimal } from "@prisma/client/runtime/library";
import { Prisma } from "@prisma/client";
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
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").map((s) => s.trim()).filter(Boolean);
const want = (k: string) => !ONLY.length || ONLY.includes(k);
const FOND_PRICE = process.argv.includes("--fondue-price"); // ТЗ 79: привести лот/закупку З-2026-0012 к 13 470 ₽ (только после переноса 15 400 ₽ в оплате — см. шапку)
const TAG = "[tz-owner:2026-10-19]";
const TAG_B = "[tz-owner-fondue:2026-10-19]";
const CAT_ADJ = "Корректировка по документу ТЗ";
const D = (v: Decimal.Value) => new Decimal(v);
const rub = (v: Decimal.Value) => D(v).toDecimalPlaces(2).toNumber().toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sgn = (v: Decimal.Value) => (D(v).gte(0) ? "+" : "") + rub(v);
const RATE4 = D("0.04");

type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string; db: string;
  // ТЗ 121 / З-2026-0001
  fox?: {
    usageId: string; usageLotBefore: string; usageRawBefore: string; movementId: string; movementLotBefore: string; movementRawBefore: string;
    lot2Id: string; lot2RemainingBefore: string; lot2RemainingAfter: string;
    deletedLot: Record<string, unknown>; deletedMovement: Record<string, unknown>; itemId: string; itemLotBefore: string | null;
    purchaseId: string; purchaseStatusBefore: string;
  };
  // ТЗ 79
  fond?: {
    lotId: string; lotBefore: Record<string, unknown>; itemId: string; itemBefore: Record<string, unknown>;
    movements: { id: string; unitCost: string; totalCost: string }[]; usages: { id: string; unitCost: string; totalCost: string }[];
    expenseId: string; expenseBefore: string; expenseDescBefore: string | null; expenseAfter: string; expenseDeleted: Record<string, unknown> | null;
    stock: { id: string; oldAvgUnitCost: string }[]; fgMovements: { id: string }[];
  };
  notes: { orderId: string; tz: string; before: string | null; after: string }[];
  purchaseNotes: { purchaseId: string; number: string; before: string | null; after: string }[];
  orders: { id: string; tz: string; old: { materialCost: string | null; expenseCost: string | null; totalCost: string | null; unitCost: string | null; verifiedAt: string | null; verifiedBy: string | null; verifyNote: string | null } }[];
  purchasesVerif: { id: string; verifiedAt: string | null; verifiedBy: string | null; verifyNote: string | null }[];
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { buildLotPlan, applyLotWrites } = await import("../src/lib/lot-reprice");
  const url = process.env.DATABASE_URL ?? "";
  const dbName = url.split("?")[0].split("/").pop() ?? "";
  const isLive = dbName === "fur_erp";
  if (APPLY && isLive && !LIVE) throw new Error(`База «${dbName}» боевая: для записи нужен --live (для репетиции укажите копию через DATABASE_URL).`);
  if (APPLY && !isLive && LIVE) throw new Error(`--live указан, но DATABASE_URL смотрит на «${dbName}», а не на fur_erp.`);
  const prisma = createAuditedClient("script:apply-tz-owner-answers-2026-10-19");
  const JOURNAL = join(INV, `corrections-journal-tz-owner-answers-2026-10-19${FOND_PRICE ? "-fondue" : ""}${isLive ? "" : `-${dbName}`}.json`);
  const org = (await prisma.organization.findFirst({ select: { id: true } }))!.id;

  const debtOf = async () => {
    try {
      const { loadSupplierDebt } = await import("../src/lib/supplier-debt");
      return (await loadSupplierDebt(prisma as never, org)).debt;
    } catch { return null; }
  };

  // ───────── откат ─────────
  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат (${dbName}): красная лиса ${j.fox ? "да" : "нет"}, фондю ${j.fond ? "да" : "нет"}, примечаний ТЗ ${j.notes.length}, примечаний закупок ${j.purchaseNotes.length}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (APPLY) {
      if (isLive && !NO_BACKUP) { console.log("Копия базы перед откатом: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
      await prisma.$transaction(async (tx) => {
        if (j.fox) {
          const f = j.fox;
          // вернуть лот и приход З-2026-0001 (полные строки), потом вернуть списание на него
          await tx.$executeRaw`INSERT INTO "RawMaterialLot" SELECT * FROM jsonb_populate_record(NULL::"RawMaterialLot", ${JSON.stringify(f.deletedLot)}::jsonb)`;
          await tx.$executeRaw`INSERT INTO "StockMovement" SELECT * FROM jsonb_populate_record(NULL::"StockMovement", ${JSON.stringify(f.deletedMovement)}::jsonb)`;
          await tx.purchaseItem.update({ where: { id: f.itemId }, data: { lotId: f.itemLotBefore } });
          await tx.productionMaterialUsage.update({ where: { id: f.usageId }, data: { lotId: f.usageLotBefore, rawMaterialId: f.usageRawBefore } });
          await tx.stockMovement.update({ where: { id: f.movementId }, data: { lotId: f.movementLotBefore, rawMaterialId: f.movementRawBefore } });
          const l2 = await tx.rawMaterialLot.findUniqueOrThrow({ where: { id: f.lot2Id } });
          await tx.rawMaterialLot.update({ where: { id: f.lot2Id }, data: { quantityRemaining: l2.quantityRemaining.add(D(f.lot2RemainingBefore).sub(D(f.lot2RemainingAfter))) } });
          await tx.purchase.update({ where: { id: f.purchaseId }, data: { status: f.purchaseStatusBefore as never } });
        }
        if (j.fond) {
          const f = j.fond;
          const restore = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null ? Prisma.DbNull : v]));
          await tx.finishedGoodsMovement.deleteMany({ where: { id: { in: f.fgMovements.map((x) => x.id) } } });
          for (const s of f.stock) await tx.finishedGoodsStock.update({ where: { id: s.id }, data: { avgUnitCost: s.oldAvgUnitCost } });
          await tx.rawMaterialLot.update({ where: { id: f.lotId }, data: restore(f.lotBefore) as never });
          await tx.purchaseItem.update({ where: { id: f.itemId }, data: restore(f.itemBefore) as never });
          for (const m of f.movements) await tx.stockMovement.update({ where: { id: m.id }, data: { unitCost: m.unitCost, totalCost: m.totalCost } });
          for (const u of f.usages) await tx.productionMaterialUsage.update({ where: { id: u.id }, data: { unitCost: u.unitCost, totalCost: u.totalCost } });
          if (f.expenseDeleted) await tx.$executeRaw`INSERT INTO "ProductionExpense" SELECT * FROM jsonb_populate_record(NULL::"ProductionExpense", ${JSON.stringify(f.expenseDeleted)}::jsonb)`;
          else await tx.productionExpense.update({ where: { id: f.expenseId }, data: { amount: f.expenseBefore, description: f.expenseDescBefore } });
        }
        for (const n of j.notes) {
          const cur = await tx.productionOrder.findUnique({ where: { id: n.orderId }, select: { notes: true } });
          if ((cur?.notes ?? null) === n.after) await tx.productionOrder.update({ where: { id: n.orderId }, data: { notes: n.before } });
          else console.log(`  ! ТЗ ${n.tz}: примечание изменено после скрипта — не откатываю (уберите строку с ${TAG} вручную)`);
        }
        for (const n of j.purchaseNotes) {
          const cur = await tx.purchase.findUnique({ where: { id: n.purchaseId }, select: { notes: true } });
          if ((cur?.notes ?? null) === n.after) await tx.purchase.update({ where: { id: n.purchaseId }, data: { notes: n.before } });
          else console.log(`  ! закупка ${n.number}: примечание изменено после скрипта — не откатываю (уберите строку с ${TAG} вручную)`);
        }
        for (const o of j.orders) {
          await tx.productionOrder.update({
            where: { id: o.id },
            data: { materialCost: o.old.materialCost, expenseCost: o.old.expenseCost, totalCost: o.old.totalCost, unitCost: o.old.unitCost, verifiedAt: o.old.verifiedAt ? new Date(o.old.verifiedAt) : null, verifiedBy: o.old.verifiedBy, verifyNote: o.old.verifyNote },
          });
        }
        for (const p of j.purchasesVerif) await tx.purchase.update({ where: { id: p.id }, data: { verifiedAt: p.verifiedAt ? new Date(p.verifiedAt) : null, verifiedBy: p.verifiedBy, verifyNote: p.verifyNote } });
      }, { timeout: 120000, maxWait: 15000 });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  // ───────── чтение ─────────
  const ordSel = {
    id: true, number: true, workOrderNumber: true, status: true, producedQuantity: true, plannedQuantity: true, clientWorkPricePerUnit: true, notes: true,
    verifiedAt: true, verifiedBy: true, verifyNote: true, materialCost: true, expenseCost: true, totalCost: true, unitCost: true, batchId: true,
    materialUsages: { select: { id: true, quantity: true, unitCost: true, totalCost: true, commission4: true, lotId: true, rawMaterialId: true, lot: { select: { id: true, lotNumber: true, purchase: { select: { number: true } } } } } },
    expenses: { select: { id: true, amount: true, description: true } },
  } satisfies Prisma.ProductionOrderSelect;
  const getOrder = async (tz: string) => {
    const os = await prisma.productionOrder.findMany({ where: { organizationId: org, workOrderNumber: tz, status: { not: "CANCELLED" } }, select: ordSel });
    return os.length === 1 ? os[0] : null;
  };
  type Ord = NonNullable<Awaited<ReturnType<typeof getOrder>>>;
  const sumOrder = (o: Ord) => {
    let s = D(0);
    for (const u of o.materialUsages) s = s.add(u.commission4 ? D(u.totalCost).mul(D(1).add(RATE4)) : D(u.totalCost));
    for (const e of o.expenses) s = s.add(e.amount);
    return s.add(o.clientWorkPricePerUnit != null ? D(o.clientWorkPricePerUnit).mul(o.status === "COMPLETED" ? o.producedQuantity : o.plannedQuantity) : 0);
  };
  const problems: string[] = [];
  const table: { obj: string; what: string; before: string; after: string; rub: string; basis: string }[] = [];
  const info: string[] = [];
  const noteAdds: { orderId: string; tz: string; before: string | null; after: string }[] = [];
  const purchaseNoteAdds: { purchaseId: string; number: string; before: string | null; after: string }[] = [];
  const addNote = (o: Ord, text: string, replace?: [string, string], tag = TAG) => {
    const cur = o.notes ?? "";
    if (cur.includes(tag)) return false;
    let base = cur;
    if (replace && base.includes(replace[0])) base = base.replace(replace[0], replace[1]);
    noteAdds.push({ orderId: o.id, tz: o.workOrderNumber ?? "", before: o.notes, after: `${base ? base.replace(/\s+$/, "") + "\n" : ""}${tag} ${text}` });
    return true;
  };
  const addPurchaseNote = (p: { id: string; number: string; notes: string | null }, text: string, tag = TAG) => {
    if ((p.notes ?? "").includes(tag)) return false;
    purchaseNoteAdds.push({ purchaseId: p.id, number: p.number, before: p.notes, after: `${p.notes ? p.notes.replace(/\s+$/, "") + "\n" : ""}${tag} ${text}` });
    return true;
  };

  // ── 1. ТЗ 116 ──
  if (want("116")) {
    const o = await getOrder("116");
    if (!o) problems.push("ТЗ 116: ожидалась ровно одна позиция");
    else {
      const nine = o.materialUsages.filter((u) => u.lot.lotNumber === "10026" && D(u.quantity).eq(9));
      if (nine.length !== 1) problems.push(`ТЗ 116: строка 10026 × 9 шт. не найдена/неоднозначна (${nine.length})`);
      else {
        const w4 = D(nine[0].totalCost).mul(D(1).add(RATE4));
        const text = `Доп. 9 шкур 10026 по письму Василия от 03.06.2026 (УПД МФВМ/000030 от 05.06.2026); в Приложении от 07.05.2026 не указаны. Строка списания 10026 × 9 шт. (${rub(nine[0].totalCost)} ₽, с 4 % ${rub(w4)} ₽) оставлена как фактический расход (решение владельца 19.10.2026).`;
        const changed = addNote(o, text, ["нужно дополнение к ТЗ №116 (решение владельца)", "дополнение внесено отметкой в примечании (решение владельца 19.10.2026)"]);
        table.push({ obj: "ТЗ 116", what: changed ? "примечание ТЗ: доп. 9 шкур 10026 (строка 87 498,00 остаётся в списаниях)" : "примечание ТЗ — УЖЕ ЕСТЬ", before: rub(sumOrder(o)), after: rub(sumOrder(o)), rub: "0,00", basis: "письмо Василия 03.06.2026 18:30 («нужно ещё 9 шкур норки 10026»), УПД МФВМ/000030 от 05.06.2026, Приложение №116 от 07.05.2026 (16 шт.); ответ владельца 19.10.2026" });
      }
    }
  }

  // ── 2. ТЗ 52 ──
  if (want("52")) {
    const o = await getOrder("52");
    const lot2 = await prisma.rawMaterialLot.findFirst({ where: { organizationId: org, lotNumber: "1498-2" }, select: { quantityReceived: true, quantityRemaining: true, unitCost: true, purchase: { select: { number: true } } } });
    if (!o) problems.push("ТЗ 52: ожидалась ровно одна позиция");
    else {
      const line = o.materialUsages.find((u) => u.lot.lotNumber === "1498-1" && D(u.quantity).eq(12));
      if (!line) problems.push("ТЗ 52: строка лота 1498-1 × 12 шт. не найдена");
      else if (!lot2 || !D(lot2.quantityReceived).eq(12) || !D(lot2.quantityRemaining).eq(12) || !D(lot2.unitCost).eq(11580) || lot2.purchase?.number !== "З-2026-0018") problems.push("лот «1498-2» изменён (ожидалось З-2026-0018, 12 шт, остаток 12, 11 580,00 ₽) — ТЗ 52 не трогаю");
      else {
        const p1 = D(line.totalCost).div(12);
        const text = `В Приложении лот 1498 по средней цене 11 579,80 ₽ (бухгалтерия); по факту лот 1498-1 — ${rub(p1)} ₽ (12 шт. × ${rub(p1)} = ${rub(line.totalCost)} ₽, с 4 % ${rub(D(line.totalCost).mul(1.04))} ₽). Разница с документом −84 698,50 ₽ объяснена средней ценой; в системе верна цена лота (решение владельца 19.10.2026), стоимость ТЗ и лотов не менялась. Лот «1498-2» (З-2026-0018, 12 шт × 11 580,00 ₽) не тронут.`;
        const changed = addNote(o, text);
        table.push({ obj: "ТЗ 52", what: changed ? "примечание ТЗ (стоимость и лоты НЕ меняются; корректировка −84 698,50 НЕ вносится)" : "примечание ТЗ — УЖЕ ЕСТЬ", before: rub(sumOrder(o)), after: rub(sumOrder(o)), rub: "0,00", basis: "Приложение №52 (лот 1498 — 11 579,80 ₽), ответ владельца 19.10.2026: верны данные системы, бухгалтерия брала среднюю" });
        info.push(`ТЗ 52: лот 1498-1 ${rub(p1)} ₽ × 12 (с 4 % ${rub(D(line.totalCost).mul(1.04))}); лот 1498-2 нетронут: З-2026-0018, 12 шт, остаток ${lot2.quantityRemaining}, ${rub(lot2.unitCost)} ₽. Разница с документом: 12 × (${rub(p1)} − 11 579,80) × 1,04 = ${rub(D(12).mul(p1.sub("11579.80")).mul("1.04"))} ₽`);
      }
    }
  }

  // ── 3. ТЗ 121: двойной учёт красной лисы ──
  type FoxPlan = { o121: Ord; usage: Ord["materialUsages"][number]; lot1: { id: string; purchaseId: string | null; rawMaterialId: string }; lot2: { id: string; quantityRemaining: Decimal; unitCost: Decimal; rawMaterialId: string }; purchase1: { id: string; number: string; notes: string | null; status: string; verifiedAt: Date | null; verifiedBy: string | null; verifyNote: string | null }; purchase2: { id: string; number: string; notes: string | null }; item1Id: string; movId: string; movLot: string; movRaw: string };
  let fox: FoxPlan | null = null;
  let foxDone = false;
  if (want("121")) {
    const o121 = await getOrder("121");
    const p1 = await prisma.purchase.findFirst({ where: { organizationId: org, number: "З-2026-0001" }, select: { id: true, number: true, notes: true, status: true, verifiedAt: true, verifiedBy: true, verifyNote: true, items: { select: { id: true, lotId: true } }, rawMaterialLots: { select: { id: true, quantityReceived: true, quantityRemaining: true, unitCost: true, rawMaterialId: true, purchaseId: true } }, payments: { select: { id: true } }, expenses: { select: { id: true } } } });
    const p2 = await prisma.purchase.findFirst({ where: { organizationId: org, number: "З-2026-0059" }, select: { id: true, number: true, notes: true, rawMaterialLots: { select: { id: true, quantityReceived: true, quantityRemaining: true, unitCost: true, rawMaterialId: true, rawMaterial: { select: { name: true } } } } } });
    if (!o121 || !p1 || !p2) problems.push("красная лиса: не найдены ТЗ 121 / З-2026-0001 / З-2026-0059");
    else if (p1.status === "CANCELLED") foxDone = true;
    else {
      const lot2 = p2.rawMaterialLots.length === 1 ? p2.rawMaterialLots[0] : null;
      const lot1 = p1.rawMaterialLots.length === 1 ? p1.rawMaterialLots[0] : null;
      const usage = lot1 ? o121.materialUsages.find((u) => u.lotId === lot1.id) : null;
      const pays = await prisma.paymentAllocation.count({ where: { productionOrderId: o121.id } }); // справочно
      if (!lot1 || !lot2 || !usage) problems.push("красная лиса: ожидалось по одному лоту у З-2026-0001/0059 и списание ТЗ 121 с лота З-2026-0001");
      else if (p1.payments.length || p1.expenses.length) problems.push(`З-2026-0001: есть оплаты (${p1.payments.length}) или расходы (${p1.expenses.length}) — отменять нельзя, нужно решение владельца`);
      else if (!D(usage.quantity).eq(55) || !D(lot1.quantityReceived).eq(55) || !D(lot1.quantityRemaining).eq(0)) problems.push("красная лиса: лот З-2026-0001 не 55/0 или списание ТЗ 121 не 55 шт.");
      else if (lot2.rawMaterial.name !== "Лиса красная" || !D(lot2.unitCost).eq(16000) || !D(lot2.quantityReceived).eq(88) || D(lot2.quantityRemaining).lt(55)) problems.push(`красная лиса: лот З-2026-0059 не тот (${lot2.rawMaterial.name}, ${lot2.quantityReceived} шт, остаток ${lot2.quantityRemaining}, ${lot2.unitCost} ₽) или остатка меньше 55`);
      else if (!D(usage.totalCost).eq(D(lot2.unitCost).mul(55))) problems.push(`красная лиса: сумма списания ТЗ 121 ${rub(usage.totalCost)} ≠ 55 × цена лота З-2026-0059 — цены разные, не переношу`);
      else {
        const mv = await prisma.stockMovement.findMany({ where: { lotId: lot1.id }, select: { id: true, type: true, quantity: true, productionOrderId: true, lotId: true, rawMaterialId: true } });
        const out = mv.filter((m) => m.type === "PRODUCTION_OUT"), inn = mv.filter((m) => m.type === "PURCHASE_IN");
        const other = await Promise.all((["DriveDocument", "PurchaseDocument", "RawMaterialLotAttr", "SupplierRawStage"] as const).map(async (t) => Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM "${t}" WHERE "lotId" = $1`, lot1.id))[0].n)));
        if (out.length !== 1 || inn.length !== 1 || mv.length !== 2 || out[0].productionOrderId !== o121.id || p1.items.length !== 1 || other.some((x) => x > 0)) problems.push(`красная лиса: у лота З-2026-0001 есть связи кроме списания ТЗ 121 и прихода (движения ${mv.length}, позиций закупки ${p1.items.length}, документов/атрибутов ${other.join("/")}) — отмена не по плану, нужно решение`);
        else {
          fox = { o121, usage, lot1, lot2, purchase1: p1, purchase2: p2, item1Id: p1.items[0].id, movId: out[0].id, movLot: out[0].lotId!, movRaw: out[0].rawMaterialId } as never;
          fox!.lot2 = { id: lot2.id, quantityRemaining: D(lot2.quantityRemaining), unitCost: D(lot2.unitCost), rawMaterialId: lot2.rawMaterialId };
          const before = sumOrder(o121);
          table.push({ obj: "ТЗ 121", what: "списание 55 шт. красной лисы: лот З-2026-0001 → лот З-2026-0059 (остаток лота 55 → 0)", before: `${rub(before)}; лот З-2026-0059 остаток ${lot2.quantityRemaining}`, after: `${rub(before)}; остаток 0`, rub: "0,00", basis: "письмо «Закупка. Приложение 19 (88 шкур красной лисы)» 17.07.2026: 88 = 8 изд. × 11, в работе 5 изд. (55); счёт/УПД №209 от 16.07.2026; ТЗ 158 — 33 (3 изд.)" });
          table.push({ obj: "З-2026-0001", what: "закупка отменена (статус «Отменена»); лот «лиса» 55 шт. и его приход убраны (копия в журнале)", before: `RECEIVED, 880 000,01 ₽ к оплате`, after: `CANCELLED, 0,00 ₽`, rub: "−880 000,01 (долг поставщику)", basis: "примечание закупки по письмам Коношенко 17.07 и 25.08.2026 («счёт за лису мы не платили»): те же 55 шкур входят в 88 шк. по счёту №209; оплат и разнесений по З-2026-0001 нет" });
          table.push({ obj: "З-2026-0059", what: "примечание: лот списан ТЗ 158 (33) + ТЗ 121 (55) = 88", before: "остаток 55", after: "остаток 0", rub: "0,00", basis: "УПД №209 от 16.07.2026, 88 шк. × 16 000 = 1 408 000 ₽" });
          addNote(o121, `Сырьё 55 шк. красной лисы (880 000 ₽) списано с лота закупки З-2026-0059 (УПД/счёт №209 от 16.07.2026, 88 шкур = 8 изд. × 11: ТЗ 121 — 55, ТЗ 158 — 33) вместо отменённой З-2026-0001 — решение владельца 19.10.2026 (устранён двойной учёт). Сумма ТЗ не менялась (${rub(before)} ₽).`);
          addPurchaseNote(p1, `ЗАКУПКА ОТМЕНЕНА 19.10.2026 по решению владельца: эти 55 шкур красной лисы (ТЗ 121, 5 изд. × 11) входят в 88 шкур по счёту/УПД №209 от 16.07.2026 (закупка З-2026-0059: 88 шк. × 16 000 = 1 408 000 ₽; письмо «Закупка. Приложение 19 (88 шкур красной лисы)» от 17.07.2026, согласовано 17.07.2026). Списание ТЗ 121 переведено на лот З-2026-0059; долг по этой закупке (880 000,01 ₽) убран как двойной учёт. Оплат и разнесений по закупке не было. Внимание: в доплату счёта №237 от 25.08.2026 (3 397 795 ₽) входят те же 880 000 ₽ шкур — при оплате счёта №237 эта часть относится к УПД №209 (З-2026-0059), второй раз не платить.`);
          addPurchaseNote(p2, `С 19.10.2026 лот списан полностью: ТЗ 158 — 33 шк., ТЗ 121 — 55 шк. (88 = 8 изд. × 11). Закупка З-2026-0001 (те же 55 шкур) отменена как двойной учёт — решение владельца 19.10.2026.`);
          info.push(`красная лиса: сумма ТЗ 121 до/после = ${rub(before)} (документ 1 497 260,37); оплат по З-2026-0001: ${p1.payments.length}; разнесений на ТЗ 121: ${pays} (не трогаются)`);
        }
      }
    }
    if (foxDone) table.push({ obj: "З-2026-0001", what: "УЖЕ ОТМЕНЕНА (ничего не делаю)", before: "CANCELLED", after: "CANCELLED", rub: "0,00", basis: "—" });
  }

  // ── 4. ТЗ 79: цена шкуры фондю ──
  type FondPlan = { o79: Ord; lotId: string; lot12: { id: string; unitCost: Decimal }; usageIds: string[]; purchase: { id: string; notes: string | null; verifiedAt: Date | null; verifiedBy: string | null; verifyNote: string | null }; expense: { id: string; amount: Decimal; description: string | null }; newExpense: Decimal; plan: unknown; writes: unknown };
  let fond: FondPlan | null = null;
  let fondDone = false;
  const FOND_NEW = D(13470), FOND_QTY = D(70), DOC79 = D("1326568.60");
  if (want("79")) {
    const o79 = await getOrder("79");
    const p12 = await prisma.purchase.findFirst({ where: { organizationId: org, number: "З-2026-0012" }, select: { id: true, notes: true, verifiedAt: true, verifiedBy: true, verifyNote: true, rawMaterialLots: { select: { id: true, unitCost: true, quantityReceived: true, lotNumber: true } } } });
    if (!o79 || !p12) problems.push("фондю: не найдены ТЗ 79 / З-2026-0012");
    else if (!FOND_PRICE) {
      // по умолчанию: деньги не меняются (корректировка +15 400 уже внесена tier2), только примечание с выводом по документам
      const cur = sumOrder(o79);
      const exp = o79.expenses.find((e) => e.description?.startsWith("[tz-tier2:2026-10-19]"));
      const changed = addNote(o79, `Цена шкуры фондю по последним документам — 13 470 ₽ (70 шт. = 942 900 ₽): ТЗ №79 от 12.01.2026 и итоговое от 17.02.2026 (письмо Василия «ТЗ и УПД на готовые изделия»), расчёт доплаты партии 7 от 14.01.2026 (шкуры 942 900; 952 540 = 942 900 + 9 640 НДС 22 % по работе); версия от 25.12.2025 с 13 250 ₽ устарела. В закупке З-2026-0012 цена 13 250 ₽ (927 500 ₽, оплачено п/п №22618): разница 70 × 220 = 15 400 ₽ учтена расходом «${CAT_ADJ}»${exp ? ` (${rub(exp.amount)} ₽ вместе с НДС 22 % по подкладке)` : ""}, итог ТЗ ${rub(cur)} ₽ = документу ${rub(DOC79)} ₽. Привести лот/закупку к 13 470 ₽ можно (--fondue-price) после переноса 15 400 ₽ из оплаты производства в оплату закупки при сверке оплат (решение владельца 19.10.2026: «по последним письмам и файлам»).`);
      table.push({ obj: "ТЗ 79", what: changed ? "примечание ТЗ: верная цена фондю 13 470 ₽ по последним документам; деньги не меняются (корректировка +15 400 ₽ уже внесена)" : "примечание ТЗ — УЖЕ ЕСТЬ", before: rub(cur), after: rub(cur), rub: "0,00", basis: "ТЗ №79 от 12.01.2026 и 17.02.2026; расчёт доплаты партии 7 от 14.01.2026; счёт №1 от 15.01.2026; З-2026-0013 (фондю 32 × 13 470 — та же цена в Jan 2026)" });
      info.push(`ТЗ 79: итог ${rub(cur)} ₽, документ ${rub(DOC79)} ₽; цену лота «фондю-3» не меняю без переноса 15 400 ₽ в оплатах (иначе долг +15 399,69 и расхождение года в сверке) — вариант --fondue-price`);
    }
    else {
      const lot = p12.rawMaterialLots.length === 1 ? p12.rawMaterialLots[0] : null;
      const usage = lot ? o79.materialUsages.find((u) => u.lotId === lot.id) : null;
      const exp = o79.expenses.find((e) => e.description?.startsWith("[tz-tier2:2026-10-19]"));
      if (!lot || lot.lotNumber !== "фондю-3" || !D(lot.quantityReceived).eq(FOND_QTY) || !usage) problems.push("фондю: лот «фондю-3» (70 шт.) у З-2026-0012 или списание ТЗ 79 не найдены");
      else if (D(lot.unitCost).eq(FOND_NEW)) fondDone = true;
      else if (!D(lot.unitCost).eq(13250)) problems.push(`фондю: цена лота ${rub(lot.unitCost)} ₽ — ожидалось 13 250,00`);
      else if (!exp) problems.push("ТЗ 79: расход «Корректировка по документу ТЗ» от tier2 не найден — сначала применить tier2 (или цену лота не менять без расхода)");
      else {
        const cur = sumOrder(o79);
        if (cur.sub(DOC79).abs().gt(1)) problems.push(`ТЗ 79: сумма ${rub(cur)} ₽ не равна документу ${rub(DOC79)} ₽ — сначала разобраться`);
        else {
          const r = await buildLotPlan(prisma as never, org, lot.id, { unitIncl: FOND_NEW.toString() });
          if ("error" in r) problems.push(`фондю: lot-reprice отказал: ${r.error}`);
          else {
            const delta = FOND_NEW.sub(13250).mul(FOND_QTY); // 15 400
            const newExp = D(exp.amount).sub(delta);
            if (newExp.lt(0)) problems.push(`ТЗ 79: расход ${rub(exp.amount)} меньше удорожания ${rub(delta)} — другая причина, не правлю`);
            else {
              fond = { o79, lotId: lot.id, lot12: { id: lot.id, unitCost: D(lot.unitCost) }, usageIds: [usage.id], purchase: p12, expense: { id: exp.id, amount: D(exp.amount), description: exp.description }, newExpense: newExp.toDecimalPlaces(2), plan: r.plan, writes: r.writes };
              const pl = r.plan as { lines: { label: string; before: string; after: string }[] };
              for (const l of pl.lines) info.push(`ТЗ 79 / лот фондю-3: ${l.label}: ${l.before} → ${l.after}`);
              table.push({ obj: "З-2026-0012 / лот фондю-3", what: "цена шкуры фондю 13 250 → 13 470 ₽ (70 шт.), штатный пересчёт лота: позиция закупки, приход, списание ТЗ 79, себестоимость ТЗ/ГП", before: `${rub(D(13250).mul(FOND_QTY))} ₽ (закупка)`, after: `${rub(D(13470).mul(FOND_QTY))} ₽`, rub: sgn(delta) + " (закупка и ТЗ 79)", basis: "ТЗ №79 от 12.01.2026 (471 450/изд. = 35 × 13 470) и итоговое от 17.02.2026 (письмо Василия «ТЗ и УПД на готовые изделия»); расчёт доплаты партии 7 от 14.01.2026: шкуры 942 900; Приложение от 25.12.2025 (13 250) — устаревшее" });
              table.push({ obj: "ТЗ 79", what: `расход «${CAT_ADJ}» уменьшен (цена шкуры теперь в лоте): остаётся НДС 22 % по подкладке`, before: `${rub(exp.amount)} ₽`, after: `${rub(newExp)} ₽`, rub: sgn(delta.neg()), basis: "итог ТЗ №79 1 326 568,60 ₽ не меняется" });
              table.push({ obj: "ТЗ 79", what: "итог ТЗ по документу", before: rub(cur), after: rub(cur), rub: "0,00", basis: "ТЗ №79 от 17.02.2026" });
              addNote(o79, `Цена шкуры фондю 13 470 ₽ (70 шт. = 942 900 ₽) по последним документам: ТЗ №79 от 12.01.2026 и итоговое от 17.02.2026, расчёт доплаты партии 7 от 14.01.2026 (942 900); версия от 25.12.2025 с 13 250 ₽ устарела. Лот «фондю-3» (З-2026-0012) приведён с 13 250 к 13 470 ₽ (решение владельца 19.10.2026); расход «${CAT_ADJ}» уменьшен с ${rub(exp.amount)} до ${rub(newExp)} ₽ (остаток — НДС 22 % по подкладке), итог ТЗ ${rub(DOC79)} ₽ без изменений. Оплата закупки 927 500 ₽ (п/п №22618) не менялась: разница 15 400 ₽ входит в расчёт доплаты партии 7 (952 540 = 942 900 шкуры + 9 640 НДС по работе) в составе оплаты производства.`, undefined, TAG_B);
              addPurchaseNote(p12 as never, `С 19.10.2026 цена шкуры фондю 13 470 ₽ (70 шт. = 942 900 ₽, было 13 250 ₽ = 927 500 ₽) по ТЗ №79 от 12.01.2026 / 17.02.2026 и расчёту доплаты партии 7 от 14.01.2026 (решение владельца 19.10.2026). Оплата закупки 927 500 ₽ по п/п №22618 не менялась: оставшиеся 15 400 ₽ входят в расчёт доплаты партии 7 (952 540 = 942 900 шкуры + 9 640 НДС 22 % по работе) в составе оплаты производства — перенос части п/п на оплату закупки решается при сверке оплат.`, TAG_B);
            }
          }
        }
      }
    }
    if (fondDone) table.push({ obj: "З-2026-0012", what: "цена фондю уже 13 470 (ничего не делаю)", before: "13 470", after: "13 470", rub: "0,00", basis: "—" });
  }

  // ───────── вывод ─────────
  const debt0 = await debtOf();
  const out: string[] = [`# Ответы владельца 19.10.2026 — ${APPLY ? "ПРИМЕНЕНИЕ" : "пробный прогон"} (${new Date().toISOString()}), база «${dbName}»`, ""];
  out.push("| ТЗ/закупка | что меняется | было → стало | ₽ | основание |", "|---|---|---|---:|---|");
  for (const r of table) out.push(`| ${r.obj} | ${r.what} | ${r.before} → ${r.after} | ${r.rub} | ${r.basis} |`);
  for (const p of problems) out.push(`| — | ПРОПУСК | — | — | ${p} |`);
  out.push("", ...info.map((i) => `    ${i}`));
  if (debt0) out.push("", `Долг поставщику сейчас: ${rub(debt0)} ₽; ожидаемое изменение: ${fox ? "−880 000,01" : "0"} (красная лиса) ${fond ? "+ 15 400,00 (фондю, пока п/п №22618 не разнесена)" : ""}`);
  console.log(out.join("\n"));
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply (копия) или --apply --live (боевая)."); await prisma.$disconnect(); return; }

  // ───────── запись ─────────
  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое — повторно не применяю (сначала --rollback --apply)."); await prisma.$disconnect(); return; }
  if (problems.length) { console.log("Есть пропуски/проблемы — запись остановлена (нечего применять частично без разбора)."); }
  if (!fox && !fond && !noteAdds.length && !purchaseNoteAdds.length) { console.log("Нечего применять."); await prisma.$disconnect(); return; }
  if (isLive && !NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  const journal: Journal = { script: "apply-tz-owner-answers-2026-10-19.ts", status: "applied", at: new Date().toISOString(), db: dbName, notes: [], purchaseNotes: [], orders: [], purchasesVerif: [] };
  const costChanged = new Set<string>();
  await prisma.$transaction(async (tx) => {
    // красная лиса
    if (fox) {
      const f = fox;
      const jf = async (table: string, id: string) => (await tx.$queryRawUnsafe<{ j: Record<string, unknown> }[]>(`SELECT to_jsonb(t) AS j FROM "${table}" t WHERE id = $1`, id))[0].j;
      const lot2 = await tx.rawMaterialLot.findUniqueOrThrow({ where: { id: f.lot2.id } });
      const mvIn = await tx.stockMovement.findFirstOrThrow({ where: { lotId: f.lot1.id, type: "PURCHASE_IN" } });
      const deletedLot = await jf("RawMaterialLot", f.lot1.id), deletedMovement = await jf("StockMovement", mvIn.id);
      const rem2 = lot2.quantityRemaining.sub(55);
      if (rem2.isNegative()) throw new Error("остаток лота З-2026-0059 ушёл бы ниже 0 — откат транзакции");
      await tx.rawMaterialLot.update({ where: { id: f.lot2.id }, data: { quantityRemaining: rem2 } });
      await tx.productionMaterialUsage.update({ where: { id: f.usage.id }, data: { lotId: f.lot2.id, rawMaterialId: f.lot2.rawMaterialId, unitCost: lot2.unitCost, totalCost: lot2.unitCost.mul(55) } });
      await tx.stockMovement.update({ where: { id: f.movId }, data: { lotId: f.lot2.id, rawMaterialId: f.lot2.rawMaterialId } });
      await tx.purchaseItem.update({ where: { id: f.item1Id }, data: { lotId: null } });
      await tx.stockMovement.delete({ where: { id: mvIn.id } });
      await tx.rawMaterialLot.delete({ where: { id: f.lot1.id } });
      await tx.purchase.update({ where: { id: f.purchase1.id }, data: { status: "CANCELLED" } });
      if (f.purchase1.verifiedAt) { journal.purchasesVerif.push({ id: f.purchase1.id, verifiedAt: f.purchase1.verifiedAt.toISOString(), verifiedBy: f.purchase1.verifiedBy, verifyNote: f.purchase1.verifyNote }); await tx.purchase.update({ where: { id: f.purchase1.id }, data: { verifiedAt: null, verifiedBy: null, verifyNote: null } }); }
      journal.fox = { usageId: f.usage.id, usageLotBefore: f.lot1.id, usageRawBefore: f.lot1.rawMaterialId, movementId: f.movId, movementLotBefore: f.lot1.id, movementRawBefore: f.movRaw, lot2Id: f.lot2.id, lot2RemainingBefore: lot2.quantityRemaining.toString(), lot2RemainingAfter: rem2.toString(), deletedLot, deletedMovement, itemId: f.item1Id, itemLotBefore: f.lot1.id, purchaseId: f.purchase1.id, purchaseStatusBefore: f.purchase1.status };
      costChanged.add(f.o121.id);
    }
    // фондю
    if (fond) {
      const f = fond;
      const w = f.writes as { lot: Record<string, unknown> | null; item: { id: string; data: Record<string, unknown> } | null; movements: { id: string }[]; usages: { id: string }[]; orders: { id: string; finishedWarehouseId: string; productModelId: string }[] };
      const lotRow = await tx.rawMaterialLot.findUniqueOrThrow({ where: { id: f.lotId } }) as unknown as Record<string, unknown>;
      const itemRow = await tx.purchaseItem.findUniqueOrThrow({ where: { id: w.item!.id } }) as unknown as Record<string, unknown>;
      const keep = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k] instanceof Decimal ? String(row[k]) : row[k] ?? null]));
      const lotBefore = keep(lotRow, Object.keys(w.lot ?? {})), itemBefore = keep(itemRow, Object.keys(w.item!.data));
      const movBefore = (await tx.stockMovement.findMany({ where: { id: { in: w.movements.map((m) => m.id) } }, select: { id: true, unitCost: true, totalCost: true } })).map((m) => ({ id: m.id, unitCost: m.unitCost.toString(), totalCost: m.totalCost.toString() }));
      const useBefore = (await tx.productionMaterialUsage.findMany({ where: { id: { in: w.usages.map((m) => m.id) } }, select: { id: true, unitCost: true, totalCost: true } })).map((m) => ({ id: m.id, unitCost: m.unitCost.toString(), totalCost: m.totalCost.toString() }));
      const stockIds = new Set<string>();
      for (const o of w.orders) { const s = await tx.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: o.finishedWarehouseId, productModelId: o.productModelId } } }); if (s) stockIds.add(s.id); }
      const stockBefore = await Promise.all([...stockIds].map(async (id) => ({ id, oldAvgUnitCost: (await tx.finishedGoodsStock.findUniqueOrThrow({ where: { id } })).avgUnitCost.toString() })));
      const fgBefore = new Set((await tx.finishedGoodsMovement.findMany({ where: { productionOrderId: { in: w.orders.map((o) => o.id) } }, select: { id: true } })).map((x) => x.id));
      // расход: сначала меняем (пересчёт ТЗ в lot-reprice читает текущие расходы)
      let expenseDeleted: Record<string, unknown> | null = null;
      const desc = `${f.expense.description ?? ""}`.replace(/ТЗ 79: цена шкуры фондю в документе 13 470 ₽ вместо 13 250 ₽ \(70 × 220 = 15 400 ₽\) и НДС 22 % по подкладке/, "ТЗ 79: НДС 22 % по подкладке (цена шкуры фондю 13 470 ₽ теперь в лоте «фондю-3»)");
      if (f.newExpense.lt(0.005)) {
        expenseDeleted = (await tx.$queryRawUnsafe<{ j: Record<string, unknown> }[]>(`SELECT to_jsonb(t) AS j FROM "ProductionExpense" t WHERE id = $1`, f.expense.id))[0].j;
        await tx.productionExpense.delete({ where: { id: f.expense.id } });
      } else await tx.productionExpense.update({ where: { id: f.expense.id }, data: { amount: f.newExpense, description: desc } });
      await tx.$queryRaw`SELECT "id" FROM "RawMaterialLot" WHERE "id" = ${f.lotId} FOR UPDATE`;
      const r = await buildLotPlan(tx, org, f.lotId, { unitIncl: FOND_NEW.toString() });
      if ("error" in r) throw new Error(`lot-reprice: ${r.error}`);
      await applyLotWrites(tx, org, r.writes);
      const fgAfter = (await tx.finishedGoodsMovement.findMany({ where: { productionOrderId: { in: w.orders.map((o) => o.id) } }, select: { id: true } })).filter((x) => !fgBefore.has(x.id));
      journal.fond = { lotId: f.lotId, lotBefore, itemId: w.item!.id, itemBefore, movements: movBefore, usages: useBefore, expenseId: f.expense.id, expenseBefore: f.expense.amount.toString(), expenseDescBefore: f.expense.description, expenseAfter: f.newExpense.toString(), expenseDeleted, stock: stockBefore, fgMovements: fgAfter };
      costChanged.add(f.o79.id);
      if (f.purchase.verifiedAt) journal.purchasesVerif.push({ id: f.purchase.id, verifiedAt: f.purchase.verifiedAt.toISOString(), verifiedBy: f.purchase.verifiedBy, verifyNote: f.purchase.verifyNote });
      await tx.purchase.update({ where: { id: f.purchase.id }, data: { verifiedAt: null, verifiedBy: null, verifyNote: null } });
    }
    // примечания
    for (const n of noteAdds) { await tx.productionOrder.update({ where: { id: n.orderId }, data: { notes: n.after } }); journal.notes.push(n); }
    for (const n of purchaseNoteAdds) { await tx.purchase.update({ where: { id: n.purchaseId }, data: { notes: n.after } }); journal.purchaseNotes.push(n); }
    // подтверждение изменённых ТЗ снимаем (как приложение); старые значения — в журнал (стоимость ТЗ 79 пересчитал lot-reprice ДО этого, поэтому берём из снимка ниже)
    for (const id of costChanged) {
      const o = await tx.productionOrder.findUnique({ where: { id }, select: { workOrderNumber: true, materialCost: true, expenseCost: true, totalCost: true, unitCost: true, verifiedAt: true, verifiedBy: true, verifyNote: true } });
      if (!o) continue;
      const old = id === fond?.o79.id ? { materialCost: fond.o79.materialCost?.toString() ?? null, expenseCost: fond.o79.expenseCost?.toString() ?? null, totalCost: fond.o79.totalCost?.toString() ?? null, unitCost: fond.o79.unitCost?.toString() ?? null }
        : { materialCost: o.materialCost?.toString() ?? null, expenseCost: o.expenseCost?.toString() ?? null, totalCost: o.totalCost?.toString() ?? null, unitCost: o.unitCost?.toString() ?? null };
      journal.orders.push({ id, tz: o.workOrderNumber ?? "", old: { ...old, verifiedAt: o.verifiedAt?.toISOString() ?? null, verifiedBy: o.verifiedBy, verifyNote: o.verifyNote } });
      if (o.verifiedAt) await tx.productionOrder.update({ where: { id }, data: { verifiedAt: null, verifiedBy: null, verifyNote: null } });
    }
  }, { timeout: 300000, maxWait: 15000 });
  writeJson(JOURNAL, journal);
  console.log(`\nПрименено на «${dbName}»: красная лиса ${journal.fox ? "да" : "нет"}, фондю ${journal.fond ? "да" : "нет"}, примечаний ТЗ ${journal.notes.length}, примечаний закупок ${journal.purchaseNotes.length}. Журнал: ${JOURNAL}`);

  // ───────── контроль после записи ─────────
  let bad = 0;
  const chk = (ok: boolean, msg: string) => { if (!ok) bad++; console.log(`  ${ok ? "✓" : "✗"} ${msg}`); };
  if (fox) {
    const o = (await getOrder("121"))!;
    const d = sumOrder(o).sub("1497260.37");
    chk(d.abs().lte(1), `ТЗ 121: ${rub(sumOrder(o))} ₽ (документ 1 497 260,37, Δ ${sgn(d)})`);
    const l2 = await prisma.rawMaterialLot.findFirst({ where: { organizationId: org, purchase: { number: "З-2026-0059" } }, select: { quantityReceived: true, quantityRemaining: true } });
    const used = await prisma.productionMaterialUsage.aggregate({ where: { lot: { purchase: { number: "З-2026-0059" } } }, _sum: { quantity: true } });
    chk(!!l2 && D(l2.quantityReceived).eq(D(used._sum.quantity ?? 0).add(l2.quantityRemaining)), `лот З-2026-0059: получено ${l2?.quantityReceived} = использовано ${used._sum.quantity} + остаток ${l2?.quantityRemaining}`);
    const p1 = await prisma.purchase.findFirst({ where: { organizationId: org, number: "З-2026-0001" }, select: { status: true } });
    chk(p1?.status === "CANCELLED", `З-2026-0001: статус ${p1?.status}`);
  }
  if (fond) {
    const o = (await getOrder("79"))!;
    const d = sumOrder(o).sub(DOC79);
    chk(d.abs().lte(1), `ТЗ 79: ${rub(sumOrder(o))} ₽ (документ ${rub(DOC79)}, Δ ${sgn(d)}); снимок ТЗ: ${rub(o.totalCost ?? 0)}`);
  }
  const debt1 = await debtOf();
  if (debt0 && debt1) console.log(`  Долг поставщику: ${rub(debt0)} → ${rub(debt1)} (${sgn(debt1.sub(debt0))})`);
  console.log(bad ? `После записи расхождений: ${bad}` : "После записи: все контрольные проверки пройдены.");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
