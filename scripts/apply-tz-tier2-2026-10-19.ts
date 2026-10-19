/**
 * Сведение семи ТЗ «второго яруса» с Word-ТЗ по ОТВЕТАМ ВЛАДЕЛЬЦА от 19.10.2026 — ПРЕДЛОЖЕНИЕ, НЕ ПРИМЕНЕНО.
 * (Первый ярус — НДС 22 %/20 % у 71 ТЗ — см. apply-tz-document-match-2026-10-19.ts, уже применён.)
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-tz-tier2-2026-10-19.ts                      # пробный прогон (БД не меняется)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-tz-tier2-2026-10-19.ts --apply              # применить на НЕ боевой базе (копия)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-tz-tier2-2026-10-19.ts --apply --live       # применить на боевой fur_erp (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-tz-tier2-2026-10-19.ts --rollback [--apply [--live]]
 *   доп. ключ: --only=52,121 (только эти ТЗ)
 *
 * ЧТО ДЕЛАЕТ (каждое действие — по документам и письмам, ничего не выдумано):
 *   ТЗ 46  — только ПРИМЕЧАНИЕ: «замена лота 1450→1457 по производству»; деньги не меняются (объяснено, не правим).
 *   ТЗ 52  — расход «Корректировка по документу ТЗ» (минус) до итога Приложения: цена лота 1498 по документу 11 579,80 ₽ (с НДС, без 4 %), в списании «1498-1» 18 366,51 ₽.
 *            Цена лота НЕ меняется (лот общий с ТЗ 125 и 133). Справка в примечании: в базе есть неиспользованный лот «1498-2» (12 шт × 11 580,00 ₽).
 *   ТЗ 79  — фондю 70 шт. уже списано (лот «фондю-3», закупка З-2026-0012, доп. закупка подрядчика, 4 % нет). Новая закупка/списание НЕ нужны.
 *            Остаток до итога Приложения = цена шкуры в документе 13 470 ₽ против 13 250 ₽ (70 × 220 = 15 400 ₽) + НДС 22 % по подкладке — расход «Корректировка по документу ТЗ».
 *   ТЗ 116 — строка 16 шт. (лот 10026) приводится к Приложению (НДС 22 %). Строка 9 шт. СОХРАНЕНА: её нет в Приложении, но она подтверждена письмом 03.06.2026,
 *            УПД МФВМ/000030 от 05.06.2026 и ОСВ (16+9=25); итог системы поэтому больше итога документа ровно на эти 9 шт. (по строкам документа — совпадает).
 *   ТЗ 121 — снят флаг 4 % со строки «лиса» (сырьё подрядчика, куплено не на аукционе): −35 200 ₽.
 *   ТЗ 146 — работа 28 163 ₽/шт. НЕ меняется: исправленное Приложение №146 (письмо Василия 15.09.2026 18:35) подтверждает 28 163 (29 500 − 1 337), цена 29 500 — старая версия;
 *            расход «Корректировка по документу ТЗ» — НДС 22 % по шкурам лота 160045 до итога исправленного Приложения (282 223,81 ₽).
 *   ТЗ 158 — списание 33 шт. красной лисы (3 изд. × 11 шк.) с лота З-2026-0059 (УПД №209 от 16.07.2026, 88 шт × 16 000 ₽, куплено у поставщика), без 4 %: 528 000 ₽.
 *   Проверка 4 % по всем ТЗ с неаукционным сырьём — таблица в выводе (только чтение; правится лишь подтверждённое документом: ТЗ 121).
 * Механика записи — как в приложении: списание лота = consumeFromLot (движение PRODUCTION_OUT + остаток лота) + ProductionMaterialUsage; тождество «куплено = использовано + остаток» сохраняется.
 * Для завершённых ТЗ пересчитывается снимок ТЗ и оценка склада ГП (как syncCompletedOrderCost); «подтверждено» у изменённых ТЗ и их партий снимается (как делает приложение при правке). Журнал — для отката.
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
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").map((s) => s.trim()).filter(Boolean);
const TAG = "[tz-tier2:2026-10-19]";
const CAT_ADJ = "Корректировка по документу ТЗ";
const TOL = 1; // ₽: допуск «сумма в системе = сумме документа»
const MAX_EXPLAIN = 5; // ₽: расхождение между строкой расхода и причиной, объяснённой по документу (округление цен в самом документе)
const AUDIT_TOL = 200; // ₽: как в первом скрипте — больше это уже не «НДС + округление»

const rub = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2).toNumber().toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sgn = (v: Decimal.Value) => (new Decimal(v).gte(0) ? "+" : "") + rub(v);
const D = (v: Decimal.Value) => new Decimal(v);
const RATE4 = new Decimal("0.04");
const K22 = new Decimal(1.22).div(1.2).sub(1); // 1/60: лот 20 % → документ 22 %

// ───────── Исходные данные по документам (итог «Общая стоимость настоящего ТЗ составляет … руб.») ─────────
type Cfg = { ref: number | null; src: string };
const CFG: Record<string, Cfg> = {
  "46": { ref: null, src: "ПРИЛОЖЕНИЕ 46 (М003 -соболь).docx — итог 1 410 510,98 ₽ (без 4 %, НДС 20 %); ответ владельца 19.10.2026" },
  "52": { ref: 1904253.46, src: "ПРИЛОЖЕНИЕ 52 (М003 -соболь)+4%.docx (НДС 20 %); ответ владельца 19.10.2026: «верна цена из документа»" },
  "79": { ref: 1326568.6, src: "ПРИЛОЖЕНИЕ 79 (М021-свакара фондю 2 изд)+4%.docx (НДС 22 %); ответ владельца 19.10.2026: фондю 70 шт. = «фондю 3»" },
  "116": { ref: 383330.44, src: "ПРИЛОЖЕНИЕ 116 от 07.05.2026 (НДС 22 %); письмо Василия 03.06.2026, УПД МФВМ/000030 от 05.06.2026" },
  "121": { ref: 1497260.37, src: "ПРИЛОЖЕНИЕ 121 (М029 красная лиса) от 28.08.2026 (НДС 22 %); ответ владельца 19.10.2026: сырьё подрядчика без 4 %" },
  "146": { ref: 282223.81, src: "ПРИЛОЖЕНИЕ 146 MSC06 — исправленное, письмо Василия 15.09.2026 18:35 (работа 28 163 ₽/шт.); старая версия от 26.08.2026 (29 500 ₽/шт.) — итог 288 908,81 ₽" },
  "158": { ref: 898356.22, src: "ПРИЛОЖЕНИЕ 158 (М029 красная лиса - 3 изд.) от 22.09.2026 (НДС 22 %); ответ владельца 19.10.2026: куплено у поставщика, не на аукционе" },
};
const REF46_BASE_NO4 = 1410510.98; // ТЗ 46: итог документа без 4 % (база сравнения)

// Для таблицы проверки 4 %: итоги документов по ТЗ с неаукционным сырьём. a22 — Приложение с НДС 22 % (лоты 20 % → +1/60); no4 — в документе 4 % нет вообще.
const REF4: Record<string, { ref: number; a22?: boolean; no4?: boolean; adj?: number; excl?: string; note?: string }> = {
  "8": { ref: 367736.3 }, "22": { ref: 2662736.44 }, "27": { ref: 447311.72 }, "28": { ref: 1110696.52 },
  "44": { ref: 520608.6, no4: true, note: "в документе 4 % нет вообще (версии «+4 %» нет)" }, "47": { ref: 1062196.0, no4: true, note: "в документе 4 % нет вообще (версии «+4 %» нет)" },
  "55": { ref: 1926757.34 }, "56": { ref: 1957318.01 }, "57": { ref: 841147.01 }, "58": { ref: 1957318.01 }, "61": { ref: 652174.0 },
  "70": { ref: 786722.04, a22: true }, "79": { ref: 1326568.6, a22: true, adj: 15400, note: "цена шкуры в документе 13 470 вместо 13 250 (+15 400)" },
  "80": { ref: 1396326.0, a22: true }, "81": { ref: 889286.0, a22: true }, "85": { ref: 444639.84, a22: true }, "88": { ref: 1196058.21, a22: true },
  "100": { ref: 91427.0, a22: true }, "105": { ref: 18285.4, a22: true }, "123": { ref: 1171030.71, a22: true }, "150": { ref: 632439.65, a22: true },
  "174": { ref: 2548367.3, a22: true },
  "116": { ref: 383330.44, a22: true, excl: "9", note: "строка 9 шт. вне Приложения (УПД МФВМ/000030) в сравнение не входит" },
  "121": { ref: 1497260.37, a22: true }, "146": { ref: 282223.81, a22: true }, "158": { ref: 898356.22, a22: true },
};

type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string; db: string;
  createdExpenses: { id: string; orderId: string; tz: string; amount: string }[];
  createdCategoryId: string | null;
  flags: { usageId: string; tz: string; before: boolean; after: boolean }[];
  usages: { id: string; orderId: string; tz: string; lotId: string; quantity: string; unitCost: string; totalCost: string }[];
  stockMovements: { id: string }[];
  lots: { id: string; lotNumber: string | null; remainingBefore: string; remainingAfter: string }[];
  notes: { orderId: string; tz: string; before: string | null; after: string }[];
  orders: { id: string; tz: string; old: { materialCost: string | null; expenseCost: string | null; totalCost: string | null; unitCost: string | null; verifiedAt: string | null; verifiedBy: string | null; verifyNote: string | null } }[];
  batches: { id: string; old: { verifiedAt: string | null; verifiedBy: string | null; verifyNote: string | null } }[];
  stock: { id: string; oldAvgUnitCost: string }[];
  movements: { id: string }[];
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { fullFinishedCost, orderStockContribution, FG_FULL_COST_NOTE } = await import("../src/lib/finished-goods-cost");
  const { consumeFromLot } = await import("../src/lib/stock");
  const url = process.env.DATABASE_URL ?? "";
  const dbName = url.split("?")[0].split("/").pop() ?? "";
  const isLive = dbName === "fur_erp";
  if (APPLY && isLive && !LIVE) throw new Error(`База «${dbName}» боевая: для записи нужен --live (для репетиции укажите копию через DATABASE_URL).`);
  if (APPLY && !isLive && LIVE) throw new Error(`--live указан, но DATABASE_URL смотрит на «${dbName}», а не на fur_erp.`);
  const prisma = createAuditedClient("script:apply-tz-tier2-2026-10-19");
  const JOURNAL = join(INV, `corrections-journal-tz-tier2-2026-10-19${isLive ? "" : `-${dbName}`}.json`);
  const org = (await prisma.organization.findFirst({ select: { id: true } }))!.id;

  // ───────── откат ─────────
  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат (${dbName}): расходов ${j.createdExpenses.length}, флагов 4% ${j.flags.length}, списаний ${j.usages.length}, ТЗ ${j.orders.length}, склад ГП ${j.stock.length}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (APPLY) {
      if (isLive && !NO_BACKUP) { console.log("Копия базы перед откатом: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
      await prisma.$transaction(async (tx) => {
        await tx.finishedGoodsMovement.deleteMany({ where: { id: { in: j.movements.map((x) => x.id) } } });
        const firstAvg = new Map<string, string>();
        for (const s of j.stock) if (!firstAvg.has(s.id)) firstAvg.set(s.id, s.oldAvgUnitCost);
        for (const [id, avg] of firstAvg) await tx.finishedGoodsStock.update({ where: { id }, data: { avgUnitCost: avg } });
        await tx.productionExpense.deleteMany({ where: { id: { in: j.createdExpenses.map((x) => x.id) } } });
        if (j.stockMovements.length) await tx.stockMovement.deleteMany({ where: { id: { in: j.stockMovements.map((x) => x.id) } } });
        if (j.usages.length) await tx.productionMaterialUsage.deleteMany({ where: { id: { in: j.usages.map((x) => x.id) } } });
        for (const l of j.lots) {
          const lot = await tx.rawMaterialLot.findUniqueOrThrow({ where: { id: l.id } });
          await tx.rawMaterialLot.update({ where: { id: l.id }, data: { quantityRemaining: lot.quantityRemaining.add(D(l.remainingBefore).sub(D(l.remainingAfter))) } });
        }
        for (const f of j.flags) await tx.productionMaterialUsage.update({ where: { id: f.usageId }, data: { commission4: f.before } });
        for (const n of j.notes) {
          const cur = await tx.productionOrder.findUnique({ where: { id: n.orderId }, select: { notes: true } });
          if ((cur?.notes ?? null) === n.after) await tx.productionOrder.update({ where: { id: n.orderId }, data: { notes: n.before } });
          else console.log(`  ! ТЗ ${n.tz}: примечание изменено после скрипта — не откатываю (уберите строку с ${TAG} вручную)`);
        }
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

  // ───────── чтение ─────────
  const tzs = Object.keys(CFG).filter((k) => !ONLY.length || ONLY.includes(k)).sort((a, b) => Number(a) - Number(b));
  const orderSelect = {
    id: true, number: true, workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, workOrderDate: true, createdAt: true, notes: true,
    batchId: true, verifiedAt: true, verifiedBy: true, verifyNote: true, materialCost: true, expenseCost: true, totalCost: true, unitCost: true,
    finishedWarehouseId: true, productModelId: true, productModel: { select: { name: true } },
    materialUsages: { select: { id: true, totalCost: true, commission4: true, vatRate: true, quantity: true, lotId: true, lot: { select: { lotNumber: true, vatRate: true, purchase: { select: { number: true, isContractorRaw: true, auctionId: true, auction: { select: { name: true } } } } } } } },
    expenses: { select: { id: true, amount: true, description: true, category: { select: { name: true } } } },
  } satisfies Prisma.ProductionOrderSelect;
  const orders = await prisma.productionOrder.findMany({ where: { organizationId: org, workOrderNumber: { in: tzs }, status: { not: "CANCELLED" } }, select: orderSelect });
  type Ord = (typeof orders)[number];
  const units = (o: Ord) => (o.status === "COMPLETED" ? o.producedQuantity : o.plannedQuantity);
  const lineWith4 = (u: Ord["materialUsages"][number], c4 = u.commission4) => (c4 ? D(u.totalCost).mul(D(1).add(RATE4)) : D(u.totalCost));
  const work = (o: Ord) => (o.clientWorkPricePerUnit != null ? D(o.clientWorkPricePerUnit).mul(units(o)) : D(0));
  /** Сумма ТЗ «как в документе»: сырьё (+4 % у строк с флагом) + расходы (без строк этого скрипта, если skipTag) + работа. */
  const sumOrder = (o: Ord, opt: { skipTag?: boolean; exclUsage?: (u: Ord["materialUsages"][number]) => boolean; no4?: boolean } = {}) => {
    let s = D(0);
    for (const u of o.materialUsages) { if (opt.exclUsage?.(u)) continue; s = s.add(opt.no4 ? D(u.totalCost) : lineWith4(u)); }
    for (const e of o.expenses) { if (opt.skipTag && e.description?.startsWith(TAG)) continue; s = s.add(e.amount); }
    return s.add(work(o));
  };

  // лоты, нужные для действий
  const lot158 = await prisma.rawMaterialLot.findMany({
    where: { organizationId: org, purchase: { number: "З-2026-0059" } },
    select: { id: true, lotNumber: true, quantityRemaining: true, quantityReceived: true, unitCost: true, vatRate: true, rawMaterialId: true, rawMaterial: { select: { name: true } }, purchase: { select: { number: true, status: true } } },
  });
  const lot1498_2 = await prisma.rawMaterialLot.findFirst({ where: { organizationId: org, lotNumber: "1498-2" }, select: { quantityReceived: true, quantityRemaining: true, unitCost: true, purchase: { select: { number: true } } } });

  type Plan = {
    tz: string; ref: number | null; src: string; orders: Ord[]; problem: string | null;
    flags: { usageId: string; orderId: string; label: string; add4: Decimal }[];
    consume: { orderId: string; lotId: string; rawMaterialId: string; lotNumber: string | null; purchase: string; qty: Decimal; unitCost: Decimal; total: Decimal; date: Date; done: boolean } | null;
    rows: { orderId: string; cat: string; amount: Decimal; desc: string }[]; existing: { id: string; orderId: string; amount: Decimal }[];
    noteAdd: { orderId: string; before: string | null; after: string }[];
    cur: Decimal; after: Decimal; docBasis: Decimal; explained: Decimal | null; info: string[];
  };
  const plans: Plan[] = [];

  const noteWith = (o: Ord, text: string, replace?: RegExp) => {
    const cur = o.notes ?? "";
    if (cur.includes(TAG)) return null;
    const body = `${TAG} ${text}`;
    const next = replace && replace.test(cur) ? cur.replace(replace, body) : `${cur ? cur.replace(/\s+$/, "") + "\n" : ""}${body}`;
    return { orderId: o.id, before: o.notes, after: next };
  };

  for (const tz of tzs) {
    const cfg = CFG[tz];
    const os = orders.filter((o) => o.workOrderNumber === tz);
    const p: Plan = { tz, ref: cfg.ref, src: cfg.src, orders: os, problem: null, flags: [], consume: null, rows: [], existing: [], noteAdd: [], cur: D(0), after: D(0), docBasis: D(0), explained: null, info: [] };
    plans.push(p);
    if (os.length !== 1) { p.problem = `ожидалась 1 позиция ТЗ, найдено ${os.length}`; continue; }
    const o = os[0];
    for (const e of o.expenses) if (e.description?.startsWith(TAG)) p.existing.push({ id: e.id, orderId: o.id, amount: D(e.amount) });
    p.cur = sumOrder(o);
    const baseNoTag = sumOrder(o, { skipTag: true });
    let base = baseNoTag; // сравниваемая база после запланированных правок строк списаний
    let exclUsage: ((u: Ord["materialUsages"][number]) => boolean) | undefined;
    const f = (n: Decimal.Value) => rub(n);

    if (tz === "46") {
      const sysNo4 = sumOrder(o, { skipTag: true, no4: true });
      const diff = D(REF46_BASE_NO4).sub(sysNo4);
      p.docBasis = D(REF46_BASE_NO4); p.after = p.cur;
      p.info.push(`документ (без 4 %) ${f(REF46_BASE_NO4)}; система без 4 % ${f(sysNo4)}; разница ${sgn(diff)} — объяснена заменой лота 1450 → 1457 (9 шт. × 590,96 ₽ ≈ 5 318 ₽, разница копеек — округление цен в документе), не правим`);
      const n = noteWith(o, `Замена лота 1450→1457 по производству (ответ владельца 19.10.2026): в Приложении №46 лот 1450 (9 шт. × 16 544,12 ₽), в списании лот 1457 (9 шт. × 15 953,16 ₽); система отражает факт — лот 1457. Сумма по ТЗ-документу (${f(REF46_BASE_NO4)} ₽, без 4 %) отличается от системы (${f(sysNo4)} ₽) на ${f(diff)} ₽ — стоимость не менялась.`);
      if (n) p.noteAdd.push(n);
      continue;
    }

    const ref = D(cfg.ref!);
    p.docBasis = ref;

    if (tz === "121") {
      for (const u of o.materialUsages) {
        if (u.lot.lotNumber === "лиса" && u.lot.purchase?.number === "З-2026-0001" && u.lot.purchase.isContractorRaw === true && D(u.quantity).eq(55)) {
          if (u.commission4) p.flags.push({ usageId: u.id, orderId: o.id, label: `лиса, ${u.quantity} шт, ${f(u.totalCost)} ₽ (З-2026-0001, сырьё подрядчика)`, add4: D(u.totalCost).mul(RATE4) });
        }
      }
      const hasOff = o.materialUsages.some((u) => u.lot.lotNumber === "лиса" && !u.commission4);
      if (!p.flags.length && !hasOff) { p.problem = "строка «лиса» 55 шт. (З-2026-0001) не найдена"; continue; }
      const flagged = new Set(p.flags.map((x) => x.usageId));
      base = D(0);
      for (const u of o.materialUsages) base = base.add(lineWith4(u, flagged.has(u.id) ? false : u.commission4));
      for (const e of o.expenses) if (!e.description?.startsWith(TAG)) base = base.add(e.amount);
      base = base.add(work(o));
      const n = noteWith(o, `4 % снято со строки «лиса» (55 шт. × 16 000 ₽ = 880 000 ₽, закупка З-2026-0001): сырьё подрядчика, купленное не на аукционе, 4 % не облагается (ответ владельца 19.10.2026; в Приложении №121 от 28.08.2026 цена 176 000 ₽/ед. без 4 %). Итог ТЗ с 4 %: ${f(baseNoTag)} → ${f(base)} ₽ (документ ${f(ref)} ₽).`);
      if (n) p.noteAdd.push(n);
    }

    if (tz === "158") {
      const lot = lot158.length === 1 ? lot158[0] : null;
      const QTY = D(33);
      if (!lot) { p.problem = `лот закупки З-2026-0059 не найден/неоднозначен (${lot158.length})`; continue; }
      if (lot.rawMaterial.name !== "Лиса красная" || !D(lot.unitCost).eq(16000) || lot.purchase?.status !== "RECEIVED") { p.problem = `лот З-2026-0059 не тот: ${lot.rawMaterial.name}, ${lot.unitCost} ₽, ${lot.purchase?.status}`; continue; }
      const already = o.materialUsages.find((u) => u.lotId === lot.id);
      const total = D(lot.unitCost).mul(QTY);
      if (!already && D(lot.quantityRemaining).lt(QTY)) { p.problem = `в лоте остаток ${lot.quantityRemaining} < ${QTY}`; continue; }
      p.consume = { orderId: o.id, lotId: lot.id, rawMaterialId: lot.rawMaterialId, lotNumber: lot.lotNumber, purchase: "З-2026-0059", qty: QTY, unitCost: D(lot.unitCost), total, date: o.workOrderDate ?? o.createdAt, done: !!already };
      if (!already) base = baseNoTag.add(total); // commission4 = false: 4 % на сырьё подрядчика/поставщика не начисляется
      p.info.push(`лот З-2026-0059 «${lot.rawMaterial.name}»: ${lot.quantityReceived} шт × ${f(lot.unitCost)} ₽ (УПД №209 от 16.07.2026, счёт №209: 88 шк. = 8 изд. × 11; ТЗ 121 — 55, ТЗ 158 — 33); остаток ${lot.quantityRemaining}${already ? " (списание уже есть)" : ` → ${D(lot.quantityRemaining).sub(QTY)}`}`);
      const n = noteWith(o, `Сырьё подрядчика 3 ед. × 176 000 ₽ = 528 000 ₽ (11 шкур красной лисы на изделие × 3 = 33 шт. × 16 000 ₽) списано с лота закупки З-2026-0059 (УПД №209 от 16.07.2026, счёт №209, 88 шкур — куплено у поставщика, не на аукционе), без 4 % (решение владельца 19.10.2026). Остаток лота 88 → 55. Итог ТЗ = Приложению №158 (${f(ref)} ₽).`,
        /Сырьё — подрядчика \(176 000[\s\S]*?документа с лотом\/закупкой нет\)\./);
      if (n) p.noteAdd.push(n);
    }

    if (tz === "116") {
      // строка 9 шт. вне Приложения (подтверждена письмом 03.06.2026, УПД МФВМ/000030 от 05.06.2026, ОСВ): не входит в сравнение с документом
      const nine = o.materialUsages.filter((u) => u.lot.lotNumber === "10026" && D(u.quantity).eq(9));
      if (nine.length !== 1) { p.problem = `строка 10026 × 9 шт. не найдена/неоднозначна (${nine.length})`; continue; }
      const nineId = nine[0].id;
      exclUsage = (u) => u.id === nineId;
      base = sumOrder(o, { skipTag: true, exclUsage });
      p.info.push(`строка 10026 × 9 шт. (${f(nine[0].totalCost)} ₽, с 4 % ${f(lineWith4(nine[0]))}) — вне Приложения, СОХРАНЕНА: письмо Василия 03.06.2026, УПД МФВМ/000030 от 05.06.2026, ОСВ (16+9=25); в сравнение с документом не входит`);
      const sixteen = o.materialUsages.find((u) => u.lot.lotNumber === "10026" && D(u.quantity).eq(16));
      const e116 = sixteen ? lineWith4(sixteen).mul(K22) : D(0);
      p.explained = e116;
      const nineWith4 = lineWith4(nine[0]);
      const n = noteWith(o, `Сверка с Приложением №116 (07.05.2026): в документе одна строка — лот 10026, 16 шт., ${f(164470.44)} ₽ (НДС 22 %, с 4 %); внесена корректировка НДС 22 %: ${sgn(ref.sub(base))} ₽, по строкам документа сумма в системе = ${f(ref)} ₽. Строка списания 10026 × 9 шт. (${f(nine[0].totalCost)} ₽, с 4 % ${f(nineWith4)} ₽) в Приложении отсутствует, но подтверждена: письмо Василия 03.06.2026 («нужно ещё 9 шкур норки 10026»), УПД МФВМ/000030 от 05.06.2026, ОСВ (16+9=25 шт.) — оставлена как фактический расход; нужно дополнение к ТЗ №116 (решение владельца). Итог системы ${f(ref.add(nineWith4))} ₽ против ${f(ref)} ₽ документа: разница — эти 9 шт.`);
      if (n) p.noteAdd.push(n);
    }

    if (tz === "52") {
      const line = o.materialUsages.find((u) => u.lot.lotNumber === "1498-1" && D(u.quantity).eq(12));
      if (!line) { p.problem = "строка лота 1498-1 × 12 шт. не найдена"; continue; }
      // по документу: 12 × 10 035,82 (без НДС, с 4 %) × 1,2 = цена лота 1498 с НДС и 4 %
      p.explained = D(12).mul(D(10035.82).mul(1.2)).sub(lineWith4(line));
      const alt = lot1498_2 ? `; в базе есть неиспользованный лот «1498-2» (закупка ${lot1498_2.purchase?.number}, ${lot1498_2.quantityReceived} шт × ${f(lot1498_2.unitCost)} ₽, остаток ${lot1498_2.quantityRemaining}) — цена совпадает с документом, возможно 12 шт. должны были списываться с него; перепривязка лота — отдельное решение` : "";
      p.info.push(`лот 1498-1: ${f(line.totalCost)} ₽ за 12 шт. (${f(D(line.totalCost).div(12))} за шт.), в документе 11 579,80 ₽/шт.${alt}`);
      const n = noteWith(o, `Лот 1498: в Приложении №52 цена 11 579,80 ₽/шт. (с НДС, без 4 %), в списании лот «1498-1» 18 366,51 ₽ × 12 шт. Решение владельца 19.10.2026: верна цена из документа. Цена лота не менялась (лот общий с ТЗ 125 и 133); внесена корректировка расхода ${sgn(ref.sub(base))} ₽ до итога документа ${f(ref)} ₽.${lot1498_2 ? ` Справка: в базе есть неиспользованный лот «1498-2» (закупка ${lot1498_2.purchase?.number}, ${lot1498_2.quantityReceived} шт × ${f(lot1498_2.unitCost)} ₽) — перепривязка лота не делалась.` : ""}`);
      if (n) p.noteAdd.push(n);
    }

    if (tz === "79") {
      const skins = o.materialUsages.find((u) => u.lot.lotNumber === "фондю-3" && D(u.quantity).eq(70));
      if (!skins) { p.problem = "строка фондю-3 × 70 шт. не найдена"; continue; }
      let up = D(0);
      for (const u of o.materialUsages) if (u.vatRate == null && D(u.lot.vatRate).eq(20)) up = up.add(lineWith4(u).mul(K22));
      p.explained = D(70).mul(13470 - 13250).add(up);
      p.info.push(`фондю 70 шт. уже списано: лот «фондю-3» (${skins.lot.purchase?.number}, доп. закупка подрядчика партии 7, ${skins.lot.purchase?.isContractorRaw ? "сырьё подрядчика" : ""}), ${f(skins.totalCost)} ₽ без 4 %; в Excel владельца — «фондю 3»`);
      const n = noteWith(o, `Фондю 70 шт.: уже списано с лота «фондю-3» (закупка ${skins.lot.purchase?.number}, доп. закупка сырья партии 7 у подрядчика, не аукцион) по 13 250 ₽ без 4 %; в Excel владельца это «фондю 3» (ответ 19.10.2026) — новой закупки и списания не нужно. В Приложении (версия +4 %, НДС 22 %) цена шкуры 13 470 ₽ вместо 13 250 ₽ (70 × 220 = 15 400 ₽); внесено корректировкой расхода вместе с НДС 22 % по подкладке: ${sgn(ref.sub(base))} ₽ до итога документа ${f(ref)} ₽.`);
      if (n) p.noteAdd.push(n);
    }

    if (tz === "146") {
      let up = D(0);
      for (const u of o.materialUsages) if (u.vatRate == null && D(u.lot.vatRate).eq(20)) up = up.add(lineWith4(u).mul(K22));
      p.explained = up;
      p.info.push(`работа ${f(o.clientWorkPricePerUnit ?? 0)} ₽/шт. НЕ меняется: исправленное Приложение №146 (письмо Василия 15.09.2026 18:35) — 28 163 ₽/шт. (29 500 − 1 337, подкладка 2 м включена в ТЗ); 29 500 — старая версия от 26.08.2026`);
      const n = noteWith(o, `Работа 28 163 ₽/шт. подтверждена исправленным Приложением №146 (письмо Василия 15.09.2026 18:35: 29 500 − 1 337 ₽, подкладка 2 м включена в ТЗ); 29 500 ₽ — старая версия от 26.08.2026. Внесена корректировка НДС 22 % по шкурам лота 160045: ${sgn(ref.sub(base))} ₽ до итога исправленного Приложения ${f(ref)} ₽.`);
      if (n) p.noteAdd.push(n);
    }

    // расход «Корректировка по документу ТЗ»: итог документа − база (с учётом запланированных правок строк)
    const delta = ref.sub(base);
    if (p.explained && delta.sub(p.explained).abs().gt(MAX_EXPLAIN)) {
      p.problem = `корректировка ${sgn(delta)} ₽ расходится с причиной по документу ${sgn(p.explained)} ₽ больше чем на ${MAX_EXPLAIN} ₽ — другая причина, не правлю`;
      continue;
    }
    if (delta.abs().gt(TOL)) {
      const reason: Record<string, string> = {
        "52": `цена лота 1498 по документу 11 579,80 ₽ (с НДС, без 4 %) вместо 18 366,51 ₽ в лоте «1498-1» × 12 шт.`,
        "79": `цена шкуры фондю в документе 13 470 ₽ вместо 13 250 ₽ (70 × 220 = 15 400 ₽) и НДС 22 % по подкладке`,
        "116": `НДС 22 % по документу вместо 20 % в лоте 10026 на 16 шт. (строка 9 шт. вне Приложения оставлена)`,
        "146": `НДС 22 % по документу вместо 20 % в лоте 160045`,
      };
      p.rows.push({ orderId: o.id, cat: CAT_ADJ, amount: delta.toDecimalPlaces(2), desc: `${TAG} ТЗ ${tz}: ${reason[tz] ?? "разница до итога документа"}; итог документа ${f(ref)} ₽ (${cfg.src})` });
    }
    p.after = base.add(p.rows.reduce((s, r) => s.add(r.amount), D(0)));
    if (exclUsage) p.after = p.after.add(o.materialUsages.filter((u) => exclUsage!(u)).reduce((s, u) => s.add(lineWith4(u)), D(0)));
  }

  // ───────── проверка 4 % по всем ТЗ с неаукционным сырьём (только чтение) ─────────
  const all4 = Object.keys(REF4);
  const o4 = await prisma.productionOrder.findMany({ where: { organizationId: org, workOrderNumber: { in: all4 }, status: { not: "CANCELLED" } }, select: orderSelect });
  const nonAuction = (u: Ord["materialUsages"][number]) => {
    const p = u.lot.purchase;
    if (!p) return null;
    if (p.isContractorRaw === true) return "сырьё подрядчика (не аукцион)";
    if (p.auctionId == null) return "закупка у поставщика по УПД (не аукцион)";
    const n = p.auction?.name ?? "";
    if (/^Белая норка/.test(n)) return "закупка у поставщика по УПД (не аукцион)";
    if (/^КФХ/.test(n)) return "закупка у фермы (не аукцион)";
    if (/^Доп\. материалы/.test(n)) return "доп. материалы по спецификации (не аукцион)";
    if (/^Без аукциона/.test(n)) return "без аукциона";
    return null;
  };
  type Row4 = { tz: string; lines: string; kind: string; sys4: string; doc4: string; verdict: string; action: string };
  const rows4: Row4[] = [];
  const planByTz = new Map(plans.map((p) => [p.tz, p]));
  for (const tz of all4.sort((a, b) => Number(a) - Number(b))) {
    const meta = REF4[tz];
    const ords = o4.filter((x) => x.workOrderNumber === tz); // все позиции ТЗ: итог документа — на весь номер ТЗ
    const na = ords.flatMap((o) => o.materialUsages.filter((u) => nonAuction(u)));
    // «после»: учитываем запланированные правки скрипта (флаг 4 % у ТЗ 121, списание ТЗ 158 — его в БД ещё может не быть)
    const pl = planByTz.get(tz);
    const synth = pl?.consume && !pl.consume.done ? pl.consume : null; // строка списания, которой в БД ещё нет
    if (!na.length && !synth) continue;
    const flagged = new Set(pl?.flags.map((x) => x.usageId) ?? []);
    const exclId = new Set<string>(meta.excl ? ords.flatMap((o) => o.materialUsages.filter((u) => u.lot.lotNumber === "10026" && D(u.quantity).eq(9)).map((u) => u.id)) : []);
    const virt = pl?.consume && !pl.consume.done ? pl.consume.total : D(0);
    const c4of = (u: Ord["materialUsages"][number], after: boolean) => (after && flagged.has(u.id) ? false : u.commission4);
    const sysOf = (after: boolean) => {
      let s = D(0);
      for (const o of ords) {
        for (const u of o.materialUsages) if (!exclId.has(u.id)) s = s.add(meta.no4 ? D(u.totalCost) : lineWith4(u, c4of(u, after)));
        for (const e of o.expenses) if (!e.description?.startsWith(TAG)) s = s.add(e.amount);
        s = s.add(work(o));
      }
      return s.add(after ? virt : D(0));
    };
    const firstScriptDone = ords.some((o) => o.expenses.some((e) => e.description?.startsWith("[tz-doc-match:2026-10-19]"))); // НДС 22 % уже внесён первым скриптом — в системе он есть
    const up22 = () => { let up = D(0); if (meta.a22 && !firstScriptDone) for (const o of ords) for (const u of o.materialUsages) if (!exclId.has(u.id) && u.vatRate == null && D(u.lot.vatRate).eq(20)) up = up.add(lineWith4(u).mul(K22)); return up; };
    const evaluate = (after: boolean) => {
      const asis = D(meta.ref).sub(sysOf(after)).sub(up22()).sub(meta.adj ?? 0);
      // что было бы, если бы у неаукционных строк флаг 4 % был противоположным
      let E = D(0);
      for (const u of na) { if (exclId.has(u.id)) continue; const e = D(u.totalCost).mul(RATE4).mul(meta.a22 && D(u.lot.vatRate).eq(20) ? D(1).add(K22) : 1); E = c4of(u, after) ? E.add(e) : E.sub(e); }
      if (after && synth) E = E.sub(synth.total.mul(RATE4)); // строка без 4 %: при флаге «да» система была бы выше на 4 %
      return { asis, alt: asis.add(E) };
    };
    const cur = evaluate(false), aft = evaluate(true);
    const verdictOf = (v: { asis: Decimal; alt: Decimal }) => (v.asis.abs().lte(AUDIT_TOL) && v.alt.abs().gt(AUDIT_TOL) ? "верно: 4 % как в документе" : v.asis.abs().gt(AUDIT_TOL) && v.alt.abs().lte(AUDIT_TOL) ? "РАСХОЖДЕНИЕ с документом" : v.asis.abs().lte(AUDIT_TOL) ? "не различимо" : "другая причина");
    const vCur = meta.no4 ? "документ без 4 % по всему ТЗ" : verdictOf(cur), vAft = verdictOf(aft);
    const kinds = [...new Set([...na.map((u) => nonAuction(u)!), ...(synth ? ["сырьё подрядчика/поставщика по УПД (не аукцион)"] : [])])].join("; ");
    const lines = [...na.map((u) => `${u.lot.lotNumber ?? "(без №)"} ${u.quantity} шт ${rub(u.totalCost)}`), ...(synth ? [`${synth.purchase}: лиса ${synth.qty} шт ${rub(synth.total)} (новое списание)`] : [])].join(", ");
    const yn = (after: boolean) => [...new Set([...na.map((u) => (c4of(u, after) ? "да" : "нет")), ...(after && synth ? ["нет"] : [])])].join("/") || "—";
    const changed = flagged.size > 0 || !!synth;
    const docHas4 = meta.no4 ? "нет (во всём документе)" : tz === "158" ? "нет" : vCur.startsWith("РАСХОЖ") ? (yn(false) === "да" ? "нет" : "да") : yn(false);
    rows4.push({
      tz, lines: lines.length > 80 ? lines.slice(0, 77) + "…" : lines, kind: kinds, sys4: changed ? `${yn(false)} → ${yn(true)}` : yn(false),
      doc4: docHas4,
      verdict: changed ? `${vCur} → ${vAft}` : `${vCur}${meta.note ? ` (${meta.note})` : ""}; Δ ${sgn(cur.asis)} ₽`,
      action: tz === "121" ? "ИСПРАВЛЕНО скриптом: флаг 4 % снят" : tz === "158" ? "ВНЕСЕНО скриптом: списание без 4 %" : /РАСХОЖ|другая/.test(vCur) ? "в список владельцу" : "не меняется",
    });
  }
  // ТЗ 90: итог в документе не заполнен — только справка
  const t90 = await prisma.productionOrder.findMany({ where: { organizationId: org, workOrderNumber: "90", status: { not: "CANCELLED" } }, select: orderSelect });
  for (const o of t90) { const na = o.materialUsages.filter((u) => nonAuction(u)); if (na.length) rows4.push({ tz: "90", lines: na.map((u) => `${u.lot.lotNumber} ${u.quantity} шт ${rub(u.totalCost)}`).join(", "), kind: nonAuction(na[0])!, sys4: na.every((u) => !u.commission4) ? "нет" : "да", doc4: "не определить (итог в документе не заполнен)", verdict: "не проверить (ТЗ 90 не трогаем)", action: "не меняется" }); }

  // ───────── вывод ─────────
  const out: string[] = [`# Сведение ТЗ «второго яруса» с документами — ${APPLY ? "ПРИМЕНЕНИЕ" : "пробный прогон"} (${new Date().toISOString()}), база «${dbName}»`, ""];
  out.push("| ТЗ | что меняется | было → стало | ₽ | основание (документ, письмо, дата) |", "|---|---|---|---:|---|");
  let nChange = 0, nSkip = 0, nSame = 0;
  const lineOut: string[] = [];
  for (const p of plans) {
    const haveSum = p.existing.reduce((s, r) => s.add(r.amount), D(0));
    const wantSum = p.rows.reduce((s, r) => s.add(r.amount), D(0));
    const expDone = p.existing.length === p.rows.length && haveSum.sub(wantSum).abs().lt(0.01) && p.rows.length > 0;
    if (p.problem) { nSkip++; out.push(`| ${p.tz} | ПРОПУСК | — | — | ${p.problem} |`); continue; }
    const acts: string[] = [];
    if (p.tz === "46") {
      out.push(`| 46 | примечание ТЗ${p.noteAdd.length ? "" : " — УЖЕ ЕСТЬ"} (стоимость не меняется) | ${rub(p.cur)} → ${rub(p.cur)} | 0,00 | ${p.src} |`);
      acts.push(p.noteAdd.length ? "примечание" : "уже есть");
    } else {
      for (const fl of p.flags) out.push(`| ${p.tz} | снять 4 % со строки: ${fl.label} | ${rub(p.cur)} → ${rub(p.cur.sub(fl.add4))} | ${sgn(fl.add4.neg())} | ${p.src} |`);
      if (p.consume) out.push(`| ${p.tz} | списание ${p.consume.qty} шт. лота ${p.consume.purchase} (commission4=нет, остаток лота −${p.consume.qty})${p.consume.done ? " — УЖЕ СДЕЛАНО" : ""} | ${rub(p.cur)} → ${rub(p.cur.add(p.consume.done ? 0 : p.consume.total))} | ${p.consume.done ? "0,00" : sgn(p.consume.total)} | ${p.src} |`);
      for (const r of p.rows) out.push(`| ${p.tz} | расход «${r.cat}»${expDone ? " — УЖЕ СДЕЛАНО" : ""} | ${rub(p.docBasis.sub(r.amount))} → ${rub(p.docBasis)} (по строкам документа) | ${sgn(r.amount)} | ${p.src} |`);
      if (!p.flags.length && !p.consume && !p.rows.length) out.push(`| ${p.tz} | без изменений денег (уже в пределах ${TOL} ₽ от документа) | ${rub(p.cur)} | 0,00 | ${p.src} |`);
      if (p.noteAdd.length) out.push(`| ${p.tz} | примечание ТЗ (основание правки) | — | 0,00 | то же |`);
    }
    for (const i of p.info) lineOut.push(`    ТЗ ${p.tz}: ${i}`);
    const money = p.flags.length > 0 || (p.consume && !p.consume.done) || (p.rows.length > 0 && !expDone);
    const notes = p.noteAdd.length > 0;
    if (money || notes) nChange++; else nSame++;
    lineOut.push(`    ТЗ ${p.tz}: итог системы ${rub(p.cur)} → ${rub(p.after)} ₽ (документ ${p.tz === "46" ? rub(REF46_BASE_NO4) + " без 4 %" : rub(p.ref!)}${p.tz === "116" ? "; по строкам документа без 9 шт." : ""})`);
  }
  out.push("", "Построчно:", ...lineOut, "");
  out.push("## Проверка 4 % по ТЗ с неаукционным сырьём (чтение; итоги документов — из аудита 19.10.2026)", "",
    "| ТЗ | строки неаукционного сырья | тип | 4 % в системе | 4 % в документе | вердикт | что сделано |", "|---|---|---|---|---|---|---|");
  for (const r of rows4) out.push(`| ${r.tz} | ${r.lines} | ${r.kind} | ${r.sys4} | ${r.doc4} | ${r.verdict} | ${r.action} |`);
  out.push("", `ИТОГО: ТЗ к изменению ${nChange}, без изменений ${nSame}, пропущено ${nSkip}.`);
  console.log(out.join("\n"));
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply (копия) или --apply --live (боевая)."); await prisma.$disconnect(); return; }

  // ───────── запись ─────────
  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое сведение — повторно не применяю (сначала --rollback --apply)."); await prisma.$disconnect(); return; }
  if (isLive && !NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  const journal: Journal = { script: "apply-tz-tier2-2026-10-19.ts", status: "applied", at: new Date().toISOString(), db: dbName, createdExpenses: [], createdCategoryId: null, flags: [], usages: [], stockMovements: [], lots: [], notes: [], orders: [], batches: [], stock: [], movements: [] };
  await prisma.$transaction(async (tx) => {
    let adj = await tx.expenseCategory.findFirst({ where: { organizationId: org, name: CAT_ADJ, kind: "PRODUCTION" } });
    const changed = new Set<string>();
    for (const p of plans) {
      if (p.problem) continue;
      // 1) флаг 4 %
      for (const fl of p.flags) {
        await tx.productionMaterialUsage.update({ where: { id: fl.usageId }, data: { commission4: false } });
        journal.flags.push({ usageId: fl.usageId, tz: p.tz, before: true, after: false });
        changed.add(fl.orderId);
      }
      // 2) списание лота
      if (p.consume && !p.consume.done) {
        const c = p.consume;
        const lotBefore = (await tx.rawMaterialLot.findUniqueOrThrow({ where: { id: c.lotId } })).quantityRemaining;
        const before = await tx.stockMovement.findMany({ where: { productionOrderId: c.orderId, lotId: c.lotId }, select: { id: true } });
        const r = await consumeFromLot(tx, { organizationId: org, lotId: c.lotId, quantity: c.qty, productionOrderId: c.orderId, notes: `${TAG} ТЗ ${p.tz}: сырьё подрядчика/поставщика, УПД №209 от 16.07.2026` });
        const mv = (await tx.stockMovement.findMany({ where: { productionOrderId: c.orderId, lotId: c.lotId }, select: { id: true } })).filter((m) => !before.some((b) => b.id === m.id));
        for (const m of mv) { await tx.stockMovement.update({ where: { id: m.id }, data: { date: c.date } }); journal.stockMovements.push({ id: m.id }); }
        const us = await tx.productionMaterialUsage.create({ data: { productionOrderId: c.orderId, rawMaterialId: r.rawMaterialId, lotId: c.lotId, quantity: c.qty, unitCost: r.unitCost, totalCost: r.totalCost, commission4: false, date: c.date }, select: { id: true } });
        journal.usages.push({ id: us.id, orderId: c.orderId, tz: p.tz, lotId: c.lotId, quantity: c.qty.toString(), unitCost: r.unitCost.toString(), totalCost: r.totalCost.toString() });
        const lotAfter = await tx.rawMaterialLot.findUniqueOrThrow({ where: { id: c.lotId } });
        if (lotAfter.quantityRemaining.isNegative()) throw new Error("остаток лота ушёл ниже 0 — откат транзакции");
        journal.lots.push({ id: c.lotId, lotNumber: c.lotNumber, remainingBefore: lotBefore.toString(), remainingAfter: lotAfter.quantityRemaining.toString() });
        changed.add(c.orderId);
      }
      // 3) расход «Корректировка по документу ТЗ» (идемпотентно: прежние строки скрипта заменяем)
      const want = p.rows.reduce((s, r) => s.add(r.amount), D(0));
      const have = p.existing.reduce((s, r) => s.add(r.amount), D(0));
      if (!(p.existing.length === p.rows.length && have.sub(want).abs().lt(0.01))) {
        if (p.existing.length) await tx.productionExpense.deleteMany({ where: { id: { in: p.existing.map((e) => e.id) } } });
        for (const r of p.rows) {
          if (!adj) { adj = await tx.expenseCategory.create({ data: { organizationId: org, name: CAT_ADJ, kind: "PRODUCTION" } }); journal.createdCategoryId = adj.id; }
          const o = p.orders.find((x) => x.id === r.orderId)!;
          const ex = await tx.productionExpense.create({ data: { productionOrderId: r.orderId, categoryId: adj.id, amount: r.amount, date: o.workOrderDate ?? o.createdAt, description: r.desc }, select: { id: true } });
          journal.createdExpenses.push({ id: ex.id, orderId: r.orderId, tz: p.tz, amount: r.amount.toFixed(2) });
          changed.add(r.orderId);
        }
        for (const e of p.existing) changed.add(e.orderId);
      }
      // 4) примечание (только примечание — «подтверждено» не снимаем)
      for (const n of p.noteAdd) {
        await tx.productionOrder.update({ where: { id: n.orderId }, data: { notes: n.after } });
        journal.notes.push({ orderId: n.orderId, tz: p.tz, before: n.before, after: n.after });
      }
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
          notes: `${TAG} Сведение с итогом Word-ТЗ (второй ярус). ${contribution.marked ? FG_FULL_COST_NOTE : "Корректировка себестоимости после правки завершённого ТЗ"}`,
        },
        select: { id: true },
      });
      journal.movements.push({ id: mv.id });
    }
  }, { timeout: 300000, maxWait: 15000 });
  writeJson(JOURNAL, journal);
  console.log(`\nПрименено на «${dbName}»: расходов ${journal.createdExpenses.length}, флагов 4 % ${journal.flags.length}, списаний ${journal.usages.length}, примечаний ${journal.notes.length}, пересчитано ТЗ ${journal.orders.length}. Журнал: ${JOURNAL}`);

  // ───────── контроль после записи ─────────
  const after = await prisma.productionOrder.findMany({ where: { organizationId: org, workOrderNumber: { in: tzs }, status: { not: "CANCELLED" } }, select: orderSelect });
  let bad = 0;
  for (const p of plans) {
    if (p.problem || p.tz === "46") continue;
    const o = after.find((x) => x.workOrderNumber === p.tz);
    if (!o) continue;
    const excl = p.tz === "116" ? (u: Ord["materialUsages"][number]) => D(u.quantity).eq(9) && u.lot.lotNumber === "10026" : undefined;
    const s = sumOrder(o as Ord, { exclUsage: excl });
    const d = s.sub(p.ref!);
    const okMark = d.abs().lte(TOL);
    if (!okMark) bad++;
    console.log(`  ${okMark ? "✓" : "✗"} ТЗ ${p.tz}: система${p.tz === "116" ? " (по строкам документа, без 9 шт.)" : ""} ${rub(s)} ₽, документ ${rub(p.ref!)} ₽, Δ ${sgn(d)}`);
  }
  console.log(bad ? `После записи расхождений > ${TOL} ₽: ${bad}` : `После записи: у всех проверенных ТЗ сумма в системе = сумме документа (допуск ${TOL} ₽); ТЗ 46 не менялось (объяснено).`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
