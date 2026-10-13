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
 * blending with other lots of the same material. This is the fur path
 * (specific identification, one lot per receipt) — for lining pooling, see
 * addOrPoolLiningLot below.
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
    colorRefId?: string | null;
    quantity: Prisma.Decimal | number;
    unitCost: Prisma.Decimal | number;
    totalCost: Prisma.Decimal | number;
    vatRate: Prisma.Decimal | number;
    materialCostExclVat: Prisma.Decimal | number;
    materialVatAmount: Prisma.Decimal | number;
    expenseCostExclVat?: Prisma.Decimal | number;
    expenseVatAmount?: Prisma.Decimal | number;
    purchaseId: string;
    purchaseItemId: string;
    costBreakdown?: Prisma.InputJsonValue;
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
      colorRefId: args.colorRefId ?? null,
      quantityReceived: quantity,
      quantityRemaining: quantity,
      unitCost,
      totalCost,
      vatRate: args.vatRate,
      materialCostExclVat: args.materialCostExclVat,
      materialVatAmount: args.materialVatAmount,
      expenseCostExclVat: args.expenseCostExclVat ?? 0,
      expenseVatAmount: args.expenseVatAmount ?? 0,
      purchaseId: args.purchaseId,
      ...(args.costBreakdown !== undefined ? { costBreakdown: args.costBreakdown } : {}),
    },
  });

  await tx.purchaseItem.update({ where: { id: args.purchaseItemId }, data: { lotId: lot.id } });

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

/**
 * Lining fabric (RawMaterial.unit === "M") is tracked as one aggregate pool
 * per fabric, not one lot per receipt (see cfc5cd6, which consolidated the
 * historical data — this is the "future purchases" half of that fix). If the
 * organization already has a RawMaterialLot for this rawMaterialId, this
 * receipt's quantity/cost is folded into it with a proper quantity-weighted
 * average (never just overwritten) and the new PurchaseItem is linked to
 * that SAME lot; otherwise a fresh lot is created exactly like
 * createRawMaterialLot does for fur.
 *
 * Post-consolidation there should be at most one lining lot per material —
 * if more than one turns up (data drifted some other way), that's a bug, not
 * a "pick one": we throw rather than silently pooling into an arbitrary lot,
 * so it surfaces instead of quietly corrupting costs.
 */
export async function addOrPoolLiningLot(
  tx: Tx,
  args: {
    organizationId: string;
    warehouseId: string;
    rawMaterialId: string;
    lotNumber: string | null;
    grade: string | null;
    color: string | null;
    colorRefId?: string | null;
    quantity: Prisma.Decimal | number;
    unitCost: Prisma.Decimal | number;
    totalCost: Prisma.Decimal | number;
    vatRate: Prisma.Decimal | number;
    materialCostExclVat: Prisma.Decimal | number;
    materialVatAmount: Prisma.Decimal | number;
    expenseCostExclVat?: Prisma.Decimal | number;
    expenseVatAmount?: Prisma.Decimal | number;
    purchaseId: string;
    purchaseItemId: string;
  }
) {
  const existingLots = await tx.rawMaterialLot.findMany({
    where: { organizationId: args.organizationId, rawMaterialId: args.rawMaterialId },
  });

  if (existingLots.length > 1) {
    throw new Error(
      `У ткани найдено ${existingLots.length} лотов вместо одного объединённого пула — перед новым поступлением нужно сначала объединить лоты ткани (обратитесь к разработчику).`
    );
  }

  const quantity = toDecimal(args.quantity);
  const unitCost = toDecimal(args.unitCost);
  const totalCost = toDecimal(args.totalCost);

  if (existingLots.length === 0) {
    return createRawMaterialLot(tx, args);
  }

  const pool = existingLots[0];

  // Цена единицы после докупки считается по ОСТАТКУ, а не по всему
  // полученному: уже израсходованные метры вышли по старой цене и в цену
  // остатка влиять не должны (раньше при нулевом остатке новая закупка
  // «разбавлялась» метрами, которых на складе уже нет).
  //   unit = (остаток × старая цена + новые метры × новая цена) / (остаток + новые)
  // Накопительные поля — quantityReceived и totalCost — остаются суммами всех
  // поступлений («получено всего» / «потрачено на закупки всего»), история
  // списаний (StockMovement, ProductionMaterialUsage) не затрагивается: каждое
  // списание уже зафиксировано по цене на момент списания. Поэтому для пула
  // unitCost ≠ totalCost/quantityReceived — unitCost это цена остатка.
  const newQuantityReceived = pool.quantityReceived.add(quantity);
  const newQuantityRemaining = pool.quantityRemaining.add(quantity);
  const newTotalCost = pool.totalCost.add(totalCost);
  const remainder = pool.quantityRemaining;
  const newUnitCost = newQuantityRemaining.isZero()
    ? unitCost
    : remainder.mul(pool.unitCost).add(quantity.mul(unitCost)).div(newQuantityRemaining);

  const weightedPerUnit = (oldPerUnit: Prisma.Decimal, newPerUnit: Prisma.Decimal) =>
    newQuantityRemaining.isZero()
      ? newPerUnit
      : oldPerUnit.mul(remainder).add(newPerUnit.mul(quantity)).div(newQuantityRemaining);

  const newMaterialCostExclVat = weightedPerUnit(pool.materialCostExclVat, toDecimal(args.materialCostExclVat));
  const newMaterialVatAmount = weightedPerUnit(pool.materialVatAmount, toDecimal(args.materialVatAmount));
  const newExpenseCostExclVat = weightedPerUnit(
    pool.expenseCostExclVat,
    toDecimal(args.expenseCostExclVat ?? 0)
  );
  const newExpenseVatAmount = weightedPerUnit(pool.expenseVatAmount, toDecimal(args.expenseVatAmount ?? 0));

  const updatedLot = await tx.rawMaterialLot.update({
    where: { id: pool.id },
    data: {
      quantityReceived: newQuantityReceived,
      quantityRemaining: newQuantityRemaining,
      unitCost: newUnitCost,
      totalCost: newTotalCost,
      // vatRate itself isn't weight-averaged (it's a rate, not a cost) —
      // keep the pool's own rate; each receipt's own rate already fed the
      // material/expense VAT-amount split above.
      materialCostExclVat: newMaterialCostExclVat,
      materialVatAmount: newMaterialVatAmount,
      expenseCostExclVat: newExpenseCostExclVat,
      expenseVatAmount: newExpenseVatAmount,
      notes: pool.notes
        ? `${pool.notes} Пул увеличен новым поступлением (+${quantity.toString()}).`
        : `Пул увеличен новым поступлением (+${quantity.toString()}).`,
    },
  });

  // The pool lot's own purchaseItemId/purchaseId is left as-is (whatever it
  // was pointing at before — see PurchaseItem.lotId's schema comment: many
  // items can point at one lot, but the lot itself only remembers its own
  // purchase/first item for provenance). This new item just gets linked to
  // the same lot.
  await tx.purchaseItem.update({ where: { id: args.purchaseItemId }, data: { lotId: pool.id } });

  await tx.stockMovement.create({
    data: {
      organizationId: args.organizationId,
      warehouseId: args.warehouseId,
      rawMaterialId: args.rawMaterialId,
      lotId: pool.id,
      type: "PURCHASE_IN",
      quantity,
      unitCost,
      totalCost,
      purchaseId: args.purchaseId,
    },
  });

  return updatedLot;
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
