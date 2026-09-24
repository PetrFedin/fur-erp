import "server-only";
import type { Prisma, StockMovementType, FinishedGoodsMovementType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

type Tx = Prisma.TransactionClient;

/**
 * Records an incoming raw-material stock movement and rolls it into the
 * warehouse's moving weighted-average cost. Used for purchase receipts and
 * any other "material entered the warehouse" event.
 */
export async function receiveRawMaterialStock(
  tx: Tx,
  args: {
    organizationId: string;
    warehouseId: string;
    rawMaterialId: string;
    quantity: Prisma.Decimal | number;
    unitCost: Prisma.Decimal | number;
    totalCost: Prisma.Decimal | number;
    type: Extract<StockMovementType, "PURCHASE_IN" | "ADJUSTMENT_IN" | "TRANSFER_IN">;
    purchaseId?: string;
    notes?: string;
  }
) {
  await tx.stockMovement.create({
    data: {
      organizationId: args.organizationId,
      warehouseId: args.warehouseId,
      rawMaterialId: args.rawMaterialId,
      type: args.type,
      quantity: args.quantity,
      unitCost: args.unitCost,
      totalCost: args.totalCost,
      purchaseId: args.purchaseId,
      notes: args.notes,
    },
  });

  const existing = await tx.rawMaterialStock.findUnique({
    where: { warehouseId_rawMaterialId: { warehouseId: args.warehouseId, rawMaterialId: args.rawMaterialId } },
  });

  const qty = toDecimal(args.quantity);
  const total = toDecimal(args.totalCost);

  if (!existing) {
    await tx.rawMaterialStock.create({
      data: {
        organizationId: args.organizationId,
        warehouseId: args.warehouseId,
        rawMaterialId: args.rawMaterialId,
        quantity: qty,
        avgUnitCost: qty.isZero() ? 0 : total.div(qty),
      },
    });
    return;
  }

  const newQuantity = existing.quantity.add(qty);
  const newTotalValue = existing.quantity.mul(existing.avgUnitCost).add(total);
  const newAvgCost = newQuantity.isZero() ? existing.avgUnitCost : newTotalValue.div(newQuantity);

  await tx.rawMaterialStock.update({
    where: { id: existing.id },
    data: { quantity: newQuantity, avgUnitCost: newAvgCost },
  });
}

/** Consumes raw-material stock at its current weighted-average cost. Throws if insufficient. */
export async function consumeRawMaterialStock(
  tx: Tx,
  args: {
    organizationId: string;
    warehouseId: string;
    rawMaterialId: string;
    quantity: Prisma.Decimal | number;
    type: Extract<StockMovementType, "PRODUCTION_OUT" | "ADJUSTMENT_OUT" | "TRANSFER_OUT">;
    productionOrderId?: string;
    notes?: string;
  }
) {
  const existing = await tx.rawMaterialStock.findUnique({
    where: { warehouseId_rawMaterialId: { warehouseId: args.warehouseId, rawMaterialId: args.rawMaterialId } },
  });

  const qty = toDecimal(args.quantity);
  if (!existing || existing.quantity.lessThan(qty)) {
    const available = existing?.quantity.toString() ?? "0";
    throw new Error(`Недостаточно сырья на складе (доступно: ${available})`);
  }

  const unitCost = existing.avgUnitCost;
  const totalCost = unitCost.mul(qty);

  await tx.stockMovement.create({
    data: {
      organizationId: args.organizationId,
      warehouseId: args.warehouseId,
      rawMaterialId: args.rawMaterialId,
      type: args.type,
      quantity: qty,
      unitCost,
      totalCost,
      productionOrderId: args.productionOrderId,
      notes: args.notes,
    },
  });

  await tx.rawMaterialStock.update({
    where: { id: existing.id },
    data: { quantity: existing.quantity.sub(qty) },
  });

  return { unitCost, totalCost };
}

/** Records finished goods entering a warehouse (e.g. from production) and updates the weighted average. */
export async function receiveFinishedGoodsStock(
  tx: Tx,
  args: {
    organizationId: string;
    warehouseId: string;
    productModelId: string;
    quantity: Prisma.Decimal | number;
    unitCost: Prisma.Decimal | number;
    totalCost: Prisma.Decimal | number;
    type: Extract<FinishedGoodsMovementType, "PRODUCTION_IN" | "ADJUSTMENT_IN" | "TRANSFER_IN">;
    productionOrderId?: string;
  }
) {
  await tx.finishedGoodsMovement.create({
    data: {
      organizationId: args.organizationId,
      warehouseId: args.warehouseId,
      productModelId: args.productModelId,
      type: args.type,
      quantity: args.quantity,
      unitCost: args.unitCost,
      totalCost: args.totalCost,
      productionOrderId: args.productionOrderId,
    },
  });

  const existing = await tx.finishedGoodsStock.findUnique({
    where: { warehouseId_productModelId: { warehouseId: args.warehouseId, productModelId: args.productModelId } },
  });

  const qty = toDecimal(args.quantity);
  const total = toDecimal(args.totalCost);

  if (!existing) {
    await tx.finishedGoodsStock.create({
      data: {
        organizationId: args.organizationId,
        warehouseId: args.warehouseId,
        productModelId: args.productModelId,
        quantity: qty,
        avgUnitCost: qty.isZero() ? 0 : total.div(qty),
      },
    });
    return;
  }

  const newQuantity = existing.quantity.add(qty);
  const newTotalValue = existing.quantity.mul(existing.avgUnitCost).add(total);
  const newAvgCost = newQuantity.isZero() ? existing.avgUnitCost : newTotalValue.div(newQuantity);

  await tx.finishedGoodsStock.update({
    where: { id: existing.id },
    data: { quantity: newQuantity, avgUnitCost: newAvgCost },
  });
}

/** Writes off finished goods (sale, disposal, adjustment) at the current weighted-average cost. */
export async function writeOffFinishedGoodsStock(
  tx: Tx,
  args: {
    organizationId: string;
    warehouseId: string;
    productModelId: string;
    quantity: Prisma.Decimal | number;
    type: Extract<FinishedGoodsMovementType, "WRITE_OFF_OUT" | "ADJUSTMENT_OUT" | "TRANSFER_OUT">;
    notes?: string;
  }
) {
  const existing = await tx.finishedGoodsStock.findUnique({
    where: { warehouseId_productModelId: { warehouseId: args.warehouseId, productModelId: args.productModelId } },
  });

  const qty = toDecimal(args.quantity);
  if (!existing || existing.quantity.lessThan(qty)) {
    const available = existing?.quantity.toString() ?? "0";
    throw new Error(`Недостаточно готовой продукции на складе (доступно: ${available})`);
  }

  const unitCost = existing.avgUnitCost;
  const totalCost = unitCost.mul(qty);

  await tx.finishedGoodsMovement.create({
    data: {
      organizationId: args.organizationId,
      warehouseId: args.warehouseId,
      productModelId: args.productModelId,
      type: args.type,
      quantity: qty,
      unitCost,
      totalCost,
      notes: args.notes,
    },
  });

  await tx.finishedGoodsStock.update({
    where: { id: existing.id },
    data: { quantity: existing.quantity.sub(qty) },
  });
}

function toDecimal(value: Prisma.Decimal | number): Prisma.Decimal {
  return typeof value === "number" ? new Decimal(value) : value;
}
