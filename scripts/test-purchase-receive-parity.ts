/**
 * Регрессия «Принять на склад» после выноса логики в src/lib/purchase-receive.ts: на КОПИИ БД (в адресе должно быть «edit_test»)
 * для принятых закупок без списаний и без подкладки (учёт в метрах) приёмка выполняется ДВАЖДЫ — по прежнему коду
 * (commit c9e0f1b, receivePurchase целиком вшит ниже) и по новому receivePurchaseInTx; обе транзакции откатываются.
 * Сравниваются лоты по позициям (количество, цена, итог, НДС, части стоимости, раскладка), движения склада и статус.
 *
 *   EDIT_TEST_URL=postgresql://…/fur_erp_edit_test node --env-file=.env node_modules/.bin/tsx scripts/test-purchase-receive-parity.ts
 */
import Module from "module";
import { join } from "path";

const url = process.env.EDIT_TEST_URL ?? "";
if (!url.includes("edit_test")) {
  console.error("Отказ: адрес базы без «edit_test» — скрипт работает только на копии");
  process.exit(2);
}
process.env.DATABASE_URL = url;
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

import { Decimal } from "@prisma/client/runtime/library";
import { Prisma, PrismaClient } from "@prisma/client";

class Rollback extends Error {}

function parseCostPlan(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const d = (k: string) => (r[k] != null ? new Decimal(String(r[k])) : null);
  const unitCostInclVat = d("unitCostInclVat");
  const materialExclVat = d("materialExclVat");
  const materialVat = d("materialVat");
  const expenseExclVat = d("expenseExclVat");
  const expenseVat = d("expenseVat");
  if (!unitCostInclVat || !materialExclVat || !materialVat || !expenseExclVat || !expenseVat) return null;
  return {
    unitCostInclVat,
    materialExclVat,
    materialVat,
    expenseExclVat,
    expenseVat,
    costBreakdown: r["costBreakdown"] as import("@prisma/client").Prisma.InputJsonValue,
  };
}

async function main() {
  const { createRawMaterialLot, addOrPoolLiningLot } = await import("../src/lib/stock");
  const { lockPurchase, receivePurchaseInTx, AlreadyReceivedError } = await import("../src/lib/purchase-receive");
  const raw = new PrismaClient({ datasources: { db: { url } } });

  /** Прежняя реализация (до выноса): тело транзакции receivePurchase из c9e0f1b без изменений. */
  async function receiveOld(tx: Prisma.TransactionClient, purchaseId: string, orgId: string) {
      const grossUp = (base: Decimal, vatRate: Decimal) => base.add(base.mul(vatRate).div(100));
        // Блокируем строку закупки: правки расчёта (updateCostPlanItem/Rate) берут ту же
        // блокировку, поэтому приёмка и правки идут строго по очереди. Статус — под замком.
        const locked = await lockPurchase(tx, purchaseId, orgId);
        if (!locked || locked.status === "RECEIVED" || locked.status === "CANCELLED") throw new AlreadyReceivedError();

        // Атомарный переход статуса: если параллельная приёмка уже выиграла,
        // count = 0 и лоты не создаются (иначе склад задвоился бы).
        const claimed = await tx.purchase.updateMany({
          where: { id: purchaseId, organizationId: orgId, status: { notIn: ["RECEIVED", "CANCELLED"] } },
          data: { status: "RECEIVED", receivedDate: new Date() },
        });
        if (claimed.count === 0) throw new AlreadyReceivedError();

        // Позиции и расходы читаем уже после захвата — правки, закоммиченные
        // до этого момента, попадают в приёмку.
        const purchase = await tx.purchase.findFirst({
          where: { id: purchaseId, organizationId: orgId },
          include: { items: { include: { rawMaterial: true } }, expenses: true },
        });
        if (!purchase) throw new Error("Закупка не найдена");
        if (purchase.items.length === 0) throw new Error("В закупке нет позиций");

        const totalExpensesExclVat = purchase.expenses.reduce((sum, e) => sum.add(e.amount), new Decimal(0));
        const totalExpensesInclVat = purchase.expenses.reduce(
          (sum, e) => sum.add(grossUp(e.amount, e.vatRate)),
          new Decimal(0)
        );
        // VAT amount of the total expense pool — used below to split each lot's
        // allocated share the same way materialCostExclVat/materialVatAmount
        // already split the item's own price. See RawMaterialLot.expenseCostExclVat
        // for why applying the item's allocation ratio to this split is exact.
        const totalExpensesVatAmount = totalExpensesInclVat.sub(totalExpensesExclVat);

        // Полная стоимость позиции (с НДС, ₽) — база для распределения расходов.
        // Для позиции с расчётом из расчётного листа (costPlan) это стоимость
        // единицы из расчёта × количество, для обычной — цена × курс + НДС.
        const rows = purchase.items.map((item) => {
          const plan = parseCostPlan(item.costPlan);
          const baseRub = item.subtotal.mul(purchase.exchangeRate);
          const inclVatRub = grossUp(baseRub, item.vatRate);
          const fullInclVatRub = plan ? plan.unitCostInclVat.mul(item.quantity) : inclVatRub;
          return { item, plan, baseRub, inclVatRub, fullInclVatRub };
        });
        const totalFullInclVatRub = rows.reduce((sum, r) => sum.add(r.fullInclVatRub), new Decimal(0));

        for (const { item, plan, baseRub, inclVatRub, fullInclVatRub } of rows) {
          // Same ratio drives both the inclusive allocation and its excl-VAT /
          // VAT-amount split — exact, since the ratio is applied uniformly to
          // the whole expense pool (excl + vat = incl by construction).
          const allocationRatio = totalFullInclVatRub.isZero() ? new Decimal(0) : fullInclVatRub.div(totalFullInclVatRub);
          const allocatedExpense = totalExpensesInclVat.mul(allocationRatio);
          const allocatedExpenseExclVat = totalExpensesExclVat.mul(allocationRatio);
          const allocatedExpenseVatAmount = totalExpensesVatAmount.mul(allocationRatio);
          const qty = item.quantity;

          // Позиция с расчётом (costPlan): стоимость единицы из расчёта
          // (выделка/транспорт — на штуку, а не от цены) + доля расходов закупки.
          let costBreakdown: Prisma.InputJsonValue | undefined;
          if (plan) {
            costBreakdown = plan.costBreakdown;
            if (allocatedExpense.gt(0)) {
              const bd = (plan.costBreakdown ?? {}) as { items?: { label: string; value: number }[] };
              costBreakdown = {
                ...(bd as object),
                items: [
                  ...(Array.isArray(bd.items) ? bd.items : []),
                  { label: "Расходы закупки (доля), ₽", value: Number(allocatedExpense.div(qty).toDecimalPlaces(2).toString()) },
                ],
              } as Prisma.InputJsonValue;
            }
          }

          const lotArgs = {
            organizationId: orgId,
            warehouseId: purchase.warehouseId,
            rawMaterialId: item.rawMaterialId,
            lotNumber: item.lotNumber,
            grade: item.grade,
            color: item.color,
            colorRefId: item.colorRefId,
            quantity: qty,
            unitCost: plan ? plan.unitCostInclVat.add(allocatedExpense.div(qty)) : inclVatRub.add(allocatedExpense).div(qty),
            totalCost: plan ? plan.unitCostInclVat.mul(qty).add(allocatedExpense) : inclVatRub.add(allocatedExpense),
            vatRate: item.vatRate,
            materialCostExclVat: plan ? plan.materialExclVat : baseRub.div(qty),
            materialVatAmount: plan ? plan.materialVat : inclVatRub.sub(baseRub).div(qty),
            expenseCostExclVat: plan
              ? plan.expenseExclVat.add(allocatedExpenseExclVat.div(qty))
              : allocatedExpenseExclVat.div(qty),
            expenseVatAmount: plan
              ? plan.expenseVat.add(allocatedExpenseVatAmount.div(qty))
              : allocatedExpenseVatAmount.div(qty),
            purchaseId: purchase.id,
            purchaseItemId: item.id,
            ...(costBreakdown !== undefined ? { costBreakdown } : {}),
          };

          // Lining fabric (tracked by the metre) is one aggregate pool per
          // fabric, not one lot per receipt — see cfc5cd6 and
          // addOrPoolLiningLot's own comment. Fur (and every other unit) keeps
          // the original specific-identification behavior: a fresh lot every
          // time.
          if (item.rawMaterial.unit === "M") {
            await addOrPoolLiningLot(tx, lotArgs);
          } else {
            await createRawMaterialLot(tx, lotArgs);
          }
        }

  }

  const snap = async (tx: Prisma.TransactionClient, purchaseId: string) => {
    const p = await tx.purchase.findUniqueOrThrow({ where: { id: purchaseId }, select: { status: true } });
    const lots = await tx.rawMaterialLot.findMany({ where: { purchaseId }, });
    const moves = await tx.stockMovement.findMany({ where: { purchaseId } });
    const f = (d: Prisma.Decimal | null) => (d == null ? null : new Decimal(d.toString()).toFixed(6));
    return JSON.stringify({
      status: p.status,
      lots: lots.map((l) => [l.lotNumber, l.grade, l.color, l.colorRefId, f(l.quantityReceived), f(l.quantityRemaining), f(l.unitCost), f(l.totalCost), f(l.vatRate), f(l.materialCostExclVat), f(l.materialVatAmount), f(l.expenseCostExclVat), f(l.expenseVatAmount), l.costBreakdown ?? null].map((x) => JSON.stringify(x))).sort(),
      moves: moves.map((m) => JSON.stringify([m.type, f(m.quantity), m.lotId ? "lot" : null])).sort(),
    });
  };

  const cands = await raw.purchase.findMany({
    where: { status: "RECEIVED", rawMaterialLots: { some: {} }, items: { some: {} } },
    include: { items: { include: { rawMaterial: true } }, rawMaterialLots: { include: { _count: { select: { usages: true } } } }, expenses: true },
    orderBy: { number: "asc" },
  });
  let variants = 0, sameVariants = 0, checked = 0, same = 0, sameStored = 0, skipped = 0, bad = 0, withExp = 0, withPlan = 0;
  for (const p of cands) {
    const usable = !p.items.some((i) => i.rawMaterial.unit === "M") && p.rawMaterialLots.every((l) => l._count.usages === 0 && l.quantityRemaining.equals(l.quantityReceived));
    if (!usable) { skipped++; continue; }
    const stored = await snap(raw, p.id);
    const cat = await raw.expenseCategory.findFirstOrThrow({ where: { organizationId: p.organizationId } });
    type Variant = "plain" | "expenses" | "expenses+costPlan";
    const run = async (kind: "old" | "new", variant: Variant) => {
      let out = "";
      try {
        await raw.$transaction(async (tx) => {
          await tx.stockMovement.deleteMany({ where: { purchaseId: p.id } });
          await tx.rawMaterialLot.deleteMany({ where: { purchaseId: p.id } });
          await tx.purchase.update({ where: { id: p.id }, data: { status: "DRAFT", receivedDate: null } });
          if (variant !== "plain") {
            // Синтетика для покрытия веток: расходы закупки (20% и 0% НДС) и расчёт costPlan у первой позиции.
            await tx.purchaseExpense.createMany({ data: [
              { purchaseId: p.id, categoryId: cat.id, amount: "12345.67", vatRate: "20" },
              { purchaseId: p.id, categoryId: cat.id, amount: "999.01", vatRate: "0" },
            ] });
          }
          if (variant === "expenses+costPlan") {
            const it = p.items[0];
            await tx.purchaseItem.update({ where: { id: it.id }, data: { costPlan: { unitCostInclVat: "1234.5678", materialExclVat: "900.1234", materialVat: "180.0247", expenseExclVat: "100.5", expenseVat: "20.1", costBreakdown: { items: [{ label: "Выделка, ₽", value: 100.5 }] } } } });
          }
          if (kind === "old") await receiveOld(tx, p.id, p.organizationId);
          else await receivePurchaseInTx(tx, p.id, p.organizationId);
          out = await snap(tx, p.id);
          throw new Rollback();
        }, { timeout: 60_000 });
      } catch (e) {
        if (!(e instanceof Rollback)) throw e;
      }
      return out;
    };
    checked++;
    let ok = true;
    for (const v of ["plain", "expenses", "expenses+costPlan"] as const) {
      const a = await run("old", v);
      const b = await run("new", v);
      variants++;
      if (a === b) sameVariants++;
      else { ok = false; console.log("РАЗЛИЧИЕ", p.number, v); }
      if (v === "plain" && a === stored) sameStored++;
    }
    if (ok) same++; else bad++;
  }
  await raw.$disconnect();
  console.log(`Проверено закупок: ${checked} × 3 варианта: без расходов, с расходами, с расходами и costPlan; пропущено (подкладка/списания): ${skipped}`);
  console.log(`Старый код = новый код: ${same} из ${checked} закупок (${sameVariants} из ${variants} прогонов); расхождений: ${bad}. Для справки пересчёт = хранимые лоты: ${sameStored}.`);
  if (checked === 0 || bad > 0) { console.log("ПРОВАЛ"); process.exit(1); }
  console.log("Итоги лотов до/после выноса идентичны");
}
main().catch((e) => { console.error(e); process.exit(1); });
