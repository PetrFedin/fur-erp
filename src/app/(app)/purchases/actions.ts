"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { createRawMaterialLot } from "@/lib/stock";
import { nextDocumentNumber } from "@/lib/numbering";
import { Decimal } from "@prisma/client/runtime/library";

const EDIT_ROLES = ["OWNER", "ADMIN", "PURCHASER"] as const;
const WAREHOUSE_ROLES = ["OWNER", "ADMIN", "PURCHASER", "WAREHOUSE"] as const;

export type FormState = { error?: string };

// ---------- Purchase header ----------

const purchaseSchema = z.object({
  supplierId: z.string().min(1, "Выберите поставщика"),
  warehouseId: z.string().min(1, "Выберите склад"),
  currency: z.string().trim().min(1).default("RUB"),
  exchangeRate: z.coerce.number().positive("Курс должен быть больше 0").default(1),
  auctionSession: z.string().trim().optional(),
  invoiceNumber: z.string().trim().optional(),
  transferDocument: z.string().trim().optional(),
  orderDate: z.string().min(1),
  expectedDate: z.string().optional(),
  notes: z.string().trim().optional(),
});

export async function createPurchase(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = purchaseSchema.safeParse({
    supplierId: formData.get("supplierId"),
    warehouseId: formData.get("warehouseId"),
    currency: formData.get("currency") || "RUB",
    exchangeRate: formData.get("exchangeRate") || 1,
    auctionSession: formData.get("auctionSession") || undefined,
    invoiceNumber: formData.get("invoiceNumber") || undefined,
    transferDocument: formData.get("transferDocument") || undefined,
    orderDate: formData.get("orderDate"),
    expectedDate: formData.get("expectedDate") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const purchase = await prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, "purchase", session.user.organizationId, "З");
    return tx.purchase.create({
      data: {
        organizationId: session.user.organizationId,
        number,
        supplierId: parsed.data.supplierId,
        warehouseId: parsed.data.warehouseId,
        currency: parsed.data.currency,
        exchangeRate: parsed.data.currency === "RUB" ? 1 : parsed.data.exchangeRate,
        auctionSession: parsed.data.auctionSession,
        invoiceNumber: parsed.data.invoiceNumber,
        transferDocument: parsed.data.transferDocument,
        orderDate: new Date(parsed.data.orderDate),
        expectedDate: parsed.data.expectedDate ? new Date(parsed.data.expectedDate) : undefined,
        notes: parsed.data.notes,
        createdById: session.user.id,
      },
    });
  });

  revalidatePath("/purchases");
  redirect(`/purchases/${purchase.id}`);
}

export async function updatePurchaseExchangeRate(purchaseId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const rate = z.coerce.number().positive().safeParse(formData.get("exchangeRate"));
  if (!rate.success) return;

  await prisma.purchase.updateMany({
    where: { id: purchaseId, organizationId: session.user.organizationId, status: { notIn: ["RECEIVED", "CANCELLED"] } },
    data: { exchangeRate: rate.data },
  });
  revalidatePath(`/purchases/${purchaseId}`);
}

export async function setPurchaseStatus(
  purchaseId: string,
  status: "DRAFT" | "ORDERED" | "IN_TRANSIT" | "CANCELLED"
) {
  const session = await requireRole(...EDIT_ROLES);
  await prisma.purchase.updateMany({
    where: {
      id: purchaseId,
      organizationId: session.user.organizationId,
      status: { notIn: ["RECEIVED", "CANCELLED"] },
    },
    data: { status },
  });
  revalidatePath(`/purchases/${purchaseId}`);
}

// ---------- Line items ----------

const itemSchema = z.object({
  rawMaterialId: z.string().min(1, "Выберите сырьё"),
  quantity: z.coerce.number().positive("Количество должно быть больше 0"),
  unitPrice: z.coerce.number().nonnegative("Цена не может быть отрицательной"),
  vatRate: z.coerce.number().min(0, "Ставка НДС не может быть отрицательной").max(100, "Некорректная ставка НДС"),
  lotNumber: z.string().trim().optional(),
  grade: z.string().trim().optional(),
  color: z.string().trim().optional(),
});

export async function addPurchaseItem(purchaseId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) return;

  const parsed = itemSchema.safeParse({
    rawMaterialId: formData.get("rawMaterialId"),
    quantity: formData.get("quantity"),
    unitPrice: formData.get("unitPrice"),
    vatRate: formData.get("vatRate") ?? 20,
    lotNumber: formData.get("lotNumber") || undefined,
    grade: formData.get("grade") || undefined,
    color: formData.get("color") || undefined,
  });
  if (!parsed.success) return;

  const subtotal = new Decimal(parsed.data.quantity).mul(parsed.data.unitPrice);

  await prisma.purchaseItem.create({
    data: {
      purchaseId,
      rawMaterialId: parsed.data.rawMaterialId,
      quantity: parsed.data.quantity,
      unitPrice: parsed.data.unitPrice,
      subtotal,
      vatRate: parsed.data.vatRate,
      lotNumber: parsed.data.lotNumber,
      grade: parsed.data.grade,
      color: parsed.data.color,
    },
  });

  revalidatePath(`/purchases/${purchaseId}`);
}

// Bulk entry: paste rows copied straight from a spreadsheet (tab- or
// multi-space-separated) instead of filling the single-item form N times —
// real purchases here run 10-160+ lots each. Columns, in order: Материал,
// Кол-во, Цена без НДС, НДС% (optional, default 20), Лот, Сорт, Цвет.
// Material is matched by exact name (case-insensitive); unmatched names
// create a new RawMaterial rather than failing the row, since that's the
// same "find or create" behavior the historical-data import scripts use.
export type BulkFormState = { error?: string; created?: number; skipped?: string[] };

export async function addPurchaseItemsBulk(
  purchaseId: string,
  _prev: BulkFormState,
  formData: FormData
): Promise<BulkFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) return { error: "Закупку нельзя редактировать" };

  const raw = (formData.get("rows") as string | null)?.trim();
  if (!raw) return { error: "Вставьте хотя бы одну строку" };

  const materials = await prisma.rawMaterial.findMany({
    where: { organizationId: session.user.organizationId },
    select: { id: true, name: true },
  });
  const materialByName = new Map(materials.map((m) => [m.name.trim().toLowerCase(), m.id]));

  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const rows: {
    rawMaterialId: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    lotNumber?: string;
    grade?: string;
    color?: string;
  }[] = [];
  const skipped: string[] = [];

  for (const line of lines) {
    const cells = line.split("\t").length > 1 ? line.split("\t") : line.split(/ {2,}/);
    const [materialName, quantityRaw, unitPriceRaw, vatRateRaw, lotNumber, grade, color] = cells.map((c) =>
      c?.trim()
    );
    const quantity = Number((quantityRaw ?? "").replace(",", "."));
    const unitPrice = Number((unitPriceRaw ?? "").replace(",", "."));
    const vatRate = vatRateRaw ? Number(vatRateRaw.replace(",", ".").replace("%", "")) : 20;

    if (!materialName || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      skipped.push(line);
      continue;
    }

    let rawMaterialId = materialByName.get(materialName.toLowerCase());
    if (!rawMaterialId) {
      const created = await prisma.rawMaterial.create({
        data: { organizationId: session.user.organizationId, name: materialName, unit: "PIECE" },
      });
      rawMaterialId = created.id;
      materialByName.set(materialName.toLowerCase(), rawMaterialId);
    }

    rows.push({
      rawMaterialId,
      quantity,
      unitPrice,
      vatRate: Number.isFinite(vatRate) ? vatRate : 20,
      lotNumber: lotNumber || undefined,
      grade: grade || undefined,
      color: color || undefined,
    });
  }

  if (rows.length === 0) return { error: "Не удалось разобрать ни одной строки", skipped };

  await prisma.purchaseItem.createMany({
    data: rows.map((r) => ({
      purchaseId,
      rawMaterialId: r.rawMaterialId,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      subtotal: new Decimal(r.quantity).mul(r.unitPrice),
      vatRate: r.vatRate,
      lotNumber: r.lotNumber,
      grade: r.grade,
      color: r.color,
    })),
  });

  revalidatePath(`/purchases/${purchaseId}`);
  return { created: rows.length, skipped: skipped.length ? skipped : undefined };
}

// Editing an already-entered line item — the main fix for wrong quantity/price/
// lot/grade/color caught after the fact (very common on bulk-pasted rows).
// Before receipt there's no RawMaterialLot yet, so everything is a plain update.
// After receipt (purchase.status === "RECEIVED"), a RawMaterialLot exists and
// may already have been consumed by production:
//  - raw material identity is never changeable post-receipt (would orphan the
//    lot's own material link and any StockMovement rows already logged against it);
//  - cosmetic fields (lot number, grade, color) stay editable regardless of
//    consumption — they don't affect cost or quantity math;
//  - quantity/price/VAT stay editable ONLY while the lot is fully unconsumed
//    (quantityRemaining === quantityReceived); once any of it has been drawn
//    into production the edit is blocked with a clear message rather than
//    trying to unwind and re-cost historical StockMovement/ProductionMaterialUsage
//    rows, which is out of scope for a single-line correction.
export async function updatePurchaseItem(
  purchaseId: string,
  itemId: string,
  formData: FormData
): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);

  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId: session.user.organizationId },
  });
  if (!purchase) return { error: "Закупка не найдена" };
  if (purchase.status === "CANCELLED") return { error: "Закупка отменена" };

  const item = await prisma.purchaseItem.findFirst({
    where: { id: itemId, purchaseId },
    include: { lot: true },
  });
  if (!item) return { error: "Позиция не найдена" };

  const parsed = itemSchema.safeParse({
    rawMaterialId: formData.get("rawMaterialId"),
    quantity: formData.get("quantity"),
    unitPrice: formData.get("unitPrice"),
    vatRate: formData.get("vatRate") ?? 20,
    lotNumber: formData.get("lotNumber") || undefined,
    grade: formData.get("grade") || undefined,
    color: formData.get("color") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  // Read these straight off formData (not parsed.data): itemSchema's
  // `.optional()` treats a blank field as "not specified" (right for
  // addPurchaseItem, where blank means "leave unset"), but on an edit blank
  // means "clear this field" — so an empty string here must become `null`,
  // not `undefined` (which Prisma reads as "don't touch").
  const cosmetic = {
    lotNumber: (formData.get("lotNumber") as string)?.trim() || null,
    grade: (formData.get("grade") as string)?.trim() || null,
    color: (formData.get("color") as string)?.trim() || null,
  };

  // Not yet received: no lot exists — every field is freely editable, same
  // validation as adding a fresh line.
  if (purchase.status !== "RECEIVED") {
    const subtotal = new Decimal(parsed.data.quantity).mul(parsed.data.unitPrice);
    await prisma.purchaseItem.update({
      where: { id: itemId },
      data: {
        rawMaterialId: parsed.data.rawMaterialId,
        quantity: parsed.data.quantity,
        unitPrice: parsed.data.unitPrice,
        subtotal,
        vatRate: parsed.data.vatRate,
        ...cosmetic,
      },
    });
    revalidatePath(`/purchases/${purchaseId}`);
    return {};
  }

  // Received: material identity is locked in.
  if (parsed.data.rawMaterialId !== item.rawMaterialId) {
    return { error: "После оприходования нельзя изменить сырьё позиции" };
  }

  const financialsChanged =
    !new Decimal(parsed.data.quantity).eq(item.quantity) ||
    !new Decimal(parsed.data.unitPrice).eq(item.unitPrice) ||
    !new Decimal(parsed.data.vatRate).eq(item.vatRate);

  const lot = item.lot;

  if (!financialsChanged) {
    // Cosmetic-only edit — always safe, even on a fully consumed lot.
    await prisma.$transaction([
      prisma.purchaseItem.update({ where: { id: itemId }, data: cosmetic }),
      ...(lot ? [prisma.rawMaterialLot.update({ where: { id: lot.id }, data: cosmetic })] : []),
    ]);
    revalidatePath(`/purchases/${purchaseId}`);
    revalidatePath("/lots");
    return {};
  }

  if (!lot) return { error: "У позиции нет партии сырья на складе — обратитесь к администратору" };
  if (!lot.quantityRemaining.equals(lot.quantityReceived)) {
    const used = lot.quantityReceived.sub(lot.quantityRemaining);
    return {
      error: `Нельзя изменить количество/цену/НДС — сырьё уже списано в производство (${used.toString()} ед. использовано). Доступно изменить только лот, сорт и цвет.`,
    };
  }

  // Unconsumed lot: recompute this item's own landed cost the same way
  // receivePurchase does, holding the RUB amount of expenses this item was
  // allocated at receipt time fixed (re-splitting expenses across every other
  // item in the purchase would mean touching their lots too — out of scope
  // for a single-line edit).
  const grossUp = (base: Decimal, vatRate: Decimal) => base.add(base.mul(vatRate).div(100));
  const oldBaseRub = item.subtotal.mul(purchase.exchangeRate);
  const oldInclVatRub = grossUp(oldBaseRub, item.vatRate);
  const allocatedExpense = lot.totalCost.sub(oldInclVatRub);

  const newQuantity = new Decimal(parsed.data.quantity);
  const newVatRate = new Decimal(parsed.data.vatRate);
  const newSubtotal = newQuantity.mul(parsed.data.unitPrice);
  const newBaseRub = newSubtotal.mul(purchase.exchangeRate);
  const newInclVatRub = grossUp(newBaseRub, newVatRate);
  const newLandedTotal = newInclVatRub.add(allocatedExpense);
  const newUnitCost = newLandedTotal.div(newQuantity);

  await prisma.$transaction([
    prisma.purchaseItem.update({
      where: { id: itemId },
      data: {
        quantity: parsed.data.quantity,
        unitPrice: parsed.data.unitPrice,
        subtotal: newSubtotal,
        vatRate: parsed.data.vatRate,
        ...cosmetic,
      },
    }),
    prisma.rawMaterialLot.update({
      where: { id: lot.id },
      data: {
        quantityReceived: newQuantity,
        quantityRemaining: newQuantity,
        unitCost: newUnitCost,
        totalCost: newLandedTotal,
        vatRate: parsed.data.vatRate,
        materialCostExclVat: newBaseRub.div(newQuantity),
        materialVatAmount: newInclVatRub.sub(newBaseRub).div(newQuantity),
        ...cosmetic,
      },
    }),
    prisma.stockMovement.updateMany({
      where: { lotId: lot.id, type: "PURCHASE_IN" },
      data: { quantity: newQuantity, unitCost: newUnitCost, totalCost: newLandedTotal },
    }),
  ]);

  revalidatePath(`/purchases/${purchaseId}`);
  revalidatePath("/lots");
  return {};
}

export async function removePurchaseItem(purchaseId: string, itemId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) return;

  await prisma.purchaseItem.delete({ where: { id: itemId } });
  revalidatePath(`/purchases/${purchaseId}`);
}

// ---------- Expenses ----------

const expenseSchema = z.object({
  categoryId: z.string().min(1, "Выберите статью расходов"),
  amount: z.coerce.number().positive("Сумма должна быть больше 0"),
  vatRate: z.coerce.number().min(0, "Ставка НДС не может быть отрицательной").max(100, "Некорректная ставка НДС"),
  description: z.string().trim().optional(),
});

export async function addPurchaseExpense(purchaseId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) return;

  const parsed = expenseSchema.safeParse({
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    vatRate: formData.get("vatRate") ?? 0,
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return;

  await prisma.purchaseExpense.create({
    data: { purchaseId, ...parsed.data },
  });

  revalidatePath(`/purchases/${purchaseId}`);
}

export async function removePurchaseExpense(purchaseId: string, expenseId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) return;

  await prisma.purchaseExpense.delete({ where: { id: expenseId } });
  revalidatePath(`/purchases/${purchaseId}`);
}

// ---------- Payments ----------

const paymentSchema = z.object({
  amount: z.coerce.number().positive("Сумма должна быть больше 0"),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]),
  paidAt: z.string().min(1),
  notes: z.string().trim().optional(),
});

export async function addPurchasePayment(purchaseId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId: session.user.organizationId },
  });
  if (!purchase) return;

  const parsed = paymentSchema.safeParse({
    amount: formData.get("amount"),
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return;

  await prisma.payment.create({
    data: {
      organizationId: session.user.organizationId,
      supplierId: purchase.supplierId,
      purchaseId,
      amount: parsed.data.amount,
      currency: purchase.currency,
      method: parsed.data.method,
      status: "COMPLETED",
      paidAt: new Date(parsed.data.paidAt),
      notes: parsed.data.notes,
    },
  });

  revalidatePath(`/purchases/${purchaseId}`);
  revalidatePath("/payments");
}

// ---------- Receiving: this is where landed cost + stock-in happens ----------

export async function receivePurchase(purchaseId: string): Promise<FormState> {
  const session = await requireRole(...WAREHOUSE_ROLES);

  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId: session.user.organizationId },
    include: { items: true, expenses: true },
  });
  if (!purchase) return { error: "Закупка не найдена" };
  if (purchase.status === "RECEIVED") return { error: "Закупка уже оприходована" };
  if (purchase.status === "CANCELLED") return { error: "Закупка отменена" };
  if (purchase.items.length === 0) return { error: "В закупке нет позиций сырья" };

  // Item prices and expense amounts are entered EXCLUDING VAT; each line
  // carries its own rate since it varies lot to lot (the rate in force
  // changes over time — 20% and 22% both appear in the same registry).
  // Expenses are always in RUB; item prices are in the purchase's currency
  // and get converted here. Everything is grossed up to VAT-inclusive RUB,
  // expenses are allocated across items proportionally by their inclusive
  // subtotal share, and rolled into that item's lot as a fixed landed cost
  // — see src/lib/stock.ts.
  const grossUp = (base: Decimal, vatRate: Decimal) => base.add(base.mul(vatRate).div(100));

  const totalExpensesInclVat = purchase.expenses.reduce(
    (sum, e) => sum.add(grossUp(e.amount, e.vatRate)),
    new Decimal(0)
  );
  const itemsInclVatRub = purchase.items.map((item) => {
    const baseRub = item.subtotal.mul(purchase.exchangeRate);
    return { item, baseRub, inclVatRub: grossUp(baseRub, item.vatRate) };
  });
  const totalItemsInclVatRub = itemsInclVatRub.reduce((sum, i) => sum.add(i.inclVatRub), new Decimal(0));

  await prisma.$transaction(async (tx) => {
    for (const { item, baseRub, inclVatRub } of itemsInclVatRub) {
      const allocatedExpense = totalItemsInclVatRub.isZero()
        ? new Decimal(0)
        : totalExpensesInclVat.mul(inclVatRub).div(totalItemsInclVatRub);
      const landedTotal = inclVatRub.add(allocatedExpense);

      await createRawMaterialLot(tx, {
        organizationId: session.user.organizationId,
        warehouseId: purchase.warehouseId,
        rawMaterialId: item.rawMaterialId,
        lotNumber: item.lotNumber,
        grade: item.grade,
        color: item.color,
        quantity: item.quantity,
        unitCost: landedTotal.div(item.quantity),
        totalCost: landedTotal,
        vatRate: item.vatRate,
        materialCostExclVat: baseRub.div(item.quantity),
        materialVatAmount: inclVatRub.sub(baseRub).div(item.quantity),
        purchaseId: purchase.id,
        purchaseItemId: item.id,
      });
    }

    await tx.purchase.update({
      where: { id: purchase.id },
      data: { status: "RECEIVED", receivedDate: new Date() },
    });
  });

  revalidatePath(`/purchases/${purchaseId}`);
  revalidatePath("/lots");
  revalidatePath("/purchases");
  return {};
}

async function getEditablePurchase(organizationId: string, purchaseId: string) {
  return prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId, status: { notIn: ["RECEIVED", "CANCELLED"] } },
  });
}
