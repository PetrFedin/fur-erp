import "server-only";
import type { Prisma, FinishedGoodsMovementType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

type Tx = Prisma.TransactionClient;

/**
 * Creates a new raw-material lot from a received purchase item and logs the
 * PURCHASE_IN movement. unitCost/totalCost must already be the landed RUB
 * cost (item price converted via the purchase's exchange rate, plus this
 * item's share of allocated purchase expenses) — see purchases/actions.ts.
 * Each lot keeps its own fixed cost for the rest of its life; there is no
 * blending with other lots of the same material.
 */
export async function createRawMaterialLot(
  tx: Tx,
  args: {
    organizationId: string;
    warehouseId: string;
    rawMaterialId: string;
    lotNumber: string | null;
    grade: string | null;
    color: string | null;
    quantity: Prisma.Decimal | number;
    unitCost: Prisma.Decimal | number;
    totalCost: Prisma.Decimal | number;
    purchaseId: string;
    purchaseItemId: string;
  }
) {
  const quantity = toDecimal(args.quantity);
  const unitCost = toDecimal(args.unitCost);
  const totalCost = toDecimal(args.totalCost);

  const lot = await tx.rawMaterialLot.create({
    data: {
      organizationId: args.organizationId,
      warehouseId: args.warehouseId,
      rawMaterialId: args.rawMaterialId,
      lotNumber: args.lotNumber,
      grade: args.grade,
      color: args.color,
      quantityReceived: quantity,
      quantityRemaining: quantity,
      unitCost,
      totalCost,
      purchaseId: args.purchaseId,
      purchaseItemId: args.purchaseItemId,
    },
  });

  await tx.stockMovement.create({
    data: {
      organizationId: args.organizationId,
      warehouseId: args.warehouseId,
      rawMaterialId: args.rawMaterialId,
      lotId: lot.id,
      type: "PURCHASE_IN",
      quantity,
      unitCost,
      totalCost,
      purchaseId: args.purchaseId,
    },
  });

  return lot;
}

/** Consumes a quantity from a specific lot at that lot's fixed unit cost. Throws if insufficient. */
export async function consumeFromLot(
  tx: Tx,
  args: {
    organizationId: string;
    lotId: string;
    quantity: Prisma.Decimal | number;
    productionOrderId: string;
    notes?: string;
  }
) {
  const lot = await tx.rawMaterialLot.findUnique({ where: { id: args.lotId } });
  const qty = toDecimal(args.quantity);
  if (!lot || lot.organizationId !== args.organizationId) {
    throw new Error("Лот не найден");
  }
  if (lot.quantityRemaining.lessThan(qty)) {
    throw new Error(
      `Недостаточно сырья в лоте ${lot.lotNumber ?? lot.id} (доступно: ${lot.quantityRemaining.toString()})`
    );
  }

  const totalCost = lot.unitCost.mul(qty);

  await tx.stockMovement.create({
    data: {
      organizationId: args.organizationId,
      warehouseId: lot.warehouseId,
      rawMaterialId: lot.rawMaterialId,
      lotId: lot.id,
      type: "PRODUCTION_OUT",
      quantity: qty,
      unitCost: lot.unitCost,
      totalCost,
      productionOrderId: args.productionOrderId,
      notes: args.notes,
    },
  });

  await tx.rawMaterialLot.update({
    where: { id: lot.id },
    data: { quantityRemaining: lot.quantityRemaining.sub(qty) },
  });

  return { unitCost: lot.unitCost, totalCost, warehouseId: lot.warehouseId, rawMaterialId: lot.rawMaterialId };
}

/** Reverses a consumption (e.g. deleting a ProductionMaterialUsage line): returns quantity to its lot. */
export async function returnToLot(
  tx: Tx,
  args: { organizationId: string; lotId: string; quantity: Prisma.Decimal | number; notes?: string }
) {
  const lot = await tx.rawMaterialLot.findUnique({ where: { id: args.lotId } });
  if (!lot || lot.organizationId !== args.organizationId) {
    throw new Error("Лот не найден");
  }
  const qty = toDecimal(args.quantity);
  const totalCost = lot.unitCost.mul(qty);

  await tx.stockMovement.create({
    data: {
      organizationId: args.organizationId,
      warehouseId: lot.warehouseId,
      rawMaterialId: lot.rawMaterialId,
      lotId: lot.id,
      type: "ADJUSTMENT_IN",
      quantity: qty,
      unitCost: lot.unitCost,
      totalCost,
      notes: args.notes ?? "Отмена списания в производство",
    },
  });

  await tx.rawMaterialLot.update({
    where: { id: lot.id },
    data: { quantityRemaining: lot.quantityRemaining.add(qty) },
  });
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
