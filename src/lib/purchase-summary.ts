import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";

import { lotUnitCostExclVat } from "@/lib/purchase-totals";
import { auctionName, loadAuctionSummaries } from "@/lib/auction-payments";

/**
 * Сводка закупок: Год (по orderDate закупки) → Аукцион → Тип сырья (RawMaterial) → лоты.
 * Лист — одна позиция закупки (PurchaseItem). Не отменённые закупки.
 *
 * Деньги:
 *  • «закупка по цене лотов» — цена лота × курс (+НДС ставки лота);
 *  • «полная стоимость» — как в режиме «Аукцион»: лот на складе — его стоимость; иначе расчёт из
 *    расчётного листа; иначе цена лота. У черновиков расходы закупки раскладываются по лотам
 *    пропорционально цене;
 *  • «оплачено» — оплаты поставщику (COMPLETED). Они ведутся на уровне закупки/аукциона, не лота, поэтому
 *    на уровне лота и типа сырья это распределение пропорционально полной стоимости (на уровне аукциона —
 *    точное значение). Оплата аукциона целиком делится между его закупками по их итогу;
 *  • в режиме «Без НДС» оплачено пересчитывается долей (без НДС / с НДС) полной стоимости.
 */

const zero = () => new Decimal(0);
const grossUp = (base: Decimal, vat: Decimal) => base.add(base.mul(vat).div(100));

export const NO_AUCTION = "Без аукциона";

export type Money2 = { incl: Decimal; excl: Decimal };

export type Leaf = {
  id: string;
  purchaseId: string;
  purchaseNumber: string;
  invoice: string | null;
  lotNumber: string | null;
  year: number;
  auction: string;
  material: string;
  unit: string;
  qty: Decimal;
  price: Money2;
  full: Money2;
  /** Оплачено с НДС (распределено). */
  paidIncl: Decimal;
};

export type Agg = {
  qty: Decimal;
  lots: number;
  price: Money2;
  full: Money2;
  paidIncl: Decimal;
  /** Оплачено в «без НДС»: Σ paidIncl × fullExcl / fullIncl по листьям. */
  paidExcl: Decimal;
};

export const emptyAgg = (): Agg => ({
  qty: zero(),
  lots: 0,
  price: { incl: zero(), excl: zero() },
  full: { incl: zero(), excl: zero() },
  paidIncl: zero(),
  paidExcl: zero(),
});

export function addLeaf(a: Agg, l: Leaf): void {
  a.qty = a.qty.add(l.qty);
  a.lots += 1;
  a.price.incl = a.price.incl.add(l.price.incl);
  a.price.excl = a.price.excl.add(l.price.excl);
  a.full.incl = a.full.incl.add(l.full.incl);
  a.full.excl = a.full.excl.add(l.full.excl);
  a.paidIncl = a.paidIncl.add(l.paidIncl);
  a.paidExcl = a.paidExcl.add(l.full.incl.isZero() ? zero() : l.paidIncl.mul(l.full.excl).div(l.full.incl));
}

export function aggOf(leaves: Leaf[]): Agg {
  const a = emptyAgg();
  for (const l of leaves) addLeaf(a, l);
  return a;
}

export async function loadSummaryLeaves(organizationId: string): Promise<Leaf[]> {
  const [purchases, summaries] = await Promise.all([
    prisma.purchase.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      include: {
        expenses: true,
        items: { include: { rawMaterial: { select: { name: true, unit: true } }, lot: true }, orderBy: { id: "asc" } },
      },
      orderBy: [{ orderDate: "asc" }, { number: "asc" }],
    }),
    loadAuctionSummaries(prisma, organizationId),
  ]);
  const byName = new Map(summaries.map((s) => [s.name, s]));
  const leaves: Leaf[] = [];

  for (const p of purchases) {
    const auction = auctionName(p.auctionSession) ?? NO_AUCTION;
    const year = p.orderDate.getFullYear();
    const lines = p.items.map((i) => {
      const base = i.subtotal.mul(p.exchangeRate);
      const priceIncl = grossUp(base, i.vatRate);
      let fullIncl: Decimal;
      let fullExcl: Decimal;
      const c = i.costPlan as Record<string, unknown> | null;
      if (i.lot) {
        fullIncl = i.lot.totalCost;
        fullExcl = lotUnitCostExclVat(i.lot).mul(i.quantity);
      } else if (c && c.unitCostInclVat != null && c.materialExclVat != null && c.expenseExclVat != null) {
        fullIncl = new Decimal(String(c.unitCostInclVat)).mul(i.quantity);
        fullExcl = new Decimal(String(c.materialExclVat)).add(new Decimal(String(c.expenseExclVat))).mul(i.quantity);
      } else {
        fullIncl = priceIncl;
        fullExcl = base;
      }
      return { i, base, priceIncl, fullIncl, fullExcl };
    });
    // Расходы закупки у принятой уже внутри лотов; у черновика раскладываем по лотам пропорционально цене.
    if (p.status !== "RECEIVED" && p.expenses.length > 0 && lines.length > 0) {
      const expIncl = p.expenses.reduce((s, e) => s.add(grossUp(e.amount, e.vatRate)), zero());
      const expExcl = p.expenses.reduce((s, e) => s.add(e.amount), zero());
      const sumBase = lines.reduce((s, l) => s.add(l.base), zero());
      for (const l of lines) {
        const share = sumBase.isZero() ? new Decimal(1).div(lines.length) : l.base.div(sumBase);
        l.fullIncl = l.fullIncl.add(expIncl.mul(share));
        l.fullExcl = l.fullExcl.add(expExcl.mul(share));
      }
    }
    const purchaseFull = lines.reduce((s, l) => s.add(l.fullIncl), zero());

    // Оплачено по этой закупке: её собственные оплаты + доля оплат аукциона целиком.
    const a = byName.get(auction);
    const pp = a?.perPurchase.find((x) => x.id === p.id);
    let paid = pp?.paid ?? zero();
    if (a && a.paidByAuction.greaterThan(0) && a.total.greaterThan(0) && pp) {
      paid = paid.add(a.paidByAuction.mul(pp.total).div(a.total));
    }

    for (const l of lines) {
      const share = purchaseFull.isZero() ? zero() : l.fullIncl.div(purchaseFull);
      leaves.push({
        id: l.i.id,
        purchaseId: p.id,
        purchaseNumber: p.number,
        invoice: p.invoiceNumber,
        lotNumber: l.i.lotNumber ?? l.i.lot?.lotNumber ?? null,
        year,
        auction,
        material: l.i.rawMaterial.name,
        unit: l.i.rawMaterial.unit,
        qty: l.i.quantity,
        price: { incl: l.priceIncl, excl: l.base },
        full: { incl: l.fullIncl, excl: l.fullExcl },
        paidIncl: paid.mul(share),
      });
    }
  }
  return leaves;
}
