"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { createRawMaterialLot, addOrPoolLiningLot } from "@/lib/stock";
import { receivePurchaseInTx, lockPurchase, AlreadyReceivedError } from "@/lib/purchase-receive";
import { resolveColorInput } from "@/lib/colors";
import { nextDocumentNumber } from "@/lib/numbering";
import { Decimal } from "@prisma/client/runtime/library";
import { Prisma } from "@prisma/client";
import { parsePasteRows, issueLines, type ParsedRow } from "./parse-rows";
import { checkOrgRefs } from "@/lib/org-guard";
import { MAX_MONEY, MAX_QTY, zNum, zMoney, parseDateInput } from "@/lib/input";
import { auctionName, loadAuctionSummaries, lockAuction, PAY_EPS } from "@/lib/auction-payments";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { formatMoney } from "@/lib/utils";
import { resetByPurchase, resetVerification } from "@/lib/verification";
import { resolveAuction } from "@/lib/auction-ref";
import { replaceFirstLine } from "@/lib/auction-key";
import { staleError, PURCHASE_V, PURCHASE_ITEM_V, PURCHASE_EXPENSE_V, PAYMENT_EDIT_V, LOT_V } from "@/lib/concurrency";
import { parseLotSizeGrade } from "@/lib/lot-size";
import { resolveVatRate, vatRateForDate } from "@/lib/vat-by-date";
import { invalidateFilterOptions } from "@/lib/filter-options";
import { getDefaultWarehouseId } from "@/lib/default-warehouse";
import { buildCostPlanJson, deriveCostPlanInputs, computeCostPlan, roundQty, roundPrice, roundVat, roundRate } from "@/lib/cost-plan";

const dateField = (label = "Некорректная дата") =>
  z.string().refine((s) => parseDateInput(s) !== null, label);
const currencyField = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Некорректная валюта").default("RUB");
const vatField = zNum("Ставка НДС", { max: 100 });
const AMOUNT_TOO_BIG = "Сумма слишком велика — проверьте количество и цену";
const tooBig = (d: Decimal) => d.gte(MAX_MONEY);

const EDIT_ROLES = ACCESS.purchases;
const WAREHOUSE_ROLES = ["OWNER", "ADMIN", "PURCHASER", "WAREHOUSE"] as const;

export type OrderRef = { id: string; number: string; quantity: string };
export type Issue = { level: "error" | "warning"; text: string };
const UNIT_SHORT: Record<string, string> = { PIECE: "шт.", KG: "кг", M2: "м²", M: "м", SET: "компл." };

export type FormState = { error?: string; issues?: Issue[]; orders?: OrderRef[]; confirm?: string };

// ---------- Purchase header ----------

const COSTPLAN_PRICE_LOCK =
  "Цена и количество взяты из расчётного листа — здесь их менять нельзя: используйте кнопку «Править расчёт» в блоке «Расчёт себестоимости по лотам». Тут доступны только лот, сорт и цвет.";
const COSTPLAN_PURCHASE_LOCK =
  "В закупке есть позиции с расчётом из расчётного листа — валюту менять нельзя, а курс меняется формой «Курс закупки» в блоке «Расчёт себестоимости по лотам» (она пересчитывает расчёт всех лотов).";

async function hasCostPlanItems(purchaseId: string) {
  const n = await prisma.purchaseItem.count({ where: { purchaseId, costPlan: { not: Prisma.DbNull } } });
  return n > 0;
}

/**
 * Аукцион закупки из формы: выбор из справочника (`auctionId`) -> запись auctionId и кэш-текст auctionSession = короткое имя.
 * Без выбора, но с текстом (пачка/импорт/старая форма): сопоставление с справочником по имени или прежнему написанию;
 * не найден — текст сохраняется как есть, без привязки. `current` — прежний текст закупки (строки после первой сохраняются).
 */
async function purchaseAuctionFromForm(orgId: string, formData: FormData, current?: string | null): Promise<{ error: string } | { auctionId: string | null | undefined; auctionSession: string | null | undefined }> {
  const id = ((formData.get("auctionId") as string | null) ?? "").trim();
  const text = ((formData.get("auctionSession") as string | null) ?? "").trim();
  const keepTail = (name: string) => (current && /\r?\n/.test(current) ? replaceFirstLine(current, name) : name);
  if (id) {
    const a = await prisma.auction.findFirst({ where: { id, organizationId: orgId }, select: { id: true, name: true } });
    if (!a) return { error: "Аукцион не найден в справочнике — обновите страницу" };
    return { auctionId: a.id, auctionSession: keepTail(a.name) };
  }
  // Правка закупки: текст не менялся и аукцион не выбирали (например, заглушка «Нет информации» с привязкой) — оставляем как есть.
  if (current !== undefined && text === (current ?? "").split(/\r?\n/)[0].trim()) return { auctionId: undefined, auctionSession: undefined };
  if (!text) return { auctionId: null, auctionSession: null };
  const a = await resolveAuction(text, orgId);
  if (a && !a.isService) return { auctionId: a.id, auctionSession: keepTail(a.name) };
  return { auctionId: null, auctionSession: text };
}

const purchaseSchema = z.object({
  supplierId: z.string().optional(),
  warehouseId: z.string().optional(),
  currency: currencyField,
  exchangeRate: zNum("Курс", { positive: true, max: 1_000_000 }),
  auctionSession: z.string().trim().max(500).optional(),
  invoiceNumber: z.string().trim().max(200).optional(),
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
  } catch (e) {
    console.error("createPurchase failed", e);
    return { error: "Не удалось сохранить закупку: проверьте числа в позициях (слишком большие значения). Введённые данные сохранены в форме.", issues };
  }

  revalidateAll(orgId);
  redirect(`/purchases/${purchase.id}`);
}

// Номера лотов, уже существующих на складе организации (для предупреждения о дублях).
async function existingLotNumbers(orgId: string): Promise<string[]> {
  const lots = await prisma.rawMaterialLot.findMany({
    where: { organizationId: orgId, lotNumber: { not: null } },
    select: { lotNumber: true },
  });
  return lots.map((l) => l.lotNumber as string);
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// Writes already-validated pasted lines; unknown materials are created
// (same find-or-create behaviour as the historical-import scripts).
async function insertPasteRows(tx: Tx, orgId: string, purchaseId: string, rows: ParsedRow[]) {
  // Цвет из вставки: сопоставляем со справочником по названию/синониму (латиница, регистр); нет соответствия — текст как есть.
  const colorByText = new Map<string, { color: string | null; colorRefId: string | null }>();
  for (const t of new Set(rows.map((r) => r.color).filter((c): c is string => !!c))) colorByText.set(t, await resolveColorInput(tx, orgId, { color: t }));
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
      color: r.color ? colorByText.get(r.color)?.color ?? r.color : r.color,
      colorRefId: r.color ? colorByText.get(r.color)?.colorRefId ?? null : null,
    })),
  });
}

export async function updatePurchaseExchangeRate(purchaseId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const rate = zNum("Курс", { positive: true, max: 1_000_000 }).safeParse(formData.get("exchangeRate"));
  if (!rate.success) return { error: rate.error.issues[0]?.message ?? "Некорректный курс" };

  if (await hasCostPlanItems(purchaseId)) return { error: COSTPLAN_PURCHASE_LOCK };
  await prisma.purchase.updateMany({
    where: { id: purchaseId, organizationId: session.user.organizationId, status: { notIn: ["RECEIVED", "CANCELLED"] } },
    data: { exchangeRate: rate.data as number },
  });
  await resetByPurchase(purchaseId);
  revalidateAll();
  return {};
}

const NOT_DRAFT = "Закупка уже принята на склад или отменена — расчёт лота менять нельзя";

function revalidateCostPlan() {
  revalidateAll();
}

const costPlanItemSchema = z.object({
  quantity: zNum("Количество", { positive: true, max: MAX_QTY }),
  price: zNum("Цена лота", { positive: true, max: 1_000_000 }),
  feePct: zNum("% сборов аукциона", { max: 100 }),
  dressing: zNum("Выделка", { max: 1_000_000 }),
  transport: zNum("Транспорт на выделку", { max: 1_000_000 }),
  brokerPct: zNum("Брокерский %", { max: 100 }),
  transit: zNum("Комиссия за транзит", { max: 1_000_000 }),
  vat: zNum("Ставка НДС", { max: 100 }),
});

// «Править расчёт лота»: позиция черновика с расчётом (costPlan). Пересчитывает
// costPlan целиком по формулам расчётного листа и обновляет количество, цену,
// сумму и НДС позиции. Курс здесь не меняется — он общий на закупку
// (updateCostPlanRate). Обычная правка позиции с расчётом по-прежнему заблокирована.
// Входные значения округляются до точности колонок БД ДО расчёта, чтобы costPlan
// был ровно пересчётом из сохранённых значений. Чтение и запись — под блокировкой
// строки закупки (иначе гонка с приёмкой / сменой курса).
export async function updateCostPlanItem(purchaseId: string, itemId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;

  const parsed = costPlanItemSchema.safeParse({
    quantity: formData.get("quantity"),
    price: formData.get("price"),
    feePct: formData.get("feePct"),
    dressing: formData.get("dressing"),
    transport: formData.get("transport"),
    brokerPct: formData.get("brokerPct"),
    transit: formData.get("transit") || 0,
    vat: formData.get("vat"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const raw = parsed.data;
  const v = { ...raw, quantity: roundQty(raw.quantity), price: roundPrice(raw.price), vat: roundVat(raw.vat) };
  if (v.quantity < 0.001) return { error: "Количество: значение должно быть не меньше 0,001" };
  if (v.price < 0.01) return { error: "Цена лота: значение должно быть не меньше 0,01" };

  const res = await prisma.$transaction(async (tx) => {
    const purchase = await lockPurchase(tx, purchaseId, orgId);
    if (!purchase) return { error: "Закупка не найдена" };
    if (purchase.status === "RECEIVED" || purchase.status === "CANCELLED") return { error: NOT_DRAFT };
    const item = await tx.purchaseItem.findFirst({ where: { id: itemId, purchaseId } });
    if (!item) return { error: "Позиция не найдена" };
    if (item.costPlan == null) return { error: "У позиции нет расчёта из расчётного листа" };

    const rate = roundRate(Number(purchase.exchangeRate.toString()));
    const plan = item.costPlan as { costBreakdown?: { furDescription?: unknown; exchangeRateFixed?: unknown } };
    const inputs = { ...v, rate };
    const calc = computeCostPlan(inputs);
    const subtotal = new Decimal(v.price).mul(v.quantity);
    if (tooBig(subtotal) || tooBig(new Decimal(calc.totalIncl))) return { error: AMOUNT_TOO_BIG };

    await tx.purchaseItem.update({
      where: { id: itemId },
      data: {
        quantity: v.quantity,
        unitPrice: v.price,
        subtotal,
        vatRate: v.vat,
        costPlan: buildCostPlanJson(
          inputs,
          { furDescription: plan.costBreakdown?.furDescription, exchangeRateFixed: plan.costBreakdown?.exchangeRateFixed },
          new Date().toISOString(),
        ),
      },
    });
    return {};
  }, { timeout: 30000 });
  if (res.error) return { error: res.error };
  await resetByPurchase(purchaseId);
  revalidateCostPlan();
  return {};
}

// Курс закупки с расчётом: общий для всех позиций, поэтому меняется одной
// формой с пересчётом costPlan каждой позиции (сборы и брокерский % берутся
// как проценты, выделка/транспорт/транзит — фиксированные суммы).
// Курс округляется до 6 знаков (точность колонки) до расчёта; позиции читаются
// после блокировки строки закупки.
export async function updateCostPlanRate(purchaseId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const rateParsed = zNum("Курс", { positive: true, max: 1_000_000 }).safeParse(formData.get("exchangeRate"));
  if (!rateParsed.success) return { error: rateParsed.error.issues[0]?.message ?? "Некорректный курс" };
  const rate = roundRate(rateParsed.data as number);
  if (rate <= 0) return { error: "Курс: значение должно быть не меньше 0,000001" };

  const res = await prisma.$transaction(async (tx) => {
    const purchase = await lockPurchase(tx, purchaseId, orgId);
    if (!purchase) return { error: "Закупка не найдена" };
    if (purchase.status === "RECEIVED" || purchase.status === "CANCELLED") return { error: NOT_DRAFT };
    const items = await tx.purchaseItem.findMany({ where: { purchaseId } });
    const planItems = items.filter((i) => i.costPlan != null);
    if (planItems.length === 0) return { error: "В закупке нет позиций с расчётом — используйте обычную форму курса" };

    const now = new Date().toISOString();
    const oldRate = roundRate(Number(purchase.exchangeRate.toString()));
    const updates = planItems.map((i) => {
      const prev = i.costPlan as { costBreakdown?: { furDescription?: unknown; exchangeRateFixed?: unknown } };
      const base = deriveCostPlanInputs(i.costPlan, {
        quantity: Number(i.quantity.toString()),
        price: Number(i.unitPrice.toString()),
        rate: oldRate,
        vat: Number(i.vatRate.toString()),
      });
      const inputs = { ...base, rate };
      return {
        id: i.id,
        costPlan: buildCostPlanJson(
          inputs,
          { furDescription: prev.costBreakdown?.furDescription, exchangeRateFixed: prev.costBreakdown?.exchangeRateFixed },
          now,
        ),
        total: computeCostPlan(inputs).totalIncl,
      };
    });
    if (updates.some((u) => tooBig(new Decimal(u.total)))) return { error: AMOUNT_TOO_BIG };

    await tx.purchase.update({ where: { id: purchaseId }, data: { exchangeRate: rate } });
    for (const u of updates) await tx.purchaseItem.update({ where: { id: u.id }, data: { costPlan: u.costPlan } });
    return {};
  }, { timeout: 30000 });
  if (res.error) return { error: res.error };
  await resetByPurchase(purchaseId);
  revalidateCostPlan();
  return {};
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
  warehouseId: z.string().optional(),
  currency: currencyField,
  auctionSession: z.string().trim().max(500).optional(),
  invoiceNumber: z.string().trim().max(200).optional(),
  transferDocument: z.string().trim().max(200).optional(),
  orderDate: z.string().min(1, "Укажите дату").pipe(dateField()),
});

export async function updatePurchase(purchaseId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);

  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) {
    // Принятая закупка: поставщик, склад и валюта заблокированы (лоты уже посчитаны), но номера документов, дату и аукцион править можно.
    const received = await prisma.purchase.findFirst({ where: { id: purchaseId, organizationId: session.user.organizationId, status: "RECEIVED" } });
    if (received) return updateReceivedPurchaseHeader(session.user.organizationId, received, formData);
    return { error: "Закупку нельзя редактировать — она отменена" };
  }
  const stale = staleError(formData, purchase, PURCHASE_V, purchase.updatedAt);
  if (stale) return { error: stale };

  const parsed = purchaseHeaderSchema.safeParse({
    supplierId: formData.get("supplierId"),
    warehouseId: formData.get("warehouseId") || undefined,
    currency: formData.get("currency") || "RUB",
    auctionSession: formData.get("auctionSession") || undefined,
    invoiceNumber: formData.get("invoiceNumber") || undefined,
    transferDocument: formData.get("transferDocument") || undefined,
    orderDate: formData.get("orderDate"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  // Склад в форме не выбирается: остаётся прежний склад закупки (иначе — по умолчанию).
  const warehouseId = parsed.data.warehouseId || purchase.warehouseId || (await getDefaultWarehouseId(session.user.organizationId)) || "";
  const badRef = await checkOrgRefs(session.user.organizationId, {
    supplier: parsed.data.supplierId,
    warehouse: warehouseId,
  });
  if (badRef) return { error: badRef };

  const currencyChanged = parsed.data.currency !== purchase.currency;
  if (currencyChanged && (await hasCostPlanItems(purchaseId))) return { error: COSTPLAN_PURCHASE_LOCK };

  // Blank optional fields must clear rather than be left untouched — same
  // "read straight off formData" reasoning as updatePurchaseItem's `cosmetic`.
  const auc = await purchaseAuctionFromForm(session.user.organizationId, formData, purchase.auctionSession);
  if ("error" in auc) return { error: auc.error };
  const invoiceNumber = (formData.get("invoiceNumber") as string)?.trim() || null;
  const transferDocument = (formData.get("transferDocument") as string)?.trim() || null;

  await prisma.purchase.updateMany({
    where: { id: purchaseId, organizationId: session.user.organizationId, status: { notIn: ["RECEIVED", "CANCELLED"] } },
    data: {
      supplierId: parsed.data.supplierId,
      warehouseId,
      currency: parsed.data.currency,
      // Same pairing rule as createPurchase: RUB is always rate 1; a
      // currency change resets the rate to 1 so a stale rate from the old
      // currency can't leak through — the exchange-rate form forces re-entry.
      ...(currencyChanged ? { exchangeRate: 1 } : {}),
      auctionSession: auc.auctionSession,
      auctionId: auc.auctionId,
      invoiceNumber,
      transferDocument,
      orderDate: new Date(parsed.data.orderDate),
    },
  });

  await resetByPurchase(purchaseId);
  revalidateAll();
  return {};
}

/**
 * Шапка ПРИНЯТОЙ закупки: можно менять № счёта, УПД, дату заказа и аукцион из справочника.
 * Нельзя (лоты уже посчитаны по этим данным): поставщик, склад, валюта, курс.
 * Смена аукциона блокируется, если по прежнему аукциону есть оплата «аукциона целиком» (иначе оплата осталась бы за старым аукционом).
 */
async function updateReceivedPurchaseHeader(
  orgId: string,
  purchase: Prisma.PurchaseGetPayload<object>,
  formData: FormData,
): Promise<FormState> {
  const stale = staleError(formData, purchase, PURCHASE_V, purchase.updatedAt);
  if (stale) return { error: stale };
  const dateRaw = String(formData.get("orderDate") ?? "").trim();
  if (!dateRaw || parseDateInput(dateRaw) === null) return { error: "Укажите корректную дату заказа" };
  const invoiceNumber = (formData.get("invoiceNumber") as string)?.trim().slice(0, 200) || null;
  const transferDocument = (formData.get("transferDocument") as string)?.trim().slice(0, 200) || null;
  const auc = await purchaseAuctionFromForm(orgId, formData, purchase.auctionSession);
  if ("error" in auc) return { error: auc.error };

  const oldAuction = auctionName(purchase.auctionSession);
  const newText = auc.auctionSession === undefined ? purchase.auctionSession : auc.auctionSession;
  const newAuction = auctionName(newText);
  const auctionChanged = oldAuction !== newAuction;
  if (auctionChanged && oldAuction) {
    const lumpPayments = await prisma.payment.count({ where: { organizationId: orgId, purchaseId: null, auctionSession: oldAuction } });
    if (lumpPayments > 0) {
      return {
        error: `Аукцион менять нельзя: по аукциону «${oldAuction}» есть оплаты «целиком» (${lumpPayments} шт.) — они остались бы за прежним аукционом и расчёты разошлись бы. Сначала перенесите или удалите эти оплаты на странице «Оплаты».`,
      };
    }
  }
  await prisma.purchase.updateMany({
    where: { id: purchase.id, organizationId: orgId, status: "RECEIVED" },
    data: {
      orderDate: new Date(dateRaw),
      invoiceNumber,
      transferDocument,
      auctionSession: auc.auctionSession,
      auctionId: auc.auctionId,
    },
  });
  await resetVerification(prisma, orgId, { purchaseIds: [purchase.id], auctions: [oldAuction, newAuction] });
  revalidateAll(orgId);
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
  await resetByPurchase(purchaseId);
  revalidateAll();
}

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

// ---------- Expenses ----------

const expenseSchema = z.object({
  categoryId: z.string().min(1, "Выберите статью расходов"),
  amount: zNum("Сумма", { positive: true }),
  vatRate: vatField,
  description: z.string().trim().max(500).optional(),
});

export async function addPurchaseExpense(purchaseId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) return { error: "Закупку нельзя редактировать — она уже принята на склад или отменена" };

  const parsed = expenseSchema.safeParse({
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    vatRate: formData.get("vatRate") ?? 0,
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля расхода" };
  const badRef = await checkOrgRefs(session.user.organizationId, { expenseCategory: parsed.data.categoryId });
  if (badRef) return { error: badRef };

  await prisma.purchaseExpense.create({
    data: { purchaseId, ...parsed.data },
  });

  await resetByPurchase(purchaseId);
  revalidateAll();
  return {};
}

export async function removePurchaseExpense(purchaseId: string, expenseId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const purchase = await getEditablePurchase(session.user.organizationId, purchaseId);
  if (!purchase) return;

  await prisma.purchaseExpense.deleteMany({ where: { id: expenseId, purchaseId: purchase.id } });
  await resetByPurchase(purchaseId);
  revalidateAll();
}

export async function updatePurchaseExpense(purchaseId: string, expenseId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const purchase = await getEditablePurchase(orgId, purchaseId);
  if (!purchase) {
    return { error: "Расходы принятой закупки менять нельзя: они уже распределены по лотам (себестоимость лотов зафиксирована). Чтобы исправить расход, верните закупку к приёмке через администратора или внесите поправку отдельным расходом в ТЗ." };
  }
  const exp = await prisma.purchaseExpense.findFirst({ where: { id: expenseId, purchaseId } });
  if (!exp) return { error: "Расход не найден (возможно, уже удалён)" };
  const stale = staleError(formData, exp, PURCHASE_EXPENSE_V);
  if (stale) return { error: stale };
  const parsed = expenseSchema.safeParse({
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    vatRate: formData.get("vatRate") ?? 0,
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля расхода" };
  const badRef = await checkOrgRefs(orgId, { expenseCategory: parsed.data.categoryId });
  if (badRef) return { error: badRef };
  await prisma.purchaseExpense.update({
    where: { id: expenseId },
    data: {
      categoryId: parsed.data.categoryId,
      amount: parsed.data.amount,
      vatRate: parsed.data.vatRate,
      description: (formData.get("description") as string)?.trim() || null,
    },
  });
  await resetByPurchase(purchaseId);
  revalidateAll(orgId);
  return {};
}

// ---------- Payments ----------

const paymentSchema = z.object({
  amount: zMoney("Сумма"),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"], { message: "Выберите способ оплаты" }),
  paidAt: z.string().min(1, "Укажите дату оплаты").pipe(dateField("Некорректная дата оплаты")),
  notes: z.string().trim().max(1000).optional(),
});

export async function addPurchasePayment(purchaseId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId: orgId },
  });
  if (!purchase) return { error: "Закупка не найдена" };
  if (purchase.status === "CANCELLED") return { error: "Закупка отменена — оплату добавить нельзя" };

  const parsed = paymentSchema.safeParse({
    amount: formData.get("amount"),
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля оплаты" };
  const amount = new Decimal(parsed.data.amount);
  const confirmed = formData.get("confirmOverpay") === "1";
  const auction = auctionName(purchase.auctionSession);

  // Та же защита от переплаты и та же блокировка, что при оплате аукциона целиком:
  // параллельные оплаты одного аукциона идут по очереди и не обходят проверку.
  const result = await prisma.$transaction(async (tx): Promise<FormState> => {
    if (auction) {
      await lockAuction(tx, orgId, auction);
      const [s] = await loadAuctionSummaries(tx, orgId, [auction]);
      if (s) {
        const after = s.paid.add(amount);
        if (after.sub(s.total).greaterThan(PAY_EPS) && !confirmed) {
          return {
            confirm: `Оплачено станет ${formatMoney(after.toString())} при стоимости аукциона ${formatMoney(s.total.toString())} — переплата ${formatMoney(after.sub(s.total).toString())}. Всё равно записать?`,
          };
        }
      }
    } else {
      const full = await tx.purchase.findFirst({
        where: { id: purchaseId, organizationId: orgId },
        include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" }, select: { amount: true } } },
      });
      if (full) {
        const total = purchaseTotalInclVat(full);
        const after = full.payments.reduce((x, p) => x.add(p.amount), new Decimal(0)).add(amount);
        if (after.sub(total).greaterThan(PAY_EPS) && !confirmed) {
          return {
            confirm: `Оплачено станет ${formatMoney(after.toString())} при стоимости закупки ${formatMoney(total.toString())} — переплата ${formatMoney(after.sub(total).toString())}. Всё равно записать?`,
          };
        }
      }
    }
    await tx.payment.create({
      data: {
        organizationId: orgId,
        supplierId: purchase.supplierId,
        purchaseId,
        amount,
        // Сумма платежа вводится и учитывается в рублях (см. «Оплачено»/остаток
        // в рублях), поэтому валюту закупки (USD…) сюда не пишем.
        currency: "RUB",
        method: parsed.data.method,
        status: "COMPLETED",
        paidAt: new Date(parsed.data.paidAt),
        notes: parsed.data.notes,
      },
    });
    return {};
  });
  if (result.error || result.confirm) return result;

  await resetByPurchase(purchaseId);
  revalidateAll(orgId);
  return {};
}

/** Удаляет оплату закупки (та же защита и блокировка аукциона, что при добавлении). */
export async function removePurchasePayment(purchaseId: string, paymentId: string): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId: orgId },
    select: { id: true, auctionSession: true },
  });
  if (!purchase) return { error: "Закупка не найдена" };
  const auction = auctionName(purchase.auctionSession);

  const deleted = await prisma.$transaction(async (tx) => {
    if (auction) await lockAuction(tx, orgId, auction);
    const res = await tx.payment.deleteMany({ where: { id: paymentId, organizationId: orgId, purchaseId: purchase.id } });
    return res.count;
  });
  if (deleted === 0) return { error: "Оплата не найдена (возможно, уже удалена)" };

  await resetByPurchase(purchaseId);
  revalidateAll(orgId);
  return {};
}

const PAY_STATUSES = ["COMPLETED", "PENDING"] as const;

/**
 * Правка оплаты закупки: сумма, дата, способ, статус (оплачена / запланирована), заметка, № п/п (docRef),
 * перенос на другую закупку того же поставщика. Переплату проверяем так же, как при добавлении (без самой правимой оплаты).
 * Любая правка сбрасывает «подтверждено» у оплаты и подтверждение закупки/аукциона.
 */
export async function updatePurchasePayment(purchaseId: string, paymentId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const existing = await prisma.payment.findFirst({
    where: { id: paymentId, organizationId: orgId, purchaseId },
    include: { purchase: { select: { id: true, auctionSession: true, status: true } } },
  });
  if (!existing || !existing.purchase) return { error: "Оплата не найдена (возможно, уже удалена или перенесена)" };
  const stale = staleError(formData, existing, PAYMENT_EDIT_V);
  if (stale) return { error: stale };

  const parsed = paymentSchema.safeParse({
    amount: formData.get("amount"),
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля оплаты" };
  const statusRaw = String(formData.get("status") ?? existing.status);
  const status = (PAY_STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as "COMPLETED" | "PENDING") : existing.status === "PENDING" ? "PENDING" : "COMPLETED";
  const docRef = (formData.get("docRef") as string)?.trim().slice(0, 200) || null;
  const targetId = String(formData.get("targetPurchaseId") ?? "").trim() || purchaseId;
  const amount = new Decimal(parsed.data.amount);
  const confirmed = formData.get("confirmOverpay") === "1";

  const target =
    targetId === purchaseId
      ? existing.purchase
      : await prisma.purchase.findFirst({
          where: { id: targetId, organizationId: orgId, supplierId: existing.supplierId, status: { not: "CANCELLED" } },
          select: { id: true, auctionSession: true, status: true },
        });
  if (!target) return { error: "Закупка для переноса не найдена: можно переносить только на закупку того же поставщика" };

  const oldAuction = auctionName(existing.purchase.auctionSession);
  const auction = auctionName(target.auctionSession);

  const result = await prisma.$transaction(async (tx): Promise<FormState> => {
    if (auction) await lockAuction(tx, orgId, auction);
    if (oldAuction && oldAuction !== auction) await lockAuction(tx, orgId, oldAuction);
    if (status === "COMPLETED") {
      let total: Decimal | null = null;
      let paid: Decimal | null = null;
      let label = "закупки";
      if (auction) {
        const [s] = await loadAuctionSummaries(tx, orgId, [auction]);
        if (s) {
          total = s.total;
          paid = s.paid;
          label = "аукциона";
        }
      } else {
        const full = await tx.purchase.findFirst({
          where: { id: target.id, organizationId: orgId },
          include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" }, select: { id: true, amount: true } } },
        });
        if (full) {
          total = purchaseTotalInclVat(full);
          paid = full.payments.reduce((x, p) => x.add(p.amount), new Decimal(0));
        }
      }
      if (total && paid) {
        const sameScope = auction ? oldAuction === auction : existing.purchaseId === target.id;
        const base = sameScope && existing.status === "COMPLETED" ? paid.sub(existing.amount) : paid;
        const after = base.add(amount);
        const moneyUnchanged = sameScope && existing.status === "COMPLETED" && amount.eq(existing.amount);
        if (!moneyUnchanged && after.sub(total).greaterThan(PAY_EPS) && !confirmed) {
          return {
            confirm: `Оплачено станет ${formatMoney(after.toString())} при стоимости ${label === "аукциона" ? "аукциона" : "закупки"} ${formatMoney(total.toString())} — переплата ${formatMoney(after.sub(total).toString())}. Всё равно записать?`,
          };
        }
      }
    }
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        purchaseId: target.id,
        amount,
        method: parsed.data.method,
        status,
        paidAt: new Date(parsed.data.paidAt),
        notes: (formData.get("notes") as string)?.trim() || null,
        docRef,
      },
    });
    return {};
  });
  if (result.error || result.confirm) return result;

  await resetVerification(prisma, orgId, {
    paymentIds: [paymentId],
    purchaseIds: [purchaseId, target.id],
    auctions: [oldAuction, auction],
  });
  revalidateAll(orgId);
  return {};
}

const lotMetaSchema = z.object({
  lotNumber: z.string().trim().max(100),
  grade: z.string().trim().max(500),
  sizeGrade: z.string().trim().max(40),
  notes: z.string().trim().max(2000),
});

/**
 * Безопасные поля лота ПОСЛЕ приёмки: № лота, сорт/описание, размер, цвет (из справочника), примечание.
 * Количество, цена и остатки не затрагиваются (их правит строка закупки, пока лот не списан).
 * Размер: пусто = определить из сорта автоматически (src/lib/lot-size.ts).
 * Если лот питает одну позицию закупки — её лот/сорт/цвет обновляются вместе с лотом.
 */
export async function updateLotMeta(lotId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...WAREHOUSE_ROLES);
  const orgId = session.user.organizationId;
  const lot = await prisma.rawMaterialLot.findFirst({
    where: { id: lotId, organizationId: orgId },
    include: { rawMaterial: { select: { name: true } }, purchaseItems: { select: { id: true } } },
  });
  if (!lot) return { error: "Лот не найден" };
  const stale = staleError(formData, lot, LOT_V);
  if (stale) return { error: stale };
  const parsed = lotMetaSchema.safeParse({
    lotNumber: String(formData.get("lotNumber") ?? ""),
    grade: String(formData.get("grade") ?? ""),
    sizeGrade: String(formData.get("sizeGrade") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля лота" };
  const colorRes = await resolveColorInput(prisma, orgId, { color: String(formData.get("color") ?? ""), colorRefId: formData.get("colorRefId") as string | null });
  const grade = parsed.data.grade || null;
  const sizeGrade = parsed.data.sizeGrade ? parsed.data.sizeGrade.toUpperCase() : parseLotSizeGrade(grade, lot.rawMaterial.name);
  const lotNumber = parsed.data.lotNumber || null;
  const cosmetic = { lotNumber, grade, color: colorRes.color, colorRefId: colorRes.colorRefId };
  await prisma.$transaction([
    prisma.rawMaterialLot.update({ where: { id: lotId }, data: { ...cosmetic, sizeGrade, notes: parsed.data.notes || null } }),
    ...(lot.purchaseItems.length === 1
      ? [prisma.purchaseItem.update({ where: { id: lot.purchaseItems[0].id }, data: cosmetic })]
      : []),
  ]);
  if (lot.purchaseId) await resetByPurchase(lot.purchaseId);
  invalidateFilterOptions(orgId);
  revalidateAll(orgId);
  return {};
}

// ---------- Receiving: this is where landed cost + stock-in happens ----------

export async function receivePurchase(purchaseId: string): Promise<FormState> {
  const session = await requireRole(...WAREHOUSE_ROLES);
  const orgId = session.user.organizationId;

  // Быстрая проверка для понятных сообщений; настоящая защита от двойной
  // приёмки (две вкладки) — атомарный переход статуса внутри транзакции ниже.
  const pre = await prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId: orgId },
    select: { status: true, _count: { select: { items: true } } },
  });
  if (!pre) return { error: "Закупка не найдена" };
  if (pre.status === "RECEIVED") return { error: "Закупка уже принята на склад" };
  if (pre.status === "CANCELLED") return { error: "Закупка отменена" };
  if (pre._count.items === 0) return { error: "В закупке нет позиций" };

  // Item prices and expense amounts are entered EXCLUDING VAT; each line
  // carries its own rate since it varies lot to lot (the rate in force
  // changes over time — 20% and 22% both appear in the same registry).
  // Expenses are always in RUB; item prices are in the purchase's currency
  // and get converted here. Everything is grossed up to VAT-inclusive RUB,
  // expenses are allocated across items proportionally by their inclusive
  // cost share, and rolled into that item's lot as a fixed landed cost
  // — see src/lib/stock.ts.

  try {
    await prisma.$transaction(
      async (tx) => {
        await receivePurchaseInTx(tx, purchaseId, orgId);
      },
      { timeout: 60_000, maxWait: 10_000 }
    );
  } catch (e) {
    if (e instanceof AlreadyReceivedError) return { error: "Закупка уже принята на склад" };
    throw e;
  }

  await resetByPurchase(purchaseId);
  revalidateAll(orgId);
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
  meters: zNum("Метры", { positive: true, max: 1_000_000 }),
  pricePerMeter: zNum("Цена за метр", { max: 10_000_000 }),
  vatRate: zNum("НДС", { max: 100 }),
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
    meters: formData.get("meters") ?? "",
    pricePerMeter: formData.get("pricePerMeter") ?? "",
    // Пустая ставка — подставим по материалу/дате ниже (vatEmpty); 0 здесь — заглушка для схемы.
    vatRate: formData.get("vatRate") || 0,
    date: formData.get("date") || "",
    invoiceNumber: formData.get("invoiceNumber") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  const d = parsed.data;
  if (String(formData.get("pricePerMeter") ?? "").trim() === "") return { error: "Укажите цену за метр" };
  if (tooBig(new Decimal(d.meters).mul(d.pricePerMeter))) return { error: AMOUNT_TOO_BIG };
  const orderDate = parseDateInput(d.date);
  if (!orderDate) return { error: "Некорректная дата" };
  const vatEmpty = String(formData.get("vatRate") ?? "").trim() === "";

  const [suppliers, defaultWarehouseId] = await Promise.all([
    prisma.supplier.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true } }),
    getDefaultWarehouseId(orgId),
  ]);
  if (suppliers.length !== 1) return { error: "Не удалось определить поставщика: оформите закупку через раздел «Закупки»" };
  if (!defaultWarehouseId) return { error: "Не удалось определить место прихода: оформите закупку через раздел «Закупки»" };

  let material: { id: string } | null = null;
  let materialName = "";
  let createdMaterial = false;
  let materialDefaultVat: string | null = null;
  if (d.materialId && d.materialId !== "__new") {
    const m = await prisma.rawMaterial.findFirst({
      where: { id: d.materialId, organizationId: orgId, unit: "M" },
      select: { id: true, name: true, defaultVatRate: true },
    });
    if (!m) return { error: "Ткань не найдена" };
    material = m;
    materialName = m.name;
    materialDefaultVat = m.defaultVatRate?.toString() ?? null;
  } else {
    const num = (d.newNumber ?? "").replace(/^№\s*/, "").trim();
    if (!num) return { error: "Выберите ткань или укажите номер новой ткани" };
    if (!/^[0-9A-Za-zА-Яа-я\-\/.]{1,20}$/.test(num)) return { error: "Номер ткани: до 20 символов, без пробелов" };
    materialName = `Подкладочная ткань №${num}`;
    material = await prisma.rawMaterial.findFirst({
      where: { organizationId: orgId, unit: "M", name: { equals: materialName, mode: "insensitive" } },
      select: { id: true, defaultVatRate: true },
    });
    materialDefaultVat = (material as { defaultVatRate?: { toString(): string } | null } | null)?.defaultVatRate?.toString() ?? null;
  }
  const itemVat = vatEmpty ? resolveVatRate(materialDefaultVat, orderDate).rate : d.vatRate;

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
          warehouseId: defaultWarehouseId,
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
          vatRate: itemVat,
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

  revalidateAll(orgId);
  return { ok: `Добавлено: ${materialName} — ${String(d.meters).replace(".", ",")} м` };
}
