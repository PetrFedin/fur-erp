// Загрузка данных для проверок: ТОЛЬКО чтение (findMany / groupBy), без записи. Числа приведены к number —
// допуски проверок (копейки, 50 ₽) заведомо больше ошибки плавающей точки.
import type { PrismaClient } from "@prisma/client";

const num = (v: { toString(): string } | null | undefined): number => (v == null ? 0 : Number(v.toString()));
export const r2 = (v: number) => Math.round(v * 100) / 100;

export type IPurchase = {
  id: string; number: string; status: string; auctionSession: string | null; auctionId: string | null; supplierId: string;
  exchangeRate: number; orderDate: Date; updatedAt: Date; verifiedAt: Date | null; verifiedBy: string | null;
  items: { id: string; quantity: number; unitPrice: number; subtotal: number; vatRate: number; costPlan: unknown; lotId: string | null }[];
  expenses: { amount: number; vatRate: number }[];
  payments: { id: string; amount: number; status: string }[];
};
export type ILot = {
  id: string; purchaseId: string | null; lotNumber: string | null; grade: string | null; color: string | null; colorRefId: string | null; colorRefName: string | null; colorRefAliases: string[];
  rawMaterialId: string; unit: string; materialName: string;
  quantityReceived: number; quantityRemaining: number; unitCost: number; totalCost: number;
  items: { id: string; lotNumber: string | null; grade: string | null; color: string | null; quantity: number }[];
};
export type IUsage = { id: string; orderId: string; lotId: string; quantity: number; unitCost: number; totalCost: number; commission4: boolean };
export type IOrder = {
  id: string; number: string; status: string; plannedQuantity: number; producedQuantity: number;
  materialCost: number | null; expenseCost: number | null; totalCost: number | null; unitCost: number | null;
  clientWorkPricePerUnit: number | null; retailPrice: number | null; batchId: string | null; productModelId: string; finishedWarehouseId: string;
  color: string | null; colorRefId: string | null; colorRefName: string | null; colorRefAliases: string[];
  updatedAt: Date; verifiedAt: Date | null; verifiedBy: string | null;
  allocations: { paymentId: string; amount: number; status: string }[];
};
export type IBatch = { id: string; number: number; name: string | null; plannedUnits: number | null; verifiedAt: Date | null; verifiedBy: string | null };
export type IPayment = {
  id: string; supplierId: string; purchaseId: string | null; auctionSession: string | null; amount: number; status: string; paidAt: Date;
  docRef: string | null; confirmed: boolean; confirmedAt: Date | null; documentId: string | null; driveDocs: number; kind: string; notes: string | null;
};
export type IProdPayment = {
  id: string; amount: number; status: string; paidAt: Date; paymentType: string; docRef: string | null; notes: string | null;
  confirmed: boolean; confirmedAt: Date | null; orders: number; driveDocs: number;
};
export type IModel = { id: string; name: string; salesCode: string | null; sellingPrice: number | null; category: string | null; categoryRefId: string | null; categoryRefName: string | null };
export type IAuction = { id: string; name: string; aliases: string[]; isService: boolean };
export type IFgStock = { warehouseId: string; productModelId: string; quantity: number };
export type IFgMove = { warehouseId: string; productModelId: string; productionOrderId: string | null; type: string; quantity: number };
export type IDriveLink = { driveFileId: string; purchaseId: string | null; lotId: string | null; productionOrderId: string | null; productionBatchId: string | null; paymentId: string | null; productionPaymentId: string | null };

export type IntegrityData = {
  orgId: string;
  purchases: IPurchase[];
  lots: ILot[];
  usages: IUsage[];
  orderExpenses: Map<string, number>;
  orders: IOrder[];
  batches: IBatch[];
  payments: IPayment[];
  prodPayments: IProdPayment[];
  models: IModel[];
  auctions: IAuction[];
  fgStock: IFgStock[];
  fgMoves: IFgMove[];
  driveLinks: IDriveLink[];
  /** Id записей, менявшихся позже даты подтверждения (по журналу): purchaseId/orderId → есть ли правки. */
  auditAfter: { model: string; recordId: string; at: Date }[];
  /** Сумма разнесений (PaymentAllocation) по оплатам подрядчику. */
  allocByPayment: Map<string, number>;
};

export async function loadIntegrityData(db: PrismaClient, orgId: string): Promise<IntegrityData> {
  const [purchases, lots, usages, expGroups, orders, batches, payments, prodPayments, models, auctions, fgStock, fgMoves, driveLinks, allocGroups] = await Promise.all([
    db.purchase.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, number: true, status: true, auctionSession: true, auctionId: true, supplierId: true, exchangeRate: true, orderDate: true, updatedAt: true, verifiedAt: true, verifiedBy: true,
        items: { select: { id: true, quantity: true, unitPrice: true, subtotal: true, vatRate: true, costPlan: true, lotId: true } },
        expenses: { select: { amount: true, vatRate: true } },
        payments: { select: { id: true, amount: true, status: true } },
      },
    }),
    db.rawMaterialLot.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, purchaseId: true, lotNumber: true, grade: true, color: true, colorRefId: true, colorRef: { select: { name: true, aliases: true } },
        rawMaterialId: true, rawMaterial: { select: { unit: true, name: true } },
        quantityReceived: true, quantityRemaining: true, unitCost: true, totalCost: true,
        purchaseItems: { select: { id: true, lotNumber: true, grade: true, color: true, quantity: true } },
      },
    }),
    db.productionMaterialUsage.findMany({
      where: { productionOrder: { organizationId: orgId } },
      select: { id: true, productionOrderId: true, lotId: true, quantity: true, unitCost: true, totalCost: true, commission4: true },
    }),
    db.productionExpense.groupBy({ by: ["productionOrderId"], where: { productionOrder: { organizationId: orgId } }, _sum: { amount: true } }),
    db.productionOrder.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, number: true, status: true, plannedQuantity: true, producedQuantity: true, materialCost: true, expenseCost: true, totalCost: true, unitCost: true,
        clientWorkPricePerUnit: true, retailPrice: true, batchId: true, productModelId: true, finishedWarehouseId: true, color: true, colorRefId: true, colorRef: { select: { name: true, aliases: true } },
        updatedAt: true, verifiedAt: true, verifiedBy: true,
        paymentAllocations: { select: { productionPayment: { select: { id: true, amount: true, status: true } } } },
      },
    }),
    db.productionBatch.findMany({ where: { organizationId: orgId }, select: { id: true, number: true, name: true, plannedUnits: true, verifiedAt: true, verifiedBy: true } }),
    db.payment.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, supplierId: true, purchaseId: true, auctionSession: true, amount: true, status: true, paidAt: true, docRef: true, confirmed: true, confirmedAt: true,
        documentId: true, kind: true, notes: true, _count: { select: { driveDocuments: true } },
      },
    }),
    db.productionPayment.findMany({
      where: { organizationId: orgId },
      select: { id: true, amount: true, status: true, paidAt: true, paymentType: true, docRef: true, notes: true, confirmed: true, confirmedAt: true, _count: { select: { orders: true, driveDocuments: true } } },
    }),
    db.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, salesCode: true, sellingPrice: true, category: true, categoryRefId: true, categoryRef: { select: { name: true } } } }),
    db.auction.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, aliases: true, isService: true } }),
    db.finishedGoodsStock.findMany({ where: { organizationId: orgId }, select: { warehouseId: true, productModelId: true, quantity: true } }),
    db.finishedGoodsMovement.findMany({ where: { organizationId: orgId }, select: { warehouseId: true, productModelId: true, productionOrderId: true, type: true, quantity: true } }),
    db.driveDocument.findMany({
      where: { organizationId: orgId },
      select: { driveFileId: true, purchaseId: true, lotId: true, productionOrderId: true, productionBatchId: true, paymentId: true, productionPaymentId: true },
    }),
    db.paymentAllocation.groupBy({ by: ["productionPaymentId"], where: { organizationId: orgId }, _sum: { amount: true } }),
  ]);

  // Журнал: правки после подтверждения (нужны только для подтверждённых строк).
  const verifiedAts = [...purchases.map((p) => p.verifiedAt), ...orders.map((o) => o.verifiedAt), ...batches.map((b) => b.verifiedAt)].filter((d): d is Date => !!d);
  let auditAfter: IntegrityData["auditAfter"] = [];
  if (verifiedAts.length) {
    const since = new Date(Math.min(...verifiedAts.map((d) => d.getTime())));
    auditAfter = await db.auditLog.findMany({
      where: {
        organizationId: orgId,
        at: { gt: since },
        model: { in: ["Purchase", "PurchaseItem", "PurchaseExpense", "Payment", "RawMaterialLot", "ProductionOrder", "ProductionMaterialUsage", "ProductionExpense", "ProductionPayment", "ProductionPaymentOrder", "ProductionBatch"] },
      },
      select: { model: true, recordId: true, at: true, changes: true },
    }).then((rows) =>
      rows
        // сам акт подтверждения/сброса (поля verified*) правкой данных не считаем
        .filter((r) => {
          const ch = r.changes as Record<string, unknown> | null;
          if (!ch || typeof ch !== "object") return true;
          const keys = Object.keys(ch);
          return !(keys.length > 0 && keys.every((k) => /^verif|^confirmed(At|By)?$|^updatedAt$/.test(k)));
        })
        .map((r) => ({ model: r.model, recordId: r.recordId, at: r.at })),
    ).catch(() => []);
  }

  return {
    orgId,
    purchases: purchases.map((p) => ({
      ...p,
      exchangeRate: num(p.exchangeRate),
      items: p.items.map((i) => ({ ...i, quantity: num(i.quantity), unitPrice: num(i.unitPrice), subtotal: num(i.subtotal), vatRate: num(i.vatRate) })),
      expenses: p.expenses.map((e) => ({ amount: num(e.amount), vatRate: num(e.vatRate) })),
      payments: p.payments.map((x) => ({ id: x.id, amount: num(x.amount), status: x.status })),
    })),
    lots: lots.map((l) => ({
      id: l.id, purchaseId: l.purchaseId, lotNumber: l.lotNumber, grade: l.grade, color: l.color, colorRefId: l.colorRefId, colorRefName: l.colorRef?.name ?? null, colorRefAliases: l.colorRef?.aliases ?? [],
      rawMaterialId: l.rawMaterialId, unit: l.rawMaterial.unit, materialName: l.rawMaterial.name,
      quantityReceived: num(l.quantityReceived), quantityRemaining: num(l.quantityRemaining), unitCost: num(l.unitCost), totalCost: num(l.totalCost),
      items: l.purchaseItems.map((i) => ({ id: i.id, lotNumber: i.lotNumber, grade: i.grade, color: i.color, quantity: num(i.quantity) })),
    })),
    usages: usages.map((u) => ({ id: u.id, orderId: u.productionOrderId, lotId: u.lotId, quantity: num(u.quantity), unitCost: num(u.unitCost), totalCost: num(u.totalCost), commission4: u.commission4 })),
    orderExpenses: new Map(expGroups.map((g) => [g.productionOrderId, num(g._sum.amount)])),
    orders: orders.map((o) => ({
      id: o.id, number: o.number, status: o.status, plannedQuantity: num(o.plannedQuantity), producedQuantity: num(o.producedQuantity),
      materialCost: o.materialCost == null ? null : num(o.materialCost), expenseCost: o.expenseCost == null ? null : num(o.expenseCost),
      totalCost: o.totalCost == null ? null : num(o.totalCost), unitCost: o.unitCost == null ? null : num(o.unitCost),
      clientWorkPricePerUnit: o.clientWorkPricePerUnit == null ? null : num(o.clientWorkPricePerUnit), retailPrice: o.retailPrice == null ? null : num(o.retailPrice),
      batchId: o.batchId, productModelId: o.productModelId, finishedWarehouseId: o.finishedWarehouseId,
      color: o.color, colorRefId: o.colorRefId, colorRefName: o.colorRef?.name ?? null, colorRefAliases: o.colorRef?.aliases ?? [],
      updatedAt: o.updatedAt, verifiedAt: o.verifiedAt, verifiedBy: o.verifiedBy,
      allocations: o.paymentAllocations.map((a) => ({ paymentId: a.productionPayment.id, amount: num(a.productionPayment.amount), status: a.productionPayment.status })),
    })),
    batches: batches.map((b) => ({ ...b })),
    payments: payments.map((p) => ({
      id: p.id, supplierId: p.supplierId, purchaseId: p.purchaseId, auctionSession: p.auctionSession, amount: num(p.amount), status: p.status, paidAt: p.paidAt,
      docRef: p.docRef, confirmed: p.confirmed, confirmedAt: p.confirmedAt, documentId: p.documentId, driveDocs: p._count.driveDocuments, kind: p.kind, notes: p.notes,
    })),
    prodPayments: prodPayments.map((p) => ({
      id: p.id, amount: num(p.amount), status: p.status, paidAt: p.paidAt, paymentType: p.paymentType, docRef: p.docRef, notes: p.notes,
      confirmed: p.confirmed, confirmedAt: p.confirmedAt, orders: p._count.orders, driveDocs: p._count.driveDocuments,
    })),
    models: models.map((m) => ({ id: m.id, name: m.name, salesCode: m.salesCode, sellingPrice: m.sellingPrice == null ? null : num(m.sellingPrice), category: m.category, categoryRefId: m.categoryRefId, categoryRefName: m.categoryRef?.name ?? null })),
    auctions,
    fgStock: fgStock.map((s) => ({ ...s, quantity: num(s.quantity) })),
    fgMoves: fgMoves.map((m) => ({ ...m, quantity: num(m.quantity) })),
    driveLinks,
    auditAfter,
    allocByPayment: new Map(allocGroups.map((g) => [g.productionPaymentId, num(g._sum.amount)])),
  };
}
