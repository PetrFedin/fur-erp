import { orderLabel } from "@/lib/order-label";
import type { Decimal } from "@prisma/client/runtime/library";
import { deriveCostPlanInputs } from "@/lib/cost-plan";
import { lineParts } from "@/lib/auction-cost-parts";
import { readExtra } from "@/lib/custom-fields";
import type { LotRow, PurchaseMeta } from "@/lib/lot-table";

const n = (d: Decimal | { toString(): string }) => Number(d.toString());

type Line = {
  i: {
    id: string;
    quantity: Decimal;
    unitPrice: Decimal;
    vatRate: Decimal;
    lotNumber: string | null;
    grade: string | null;
    color: string | null;
    notes: string | null;
    costPlan: unknown;
    extra: unknown;
    rawMaterialId: string;
    rawMaterial: { name: string; unit: string };
    lot: { id?: string; attrs?: { attr: { name: string } }[]; quantityRemaining: Decimal; usages: { id: string; productionOrderId: string; quantity: Decimal; productionOrder: { number: string; workOrderNumber?: string | null } }[] } | null;
  };
  unitIncl: Decimal;
  unitExcl: Decimal;
  totalIncl: Decimal;
  totalExcl: Decimal;
  lotPriceIncl: Decimal;
  base: Decimal;
  breakdown: unknown;
  source: "lot" | "plan" | "price";
};

type Block = {
  p: {
    id: string;
    number: string;
    invoiceNumber: string | null;
    invoiceDate?: Date | null;
    status: string;
    currency: string;
    exchangeRate: Decimal;
    expenses: { amount: Decimal; vatRate: Decimal; category: { name: string } }[];
  };
  counted: boolean;
  lines: Line[];
  expIncl: Decimal;
  expExcl: Decimal;
  unallocated: boolean;
};

/** Плоские числа для клиентских таблиц: строки лотов и сводка по закупкам. */
export function buildAuctionRows(
  blocks: Block[],
  unitLabels: Record<string, string>,
  canEdit: boolean,
): { rows: LotRow[]; purchases: PurchaseMeta[] } {
  const rows: LotRow[] = [];
  const purchases: PurchaseMeta[] = [];
  for (const b of blocks) {
    const { p } = b;
    const cats = new Map<string, { incl: number; excl: number }>();
    for (const e of p.expenses) {
      const c = cats.get(e.category.name) ?? { incl: 0, excl: 0 };
      c.excl += n(e.amount);
      c.incl += n(e.amount) + (n(e.amount) * n(e.vatRate)) / 100;
      cats.set(e.category.name, c);
    }
    const editable = canEdit && p.status !== "RECEIVED" && p.status !== "CANCELLED";
    purchases.push({
      id: p.id,
      label: p.invoiceNumber ? `Счёт ${p.invoiceNumber}` : p.number,
      number: p.number,
      counted: b.counted,
      unallocated: b.unallocated,
      received: p.status === "RECEIVED",
      cancelled: p.status === "CANCELLED",
      currency: p.currency,
      expIncl: n(b.expIncl),
      expExcl: n(b.expExcl),
      expenses: Array.from(cats, ([name, v]) => ({ name, ...v })),
      lineCount: b.lines.length,
    });
    for (const l of b.lines) {
      const i = l.i;
      const qty = n(i.quantity);
      const bd = (l.breakdown ?? {}) as { items?: unknown };
      const { parts, expIncl } = lineParts({
        items: bd.items,
        qty,
        base: n(l.base),
        priceIncl: n(l.lotPriceIncl),
        totalIncl: n(l.totalIncl),
        source: l.source,
      });
      rows.push({
        id: i.id,
        purchaseId: p.id,
        materialId: i.rawMaterialId,
        material: i.rawMaterial.name,
        lotNumber: i.lotNumber ?? "",
        size: [i.grade, i.color].filter(Boolean).join(" / "),
        op: i.notes ?? "",
        attrs: (i.lot?.attrs ?? []).map((a) => a.attr.name),
        qty,
        unit: unitLabels[i.rawMaterial.unit] ?? "",
        price: n(i.unitPrice),
        currency: p.currency,
        rate: n(p.exchangeRate),
        unitIncl: n(l.unitIncl),
        unitExcl: n(l.unitExcl),
        totalIncl: n(l.totalIncl),
        totalExcl: n(l.totalExcl),
        priceIncl: n(l.lotPriceIncl),
        priceExcl: n(l.base),
        source: l.source,
        onStock: Boolean(i.lot),
        lotId: i.lot?.id ?? null,
        remaining: i.lot ? n(i.lot.quantityRemaining) : 0,
        usages: (i.lot?.usages ?? []).map((u) => ({ id: u.id, orderId: u.productionOrderId, number: u.productionOrder.number, wo: u.productionOrder.workOrderNumber ?? null, label: orderLabel({ workOrderNumber: u.productionOrder.workOrderNumber, number: u.productionOrder.number }), qty: n(u.quantity) })),
        parts,
        expIncl,
        extra: readExtra(i.extra),
        breakdown: l.breakdown ?? null,
        editor:
          editable && i.costPlan != null
            ? {
                id: i.id,
                lotNumber: i.lotNumber,
                ...deriveCostPlanInputs(i.costPlan, { quantity: qty, price: n(i.unitPrice), rate: n(p.exchangeRate), vat: n(i.vatRate) }),
              }
            : null,
      });
    }
  }
  return { rows, purchases };
}
