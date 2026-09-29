/**
 * Imports the FW26 season purchase report
 * (08_06_2026_Отчет_по_закупке_мехового_сырья_MVST.xlsx, sheet "закупка FW26")
 * into the app database. Reads scripts/fw26_plan.json (pre-resolved by a
 * Python script from the raw xlsx — not checked in).
 *
 * Four lot numbers (355159, 165270, 500083, 300687) were already present in
 * the DB as rough placeholders from the historical registry import (that
 * file referenced them in production but had no purchase record for them —
 * see README's "orphan lots" note). Their unitCost here matches exactly, so
 * for those we UPDATE the existing lot's quantityReceived/quantityRemaining
 * instead of inserting a duplicate. Four other lot numbers (30, 32, 33,
 * 1525) collide with *different*, unrelated lots already in the DB from an
 * earlier season (same numbering scheme reused) — those are inserted fresh
 * with an "FW26-" prefix to avoid ambiguity on the lot-number search.
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/import-fw26.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();
type Tx = Prisma.TransactionClient;

async function nextDocumentNumber(tx: Tx, organizationId: string, prefix: string) {
  const year = new Date().getFullYear();
  const count = await tx.purchase.count({ where: { organizationId } });
  return `${prefix}-${year}-${String(count + 1).padStart(4, "0")}`;
}

const VAT_RATE = new Decimal(22);
const IMPORT_TAG = "import-fw26-2026-09";

function qty(n: number): Decimal {
  return new Decimal(n.toFixed(3));
}
function money(n: number): Decimal {
  return new Decimal(n.toFixed(2));
}

type PlanLot = { lotNumber: string; materialName: string; quantity: number; unitCostInclVat: number };
type PlanPurchase = {
  key: string;
  supplierName: string;
  auctionSession: string;
  invoiceNumber: string;
  orderDate: string;
  lots: PlanLot[];
};

async function main() {
  const plan: { purchases: PlanPurchase[] } = JSON.parse(
    readFileSync(join(__dirname, "fw26_plan.json"), "utf-8")
  );

  const org = await prisma.organization.findFirstOrThrow();
  const organizationId = org.id;
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { organizationId, isDefault: true } });
  const warehouseId = warehouse.id;

  const supplierIdByName = new Map<string, string>();
  async function getOrCreateSupplier(name: string): Promise<string> {
    const cached = supplierIdByName.get(name);
    if (cached) return cached;
    const existing = await prisma.supplier.findFirst({ where: { organizationId, name } });
    if (existing) {
      supplierIdByName.set(name, existing.id);
      return existing.id;
    }
    const created = await prisma.supplier.create({ data: { organizationId, name } });
    supplierIdByName.set(name, created.id);
    console.log(`Created supplier: ${name}`);
    return created.id;
  }

  const materialIdByName = new Map<string, string>();
  async function getOrCreateMaterial(name: string): Promise<string> {
    const cached = materialIdByName.get(name);
    if (cached) return cached;
    const existing = await prisma.rawMaterial.findFirst({ where: { organizationId, name } });
    if (existing) {
      materialIdByName.set(name, existing.id);
      return existing.id;
    }
    const created = await prisma.rawMaterial.create({ data: { organizationId, name, unit: "PIECE" } });
    materialIdByName.set(name, created.id);
    return created.id;
  }

  let purchasesCreated = 0;
  let lotsInserted = 0;
  let lotsUpdated = 0;
  let lotsPrefixedForCollision = 0;

  for (const p of plan.purchases) {
    const tag = `${IMPORT_TAG}:${p.key}`;
    const existingPurchase = await prisma.purchase.findFirst({ where: { organizationId, notes: tag } });
    if (existingPurchase) continue;

    const supplierId = await getOrCreateSupplier(p.supplierName);

    await prisma.$transaction(
      async (tx) => {
        const number = await nextDocumentNumber(tx, organizationId, "З");
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
            orderDate: new Date(p.orderDate),
            receivedDate: new Date(p.orderDate),
            notes: tag,
          },
        });

        for (const lot of p.lots) {
          const existingLot = await tx.rawMaterialLot.findFirst({
            where: { organizationId, lotNumber: lot.lotNumber },
          });

          const unitCostInclVat = money(lot.unitCostInclVat);

          if (existingLot && existingLot.unitCost.sub(unitCostInclVat).abs().lessThan(1)) {
            // Same physical lot, previously entered with only its consumed
            // quantity (no purchase record existed for it yet). Correct the
            // received/remaining quantity now that we have the real number.
            const trueQuantity = qty(lot.quantity);
            const delta = trueQuantity.sub(existingLot.quantityReceived);
            if (delta.greaterThan(0)) {
              await tx.rawMaterialLot.update({
                where: { id: existingLot.id },
                data: {
                  quantityReceived: trueQuantity,
                  quantityRemaining: existingLot.quantityRemaining.add(delta),
                  purchaseId: purchase.id,
                },
              });
              await tx.stockMovement.create({
                data: {
                  organizationId,
                  warehouseId: existingLot.warehouseId,
                  rawMaterialId: existingLot.rawMaterialId,
                  lotId: existingLot.id,
                  type: "ADJUSTMENT_IN",
                  quantity: delta,
                  unitCost: existingLot.unitCost,
                  totalCost: existingLot.unitCost.mul(delta),
                  purchaseId: purchase.id,
                  notes: "Уточнение остатка по данным отчёта FW26 (лот заведён ранее без закупки)",
                },
              });
            }
            lotsUpdated++;
            continue;
          }

          let lotNumber = lot.lotNumber;
          if (existingLot) {
            // Same lot number, different lot (numbering reused across seasons).
            lotNumber = `FW26-${lot.lotNumber}`;
            lotsPrefixedForCollision++;
          }

          const rawMaterialId = await getOrCreateMaterial(lot.materialName);
          const quantity = qty(lot.quantity);
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
              lotNumber,
            },
          });

          const created = await tx.rawMaterialLot.create({
            data: {
              organizationId,
              warehouseId,
              rawMaterialId,
              lotNumber,
              grade: null,
              color: null,
              quantityReceived: quantity,
              quantityRemaining: quantity,
              unitCost: unitCostInclVat,
              totalCost,
              vatRate: VAT_RATE,
              materialCostExclVat,
              materialVatAmount,
              purchaseId: purchase.id,
            },
          });

          await tx.purchaseItem.update({ where: { id: item.id }, data: { lotId: created.id } });

          await tx.stockMovement.create({
            data: {
              organizationId,
              warehouseId,
              rawMaterialId,
              lotId: created.id,
              type: "PURCHASE_IN",
              quantity,
              unitCost: unitCostInclVat,
              totalCost,
              purchaseId: purchase.id,
            },
          });
          lotsInserted++;
        }
      },
      { timeout: 30000 }
    );
    purchasesCreated++;
  }

  console.log(
    `Purchases created: ${purchasesCreated}, lots inserted: ${lotsInserted} (${lotsPrefixedForCollision} prefixed for number collision), lots updated (quantity correction): ${lotsUpdated}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
