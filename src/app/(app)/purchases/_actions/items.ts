"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { resolveColorInput } from "@/lib/colors";
import { Decimal } from "@prisma/client/runtime/library";
import { parsePasteRows, issueLines } from "../parse-rows";
import { checkOrgRefs } from "@/lib/org-guard";
import { MAX_QTY, zNum } from "@/lib/input";
import { resetByPurchase } from "@/lib/verification";
import { staleError, PURCHASE_ITEM_V } from "@/lib/concurrency";
import { parseLotSizeGrade } from "@/lib/lot-size";
import { resolveVatRate, vatRateForDate } from "@/lib/vat-by-date";
import { vatField, AMOUNT_TOO_BIG, tooBig, EDIT_ROLES, type OrderRef, type Issue, type FormState, existingLotNumbers, insertPasteRows, getEditablePurchase } from "./shared";

const UNIT_SHORT: Record<string, string> = { PIECE: "шт.", KG: "кг", M2: "м²", M: "м", SET: "компл." };

// ---------- Purchase header ----------

const COSTPLAN_PRICE_LOCK =
  "Цена и количество взяты из расчётного листа — здесь их менять нельзя: используйте кнопку «Править расчёт» в блоке «Расчёт себестоимости по лотам». Тут доступны только лот, сорт и цвет.";

// ---------- Line items ----------

/**
 * Ставка НДС новой позиции: введённая вручную; пусто — ставка материала по умолчанию, иначе по дате закупки
 * (до 01.01.2026 — 20%, с 2026 — 22%, см. src/lib/vat-by-date.ts).
 */
async function vatRateOrDefault(raw: FormDataEntryValue | null, materialId: FormDataEntryValue | null, orgId: string, date: Date): Promise<string | number> {
  if (raw != null && String(raw).trim() !== "") return String(raw);
  const m = typeof materialId === "string" && materialId
    ? await prisma.rawMaterial.findFirst({ where: { id: materialId, organizationId: orgId }, select: { defaultVatRate: true } })
    : null;
  return resolveVatRate(m?.defaultVatRate?.toString() ?? null, date).rate;
}

const itemSchema = z.object({
  rawMaterialId: z.string().min(1, "Выберите материал"),
  quantity: zNum("Количество", { positive: true, max: MAX_QTY }),
  unitPrice: zNum("Цена"),
  vatRate: vatField,
  lotNumber: z.string().trim().max(100).optional(),
  grade: z.string().trim().max(100).optional(),
  color: z.string().trim().max(100).optional(),
});

export async function addPurchaseItem(purchaseId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) return { error: "Закупку нельзя редактировать — она уже принята на склад или отменена" };

  const parsed = itemSchema.safeParse({
    rawMaterialId: formData.get("rawMaterialId"),
    quantity: formData.get("quantity"),
    unitPrice: formData.get("unitPrice"),
    vatRate: await vatRateOrDefault(formData.get("vatRate"), formData.get("rawMaterialId"), session.user.organizationId, purchase.orderDate),
    lotNumber: formData.get("lotNumber") || undefined,
    grade: formData.get("grade") || undefined,
    color: formData.get("color") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля позиции" };
  const badRef = await checkOrgRefs(session.user.organizationId, { rawMaterial: parsed.data.rawMaterialId });
  if (badRef) return { error: badRef };

  const subtotal = new Decimal(parsed.data.quantity).mul(parsed.data.unitPrice);
  if (tooBig(subtotal)) return { error: AMOUNT_TOO_BIG };

  const colorRes = await resolveColorInput(prisma, session.user.organizationId, { color: parsed.data.color, colorRefId: formData.get("colorRefId") as string | null });
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
      color: colorRes.color ?? undefined,
      colorRefId: colorRes.colorRefId ?? undefined,
    },
  });

  await resetByPurchase(purchaseId);
  revalidateAll();
  return {};
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
  const result = parsePasteRows(raw, materials.map((m) => m.name), await existingLotNumbers(orgId), vatRateForDate(purchase.orderDate));
  const issues = issueLines(result);
  if (result.errorCount > 0) {
    return { error: `Ничего не добавлено: ошибок в позициях — ${result.errorCount}.`, issues };
  }
  if (result.rows.length === 0) return { error: "Не удалось разобрать ни одной строки", issues };

  try {
    await prisma.$transaction((tx) => insertPasteRows(tx, orgId, purchaseId, result.rows));
  } catch (e) {
    console.error("addPurchaseItemsBulk failed", e);
    return { error: "Не удалось сохранить позиции: проверьте числа (слишком большие значения). Текст вставки сохранён.", issues };
  }

  await resetByPurchase(purchaseId);
  revalidateAll(orgId);
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
    include: { rawMaterial: { select: { unit: true, name: true } }, lot: { include: { purchaseItems: { select: { id: true } } } } },
  });
  if (!item) return { error: "Позиция не найдена" };
  const stale = staleError(formData, item, PURCHASE_ITEM_V);
  if (stale) return { error: stale };

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
  const badRef = await checkOrgRefs(session.user.organizationId, { rawMaterial: parsed.data.rawMaterialId });
  if (badRef) return { error: badRef };
  if (tooBig(new Decimal(parsed.data.quantity).mul(parsed.data.unitPrice))) return { error: AMOUNT_TOO_BIG };

  // Позиция с расчётом из расчётного листа: цена, количество и НДС взяты из
  // расчёта — правка сломала бы стоимость лота. Разрешены лот/сорт/цвет.
  if (
    item.costPlan != null &&
    (!new Decimal(parsed.data.quantity).eq(item.quantity) ||
      !new Decimal(parsed.data.unitPrice).eq(item.unitPrice) ||
      !new Decimal(parsed.data.vatRate).eq(item.vatRate))
  ) {
    return { error: COSTPLAN_PRICE_LOCK };
  }

  // Read these straight off formData (not parsed.data): itemSchema's
  // `.optional()` treats a blank field as "not specified" (right for
  // addPurchaseItem, where blank means "leave unset"), but on an edit blank
  // means "clear this field" — so an empty string here must become `null`,
  // not `undefined` (which Prisma reads as "don't touch").
  const colorRes = await resolveColorInput(prisma, session.user.organizationId, { color: (formData.get("color") as string) ?? "", colorRefId: formData.get("colorRefId") as string | null });
  const cosmetic = {
    lotNumber: (formData.get("lotNumber") as string)?.trim() || null,
    grade: (formData.get("grade") as string)?.trim() || null,
    color: colorRes.color,
    colorRefId: colorRes.colorRefId,
  };

  // Размер лота пересчитывается из сорта, только если сорт изменился (ручной размер при той же формулировке не затираем).
  const lotCosmetic = {
    ...cosmetic,
    ...(item.lot && cosmetic.grade !== (item.lot.grade ?? null)
      ? { sizeGrade: parseLotSizeGrade(cosmetic.grade, item.rawMaterial.name) }
      : {}),
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
    await resetByPurchase(purchaseId);
    revalidateAll();
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
      ...(lot ? [prisma.rawMaterialLot.update({ where: { id: lot.id }, data: lotCosmetic })] : []),
    ]);
    await resetByPurchase(purchaseId);
    revalidateAll();
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
  if (tooBig(newLandedTotal)) return { error: AMOUNT_TOO_BIG };

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
        ...lotCosmetic,
      },
    }),
    prisma.stockMovement.updateMany({
      where: { lotId: lot.id, type: "PURCHASE_IN" },
      data: { quantity: newQuantity, unitCost: newUnitCost, totalCost: newLandedTotal },
    }),
  ]);

  await resetByPurchase(purchaseId);
  revalidateAll();
  return {};
}

export async function removePurchaseItem(purchaseId: string, itemId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) return;

  // deleteMany + фильтр по закупке этой организации: чужую позицию не удалить.
  await prisma.purchaseItem.deleteMany({ where: { id: itemId, purchaseId: purchase.id } });
  await resetByPurchase(purchaseId);
  revalidateAll();
}
