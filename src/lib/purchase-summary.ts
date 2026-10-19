import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { canonicalFur } from "@/lib/fur-ref";
import { getFurIndex } from "@/lib/fur-ref-server";

import { expenseInclVat, lotUnitCostExclVat, purchaseTotalExclVat, purchaseTotalInclVat } from "@/lib/purchase-totals";
import { auctionName, loadAuctionSummaries } from "@/lib/auction-payments";

/**
 * Сводка закупок: Год (по orderDate закупки) → Аукцион → Тип сырья (RawMaterial) → лоты.
 * Лист — одна позиция закупки (PurchaseItem). Не отменённые закупки.
 *
 * Деньги:
 *  • позиция общего лота (подкладка: один лот на несколько закупок) считается по самой позиции:
 *    расчётный лист → цена позиции × курс × (1+НДС) + доля расходов закупки, а не по lot.totalCost,
 *    иначе стоимость лота задвоилась бы;
 *  • год закупки считается в часовом поясе Europe/Moscow;
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
  /** Признаки меха лота позиции (справочник /settings/fur-attrs); у позиции без лота — пусто. */
  attrs: string[];
  /** Закупка не принята (черновик/заказана): мех на складе ещё не стоит, стоимость — расчётная. */
  draft: boolean;
};

/** Год даты в часовом поясе Europe/Moscow (сервер может жить в UTC: 31 декабря 22:00 UTC уже новый год). */
export function moscowYear(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric" }).format(d));
}

export type SummaryData = {
  leaves: Leaf[];
  /** Независимый путь: итог закупки по purchaseTotalInclVat / purchaseTotalExclVat (как дашборд и /payments). */
  purchaseTotals: Map<string, { incl: Decimal; excl: Decimal }>;
};

export type UnlinkedAdvance = { id: string; amount: Decimal; paidAt: Date; supplier: string; docRef: string | null };

/** Оплаты поставщикам без привязки к закупке и аукциону (COMPLETED): не входят в «Оплачено» сводки. */
export async function loadUnlinkedAdvances(organizationId: string): Promise<UnlinkedAdvance[]> {
  const rows = await prisma.payment.findMany({
    where: { organizationId, purchaseId: null, auctionSession: null, status: "COMPLETED" },
    include: { supplier: { select: { name: true } } },
    orderBy: { paidAt: "asc" },
  });
  return rows.map((r) => ({ id: r.id, amount: r.amount, paidAt: r.paidAt, supplier: r.supplier.name, docRef: r.docRef }));
}

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

export async function loadSummary(organizationId: string): Promise<SummaryData> {
  const [purchases, summaries] = await Promise.all([
    prisma.purchase.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      include: {
        expenses: true,
        // Оплаты самой закупки (для закупок вне аукциона — единственный источник «Оплачено»).
        payments: { where: { status: "COMPLETED" }, select: { amount: true } },
        items: {
          include: {
            rawMaterial: { select: { name: true, unit: true } },
            lot: { include: { _count: { select: { purchaseItems: true } }, attrs: { select: { attr: { select: { name: true } } } } } },
          },
          orderBy: { id: "asc" },
        },
      },
      orderBy: [{ orderDate: "asc" }, { number: "asc" }],
    }),
    loadAuctionSummaries(prisma, organizationId),
  ]);
  const furIdx = await getFurIndex(organizationId);
  const byName = new Map(summaries.map((s) => [s.name, s]));
  const leaves: Leaf[] = [];
  const purchaseTotals = new Map<string, { incl: Decimal; excl: Decimal }>();

  for (const p of purchases) {
    const auction = auctionName(p.auctionSession) ?? NO_AUCTION;
    const year = moscowYear(p.orderDate);
    purchaseTotals.set(p.id, { incl: purchaseTotalInclVat(p), excl: purchaseTotalExclVat(p) });
    const lines = p.items.map((i) => {
      const base = i.subtotal.mul(p.exchangeRate);
      const priceIncl = grossUp(base, i.vatRate);
      let fullIncl: Decimal;
      let fullExcl: Decimal;
      const c = i.costPlan as Record<string, unknown> | null;
      // Общий лот (несколько позиций): lot.totalCost принадлежит всем позициям сразу — берём по самой позиции.
      const own = Boolean(i.lot) && i.lot!._count.purchaseItems <= 1;
      if (i.lot && own) {
        fullIncl = i.lot.totalCost;
        fullExcl = lotUnitCostExclVat(i.lot).mul(i.quantity);
      } else if (c && c.unitCostInclVat != null && c.materialExclVat != null && c.expenseExclVat != null) {
        fullIncl = new Decimal(String(c.unitCostInclVat)).mul(i.quantity);
        fullExcl = new Decimal(String(c.materialExclVat)).add(new Decimal(String(c.expenseExclVat))).mul(i.quantity);
      } else {
        fullIncl = priceIncl;
        fullExcl = base;
      }
      return { i, base, priceIncl, fullIncl, fullExcl, own };
    });
    // Расходы закупки у принятой уже внутри собственных лотов; у черновика и у позиций общих лотов
    // раскладываем по позициям пропорционально цене.
    if (p.expenses.length > 0 && lines.length > 0) {
      const expIncl = p.expenses.reduce((s, e) => s.add(expenseInclVat(e)), zero());
      const expExcl = p.expenses.reduce((s, e) => s.add(e.amount), zero());
      const sumBase = lines.reduce((s, l) => s.add(l.base), zero());
      for (const l of lines) {
        if (p.status === "RECEIVED" && l.own) continue;
        const share = sumBase.isZero() ? new Decimal(1).div(lines.length) : l.base.div(sumBase);
        l.fullIncl = l.fullIncl.add(expIncl.mul(share));
        l.fullExcl = l.fullExcl.add(expExcl.mul(share));
      }
    }
    const purchaseFull = lines.reduce((s, l) => s.add(l.fullIncl), zero());

    // Оплачено по этой закупке: её собственные оплаты + доля оплат аукциона целиком.
    const a = byName.get(auction);
    const pp = a?.perPurchase.find((x) => x.id === p.id);
    // Закупка вне аукциона в byName не попадает (buildAuctionSummaries пропускает записи без аукциона): её оплаты — p.payments.
    let paid = pp?.paid ?? (a ? zero() : p.payments.reduce((s, x) => s.add(x.amount), zero()));
    if (a && a.paidByAuction.greaterThan(0) && a.total.greaterThan(0) && pp) {
      paid = paid.add(a.paidByAuction.mul(pp.total).div(a.total));
    }

    // «С расходами» не меньше «Цены шкур по счетам»: у принятого лота стоимость хранится округлённой до копеек,
    // а цена по счёту — нет; различие в пределах 1 ₽ — это округление, выравниваем на цену.
    for (const l of lines) {
      if (l.fullIncl.lessThan(l.priceIncl) && l.priceIncl.sub(l.fullIncl).lessThanOrEqualTo(1)) l.fullIncl = l.priceIncl;
      if (l.fullExcl.lessThan(l.base) && l.base.sub(l.fullExcl).lessThanOrEqualTo(1)) l.fullExcl = l.base;
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
        // «Лиса красная» — вид «Лиса» (цвет — отдельное поле); подкладка и неизвестное — как в справочнике материалов.
        material: l.i.rawMaterial.unit === "M" ? l.i.rawMaterial.name : canonicalFur(l.i.rawMaterial.name, furIdx)?.name ?? l.i.rawMaterial.name,
        unit: l.i.rawMaterial.unit,
        qty: l.i.quantity,
        price: { incl: l.priceIncl, excl: l.base },
        full: { incl: l.fullIncl, excl: l.fullExcl },
        paidIncl: paid.mul(share),
        attrs: l.i.rawMaterial.unit === "M" ? [] : (l.i.lot?.attrs ?? []).map((a) => a.attr.name),
        draft: p.status !== "RECEIVED",
      });
    }
  }
  return { leaves, purchaseTotals };
}
