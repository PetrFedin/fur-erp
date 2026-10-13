// Себестоимость готовой продукции на складе (FinishedGoodsStock / FinishedGoodsMovement) — по ПОЛНОЙ стоимости:
// сырьё и подкладка со списаний (с НДС) + 4% (только у строк с commission4) + расходы ТЗ + работа (цена работы × выпуск).
// Решение владельца: «ценообразование от полной стоимости с 4 %».
//
// Это ТОЛЬКО оценка остатков склада ГП. Снимок самого ТЗ (ProductionOrder.materialCost / expenseCost / totalCost / unitCost) остаётся прежним
// (сырьё + расходы, без 4% и без работы): от него считаются «Произведено» и «На 1 изделие» на Главной, в партиях и в «Изделиях».
// Шкуры подрядчика (оплачены в составе счетов за пошив и в ТЗ не списаны) в оценку склада не входят: у них нет строк в ТЗ.
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { COMMISSION_RATE } from "./commission4-const";

/** Пометка в движении склада ГП: с этого момента стоимость ТЗ на складе ведётся по полной себестоимости. */
export const FG_FULL_COST_NOTE = "Себестоимость ГП: с работой и 4%";

type FullCostOrder = {
  materialUsages: { totalCost: Decimal.Value; commission4: boolean }[];
  expenses: { amount: Decimal.Value }[];
  clientWorkPricePerUnit: Decimal.Value | null;
};

export type FullCost = { material: Decimal; extra4: Decimal; expenses: Decimal; work: Decimal; total: Decimal };

/** Полная себестоимость ТЗ для склада ГП при выпуске `qty` шт. (рубли с НДС, округление до копеек). */
export function fullFinishedCost(o: FullCostOrder, qty: Decimal.Value): FullCost {
  const rate = new Decimal(COMMISSION_RATE);
  let material = new Decimal(0);
  let base4 = new Decimal(0);
  for (const u of o.materialUsages) {
    const t = new Decimal(u.totalCost);
    material = material.add(t);
    if (u.commission4) base4 = base4.add(t);
  }
  const extra4 = base4.mul(rate);
  const expenses = o.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const work = o.clientWorkPricePerUnit == null ? new Decimal(0) : new Decimal(o.clientWorkPricePerUnit).mul(qty);
  const total = material.add(extra4).add(expenses).add(work).toDecimalPlaces(2);
  return { material, extra4, expenses, work, total };
}

const IN_TYPES = new Set(["PRODUCTION_IN", "ADJUSTMENT_IN", "TRANSFER_IN"]);

/**
 * Сколько ТЗ «вложило» в остаток склада ГП: сумма движений по этому ТЗ (приход плюс, списание-корректировка минус).
 * marked — стоимость ТЗ уже ведётся по полной себестоимости (есть движение с пометкой FG_FULL_COST_NOTE).
 * count = 0 — движений по ТЗ нет (ТЗ завершено импортом): тогда базой считается снимок ТЗ (totalCost).
 */
export async function orderStockContribution(tx: Prisma.TransactionClient, orderId: string): Promise<{ net: Decimal; count: number; marked: boolean }> {
  const rows = await tx.finishedGoodsMovement.findMany({ where: { productionOrderId: orderId }, select: { type: true, totalCost: true, notes: true } });
  let net = new Decimal(0);
  let marked = false;
  for (const r of rows) {
    if (r.notes?.includes(FG_FULL_COST_NOTE)) marked = true;
    if (IN_TYPES.has(r.type)) net = net.add(r.totalCost);
    else if (r.type === "ADJUSTMENT_OUT") net = net.sub(r.totalCost);
  }
  return { net, count: rows.length, marked };
}
