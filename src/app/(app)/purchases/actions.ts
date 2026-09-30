"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { createRawMaterialLot, addOrPoolLiningLot } from "@/lib/stock";
import { nextDocumentNumber } from "@/lib/numbering";
import { Decimal } from "@prisma/client/runtime/library";
import { parsePasteRows, issueLines, type ParsedRow } from "./parse-rows";

const EDIT_ROLES = ["OWNER", "ADMIN", "PURCHASER"] as const;
const WAREHOUSE_ROLES = ["OWNER", "ADMIN", "PURCHASER", "WAREHOUSE"] as const;

export type OrderRef = { id: string; number: string; quantity: string };
export type Issue = { level: "error" | "warning"; text: string };
const UNIT_SHORT: Record<string, string> = { PIECE: "шт.", KG: "кг", M2: "м²", M: "м", SET: "компл." };

export type FormState = { error?: string; issues?: Issue[]; orders?: OrderRef[] };

// ---------- Purchase header ----------

const purchaseSchema = z.object({
  supplierId: z.string().optional(),
  warehouseId: z.string().optional(),
  currency: z.string().trim().min(1).default("RUB"),
  exchangeRate: z.coerce.number().positive("Курс должен быть больше 0").default(1),
  auctionSession: z.string().trim().optional(),
  invoiceNumber: z.string().trim().optional(),
  transferDocument: z.string().trim().optional(),
  orderDate: z.string().min(1, "Укажите дату"),
  expectedDate: z.string().optional(),
  notes: z.string().trim().optional(),
});

// Creates the purchase TOGETHER with the lines pasted from Excel, in one
// transaction — if any pasted line has an error nothing is written and the
// form keeps its fields. Supplier/warehouse may be omitted when the
// organization has exactly one of each (the form hides them then).
export async function createPurchase(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const parsed = purchaseSchema.safeParse({
    supplierId: formData.get("supplierId") || undefined,
    warehouseId: formData.get("warehouseId") || undefined,
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

  let supplierId = parsed.data.supplierId;
  if (!supplierId) {
    const suppliers = await prisma.supplier.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true } });
    if (suppliers.length !== 1) return { error: "Выберите поставщика" };
    supplierId = suppliers[0].id;
  }
  let warehouseId = parsed.data.warehouseId;
  if (!warehouseId) {
    const warehouses = await prisma.warehouse.findMany({ where: { organizationId: orgId }, select: { id: true } });
    if (warehouses.length !== 1) return { error: "Выберите склад" };
    warehouseId = warehouses[0].id;
  }
  const [supplierOk, warehouseOk] = await Promise.all([
    prisma.supplier.findFirst({ where: { id: supplierId, organizationId: orgId }, select: { id: true } }),
    prisma.warehouse.findFirst({ where: { id: warehouseId, organizationId: orgId }, select: { id: true } }),
  ]);
  if (!supplierOk) return { error: "Поставщик не найден" };
  if (!warehouseOk) return { error: "Склад не найден" };

  const rawRows = ((formData.get("rows") as string | null) ?? "").trim();
  let pasteRows: ParsedRow[] = [];
  let issues: Issue[] = [];
  if (rawRows) {
    const materials = await prisma.rawMaterial.findMany({ where: { organizationId: orgId }, select: { name: true } });
    const result = parsePasteRows(rawRows, materials.map((m) => m.name));
    issues = issueLines(result);
    if (result.errorCount > 0) {
      return { error: `Закупка не создана: ошибок в позициях — ${result.errorCount}. Исправьте строки ниже.`, issues };
    }
    pasteRows = result.rows;
  }

  const purchase = await prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, "purchase", orgId, "З");
    const created = await tx.purchase.create({
      data: {
        organizationId: orgId,
        number,
        supplierId,
        warehouseId,
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
    if (pasteRows.length > 0) await insertPasteRows(tx, orgId, created.id, pasteRows);
    return created;
  });

  revalidatePath("/purchases");
  redirect(`/purchases/${purchase.id}`);
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// Writes already-validated pasted lines; unknown materials are created
// (same find-or-create behaviour as the historical-import scripts).
async function insertPasteRows(tx: Tx, orgId: string, purchaseId: string, rows: ParsedRow[]) {
  const materials = await tx.rawMaterial.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
  const idByName = new Map(materials.map((m) => [m.name.trim().toLowerCase(), m.id]));
  for (const r of rows) {
    const key = r.materialName.toLowerCase();
    if (!idByName.has(key)) {
      const created = await tx.rawMaterial.create({
        data: { organizationId: orgId, name: r.materialName, unit: "PIECE" },
      });
      idByName.set(key, created.id);
    }
  }
  await tx.purchaseItem.createMany({
    data: rows.map((r) => ({
      purchaseId,
      rawMaterialId: idByName.get(r.materialName.toLowerCase())!,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      subtotal: new Decimal(r.quantity).mul(r.unitPrice),
      vatRate: r.vatRate,
      lotNumber: r.lotNumber,
      grade: r.grade,
      color: r.color,
    })),
  });
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

// Editing the purchase header itself — supplier, warehouse, auction session,
// order date, currency, invoice number, transfer document. Only while
// `editable` (not RECEIVED, not CANCELLED): once received, every line item's
// RawMaterialLot is already costed against this purchase's currency/
// exchangeRate at that moment (see receivePurchase) — changing supplier/
// warehouse/currency afterwards would silently desync already-costed lots
// from the purchase they claim to belong to. This mirrors the same
// `editable` gate the detail page already uses for item edits.
// exchangeRate keeps its own dedicated action (updatePurchaseExchangeRate)
// rather than being duplicated here — but changing `currency` here resets
// exchangeRate to 1 (or leaves it, for RUB) exactly like createPurchase does,
// since a stale rate carried over from a different currency is meaningless
// and must be re-entered.
const purchaseHeaderSchema = z.object({
  supplierId: z.string().min(1, "Выберите поставщика"),
  warehouseId: z.string().min(1, "Выберите склад"),
  currency: z.string().trim().min(1).default("RUB"),
  auctionSession: z.string().trim().optional(),
  invoiceNumber: z.string().trim().optional(),
  transferDocument: z.string().trim().optional(),
  orderDate: z.string().min(1),
});

export async function updatePurchase(purchaseId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);

  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) return { error: "Закупку нельзя редактировать — она уже принята на склад или отменена" };

  const parsed = purchaseHeaderSchema.safeParse({
    supplierId: formData.get("supplierId"),
    warehouseId: formData.get("warehouseId"),
    currency: formData.get("currency") || "RUB",
    auctionSession: formData.get("auctionSession") || undefined,
    invoiceNumber: formData.get("invoiceNumber") || undefined,
    transferDocument: formData.get("transferDocument") || undefined,
    orderDate: formData.get("orderDate"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const currencyChanged = parsed.data.currency !== purchase.currency;

  // Blank optional fields must clear rather than be left untouched — same
  // "read straight off formData" reasoning as updatePurchaseItem's `cosmetic`.
  const auctionSession = (formData.get("auctionSession") as string)?.trim() || null;
  const invoiceNumber = (formData.get("invoiceNumber") as string)?.trim() || null;
  const transferDocument = (formData.get("transferDocument") as string)?.trim() || null;

  await prisma.purchase.updateMany({
    where: { id: purchaseId, organizationId: session.user.organizationId, status: { notIn: ["RECEIVED", "CANCELLED"] } },
    data: {
      supplierId: parsed.data.supplierId,
      warehouseId: parsed.data.warehouseId,
      currency: parsed.data.currency,
      // Same pairing rule as createPurchase: RUB is always rate 1; a
      // currency change resets the rate to 1 so a stale rate from the old
      // currency can't leak through — the exchange-rate form forces re-entry.
      ...(currencyChanged ? { exchangeRate: 1 } : {}),
      auctionSession,
      invoiceNumber,
      transferDocument,
      orderDate: new Date(parsed.data.orderDate),
    },
  });

  revalidatePath(`/purchases/${purchaseId}`);
  return {};
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
  rawMaterialId: z.string().min(1, "Выберите материал"),
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

// Bulk entry into an existing draft: same paste format and parser as the
// "Новая закупка" form (see parse-rows.ts). All-or-nothing: any error in any
// line -> nothing is written, every problem is listed.
export type BulkFormState = { error?: string; created?: number; issues?: Issue[] };

export async function addPurchaseItemsBulk(
  purchaseId: string,
  _prev: BulkFormState,
  formData: FormData
): Promise<BulkFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const purchase = await getEditablePurchase(orgId, purchaseId);
  if (!purchase) return { error: "Закупку нельзя редактировать" };

  const raw = (formData.get("rows") as string | null)?.trim();
  if (!raw) return { error: "Вставьте хотя бы одну строку" };

  const materials = await prisma.rawMaterial.findMany({ where: { organizationId: orgId }, select: { name: true } });
  const result = parsePasteRows(raw, materials.map((m) => m.name));
  const issues = issueLines(result);
  if (result.errorCount > 0) {
    return { error: `Ничего не добавлено: ошибок в позициях — ${result.errorCount}.`, issues };
  }
  if (result.rows.length === 0) return { error: "Не удалось разобрать ни одной строки", issues };

  await prisma.$transaction((tx) => insertPasteRows(tx, orgId, purchaseId, result.rows));

  revalidatePath(`/purchases/${purchaseId}`);
  return { created: result.rows.length, issues: issues.length ? issues : undefined };
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
    include: { rawMaterial: { select: { unit: true } }, lot: { include: { purchaseItems: { select: { id: true } } } } },
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
    return { error: "После приёма на склад нельзя изменить материал позиции" };
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

  if (!lot) return { error: "У позиции нет лота на складе — обратитесь к администратору" };
  // A pooled lining lot (see addOrPoolLiningLot) has more than one
  // PurchaseItem feeding it once a second receipt has come in. The
  // quantity/price recompute below assumes this item's own quantity/price
  // maps 1:1 onto the lot's totals (true for fur, and for a lining lot's
  // very first receipt) — once the lot is shared, "this item's fixed
  // allocated expense" can no longer be isolated from the pool without
  // unwinding every other item's contribution too, which is out of scope
  // for a single-line edit. Block rather than silently mis-costing the pool.
  if (lot.purchaseItems.length > 1) {
    return {
      error:
        "Эта позиция входит в объединённый пул остатков ткани (несколько поступлений на один лот) — количество/цену/НДС менять нельзя. Доступно изменить только лот, сорт и цвет.",
    };
  }
  if (!lot.quantityRemaining.equals(lot.quantityReceived)) {
    const usages = await prisma.productionMaterialUsage.findMany({
      where: { lotId: lot.id },
      include: { productionOrder: { select: { id: true, number: true } } },
      orderBy: { date: "asc" },
    });
    const byOrder = new Map<string, OrderRef>();
    for (const u of usages) {
      const cur = byOrder.get(u.productionOrderId);
      byOrder.set(u.productionOrderId, {
        id: u.productionOrder.id,
        number: u.productionOrder.number,
        quantity: (cur ? new Decimal(cur.quantity) : new Decimal(0)).add(u.quantity).toString(),
      });
    }
    const orders = [...byOrder.values()];
    const unitLabel = UNIT_SHORT[item.rawMaterial.unit] ?? "";
    const lotName = lot.lotNumber ? `Лот ${lot.lotNumber}` : "Лот без номера";
    if (orders.length === 0) {
      const used = lot.quantityReceived.sub(lot.quantityRemaining);
      return {
        error: `${lotName} уже частично израсходован (${used.toString()} ед.). Количество, цену и НДС менять нельзя — доступны только лот, сорт и цвет.`,
      };
    }
    return {
      error: `${lotName} уже списан в ТЗ: ${orders
        .map((o) => `${o.number} (${new Decimal(o.quantity).toString()} ${unitLabel})`)
        .join(", ")}. Сначала удалите там списание.`,
      orders,
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
  // The allocated expense's own excl-VAT/VAT-amount split, as a fixed total
  // (old per-unit figure * old quantity) — held fixed exactly like
  // allocatedExpense itself, since we're not re-splitting expenses across
  // the purchase's other items here (see comment above).
  const allocatedExpenseExclVatTotal = lot.expenseCostExclVat.mul(lot.quantityReceived);
  const allocatedExpenseVatAmountTotal = lot.expenseVatAmount.mul(lot.quantityReceived);

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
        expenseCostExclVat: allocatedExpenseExclVatTotal.div(newQuantity),
        expenseVatAmount: allocatedExpenseVatAmountTotal.div(newQuantity),
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
    include: { items: { include: { rawMaterial: true } }, expenses: true },
  });
  if (!purchase) return { error: "Закупка не найдена" };
  if (purchase.status === "RECEIVED") return { error: "Закупка уже принята на склад" };
  if (purchase.status === "CANCELLED") return { error: "Закупка отменена" };
  if (purchase.items.length === 0) return { error: "В закупке нет позиций" };

  // Item prices and expense amounts are entered EXCLUDING VAT; each line
  // carries its own rate since it varies lot to lot (the rate in force
  // changes over time — 20% and 22% both appear in the same registry).
  // Expenses are always in RUB; item prices are in the purchase's currency
  // and get converted here. Everything is grossed up to VAT-inclusive RUB,
  // expenses are allocated across items proportionally by their inclusive
  // subtotal share, and rolled into that item's lot as a fixed landed cost
  // — see src/lib/stock.ts.
  const grossUp = (base: Decimal, vatRate: Decimal) => base.add(base.mul(vatRate).div(100));

  const totalExpensesExclVat = purchase.expenses.reduce((sum, e) => sum.add(e.amount), new Decimal(0));
  const totalExpensesInclVat = purchase.expenses.reduce(
    (sum, e) => sum.add(grossUp(e.amount, e.vatRate)),
    new Decimal(0)
  );
  // VAT amount of the total expense pool — used below to split each lot's
  // allocated share the same way materialCostExclVat/materialVatAmount
  // already split the item's own price. See RawMaterialLot.expenseCostExclVat
  // for why applying the item's allocation ratio to this split is exact.
  const totalExpensesVatAmount = totalExpensesInclVat.sub(totalExpensesExclVat);
  const itemsInclVatRub = purchase.items.map((item) => {
    const baseRub = item.subtotal.mul(purchase.exchangeRate);
    return { item, baseRub, inclVatRub: grossUp(baseRub, item.vatRate) };
  });
  const totalItemsInclVatRub = itemsInclVatRub.reduce((sum, i) => sum.add(i.inclVatRub), new Decimal(0));

  await prisma.$transaction(async (tx) => {
    for (const { item, baseRub, inclVatRub } of itemsInclVatRub) {
      // Same ratio drives both the inclusive allocation and its excl-VAT /
      // VAT-amount split — exact, since the ratio is applied uniformly to
      // the whole expense pool (excl + vat = incl by construction).
      const allocationRatio = totalItemsInclVatRub.isZero()
        ? new Decimal(0)
        : inclVatRub.div(totalItemsInclVatRub);
      const allocatedExpense = totalExpensesInclVat.mul(allocationRatio);
      const allocatedExpenseExclVat = totalExpensesExclVat.mul(allocationRatio);
      const allocatedExpenseVatAmount = totalExpensesVatAmount.mul(allocationRatio);
      const landedTotal = inclVatRub.add(allocatedExpense);

      const lotArgs = {
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
        expenseCostExclVat: allocatedExpenseExclVat.div(item.quantity),
        expenseVatAmount: allocatedExpenseVatAmount.div(item.quantity),
        purchaseId: purchase.id,
        purchaseItemId: item.id,
      };

      // Lining fabric (tracked by the metre) is one aggregate pool per
      // fabric, not one lot per receipt — see cfc5cd6 and
      // addOrPoolLiningLot's own comment. Fur (and every other unit) keeps
      // the original specific-identification behavior: a fresh lot every
      // time.
      if (item.rawMaterial.unit === "M") {
        await addOrPoolLiningLot(tx, lotArgs);
      } else {
        await createRawMaterialLot(tx, lotArgs);
      }
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

// ---------- Quick lining purchase ----------

export type LiningPurchaseState = { error?: string; ok?: string };

const liningSchema = z.object({
  materialId: z.string().optional(),
  newNumber: z.string().trim().optional(),
  meters: z.coerce.number({ message: "Укажите метры числом" }).positive("Метры должны быть больше 0").max(1_000_000, "Слишком большое количество метров"),
  pricePerMeter: z.coerce.number({ message: "Укажите цену за метр числом" }).min(0, "Цена не может быть отрицательной").max(10_000_000, "Слишком большая цена"),
  vatRate: z.coerce.number({ message: "НДС — число" }).min(0, "НДС не может быть отрицательным").max(100, "НДС не может быть больше 100%"),
  date: z.string().min(1, "Укажите дату"),
  invoiceNumber: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

// One-step lining purchase from «Сырьё → Подкладка»: creates a purchase with a
// single line and receives it into the warehouse straight away. Receiving goes
// through receivePurchase, which folds the metres into the fabric's single pool
// (addOrPoolLiningLot) with a weighted-average price. If anything fails after
// the purchase was written, the purchase (and a fabric created just now) is
// removed again so nothing half-done stays behind.
export async function addLiningPurchase(_prev: LiningPurchaseState, formData: FormData): Promise<LiningPurchaseState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const parsed = liningSchema.safeParse({
    materialId: formData.get("materialId") || undefined,
    newNumber: formData.get("newNumber") || undefined,
    meters: (formData.get("meters") as string | null)?.replace(",", ".") ?? "",
    pricePerMeter: (formData.get("pricePerMeter") as string | null)?.replace(",", ".") || "",
    vatRate: (formData.get("vatRate") as string | null)?.replace(",", ".") || 22,
    date: formData.get("date") || "",
    invoiceNumber: formData.get("invoiceNumber") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  const d = parsed.data;
  if (String(formData.get("pricePerMeter") ?? "").trim() === "") return { error: "Укажите цену за метр" };
  const orderDate = new Date(d.date);
  if (Number.isNaN(orderDate.getTime())) return { error: "Некорректная дата" };

  const [suppliers, warehouses] = await Promise.all([
    prisma.supplier.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true } }),
    prisma.warehouse.findMany({ where: { organizationId: orgId }, select: { id: true } }),
  ]);
  if (suppliers.length !== 1) return { error: "Не удалось определить поставщика: оформите закупку через раздел «Закупки»" };
  if (warehouses.length !== 1) return { error: "Не удалось определить склад: оформите закупку через раздел «Закупки»" };

  let material: { id: string } | null = null;
  let materialName = "";
  let createdMaterial = false;
  if (d.materialId && d.materialId !== "__new") {
    const m = await prisma.rawMaterial.findFirst({
      where: { id: d.materialId, organizationId: orgId, unit: "M" },
      select: { id: true, name: true },
    });
    if (!m) return { error: "Ткань не найдена" };
    material = m;
    materialName = m.name;
  } else {
    const num = (d.newNumber ?? "").replace(/^№\s*/, "").trim();
    if (!num) return { error: "Выберите ткань или укажите номер новой ткани" };
    if (!/^[0-9A-Za-zА-Яа-я\-\/.]{1,20}$/.test(num)) return { error: "Номер ткани: до 20 символов, без пробелов" };
    materialName = `Подкладочная ткань №${num}`;
    material = await prisma.rawMaterial.findFirst({
      where: { organizationId: orgId, unit: "M", name: { equals: materialName, mode: "insensitive" } },
      select: { id: true },
    });
  }

  let purchaseId: string | null = null;
  try {
    const created = await prisma.$transaction(async (tx) => {
      if (!material) {
        material = await tx.rawMaterial.create({
          data: { organizationId: orgId, name: materialName, unit: "M" },
          select: { id: true },
        });
        createdMaterial = true;
      }
      const number = await nextDocumentNumber(tx, "purchase", orgId, "З");
      const purchase = await tx.purchase.create({
        data: {
          organizationId: orgId,
          number,
          supplierId: suppliers[0].id,
          warehouseId: warehouses[0].id,
          currency: "RUB",
          exchangeRate: 1,
          auctionSession: "Подкладочные материалы",
          invoiceNumber: d.invoiceNumber,
          orderDate,
          notes: d.notes,
          createdById: session.user.id,
        },
      });
      await tx.purchaseItem.create({
        data: {
          purchaseId: purchase.id,
          rawMaterialId: material.id,
          quantity: d.meters,
          unitPrice: d.pricePerMeter,
          subtotal: new Decimal(d.meters).mul(d.pricePerMeter),
          vatRate: d.vatRate,
        },
      });
      return purchase;
    });
    purchaseId = created.id;

    const res = await receivePurchase(created.id);
    if (res.error) throw new Error(res.error);
  } catch (e) {
    // Roll back: receivePurchase's own transaction already undid the stock
    // side; drop the (draft) purchase — its item cascades — and a fabric we
    // created just now, if nothing else references it.
    try {
      if (purchaseId) {
        const p = await prisma.purchase.findUnique({ where: { id: purchaseId }, select: { status: true } });
        if (p && p.status !== "RECEIVED") await prisma.purchase.delete({ where: { id: purchaseId } });
      }
      if (createdMaterial && material) {
        const mid = (material as { id: string }).id;
        const [items, lots] = await Promise.all([
          prisma.purchaseItem.count({ where: { rawMaterialId: mid } }),
          prisma.rawMaterialLot.count({ where: { rawMaterialId: mid } }),
        ]);
        if (items === 0 && lots === 0) await prisma.rawMaterial.delete({ where: { id: mid } });
      }
    } catch {
      /* best effort */
    }
    return { error: `Закупка не оформлена: ${e instanceof Error ? e.message : "неизвестная ошибка"}` };
  }

  revalidatePath("/lots");
  revalidatePath("/purchases");
  return { ok: `Добавлено: ${materialName} — ${d.meters} м` };
}
