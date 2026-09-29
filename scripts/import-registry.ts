/**
 * One-time bulk import of the historical fur registry
 * (21-08 ЕДИНЫЙ_РЕЕСТР_ПО_МЕХУ_MVST 2.xlsx) into the app database.
 * Reads scripts/import_plan.json (pre-resolved by the Python extraction
 * scripts in /tmp/xlsx_extract) and creates Suppliers, RawMaterials,
 * Purchases+PurchaseItems+RawMaterialLots, then ProductionOrders with
 * material consumption, mirroring the exact math the app's own server
 * actions use (src/lib/stock.ts, production/actions.ts).
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/import-registry.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();

// Inlined from src/lib/stock.ts / src/lib/numbering.ts (kept import-free here
// since this standalone script can't load the "server-only" guard those
// modules pull in) — logic must stay identical to what the app's own server
// actions do.
type Tx = Prisma.TransactionClient;

async function nextDocumentNumber(
  tx: Tx,
  model: "purchase" | "productionOrder",
  organizationId: string,
  prefix: string
) {
  const year = new Date().getFullYear();
  const count =
    model === "purchase"
      ? await tx.purchase.count({ where: { organizationId } })
      : await tx.productionOrder.count({ where: { organizationId } });
  return `${prefix}-${year}-${String(count + 1).padStart(4, "0")}`;
}

async function createRawMaterialLot(
  tx: Tx,
  args: {
    organizationId: string;
    warehouseId: string;
    rawMaterialId: string;
    lotNumber: string | null;
    grade: string | null;
    color: string | null;
    quantity: Decimal;
    unitCost: Decimal;
    totalCost: Decimal;
    vatRate: Decimal;
    materialCostExclVat: Decimal;
    materialVatAmount: Decimal;
    purchaseId: string;
    purchaseItemId: string;
  }
) {
  const lot = await tx.rawMaterialLot.create({
    data: {
      organizationId: args.organizationId,
      warehouseId: args.warehouseId,
      rawMaterialId: args.rawMaterialId,
      lotNumber: args.lotNumber,
      grade: args.grade,
      color: args.color,
      quantityReceived: args.quantity,
      quantityRemaining: args.quantity,
      unitCost: args.unitCost,
      totalCost: args.totalCost,
      vatRate: args.vatRate,
      materialCostExclVat: args.materialCostExclVat,
      materialVatAmount: args.materialVatAmount,
      purchaseId: args.purchaseId,
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
      quantity: args.quantity,
      unitCost: args.unitCost,
      totalCost: args.totalCost,
      purchaseId: args.purchaseId,
    },
  });

  return lot;
}

async function consumeFromLot(
  tx: Tx,
  args: { organizationId: string; lotId: string; quantity: Decimal; productionOrderId: string }
) {
  const lot = await tx.rawMaterialLot.findUnique({ where: { id: args.lotId } });
  if (!lot || lot.organizationId !== args.organizationId) {
    throw new Error("Лот не найден");
  }
  if (lot.quantityRemaining.lessThan(args.quantity)) {
    throw new Error(
      `Недостаточно сырья в лоте ${lot.lotNumber ?? lot.id} (доступно: ${lot.quantityRemaining.toString()}, нужно: ${args.quantity.toString()})`
    );
  }

  const totalCost = lot.unitCost.mul(args.quantity);

  await tx.stockMovement.create({
    data: {
      organizationId: args.organizationId,
      warehouseId: lot.warehouseId,
      rawMaterialId: lot.rawMaterialId,
      lotId: lot.id,
      type: "PRODUCTION_OUT",
      quantity: args.quantity,
      unitCost: lot.unitCost,
      totalCost,
      productionOrderId: args.productionOrderId,
    },
  });

  await tx.rawMaterialLot.update({
    where: { id: lot.id },
    data: { quantityRemaining: lot.quantityRemaining.sub(args.quantity) },
  });

  return { unitCost: lot.unitCost, totalCost, warehouseId: lot.warehouseId, rawMaterialId: lot.rawMaterialId };
}

async function receiveFinishedGoodsStock(
  tx: Tx,
  args: {
    organizationId: string;
    warehouseId: string;
    productModelId: string;
    quantity: Decimal;
    unitCost: Decimal;
    totalCost: Decimal;
    type: "PRODUCTION_IN";
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

  if (!existing) {
    await tx.finishedGoodsStock.create({
      data: {
        organizationId: args.organizationId,
        warehouseId: args.warehouseId,
        productModelId: args.productModelId,
        quantity: args.quantity,
        avgUnitCost: args.quantity.isZero() ? 0 : args.totalCost.div(args.quantity),
      },
    });
    return;
  }

  const newQuantity = existing.quantity.add(args.quantity);
  const newTotalValue = existing.quantity.mul(existing.avgUnitCost).add(args.totalCost);
  const newAvgCost = newQuantity.isZero() ? existing.avgUnitCost : newTotalValue.div(newQuantity);

  await tx.finishedGoodsStock.update({
    where: { id: existing.id },
    data: { quantity: newQuantity, avgUnitCost: newAvgCost },
  });
}

type PlanLot = { lotNumber: string; materialName: string; quantityReceived: number; unitCostInclVat: number };
type PlanPurchase = {
  key: string;
  supplierKey: string;
  auctionSession: string | null;
  invoiceNumber: string | null;
  transferDocument: string | null;
  orderDate: string;
  lots: PlanLot[];
};
type PlanLine = { lotNumber: string; quantity: number };
type PlanProductionOrder = {
  headerRow: number;
  article: string;
  productType: string | null;
  materialDescription: string | null;
  liningComposition: string | null;
  sizes: string | null;
  quantity: number;
  workPricePerUnit: number;
  retailPrice: number | null;
  workOrderNumber: string | null;
  colorName: string | null;
  lines: PlanLine[];
};
type Plan = {
  suppliers: { key: string; name: string }[];
  materials: string[];
  purchases: PlanPurchase[];
  productionOrders: PlanProductionOrder[];
};

const VAT_RATE = new Decimal(22);
const IMPORT_TAG = "bulk-import-registry-2026-09";

// Quantities/prices in import_plan.json passed through Python float math and
// JSON round-tripping, which can leave 1e-15-scale noise (e.g. 6.2 becomes
// 6.200000000000001). The schema stores quantities at 3 decimal places, so
// round here to avoid spurious "insufficient stock" failures from noise well
// below that precision.
function qty(n: number): Decimal {
  return new Decimal(n.toFixed(3));
}

async function main() {
  const plan: Plan = JSON.parse(readFileSync(join(__dirname, "import_plan.json"), "utf-8"));

  const org = await prisma.organization.findFirstOrThrow();
  const organizationId = org.id;
  const warehouse = await prisma.warehouse.findFirstOrThrow({
    where: { organizationId, isDefault: true },
  });
  const warehouseId = warehouse.id;

  console.log(`Org: ${org.name} (${organizationId}), warehouse: ${warehouse.name}`);

  // ---------- Suppliers ----------
  const supplierIdByKey = new Map<string, string>();
  for (const s of plan.suppliers) {
    const existing = await prisma.supplier.findFirst({ where: { organizationId, name: s.name } });
    if (existing) {
      supplierIdByKey.set(s.key, existing.id);
    } else {
      const created = await prisma.supplier.create({ data: { organizationId, name: s.name } });
      supplierIdByKey.set(s.key, created.id);
      console.log(`Created supplier: ${s.name}`);
    }
  }

  // ---------- Raw materials (created lazily as encountered, name-keyed) ----------
  const materialIdByName = new Map<string, string>();
  async function getOrCreateMaterial(name: string, unit: "PIECE" | "M"): Promise<string> {
    const cached = materialIdByName.get(name);
    if (cached) return cached;
    const existing = await prisma.rawMaterial.findFirst({ where: { organizationId, name } });
    if (existing) {
      materialIdByName.set(name, existing.id);
      return existing.id;
    }
    const created = await prisma.rawMaterial.create({ data: { organizationId, name, unit } });
    materialIdByName.set(name, created.id);
    return created.id;
  }

  // ---------- Purchases + lots ----------
  const lotIdByNumber = new Map<string, string>();
  let purchasesCreated = 0;
  let lotsCreated = 0;

  for (const p of plan.purchases) {
    const existingPurchase = await prisma.purchase.findFirst({
      where: { organizationId, notes: `${IMPORT_TAG}:${p.key}` },
      include: { items: { include: { lot: true } } },
    });
    if (existingPurchase) {
      for (const item of existingPurchase.items) {
        if (item.lotNumber && item.lot) lotIdByNumber.set(item.lotNumber, item.lot.id);
      }
      continue;
    }

    const supplierId = supplierIdByKey.get(p.supplierKey);
    if (!supplierId) throw new Error(`Unknown supplier key ${p.supplierKey}`);

    await prisma.$transaction(
      async (tx) => {
        const number = await nextDocumentNumber(tx, "purchase", organizationId, "З");
        const purchase = await tx.purchase.create({
          data: {
            organizationId,
            number,
            supplierId,
            warehouseId,
            status: "RECEIVED",
            currency: "RUB",
            exchangeRate: 1,
            auctionSession: p.auctionSession,
            invoiceNumber: p.invoiceNumber,
            transferDocument: p.transferDocument,
            orderDate: new Date(p.orderDate),
            receivedDate: new Date(p.orderDate),
            notes: `${IMPORT_TAG}:${p.key}`,
          },
        });

        for (const lot of p.lots) {
          const unit = lot.materialName.startsWith("Подкладочная") ? "M" : "PIECE";
          const rawMaterialId = await getOrCreateMaterial(lot.materialName, unit);

          const unitCostInclVat = new Decimal(lot.unitCostInclVat);
          const quantity = qty(lot.quantityReceived);
          const materialCostExclVat = unitCostInclVat.div(VAT_RATE.div(100).add(1));
          const materialVatAmount = unitCostInclVat.sub(materialCostExclVat);
          const totalCost = unitCostInclVat.mul(quantity);

          const item = await tx.purchaseItem.create({
            data: {
              purchaseId: purchase.id,
              rawMaterialId,
              quantity,
              unitPrice: materialCostExclVat,
              subtotal: materialCostExclVat.mul(quantity),
              vatRate: VAT_RATE,
              lotNumber: lot.lotNumber,
            },
          });

          const created = await createRawMaterialLot(tx, {
            organizationId,
            warehouseId,
            rawMaterialId,
            lotNumber: lot.lotNumber,
            grade: null,
            color: null,
            quantity,
            unitCost: unitCostInclVat,
            totalCost,
            vatRate: VAT_RATE,
            materialCostExclVat,
            materialVatAmount,
            purchaseId: purchase.id,
            purchaseItemId: item.id,
          });
          lotIdByNumber.set(lot.lotNumber, created.id);
          lotsCreated++;
        }
      },
      { timeout: 30000 }
    );
    purchasesCreated++;
  }

  console.log(`Purchases created: ${purchasesCreated}, lots created: ${lotsCreated}, lots known: ${lotIdByNumber.size}`);

  // ---------- Production orders ----------
  const productModelIdByArticle = new Map<string, string>();
  let ordersCreated = 0;
  let ordersSkipped = 0;

  for (const po of plan.productionOrders) {
    const tag = `${IMPORT_TAG}:row-${po.headerRow}`;
    const existing = await prisma.productionOrder.findFirst({ where: { organizationId, notes: tag } });
    if (existing) {
      ordersSkipped++;
      continue;
    }

    let productModelId = productModelIdByArticle.get(po.article);
    if (!productModelId) {
      const existingModel = await prisma.productModel.findFirst({ where: { organizationId, name: po.article } });
      if (existingModel) {
        productModelId = existingModel.id;
        if (!existingModel.sellingPrice && po.retailPrice) {
          await prisma.productModel.update({
            where: { id: existingModel.id },
            data: { sellingPrice: new Decimal(po.retailPrice) },
          });
        }
      } else {
        const created = await prisma.productModel.create({
          data: {
            organizationId,
            name: po.article,
            category: po.productType ?? undefined,
            sellingPrice: po.retailPrice ? new Decimal(po.retailPrice) : undefined,
          },
        });
        productModelId = created.id;
      }
      productModelIdByArticle.set(po.article, productModelId);
    }

    const lotsForOrder = po.lines.map((l) => ({
      lotId: lotIdByNumber.get(l.lotNumber),
      quantity: qty(l.quantity),
      lotNumber: l.lotNumber,
    }));
    const missing = lotsForOrder.filter((l) => !l.lotId);
    if (missing.length > 0) {
      console.error(`Row ${po.headerRow} (${po.article}): missing lots`, missing.map((m) => m.lotNumber));
      continue;
    }

    try {
      await prisma.$transaction(
        async (tx) => {
          const number = await nextDocumentNumber(tx, "productionOrder", organizationId, "П");
          const order = await tx.productionOrder.create({
            data: {
              organizationId,
              number,
              productModelId: productModelId!,
              rawWarehouseId: warehouseId,
              finishedWarehouseId: warehouseId,
              status: "PLANNED",
              plannedQuantity: qty(po.quantity),
              size: po.sizes ?? undefined,
              color: po.colorName ?? undefined,
              materialDescription: po.materialDescription ?? undefined,
              lining: po.liningComposition ?? undefined,
              workOrderNumber: po.workOrderNumber ?? undefined,
              clientWorkPricePerUnit: po.workPricePerUnit ? new Decimal(po.workPricePerUnit) : undefined,
              retailPrice: po.retailPrice ? new Decimal(po.retailPrice) : undefined,
              notes: tag,
            },
          });

          let materialCost = new Decimal(0);
          for (const line of lotsForOrder) {
            const { unitCost, totalCost, rawMaterialId } = await consumeFromLot(tx, {
              organizationId,
              lotId: line.lotId!,
              quantity: line.quantity,
              productionOrderId: order.id,
            });
            await tx.productionMaterialUsage.create({
              data: {
                productionOrderId: order.id,
                rawMaterialId,
                lotId: line.lotId!,
                quantity: line.quantity,
                unitCost,
                totalCost,
              },
            });
            materialCost = materialCost.add(totalCost);
          }

          const producedQuantity = qty(po.quantity);
          const totalCost = materialCost;
          const unitCost = totalCost.div(producedQuantity);

          await tx.productionOrder.update({
            where: { id: order.id },
            data: {
              status: "COMPLETED",
              producedQuantity,
              materialCost,
              expenseCost: 0,
              totalCost,
              unitCost,
              endDate: new Date(),
            },
          });

          await receiveFinishedGoodsStock(tx, {
            organizationId,
            warehouseId,
            productModelId: productModelId!,
            quantity: producedQuantity,
            unitCost,
            totalCost,
            type: "PRODUCTION_IN",
            productionOrderId: order.id,
          });
        },
        { timeout: 30000 }
      );
      ordersCreated++;
    } catch (e) {
      console.error(`Row ${po.headerRow} (${po.article}) failed:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`Production orders created: ${ordersCreated}, skipped (already imported): ${ordersSkipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
