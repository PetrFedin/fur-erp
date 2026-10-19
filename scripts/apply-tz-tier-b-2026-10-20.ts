/**
 * Сведение себестоимости ТЗ 91–96, 111, 112 с итогом Word-Приложения (по правилу яруса A из scripts/apply-tz-document-match-2026-10-19.ts) — 20.10.2026, НЕ ПРИМЕНЕНО на боевой базе.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-tz-tier-b-2026-10-20.ts                      # пробный прогон (БД не меняется)
 *   DATABASE_URL=<копия> node --env-file=.env node_modules/.bin/tsx scripts/apply-tz-tier-b-2026-10-20.ts --apply              # репетиция на копии
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-tz-tier-b-2026-10-20.ts --apply --live       # боевая fur_erp (сам делает scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-tz-tier-b-2026-10-20.ts --rollback [--apply [--live]]
 *
 * Причина та же, что у яруса A: в Приложениях НДС 22% по всем строкам, в лотах 2025 г. ставка 20%, строка в системе меньше документа в 1,22/1,20 раза.
 * Разница ведётся отдельной строкой доп. расхода ТЗ «Корректировка по документу ТЗ» (метка [tz-doc-match:2026-10-19]); строки списаний, лоты, закупки и остатки не трогаем.
 * Подтверждение (verifiedAt) у изменённых ТЗ и их партий снимается, прежние значения лежат в журнале и возвращаются откатом. ТЗ 90 — файла Приложения нет, не трогаем.
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
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
const ROUNDING = process.argv.includes("--rounding");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").map((s) => s.trim()).filter(Boolean);
const TAG = "[tz-doc-match:2026-10-19]";
const CAT_ADJ = "Корректировка по документу ТЗ";
const MAX_RESID = 200; // ₽: больше — это не «НДС + округление», а другая причина (лот, количество, работа): ТЗ пропускается и идёт владельцу на решение
const TOL = 1; // ₽

// ТЗ 91–96, 111, 112: правило яруса A (НДС 22% в Приложении против 20% в лотах). ref — «Общая стоимость настоящего ТЗ составляет … руб.» (совпадает с «Итого» таблицы продукции;
// проверено по docx в uploads/drive-docs, 2026-10-20). ТЗ 90 (Приложение не прикреплено), 146, 116, 46, 52 — НЕ трогаем (ждут решения владельца).
const TIER_A: Record<string, { ref: number; src: string; extras?: { perUnit: number; qty: number; cat: string; desc: string }[] }> = {
  "91": { ref: 256063.56, src: "ПРИЛОЖЕНИЕ 91 (МН02 блэкглама 9 шт).docx" },
  "92": { ref: 214034.65, src: "ПРИЛОЖЕНИЕ 92 (МН02 лаванда 5 шт).docx" },
  "93": { ref: 159149.55, src: "ПРИЛОЖЕНИЕ 93 (МН02 пастель 5 шт).docx" },
  "94": { ref: 64259.86, src: "ПРИЛОЖЕНИЕ 94 (МН09 соболь 1 шт).docx" },
  "95": { ref: 53963.26, src: "ПРИЛОЖЕНИЕ 95 (МН17 норка 3 шт.).docx" },
  "96": { ref: 22362.75, src: "ПРИЛОЖЕНИЕ 96 (МН06 норка 2 шт.).docx" },
  "111": { ref: 391887.97, src: "ПРИЛОЖЕНИЕ 111 (MH12 - 8 шт.).docx" },
  "112": { ref: 189509.51, src: "ПРИЛОЖЕНИЕ 112 (MH13 - 12 шт.).docx" },
};
// Ярус B (округление ≤ 100 ₽) в этом скрипте не используется.
const TIER_B: Record<string, { ref: number; src: string; extras?: { perUnit: number; qty: number; cat: string; desc: string }[] }> = {};

const rub = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2).toNumber().toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const D = (v: Decimal.Value) => new Decimal(v);
const RATE4 = new Decimal("0.04");
const K22 = new Decimal(1.22).div(1.2).sub(1); // 1/60

type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string; db: string;
  createdExpenses: { id: string; orderId: string; tz: string; amount: string }[];
  createdCategoryId: string | null;
  orders: { id: string; tz: string; old: { materialCost: string | null; expenseCost: string | null; totalCost: string | null; unitCost: string | null; verifiedAt: string | null; verifiedBy: string | null; verifyNote: string | null } }[];
  batches: { id: string; old: { verifiedAt: string | null; verifiedBy: string | null; verifyNote: string | null } }[];
  stock: { id: string; oldAvgUnitCost: string }[];
  movements: { id: string }[];
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { fullFinishedCost, orderStockContribution, FG_FULL_COST_NOTE } = await import("../src/lib/finished-goods-cost");
  const url = process.env.DATABASE_URL ?? "";
  const dbName = url.split("?")[0].split("/").pop() ?? "";
  const isLive = dbName === "fur_erp";
  if (APPLY && isLive && !LIVE) throw new Error(`База «${dbName}» боевая: для записи нужен --live (для репетиции укажите копию через DATABASE_URL).`);
  if (APPLY && !isLive && LIVE) throw new Error(`--live указан, но DATABASE_URL смотрит на «${dbName}», а не на fur_erp.`);
  const prisma = createAuditedClient("script:apply-tz-tier-b-2026-10-20");
  const JOURNAL = join(INV, `corrections-journal-tz-tier-b-2026-10-20${isLive ? "" : `-${dbName}`}.json`);
  const org = (await prisma.organization.findFirst({ select: { id: true } }))!.id;

  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат (${dbName}): расходов ${j.createdExpenses.length}, ТЗ ${j.orders.length}, партий ${j.batches.length}, склад ГП ${j.stock.length}, движений ${j.movements.length}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        await tx.finishedGoodsMovement.deleteMany({ where: { id: { in: j.movements.map((x) => x.id) } } });
        // один остаток склада мог меняться несколькими ТЗ подряд: возвращаем значение ДО первой правки (первая запись журнала)
        const firstAvg = new Map<string, string>();
        for (const s of j.stock) if (!firstAvg.has(s.id)) firstAvg.set(s.id, s.oldAvgUnitCost);
        for (const [id, avg] of firstAvg) await tx.finishedGoodsStock.update({ where: { id }, data: { avgUnitCost: avg } });
        await tx.productionExpense.deleteMany({ where: { id: { in: j.createdExpenses.map((x) => x.id) } } });
        for (const o of j.orders) {
          await tx.productionOrder.update({
            where: { id: o.id },
            data: { materialCost: o.old.materialCost, expenseCost: o.old.expenseCost, totalCost: o.old.totalCost, unitCost: o.old.unitCost, verifiedAt: o.old.verifiedAt ? new Date(o.old.verifiedAt) : null, verifiedBy: o.old.verifiedBy, verifyNote: o.old.verifyNote },
          });
        }
        for (const b of j.batches) await tx.productionBatch.update({ where: { id: b.id }, data: { verifiedAt: b.old.verifiedAt ? new Date(b.old.verifiedAt) : null, verifiedBy: b.old.verifiedBy, verifyNote: b.old.verifyNote } });
        if (j.createdCategoryId) {
          const used = await tx.productionExpense.count({ where: { categoryId: j.createdCategoryId } });
          if (used === 0) await tx.expenseCategory.delete({ where: { id: j.createdCategoryId } });
        }
      }, { timeout: 120000, maxWait: 15000 });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  const targets: Record<string, { ref: number; src: string; extras?: { perUnit: number; qty: number; cat: string; desc: string }[]; tier: "A" | "B" }> = {};
  for (const [k, v] of Object.entries(TIER_A)) targets[k] = { ...v, tier: "A" };
  if (ROUNDING) for (const [k, v] of Object.entries(TIER_B)) targets[k] = { ...v, tier: "B" };
  const tzs = Object.keys(targets).filter((k) => !ONLY.length || ONLY.includes(k)).sort((a, b) => Number(a) - Number(b));

  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: org, workOrderNumber: { in: tzs }, status: { not: "CANCELLED" } },
    select: {
      id: true, number: true, workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, workOrderDate: true, createdAt: true,
      batchId: true, verifiedAt: true, verifiedBy: true, verifyNote: true, materialCost: true, expenseCost: true, totalCost: true, unitCost: true,
      finishedWarehouseId: true, productModelId: true, productModel: { select: { name: true } },
      materialUsages: { select: { id: true, totalCost: true, commission4: true, vatRate: true, quantity: true, lot: { select: { lotNumber: true, vatRate: true } } } },
      expenses: { select: { id: true, amount: true, description: true, category: { select: { name: true } } } },
    },
  });

  type Plan = {
    tz: string; ref: number; src: string; tier: "A" | "B";
    orders: typeof orders; sysBase: Decimal; uplift: Decimal; extras: Decimal; remaining: Decimal; resid: Decimal;
    lineLog: string[]; rows: { orderId: string; cat: string; amount: Decimal; desc: string }[]; problem: string | null; existing: { id: string; orderId: string; amount: Decimal; desc: string }[];
  };
  const plans: Plan[] = [];
  for (const tz of tzs) {
    const t = targets[tz];
    const os = orders.filter((o) => o.workOrderNumber === tz);
    const p: Plan = { tz, ref: t.ref, src: t.src, tier: t.tier, orders: os, sysBase: D(0), uplift: D(0), extras: D(0), remaining: D(0), resid: D(0), lineLog: [], rows: [], problem: null, existing: [] };
    plans.push(p);
    if (os.length === 0) { p.problem = "ТЗ не найдено в базе"; continue; }
    const upByOrder = new Map<string, Decimal>();
    for (const o of os) {
      const units = o.status === "COMPLETED" ? o.producedQuantity : o.plannedQuantity;
      let sum = D(0);
      for (const u of o.materialUsages) {
        const line = u.commission4 ? D(u.totalCost).mul(D(1).add(RATE4)) : D(u.totalCost);
        sum = sum.add(line);
        if (t.tier === "A" && u.vatRate == null && D(u.lot.vatRate).eq(20)) {
          const up = line.mul(K22);
          upByOrder.set(o.id, (upByOrder.get(o.id) ?? D(0)).add(up));
          p.uplift = p.uplift.add(up);
          p.lineLog.push(`    ${o.number} лот ${u.lot.lotNumber ?? "(подкладка)"}: ${rub(line)} → ${rub(line.add(up))} (+${rub(up)})`);
        }
      }
      for (const e of o.expenses) {
        if (e.description?.startsWith(TAG)) p.existing.push({ id: e.id, orderId: o.id, amount: D(e.amount), desc: e.description });
        else sum = sum.add(e.amount);
      }
      if (o.clientWorkPricePerUnit != null) sum = sum.add(D(o.clientWorkPricePerUnit).mul(units));
      p.sysBase = p.sysBase.add(sum);
    }
    // доп. материалы из документа — на первую позицию ТЗ
    const ex = t.extras ?? [];
    for (const e of ex) {
      const amt = D(e.perUnit).mul(e.qty);
      p.extras = p.extras.add(amt);
      p.rows.push({ orderId: os[0].id, cat: e.cat, amount: amt, desc: `${TAG} ${e.desc}` });
    }
    p.remaining = D(t.ref).sub(p.sysBase).sub(p.extras);
    p.resid = p.remaining.sub(p.uplift);
    if (p.resid.abs().gt(MAX_RESID)) { p.problem = `остаток после НДС 22% и доп. материалов ${rub(p.resid)} ₽ больше допуска ${MAX_RESID} ₽ — другая причина, не правлю`; p.rows = []; continue; }
    if (p.remaining.abs().gt(TOL)) {
      // разносим по позициям пропорционально их доле НДС-эффекта; остаток округления — на позицию с наибольшей долей
      const parts = os.map((o) => ({ o, w: upByOrder.get(o.id) ?? D(0) }));
      const totalW = parts.reduce((s, x) => s.add(x.w), D(0));
      let left = p.remaining;
      const sorted = [...parts].sort((a, b) => b.w.comparedTo(a.w));
      sorted.forEach((x, i) => {
        const part = i === sorted.length - 1 || totalW.isZero() ? left : p.remaining.mul(x.w.div(totalW)).toDecimalPlaces(2);
        const v = i === 0 && totalW.isZero() ? p.remaining : part;
        if (totalW.isZero() && i > 0) return;
        left = left.sub(v);
        if (v.abs().lt(0.005)) return;
        p.rows.push({ orderId: x.o.id, cat: CAT_ADJ, amount: v.toDecimalPlaces(2), desc: `${TAG} ТЗ ${tz}: ${t.tier === "A" ? `НДС 22 % по документу вместо 20 % в лотах: +${rub(p.uplift)} ₽` : "округление цены за единицу в документе"}; округление документа ${rub(p.resid)} ₽; итог документа ${rub(t.ref)} ₽ (${t.src})` });
      });
    }
  }

  // ───────── вывод
  const out: string[] = [`# Сведение себестоимости ТЗ с Word-ТЗ — ${APPLY ? "ПРИМЕНЕНИЕ" : "пробный прогон"} (${new Date().toISOString()}), база «${dbName}»`, ""];
  let sumDelta = D(0), nChange = 0, nSkip = 0, nSame = 0;
  for (const p of plans) {
    const want = p.rows.reduce((s, r) => s.add(r.amount), D(0));
    const have = p.existing.reduce((s, r) => s.add(r.amount), D(0));
    const status = p.problem ? `ПРОПУСК: ${p.problem}` : p.existing.length && have.sub(want).abs().lt(0.01) && p.existing.length === p.rows.length ? "уже применено" : want.isZero() && !p.existing.length ? "совпадает (в пределах 1 ₽)" : "будет записано";
    out.push(`## ТЗ ${p.tz} (${p.orders.map((o) => o.productModel.name).join(", ")}) · ярус ${p.tier} · документ ${rub(p.ref)} · система без поправки ${rub(p.sysBase)} · Δ ${rub(D(p.ref).sub(p.sysBase))} — ${status}`);
    if (p.problem) { nSkip++; out.push(""); continue; }
    out.push(...p.lineLog);
    for (const r of p.rows) out.push(`    + расход «${r.cat}» ${p.orders.find((o) => o.id === r.orderId)?.number}: ${rub(r.amount)} ₽ — ${r.desc.slice(TAG.length + 1, TAG.length + 120)}…`);
    out.push(`    итого после: ${rub(p.sysBase.add(want))} ₽ (документ ${rub(p.ref)}; |Δ| = ${rub(D(p.ref).sub(p.sysBase).sub(want).abs())})`, "");
    if (status === "уже применено" || (want.isZero() && !p.existing.length)) nSame++; else { nChange++; sumDelta = sumDelta.add(want.sub(have)); }
  }
  out.push(`ИТОГО: ТЗ к изменению ${nChange}, без изменений ${nSame}, пропущено ${nSkip}; общий рост себестоимости ТЗ ${rub(sumDelta)} ₽`);
  console.log(out.join("\n"));
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply (копия) или --apply --live (боевая)."); await prisma.$disconnect(); return; }

  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое сведение — повторно не применяю (сначала --rollback --apply)."); await prisma.$disconnect(); return; }
  if (isLive && !NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }

  const journal: Journal = { script: "apply-tz-tier-b-2026-10-20.ts", status: "applied", at: new Date().toISOString(), db: dbName, createdExpenses: [], createdCategoryId: null, orders: [], batches: [], stock: [], movements: [] };
  await prisma.$transaction(async (tx) => {
    let adj = await tx.expenseCategory.findFirst({ where: { organizationId: org, name: CAT_ADJ, kind: "PRODUCTION" } });
    const mats = await tx.expenseCategory.findFirst({ where: { organizationId: org, name: "Доп. материалы", kind: "PRODUCTION" } });
    const changed = new Set<string>();
    for (const p of plans) {
      if (p.problem) continue;
      const want = p.rows.reduce((s, r) => s.add(r.amount), D(0));
      const have = p.existing.reduce((s, r) => s.add(r.amount), D(0));
      if (p.existing.length === p.rows.length && have.sub(want).abs().lt(0.01)) continue;
      // идемпотентность: прежние строки этого скрипта заменяем новыми (журнал фиксирует только созданные в этом запуске)
      if (p.existing.length) await tx.productionExpense.deleteMany({ where: { id: { in: p.existing.map((e) => e.id) } } });
      for (const r of p.rows) {
        let cat = r.cat === CAT_ADJ ? adj : mats;
        if (!cat && r.cat === CAT_ADJ) { adj = cat = await tx.expenseCategory.create({ data: { organizationId: org, name: CAT_ADJ, kind: "PRODUCTION" } }); journal.createdCategoryId = cat.id; }
        if (!cat) throw new Error(`Нет категории расходов «${r.cat}»`);
        const o = p.orders.find((x) => x.id === r.orderId)!;
        const ex = await tx.productionExpense.create({ data: { productionOrderId: r.orderId, categoryId: cat.id, amount: r.amount, date: o.workOrderDate ?? o.createdAt, description: r.desc }, select: { id: true } });
        journal.createdExpenses.push({ id: ex.id, orderId: r.orderId, tz: p.tz, amount: r.amount.toFixed(2) });
        changed.add(r.orderId);
      }
      for (const e of p.existing) changed.add(e.orderId);
    }
    // снимок ТЗ, склад ГП, подтверждение — как syncCompletedOrderCost и resetVerification в приложении
    for (const id of changed) {
      const o = await tx.productionOrder.findUnique({ where: { id }, include: { materialUsages: true, expenses: true } });
      if (!o) continue;
      journal.orders.push({ id, tz: o.workOrderNumber ?? "", old: { materialCost: o.materialCost?.toString() ?? null, expenseCost: o.expenseCost?.toString() ?? null, totalCost: o.totalCost?.toString() ?? null, unitCost: o.unitCost?.toString() ?? null, verifiedAt: o.verifiedAt?.toISOString() ?? null, verifiedBy: o.verifiedBy, verifyNote: o.verifyNote } });
      if (o.verifiedAt) await tx.productionOrder.update({ where: { id }, data: { verifiedAt: null, verifiedBy: null, verifyNote: null } });
      if (o.batchId && !journal.batches.some((b) => b.id === o.batchId)) {
        const b = await tx.productionBatch.findUnique({ where: { id: o.batchId }, select: { id: true, verifiedAt: true, verifiedBy: true, verifyNote: true } });
        if (b?.verifiedAt) { journal.batches.push({ id: b.id, old: { verifiedAt: b.verifiedAt.toISOString(), verifiedBy: b.verifiedBy, verifyNote: b.verifyNote } }); await tx.productionBatch.update({ where: { id: b.id }, data: { verifiedAt: null, verifiedBy: null, verifyNote: null } }); }
      }
      if (o.status !== "COMPLETED" || o.producedQuantity.isZero()) continue;
      const materialCost = o.materialUsages.reduce((s, u) => s.add(u.totalCost), D(0));
      const expenseCost = o.expenses.reduce((s, e) => s.add(e.amount), D(0));
      const totalCost = materialCost.add(expenseCost);
      const snapshotDelta = totalCost.sub(o.totalCost ?? D(0));
      const contribution = await orderStockContribution(tx as Prisma.TransactionClient, id);
      const full = fullFinishedCost(o, o.producedQuantity);
      const stockDelta = contribution.marked ? full.total.sub(contribution.count === 0 ? (o.totalCost ?? D(0)) : contribution.net) : snapshotDelta;
      await tx.productionOrder.update({ where: { id }, data: { materialCost, expenseCost, totalCost, unitCost: totalCost.div(o.producedQuantity) } });
      if (stockDelta.abs().lt(0.005)) continue;
      const stock = await tx.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: o.finishedWarehouseId, productModelId: o.productModelId } } });
      if (!stock) continue;
      journal.stock.push({ id: stock.id, oldAvgUnitCost: stock.avgUnitCost.toString() });
      const newTotal = stock.quantity.mul(stock.avgUnitCost).add(stockDelta);
      await tx.finishedGoodsStock.update({ where: { id: stock.id }, data: { avgUnitCost: stock.quantity.isZero() ? stock.avgUnitCost : newTotal.div(stock.quantity) } });
      const mv = await tx.finishedGoodsMovement.create({
        data: {
          organizationId: org, warehouseId: o.finishedWarehouseId, productModelId: o.productModelId, type: stockDelta.greaterThan(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", quantity: 0,
          unitCost: stockDelta.abs().div(o.producedQuantity), totalCost: stockDelta.abs(), productionOrderId: id,
          notes: `${TAG} Сведение с итогом Word-ТЗ. ${contribution.marked ? FG_FULL_COST_NOTE : "Корректировка себестоимости после правки завершённого ТЗ"}`,
        },
        select: { id: true },
      });
      journal.movements.push({ id: mv.id });
    }
  }, { timeout: 300000, maxWait: 15000 });
  writeJson(JOURNAL, journal);
  console.log(`\nПрименено на «${dbName}»: создано расходов ${journal.createdExpenses.length}, пересчитано ТЗ ${journal.orders.length}. Журнал: ${JOURNAL}`);

  // контроль после записи: итог ТЗ в системе = итог документа (допуск 1 ₽)
  const after = await prisma.productionOrder.findMany({
    where: { organizationId: org, workOrderNumber: { in: tzs }, status: { not: "CANCELLED" } },
    select: { workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, materialUsages: { select: { totalCost: true, commission4: true } }, expenses: { select: { amount: true } } },
  });
  let bad = 0;
  for (const tz of tzs) {
    const p = plans.find((x) => x.tz === tz)!;
    if (p.problem) continue;
    let s = D(0);
    for (const o of after.filter((x) => x.workOrderNumber === tz)) {
      for (const u of o.materialUsages) s = s.add(u.commission4 ? D(u.totalCost).mul(D(1).add(RATE4)) : u.totalCost);
      for (const e of o.expenses) s = s.add(e.amount);
      if (o.clientWorkPricePerUnit != null) s = s.add(D(o.clientWorkPricePerUnit).mul(o.status === "COMPLETED" ? o.producedQuantity : o.plannedQuantity));
    }
    const d = s.sub(targets[tz].ref);
    if (d.abs().gt(TOL)) { bad++; console.log(`  ✗ ТЗ ${tz}: система ${rub(s)} ≠ документ ${rub(targets[tz].ref)} (Δ ${rub(d)})`); }
  }
  console.log(bad ? `После записи расхождений > ${TOL} ₽: ${bad}` : `После записи: у всех ${tzs.length - plans.filter((x) => x.problem).length} ТЗ сумма в системе = сумма документа (допуск ${TOL} ₽).`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
