"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { nextDocumentNumber } from "@/lib/numbering";
import { parsePasteRows, issueLines, type ParsedRow } from "../parse-rows";
import { zNum } from "@/lib/input";
import { vatRateForDate } from "@/lib/vat-by-date";
import { getDefaultWarehouseId } from "@/lib/default-warehouse";
import { syncPurchaseInvoice } from "@/lib/invoice-sync";
import { dateField, currencyField, EDIT_ROLES, type Issue, type FormState, purchaseAuctionFromForm, existingLotNumbers, insertPasteRows } from "./shared";

const purchaseSchema = z.object({
  supplierId: z.string().optional(),
  warehouseId: z.string().optional(),
  currency: currencyField,
  exchangeRate: zNum("Курс", { positive: true, max: 1_000_000 }),
  auctionSession: z.string().trim().max(500).optional(),
  invoiceNumber: z.string().trim().max(200).optional(),
  invoiceDate: dateField().optional(),
  transferDocument: z.string().trim().max(200).optional(),
  orderDate: z.string().min(1, "Укажите дату").pipe(dateField()),
  expectedDate: dateField().optional(),
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
    invoiceDate: formData.get("invoiceDate") || undefined,
    transferDocument: formData.get("transferDocument") || undefined,
    orderDate: formData.get("orderDate"),
    expectedDate: formData.get("expectedDate") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const auc = await purchaseAuctionFromForm(orgId, formData);
  if ("error" in auc) return { error: auc.error };

  let supplierId = parsed.data.supplierId;
  if (!supplierId) {
    const suppliers = await prisma.supplier.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true } });
    if (suppliers.length !== 1) return { error: "Выберите поставщика" };
    supplierId = suppliers[0].id;
  }
  let warehouseId = parsed.data.warehouseId;
  if (!warehouseId) {
    const def = await getDefaultWarehouseId(orgId);
    if (!def) return { error: "Не удалось определить место прихода — обратитесь к администратору" };
    warehouseId = def;
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
    const result = parsePasteRows(rawRows, materials.map((m) => m.name), await existingLotNumbers(orgId), vatRateForDate(parsed.data.orderDate));
    issues = issueLines(result);
    if (result.errorCount > 0) {
      return { error: `Закупка не создана: ошибок в позициях — ${result.errorCount}. Исправьте строки ниже.`, issues };
    }
    pasteRows = result.rows;
  }

  let purchase: { id: string };
  try {
    purchase = await prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, "purchase", orgId, "З");
    const created = await tx.purchase.create({
      data: {
        organizationId: orgId,
        number,
        supplierId,
        warehouseId,
        currency: parsed.data.currency,
        exchangeRate: parsed.data.currency === "RUB" ? 1 : parsed.data.exchangeRate,
        auctionSession: auc.auctionSession,
        auctionId: auc.auctionId,
        invoiceNumber: parsed.data.invoiceNumber,
        invoiceDate: parsed.data.invoiceDate ? new Date(parsed.data.invoiceDate) : undefined,
        transferDocument: parsed.data.transferDocument,
        orderDate: new Date(parsed.data.orderDate),
        expectedDate: parsed.data.expectedDate ? new Date(parsed.data.expectedDate) : undefined,
        notes: parsed.data.notes,
        createdById: session.user.id,
      },
    });
    await syncPurchaseInvoice(tx, created.id, { setDate: true });
    if (pasteRows.length > 0) await insertPasteRows(tx, orgId, created.id, pasteRows);
    return created;
    });
  } catch (e) {
    console.error("createPurchase failed", e);
    return { error: "Не удалось сохранить закупку: проверьте числа в позициях (слишком большие значения). Введённые данные сохранены в форме.", issues };
  }

  revalidateAll(orgId);
  redirect(`/purchases/${purchase.id}`);
}
