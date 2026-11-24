import { orderUnits } from "@/lib/production-totals";
import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { orderLabel } from "@/lib/order-label";
import { classifyProduct } from "@/lib/product-category";
import { lotUnitCostExclVat } from "@/lib/purchase-totals";
import { usageExclVat } from "@/lib/commission4";
import { COMMISSION_RATE } from "@/lib/commission4-const";

export const zero = () => new Decimal(0);

/** label — единая подпись ТЗ («ТЗ 182 · поз. 1/3», см. order-label.ts); number — внутренний номер (для подсказки); wo — рабочий № ТЗ. */
export type UsageRef = { id: string; orderId: string; number: string; wo: string | null; label: string; modelId: string; qty: Decimal };

export const usageRowPick = (r: UsageRow) => ({ orderId: r.orderId, number: r.orderNumber, wo: r.wo });

export type RawLot = {
  id: string;
  lotNumber: string;
  auction: string; // полное название (ключ фильтра) или NO_AUCTION_KEY
  auctionLabel: string;
  year: number;
  month: string; // YYYY-MM
  kind: string;
  /** Название материала («Подкладочная ткань №2», «Соболь …»). */
  materialName: string;
  unit: string;
  cat: string;
  /** Основной размер лота по документам (первый из sizeGrade) для группировки; нет — «Не указан». */
  size: string;
  /** Все размеры лота по документам (RawMaterialLot.sizeGrade); пусто — размер в документах не указан. */
  sizes: string[];
  /** Признаки меха лота (справочник /settings/fur-attrs). */
  attrs: string[];
  purchaseId: string | null;
  purchaseNumber: string | null;
  recv: Decimal;
  used: Decimal;
  rem: Decimal;
  unitIncl: Decimal;
  unitExcl: Decimal;
  usedIncl: Decimal;
  usedExcl: Decimal;
  usedExtraIncl: Decimal; // надбавка 4% по строкам списания, у которых она применяется
  usedExtraExcl: Decimal;
  usages: UsageRef[];
  gradeEmpty: boolean;
  /** Расхождения: получено − остаток − списано в ТЗ; чистое движение по журналу − остаток. */
  otherOut: Decimal;
  movementGap: Decimal;
  /** Дата закупки (иначе дата прихода) — по ней год лота и «сколько лежит». */
  date: Date;
  /** Σ количества в позициях закупки, привязанных к лоту. */
  itemsQty: Decimal;
  /** Журнал движений склада (StockMovement) по лоту: приход, списано в ТЗ, списано иначе, остаток. */
  jIn: Decimal;
  jProdOut: Decimal;
  jOtherOut: Decimal;
  jNet: Decimal;
  /**
   * Строка «моста до Главной» — не лот склада: «ordered» — заказано, но не получено (лотов ещё нет),
   * «hides» — шкуры подрядчика (оплачены в составе пошива). Собираются в loadDashboard (src/lib/raw-analytics-dash.ts).
   */
  synthetic?: "ordered" | "hides";
  /** Суммы, заданные расчётом Главной (у синтетических строк цена за единицу не имеет смысла): вместо кол-во × цена. */
  fixed?: { recvIncl: Decimal; recvExcl: Decimal; remIncl: Decimal; remExcl: Decimal };
};

export const LOT_INCLUDE = {
  rawMaterial: { select: { name: true, unit: true } },
  colorRef: { select: { name: true } },
  attrs: { select: { attr: { select: { name: true } } } },
  purchase: { select: { id: true, number: true, auctionSession: true, orderDate: true } },
  purchaseItems: { select: { quantity: true } },
  usages: {
    select: {
      id: true, quantity: true, totalCost: true, commission4: true, vatRate: true,
      productionOrder: { select: { id: true, number: true, workOrderNumber: true, productModelId: true } },
    },
    orderBy: { date: "asc" },
  },
  stockMovements: { select: { type: true, quantity: true } },
} satisfies Prisma.RawMaterialLotInclude;

// ───────────── списания по изделиям и ТЗ ─────────────

export const K4 = new Decimal(COMMISSION_RATE);

/** Произведено по ТЗ — все ТЗ без отменённых (production-totals.ts), как на Главной: выпуск завершённого, план ТЗ в работе. */
export const producedDec = (o: { status: string; producedQuantity: Decimal; plannedQuantity: Decimal }) => new Decimal(orderUnits(o).toFixed(3));

export type OrderBrief = {
  workOrderNumber: string | null;
  id: string;
  number: string;
  status: string;
  producedQuantity: Decimal;
  plannedQuantity: Decimal;
  workOrderDate: Date | null;
  endDate: Date | null;
  startDate: Date | null;
  materialDescription: string | null;
  batch: { id: string; number: number; year: number | null } | null;
  productModel: { id: string; name: string; sku: string | null; category: string | null; categoryRef: { name: string } | null };
};

export const ORDER_BRIEF = {
  id: true, number: true, workOrderNumber: true, status: true, producedQuantity: true, plannedQuantity: true, workOrderDate: true, endDate: true, startDate: true, materialDescription: true,
  batch: { select: { id: true, number: true, year: true } },
  productModel: { select: { id: true, name: true, sku: true, category: true, categoryRef: { select: { name: true } } } },
} satisfies Prisma.ProductionOrderSelect;

export const orderDateOf = (o: { workOrderDate: Date | null; endDate: Date | null; startDate: Date | null }) => o.workOrderDate ?? o.endDate ?? o.startDate;

export const categoryOfOrder = (o: OrderBrief) =>
  classifyProduct({ refName: o.productModel.categoryRef?.name, modelCategory: o.productModel.category, orderDescription: o.materialDescription, modelName: o.productModel.name }).category;

/** Одно списание сырья в ТЗ (со стоимостью по цене лота). */
export type UsageRow = {
  id: string;
  lotId: string;
  orderId: string;
  orderNumber: string;
  /** Рабочий № ТЗ из документа. */
  wo: string | null;
  /** Единая подпись ТЗ («ТЗ 182 · поз. 1/3»). */
  label: string;
  orderDate: Date | null;
  modelId: string;
  modelName: string;
  sku: string | null;
  category: string;
  batchNumber: number | null;
  produced: Decimal;
  unit: string;
  qty: Decimal;
  incl: Decimal;
  excl: Decimal;
  c4: boolean;
};

export const usageRowOf = (u: {
  id: string; lotId: string; quantity: Decimal; totalCost: Decimal; commission4: boolean; vatRate: Decimal | null;
  lot: Parameters<typeof lotUnitCostExclVat>[0] & { rawMaterial: { unit: string } };
  productionOrder: OrderBrief;
}): UsageRow => ({
  id: u.id,
  lotId: u.lotId,
  orderId: u.productionOrder.id,
  orderNumber: u.productionOrder.number,
  wo: u.productionOrder.workOrderNumber,
  label: orderLabel(u.productionOrder),
  orderDate: orderDateOf(u.productionOrder),
  modelId: u.productionOrder.productModel.id,
  modelName: u.productionOrder.productModel.name,
  sku: u.productionOrder.productModel.sku,
  category: categoryOfOrder(u.productionOrder),
  batchNumber: u.productionOrder.batch?.number ?? null,
  produced: producedDec(u.productionOrder),
  unit: u.lot.rawMaterial.unit,
  qty: u.quantity,
  incl: u.totalCost,
  excl: usageExclVat(u, lotUnitCostExclVat(u.lot)),
  c4: u.commission4,
});

export const USAGE_SELECT = {
  id: true, lotId: true, quantity: true, totalCost: true, commission4: true, vatRate: true,
  lot: { select: { unitCost: true, vatRate: true, materialCostExclVat: true, expenseCostExclVat: true, rawMaterial: { select: { unit: true } } } },
  productionOrder: { select: ORDER_BRIEF },
} satisfies Prisma.ProductionMaterialUsageSelect;
