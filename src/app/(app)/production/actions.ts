"use server";

import { z } from "zod";
import { revalidateAll } from "@/lib/revalidate-all";
import { resetByBatch, resetByOrder } from "@/lib/verification";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { consumeFromLot, returnToLot, receiveFinishedGoodsStock } from "@/lib/stock";
import { nextDocumentNumber } from "@/lib/numbering";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { PRODUCTION_EDIT_ROLES as EDIT_ROLES } from "@/lib/production-access";
import { parseLotLines } from "@/lib/lot-lines";
import { checkOrgRefs } from "@/lib/org-guard";
import { MAX_QTY, parsePrice, zNum, zNumOpt, parseNumber, parseDateInput } from "@/lib/input";
import { defaultCommission4 } from "@/lib/commission4-const";
import { resolveColorInput } from "@/lib/colors";
import { staleError, ORDER_V, PRODUCTION_PAYMENT_V, BATCH_V } from "@/lib/concurrency";
import { resetByProdPayment } from "@/lib/verification";
import { autoAllocatePayment } from "@/lib/payment-alloc";
import { isUniqueViolation } from "@/lib/input";

const optDate = (label: string) =>
  z.string().optional().refine((s) => !s || parseDateInput(s) !== null, label);

const CANCELLED_ERROR = "ТЗ отменено — оплаты добавлять нельзя";

export type FormState = { error?: string };

// ---------- Order header ----------

const orderSchema = z.object({
  productModelId: z.string().min(1, "Выберите модель изделия"),
  rawWarehouseId: z.string().min(1, "Выберите склад сырья"),
  finishedWarehouseId: z.string().min(1, "Выберите склад готовой продукции"),
  plannedQuantity: zNum("Плановое количество", { positive: true, max: MAX_QTY }),
  color: z.string().trim().max(200).optional(),
  size: z.string().trim().max(200).optional(),
  materialDescription: z.string().trim().max(2000).optional(),
  lining: z.string().trim().max(2000).optional(),
  startDate: optDate("Некорректная дата начала"),
  notes: z.string().trim().max(5000).optional(),
  clientId: z.string().trim().optional(),
  contractNumber: z.string().trim().max(200).optional(),
  workOrderNumber: z.string().trim().max(200).optional(),
  workOrderDate: optDate("Некорректная дата ТЗ"),
  clientWorkPricePerUnit: zNumOpt("Стоимость работ за ед."),
  liningMaterialId: z.string().trim().optional(),
  liningQuantity: zNumOpt("Метраж подкладки", { positive: true, max: MAX_QTY }),
});

export type CreateOrderState = { error?: string; errors?: string[]; created?: { id: string; label: string } };

// Черновик ТЗ из формы создания: строки списаний (мех, подкладка по лотам), расходы, ставка НДС, партия, вид меха.
// Всё записывается одной транзакцией вместе с ТЗ (всё или ничего).
const draftLine = z.object({
  lotId: z.string().min(1),
  quantity: z.number().positive().max(MAX_QTY),
  commission4: z.boolean(),
});
const draftSchema = z.object({
  fur: z.array(draftLine).max(300),
  lining: z.array(draftLine).max(100),
  expenses: z.array(z.object({ categoryId: z.string().min(1), amount: z.number().positive().max(1e10), description: z.string().trim().max(500).optional() })).max(100),
  vatRate: z.string().trim().max(10).optional(),
  batchId: z.string().trim().optional(),
  batchNumber: z.string().trim().max(6).optional(),
  furType: z.string().trim().max(100).optional(),
});

type ResolvedLot = { line: number; lotId: string; quantity: number };

// Resolves parsed lot lines against lots that still have stock. An ambiguous
// number is never guessed — listed instead. Every problem is collected.
// `warehouseId` limits the search to one raw-material warehouse (ТЗ card);
// creation searches all warehouses.
async function resolveLotLines(
  organizationId: string,
  lines: { line: number; lotNumber: string; quantity: number }[],
  warehouseId?: string
): Promise<{ resolved: ResolvedLot[]; errors: string[] }> {
  const resolved: ResolvedLot[] = [];
  const errors: string[] = [];
  if (lines.length === 0) return { resolved, errors };
  const lots = await prisma.rawMaterialLot.findMany({
    where: {
      organizationId,
      quantityRemaining: { gt: 0 },
      lotNumber: { not: null },
      ...(warehouseId ? { warehouseId } : {}),
    },
    include: { rawMaterial: { select: { name: true } }, purchase: { select: { number: true } } },
  });
  const byNumber = new Map<string, typeof lots>();
  for (const l of lots) {
    const k = l.lotNumber!.trim().toLowerCase();
    byNumber.set(k, [...(byNumber.get(k) ?? []), l]);
  }
  const needed = new Map<string, Decimal>();
  for (const ln of lines) {
    const cands = byNumber.get(ln.lotNumber.toLowerCase()) ?? [];
    if (cands.length === 0) {
      errors.push(`строка ${ln.line}: лот ${ln.lotNumber} не найден (или нет остатка)`);
      continue;
    }
    if (cands.length > 1) {
      const opts = cands
        .map((c) => `${c.rawMaterial.name}${c.purchase ? `, закупка ${c.purchase.number}` : ""}, остаток ${c.quantityRemaining.toString()}`)
        .join("; ");
      errors.push(`строка ${ln.line}: лот ${ln.lotNumber} неоднозначен, найдено ${cands.length}: ${opts}`);
      continue;
    }
    const lot = cands[0];
    const total = (needed.get(lot.id) ?? new Decimal(0)).add(ln.quantity);
    if (lot.quantityRemaining.lessThan(total)) {
      errors.push(
        `строка ${ln.line}: лот ${ln.lotNumber} — мало остатка: есть ${lot.quantityRemaining.toString()}, нужно ${total.toString()}`
      );
      continue;
    }
    needed.set(lot.id, total);
    resolved.push({ line: ln.line, lotId: lot.id, quantity: ln.quantity });
  }
  const lineNo = (e: string) => Number(/^строка (\d+)/.exec(e)?.[1] ?? 0);
  errors.sort((x, y) => lineNo(x) - lineNo(y));
  return { resolved, errors };
}

export async function createProductionOrder(
  _prev: CreateOrderState,
  formData: FormData
): Promise<CreateOrderState> {
  const session = await requireRole(...EDIT_ROLES);
  const organizationId = session.user.organizationId;

  // Warehouses default to the org's default/first one when not sent.
  let rawWarehouseId = (formData.get("rawWarehouseId") as string) || "";
  let finishedWarehouseId = (formData.get("finishedWarehouseId") as string) || "";
  if (!rawWarehouseId || !finishedWarehouseId) {
    const ws = await prisma.warehouse.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
    const def = ws.find((w) => w.isDefault)?.id ?? ws[0]?.id ?? "";
    rawWarehouseId ||= def;
    finishedWarehouseId ||= def;
  }

  const parsed = orderSchema.safeParse({
    productModelId: formData.get("productModelId"),
    rawWarehouseId,
    finishedWarehouseId,
    plannedQuantity: formData.get("plannedQuantity"),
    color: formData.get("color") || undefined,
    size: formData.get("size") || undefined,
    materialDescription: formData.get("materialDescription") || undefined,
    lining: formData.get("lining") || undefined,
    startDate: formData.get("startDate") || undefined,
    notes: formData.get("notes") || undefined,
    clientId: formData.get("clientId") || undefined,
    contractNumber: formData.get("contractNumber") || undefined,
    workOrderNumber: formData.get("workOrderNumber") || undefined,
    workOrderDate: formData.get("workOrderDate") || undefined,
    clientWorkPricePerUnit: formData.get("clientWorkPricePerUnit") || undefined,
    liningMaterialId: formData.get("liningMaterialId") || undefined,
    liningQuantity: formData.get("liningQuantity") || undefined,
  });
  if (!parsed.success) return { errors: parsed.error.issues.map((i) => i.message) };

  const { lines, errors } = parseLotLines(((formData.get("lots") as string | null) ?? "").toString());

  // Lining: fabric and metres go together — never silently drop one half.
  if (parsed.data.liningMaterialId && !parsed.data.liningQuantity) {
    errors.push("Подкладка: указана ткань, но не указан метраж — введите метраж или выберите «Не списывать сейчас»");
  }
  if (!parsed.data.liningMaterialId && parsed.data.liningQuantity) {
    errors.push("Подкладка: указан метраж, но не выбрана ткань — выберите ткань или очистите метраж");
  }

  // Черновик из формы (JSON): строки списаний, расходы, НДС, партия, вид меха.
  let draft: z.infer<typeof draftSchema> | null = null;
  const draftRaw = formData.get("draft");
  if (typeof draftRaw === "string" && draftRaw) {
    try {
      const d = draftSchema.safeParse(JSON.parse(draftRaw));
      if (!d.success) errors.push("Не удалось прочитать строки расчёта — обновите страницу и повторите");
      else draft = d.data;
    } catch {
      errors.push("Не удалось прочитать строки расчёта — обновите страницу и повторите");
    }
  }
  let vatOwn: Decimal | null = null;
  if (draft?.vatRate) {
    const raw = draft.vatRate.replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw) > 100) errors.push("НДС: число от 0 до 100, например 20 или 22");
    else vatOwn = new Decimal(raw);
  }
  const draftLots = draft ? [...draft.fur, ...draft.lining] : [];
  const lotInfo = new Map<string, { id: string; lotNumber: string | null; quantityRemaining: Decimal; vatRate: Decimal; unit: string }>();
  if (draft) {
    const ids = [...new Set(draftLots.map((l) => l.lotId))];
    const rows = ids.length
      ? await prisma.rawMaterialLot.findMany({
          where: { id: { in: ids }, organizationId },
          select: { id: true, lotNumber: true, quantityRemaining: true, vatRate: true, rawMaterial: { select: { unit: true } } },
        })
      : [];
    for (const r of rows) lotInfo.set(r.id, { id: r.id, lotNumber: r.lotNumber, quantityRemaining: r.quantityRemaining, vatRate: r.vatRate, unit: r.rawMaterial.unit });
    const need = new Map<string, Decimal>();
    for (const l of draftLots) {
      const info = lotInfo.get(l.lotId);
      if (!info) { errors.push("Один из выбранных лотов не найден — обновите страницу"); continue; }
      need.set(l.lotId, (need.get(l.lotId) ?? new Decimal(0)).add(l.quantity));
    }
    for (const [id, total] of need) {
      const info = lotInfo.get(id)!;
      if (info.quantityRemaining.lessThan(total)) {
        errors.push(`Лот ${info.lotNumber ?? "без номера"}: остаток ${info.quantityRemaining.toString()}, в ТЗ ${total.toString()}`);
      }
    }
    const catIds = [...new Set(draft.expenses.map((e) => e.categoryId))];
    if (catIds.length) {
      const bad = await checkOrgRefs(organizationId, { expenseCategory: catIds[0] });
      if (bad) errors.push(bad);
      const cnt = await prisma.expenseCategory.count({ where: { id: { in: catIds }, organizationId } });
      if (cnt !== catIds.length) errors.push("Статья расходов не найдена");
    }
    if (draft.batchId) {
      const b = await prisma.productionBatch.findFirst({ where: { id: draft.batchId, organizationId }, select: { id: true } });
      if (!b) errors.push("Партия не найдена");
    }
    if (draft.batchNumber && (!/^\d{1,4}$/.test(draft.batchNumber) || Number(draft.batchNumber) < 1)) errors.push("Номер партии — целое число от 1 до 9999");
  }

  const badRef = await checkOrgRefs(organizationId, {
    productModel: parsed.data.productModelId,
    client: parsed.data.clientId,
    warehouse: [parsed.data.rawWarehouseId, parsed.data.finishedWarehouseId],
    rawMaterial: parsed.data.liningMaterialId,
  });
  if (badRef) return { errors: [badRef] };
  const model = await prisma.productModel.findFirst({
    where: { id: parsed.data.productModelId, organizationId },
    select: { sellingPrice: true },
  });
  if (!model) return { errors: ["Модель изделия не найдена"] };

  // Resolve lot numbers against every lot that still has stock, across all
  // purchases.
  const lotRes = await resolveLotLines(organizationId, lines);
  const resolved = lotRes.resolved;
  errors.push(...lotRes.errors);
  if (errors.length > 0) {
    const lineNo = (e: string) => Number(/^строка (\d+)/.exec(e)?.[1] ?? 0);
    // Line-bound errors first, in line order; general ones keep their order after.
    const withLine = errors.filter((e) => lineNo(e) > 0).sort((a, b) => lineNo(a) - lineNo(b));
    return { errors: [...errors.filter((e) => lineNo(e) === 0), ...withLine] };
  }

  let orderId: { id: string; label: string };
  try {
    orderId = await prisma.$transaction(async (tx) => {
      const number = await nextDocumentNumber(tx, "productionOrder", organizationId, "П");
      const colorRes = await resolveColorInput(tx, organizationId, { color: parsed.data.color, colorRefId: formData.get("colorRefId") as string | null });
      const order = await tx.productionOrder.create({
        data: {
          organizationId,
          number,
          productModelId: parsed.data.productModelId,
          rawWarehouseId: parsed.data.rawWarehouseId,
          finishedWarehouseId: parsed.data.finishedWarehouseId,
          plannedQuantity: parsed.data.plannedQuantity,
          color: colorRes.color ?? undefined,
          colorRefId: colorRes.colorRefId ?? undefined,
          size: parsed.data.size,
          materialDescription: parsed.data.materialDescription,
          lining: parsed.data.lining,
          startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : new Date(),
          notes: parsed.data.notes,
          clientId: parsed.data.clientId || undefined,
          contractNumber: parsed.data.contractNumber,
          workOrderNumber: parsed.data.workOrderNumber,
          workOrderDate: parsed.data.workOrderDate ? new Date(parsed.data.workOrderDate) : undefined,
          clientWorkPricePerUnit: parsed.data.clientWorkPricePerUnit,
          // The article's retail price is inherited by the new ТЗ.
          retailPrice: model.sellingPrice ?? undefined,
          createdById: session.user.id,
        },
      });

      // Партия (из списка или новым номером) и ручной вид меха.
      if (draft) {
        let batchId: string | null = draft.batchId || null;
        if (draft.batchNumber) {
          const number = Number(draft.batchNumber);
          const b =
            (await tx.productionBatch.findFirst({ where: { organizationId, number }, select: { id: true } })) ??
            (await tx.productionBatch.create({
              data: { organizationId, number, name: `Поставка ${number}`, year: parsed.data.workOrderDate ? new Date(parsed.data.workOrderDate).getUTCFullYear() : null },
              select: { id: true },
            }));
          batchId = b.id;
        }
        const furType = (draft.furType ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
        if (batchId || furType) {
          await tx.productionOrder.update({ where: { id: order.id }, data: { batchId: batchId ?? undefined, furTypeOverride: furType || undefined } });
        }
        for (const l of [...draft.fur, ...draft.lining]) {
          const info = lotInfo.get(l.lotId)!;
          const { unitCost, totalCost, rawMaterialId } = await consumeFromLot(tx, { organizationId, lotId: l.lotId, quantity: l.quantity, productionOrderId: order.id });
          await tx.productionMaterialUsage.create({
            data: {
              productionOrderId: order.id,
              rawMaterialId,
              lotId: l.lotId,
              quantity: l.quantity,
              unitCost,
              totalCost,
              commission4: l.commission4,
              vatRate: vatOwn && !vatOwn.eq(info.vatRate) ? vatOwn : null,
            },
          });
        }
        for (const e of draft.expenses) {
          await tx.productionExpense.create({ data: { productionOrderId: order.id, categoryId: e.categoryId, amount: e.amount, description: e.description || undefined } });
        }
      }

      // Pasted lots: same primitive (consumeFromLot) and same usage row as
      // addMaterialUsagesBulk, so cost snapshots are identical.
      for (const r of resolved) {
        try {
          const { unitCost, totalCost, rawMaterialId } = await consumeFromLot(tx, {
            organizationId,
            lotId: r.lotId,
            quantity: r.quantity,
            productionOrderId: order.id,
          });
          await tx.productionMaterialUsage.create({
            data: {
              productionOrderId: order.id,
              rawMaterialId,
              lotId: r.lotId,
              quantity: r.quantity,
              unitCost,
              totalCost,
            },
          });
        } catch (e) {
          throw new Error(`строка ${r.line}: ${e instanceof Error ? e.message : "не удалось списать"}`);
        }
      }

      // Lining pick (one aggregate pool per fabric, see consumeLiningForOrder).
      if (parsed.data.liningMaterialId && parsed.data.liningQuantity) {
        await consumeLiningForOrder(tx, {
          organizationId,
          orderId: order.id,
          rawMaterialId: parsed.data.liningMaterialId,
          quantity: parsed.data.liningQuantity,
        });
      }
      if (resolved.length > 0 || (draft && (draft.fur.length > 0 || draft.lining.length > 0)) || (parsed.data.liningMaterialId && parsed.data.liningQuantity)) {
        await tx.productionOrder.update({ where: { id: order.id }, data: { status: "IN_PROGRESS" } });
      }

      return { id: order.id, label: parsed.data.workOrderNumber ? `ТЗ №${parsed.data.workOrderNumber}` : number };
    });
  } catch (e) {
    return { errors: [e instanceof Error ? e.message : "Не удалось создать ТЗ"] };
  }

  revalidateAll(organizationId);
  // «Сохранить и добавить ещё»: остаёмся на форме, ссылка на созданное ТЗ — в сообщении.
  if (formData.get("intent") === "again") return { created: { id: orderId.id, label: orderId.label } };
  redirect(`/production/${orderId.id}`);
}

// Consumes `quantity` metres of a lining fabric's pooled stock for a
// freshly created order's lining pick (see createProductionOrder above).
// Draws oldest-lot-first like applyBomToOrder, but validates the *total*
// available across all of this fabric's lots up front so the error message
// names the fabric and the real shortage instead of an arbitrary lot's
// partial one.
async function consumeLiningForOrder(
  tx: Prisma.TransactionClient,
  args: { organizationId: string; orderId: string; rawMaterialId: string; quantity: number }
) {
  const material = await tx.rawMaterial.findFirst({
    where: { id: args.rawMaterialId, organizationId: args.organizationId },
  });
  if (!material) throw new Error("Ткань подкладки не найдена");

  const lots = await tx.rawMaterialLot.findMany({
    where: { organizationId: args.organizationId, rawMaterialId: args.rawMaterialId, quantityRemaining: { gt: 0 } },
    orderBy: { receivedDate: "asc" },
  });

  const requested = new Decimal(args.quantity);
  const available = lots.reduce((s, l) => s.add(l.quantityRemaining), new Decimal(0));
  if (available.lessThan(requested)) {
    throw new Error(
      `недостаточно ткани «${material.name}»: остаток ${available.toString()} м, запрошено ${requested.toString()} м`
    );
  }

  let remaining = requested;
  for (const lot of lots) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const take = Decimal.min(remaining, lot.quantityRemaining);

    const { unitCost, totalCost, rawMaterialId } = await consumeFromLot(tx, {
      organizationId: args.organizationId,
      lotId: lot.id,
      quantity: take,
      productionOrderId: args.orderId,
    });

    await tx.productionMaterialUsage.create({
      data: {
        productionOrderId: args.orderId,
        rawMaterialId,
        lotId: lot.id,
        quantity: take,
        unitCost,
        totalCost,
      },
    });

    remaining = remaining.sub(take);
  }
}

// Editing a ТЗ's own core fields after creation — model/quantity/color/
// size/material description/lining text/dates/client/contract/work-order
// info/work price/notes. Before this, the only way to fix a mistyped field
// was a raw DB edit, which the golden rule (never invent data) makes
// especially costly to get wrong by hand.
//
// Two fields get a guard instead of being silently accepted or silently
// dropped, following the same locked-identity philosophy as
// updatePurchaseItem (8b24d5c): once real activity has happened against a
// value, changing it out from under that activity would either orphan
// history or silently mis-cost it, so it's blocked with an explicit error
// naming why, rather than swallowed:
// - productModelId: the order's materialDescription/lining free text and
//   its BOM-driven "apply norm" button (applyBomToOrder) both describe
//   *this* model. Once any material has been used or the order has a
//   produced quantity, the model is locked — matches how updatePurchaseItem
//   locks rawMaterialId once a lot exists and may be consumed.
// - plannedQuantity: can be raised freely, but never lowered below
//   producedQuantity already recorded — can't plan for less than what's
//   already been made.
// rawWarehouseId/finishedWarehouseId are intentionally NOT guarded here:
// material usages reference their own lot (which carries its own
// warehouse), and finished-goods stock is keyed by the order's *current*
// warehouseId at completion time, already fixed by then — so a later
// warehouse correction on the order header has no dangling reference to
// invalidate.
const editOrderSchema = z.object({
  productModelId: z.string().min(1, "Выберите модель изделия"),
  rawWarehouseId: z.string().min(1, "Выберите склад сырья"),
  finishedWarehouseId: z.string().min(1, "Выберите склад готовой продукции"),
  plannedQuantity: zNum("Плановое количество", { positive: true, max: MAX_QTY }),
});

export async function updateProductionOrder(orderId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId },
  });
  if (!order) return { error: "ТЗ не найдено" };
  const stale = staleError(formData, order, ORDER_V, order.updatedAt);
  if (stale) return { error: stale };

  const parsed = editOrderSchema.safeParse({
    productModelId: formData.get("productModelId"),
    rawWarehouseId: formData.get("rawWarehouseId"),
    // Склад готовой продукции в интерфейсе не выбирается (склад один): без поля остаётся прежний склад ТЗ.
    finishedWarehouseId: (formData.get("finishedWarehouseId") as string | null) || order.finishedWarehouseId,
    plannedQuantity: formData.get("plannedQuantity"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const clientIdRaw = (formData.get("clientId") as string | null)?.trim() || null;
  const badRef = await checkOrgRefs(session.user.organizationId, {
    productModel: parsed.data.productModelId,
    client: clientIdRaw,
    warehouse: [parsed.data.rawWarehouseId, parsed.data.finishedWarehouseId],
  });
  if (badRef) return { error: badRef };

  const newPlannedQuantity = new Decimal(parsed.data.plannedQuantity);
  if (newPlannedQuantity.lessThan(order.producedQuantity)) {
    return {
      error: `Плановое количество не может быть меньше уже произведённого (${order.producedQuantity.toString()} шт.)`,
    };
  }

  // Free-text/reference fields read straight off formData rather than
  // through a z.string().optional() schema: that treats a blank field as
  // "not specified" (right at creation, where blank means "leave unset"),
  // but on an edit blank means "clear it" — same bug class already fixed
  // for purchase-item and production-expense edits (b17a9bd), avoided here
  // by mapping blank to `null` explicitly instead of `undefined`.
  const colorRes = await resolveColorInput(prisma, session.user.organizationId, { color: (formData.get("color") as string) ?? "", colorRefId: formData.get("colorRefId") as string | null });
  const color = colorRes.color;
  const size = (formData.get("size") as string)?.trim() || null;
  const materialDescription = (formData.get("materialDescription") as string)?.trim() || null;
  const lining = (formData.get("lining") as string)?.trim() || null;
  const notes = (formData.get("notes") as string)?.trim() || null;
  const clientId = (formData.get("clientId") as string)?.trim() || null;
  const contractNumber = (formData.get("contractNumber") as string)?.trim() || null;
  const workOrderNumber = (formData.get("workOrderNumber") as string)?.trim() || null;

  const startDateRaw = (formData.get("startDate") as string)?.trim();
  const startDate = startDateRaw ? parseDateInput(startDateRaw) : null;
  if (startDateRaw && !startDate) return { error: "Некорректная дата начала" };

  const workOrderDateRaw = (formData.get("workOrderDate") as string)?.trim();
  const workOrderDate = workOrderDateRaw ? parseDateInput(workOrderDateRaw) : null;
  if (workOrderDateRaw && !workOrderDate) return { error: "Некорректная дата ТЗ" };

  const clientWorkPriceRaw = (formData.get("clientWorkPricePerUnit") as string)?.trim();
  let clientWorkPricePerUnit: Decimal | null = null;
  if (clientWorkPriceRaw) {
    const n = parseNumber(clientWorkPriceRaw, "Стоимость работ за ед.");
    if ("error" in n) return { error: n.error };
    clientWorkPricePerUnit = new Decimal(n.value);
  }

  // Партия — необязательное поле формы правки: меняем только если оно пришло (пусто = «без партии»);
  // можно выбрать из списка (batchId) или ввести новый номер (batchNumber) — тогда партия создаётся.
  const batchRes = await resolveBatchChange(session.user.organizationId, order, formData, workOrderDate ?? startDate);
  if ("error" in batchRes) return { error: batchRes.error };
  const batchPatch = batchRes.patch;

  // Смена артикула (в том числе у ТЗ со списаниями и завершённого): списания и себестоимость остаются, меняется только артикул ТЗ.
  // Цена продажи ТЗ — свойство артикула (проверка «Цена продажи ТЗ = цена артикула»), поэтому берём цену нового артикула, если она задана.
  let retailPatch: { retailPrice?: Decimal } = {};
  if (parsed.data.productModelId !== order.productModelId) {
    const nm = await prisma.productModel.findFirst({ where: { id: parsed.data.productModelId, organizationId: session.user.organizationId }, select: { sellingPrice: true } });
    if (nm?.sellingPrice != null) retailPatch = { retailPrice: nm.sellingPrice };
  }

  await prisma.productionOrder.update({
    where: { id: orderId },
    data: {
      ...batchPatch,
      ...retailPatch,
      productModelId: parsed.data.productModelId,
      rawWarehouseId: parsed.data.rawWarehouseId,
      finishedWarehouseId: parsed.data.finishedWarehouseId,
      plannedQuantity: newPlannedQuantity,
      color,
      colorRefId: colorRes.colorRefId,
      size,
      materialDescription,
      lining,
      startDate,
      notes,
      clientId,
      contractNumber,
      workOrderNumber,
      workOrderDate,
      clientWorkPricePerUnit,
    },
  });

  await resetByOrder(orderId);
  await afterBatchChange(session.user.organizationId, orderId, batchRes);
  revalidateAll(session.user.organizationId);
  return {};
}

/** Поля ТЗ, которые правятся по месту в таблице «Параметры ТЗ» (одно поле за раз). */
const PATCH_FIELDS = new Set([
  "productModelId", "rawWarehouseId", "finishedWarehouseId", "plannedQuantity", "producedQuantity", "colorRefId", "color", "size",
  "materialDescription", "lining", "startDate", "notes", "clientId", "batchId", "contractNumber", "workOrderNumber",
  "workOrderDate", "clientWorkPricePerUnit", "endDate",
]);

/**
 * Правка ОДНОГО поля ТЗ по месту. Берёт текущие значения ТЗ, подменяет одно и отдаёт в updateProductionOrder —
 * поэтому валидация, блокировки (модель после списаний), сброс подтверждения и пересчёт (revalidateAll) те же, что у формы «Изменить».
 * «Произведено» (producedQuantity) правится только у завершённого ТЗ — через updateProducedQuantity.
 */
export async function patchProductionOrder(orderId: string, field: string, value: string): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  if (!PATCH_FIELDS.has(field)) return { error: "Это поле здесь не редактируется" };
  const order = await prisma.productionOrder.findFirst({ where: { id: orderId, organizationId: session.user.organizationId } });
  if (!order) return { error: "ТЗ не найдено" };
  const v = value.trim();
  if (field === "producedQuantity") {
    const fd = new FormData();
    fd.set("producedQuantity", v);
    return updateProducedQuantity(orderId, {}, fd);
  }
  if (field === "endDate") {
    // Дата окончания обычно ставится при завершении; здесь её можно поправить (от неё зависит год ТЗ в сводках).
    let end: Date | null = null;
    if (v) {
      end = parseDateInput(v);
      if (!end) return { error: "Некорректная дата окончания" };
    }
    await prisma.productionOrder.update({ where: { id: orderId }, data: { endDate: end } });
    await resetByOrder(orderId);
    revalidateAll(session.user.organizationId);
    return {};
  }
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const fd = new FormData();
  fd.set("productModelId", order.productModelId);
  fd.set("rawWarehouseId", order.rawWarehouseId);
  fd.set("finishedWarehouseId", order.finishedWarehouseId);
  fd.set("plannedQuantity", order.plannedQuantity.toString());
  fd.set("color", order.color ?? "");
  fd.set("colorRefId", order.colorRefId ?? "");
  fd.set("size", order.size ?? "");
  fd.set("materialDescription", order.materialDescription ?? "");
  fd.set("lining", order.lining ?? "");
  fd.set("startDate", day(order.startDate));
  fd.set("notes", order.notes ?? "");
  fd.set("clientId", order.clientId ?? "");
  fd.set("contractNumber", order.contractNumber ?? "");
  fd.set("workOrderNumber", order.workOrderNumber ?? "");
  fd.set("workOrderDate", day(order.workOrderDate));
  fd.set("clientWorkPricePerUnit", order.clientWorkPricePerUnit?.toString() ?? "");
  // Партия меняется, только если поле пришло (см. resolveBatchChange).
  if (field === "colorRefId") {
    fd.set("colorRefId", v);
    fd.set("color", "");
  } else if (field === "color") {
    // Свободный ввод цвета: сервер сам привяжет его к справочнику по названию/синониму либо сохранит текстом.
    fd.set("color", v);
    fd.set("colorRefId", "");
  } else {
    fd.set(field, v);
  }
  return updateProductionOrder(orderId, fd);
}

type BatchChange = { patch: { batchId: string | null } | Record<string, never>; oldBatchId: string | null; oldNumber: number | null; newBatchId: string | null; newNumber: number | null; changed: boolean };

/**
 * Партия ТЗ: из списка (поле batchId) или новый номер (поле batchNumber — партия создаётся, если такого номера ещё нет).
 * Поля нет в форме — партия не меняется. Год новой партии берётся только из даты ТЗ (если она есть), иначе остаётся пустым.
 */
async function resolveBatchChange(
  orgId: string,
  order: { batchId: string | null },
  formData: FormData,
  dateHint: Date | null,
): Promise<BatchChange | { error: string }> {
  const old = order.batchId ? await prisma.productionBatch.findUnique({ where: { id: order.batchId }, select: { id: true, number: true } }) : null;
  const base = { oldBatchId: old?.id ?? null, oldNumber: old?.number ?? null };
  const idRaw = ((formData.get("batchId") as string | null) ?? "").trim();
  const numRaw = ((formData.get("batchNumber") as string | null) ?? "").trim();
  if (!formData.has("batchId") && !numRaw) return { patch: {}, ...base, newBatchId: base.oldBatchId, newNumber: base.oldNumber, changed: false };
  let target: { id: string; number: number } | null = null;
  if (numRaw) {
    if (!/^\d{1,4}$/.test(numRaw) || Number(numRaw) < 1) return { error: "Номер партии — целое число от 1 до 9999" };
    const number = Number(numRaw);
    target =
      (await prisma.productionBatch.findFirst({ where: { organizationId: orgId, number }, select: { id: true, number: true } })) ??
      (await prisma.productionBatch.create({
        data: { organizationId: orgId, number, name: `Поставка ${number}`, year: dateHint ? dateHint.getUTCFullYear() : null },
        select: { id: true, number: true },
      }));
  } else if (idRaw) {
    target = await prisma.productionBatch.findFirst({ where: { id: idRaw, organizationId: orgId }, select: { id: true, number: true } });
    if (!target) return { error: "Партия не найдена" };
  }
  return { patch: { batchId: target?.id ?? null }, ...base, newBatchId: target?.id ?? null, newNumber: target?.number ?? null, changed: (target?.id ?? null) !== base.oldBatchId };
}

/** После смены партии: сбросить проверку старой партии, обновить кэши страниц, где участвует партия (итоги партии, оплаты, сводки, аналитика). */
async function afterBatchChange(orgId: string, orderId: string, r: BatchChange) {
  if (!r.changed) return;
  if (r.oldBatchId) await resetByBatch(orgId, r.oldBatchId);
  revalidateAll(orgId);
}

/** Быстрое назначение партии прямо из карточки ТЗ (блок «Партия»): выбрать из списка или ввести новый номер; пусто — «без партии». */
export async function assignOrderBatch(orderId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId },
    select: { id: true, batchId: true, workOrderDate: true, endDate: true, startDate: true },
  });
  if (!order) return { error: "ТЗ не найдено" };
  if (!formData.has("batchId")) formData.set("batchId", "");
  const r = await resolveBatchChange(session.user.organizationId, order, formData, order.workOrderDate ?? order.endDate ?? order.startDate);
  if ("error" in r) return { error: r.error };
  if (r.changed) {
    await prisma.productionOrder.update({ where: { id: orderId }, data: r.patch });
    await resetByOrder(orderId);
  }
  await afterBatchChange(session.user.organizationId, orderId, r);
  revalidateAll(session.user.organizationId);
  return {};
}

// Retail price is really an attribute of the article, not of one specific
// ТЗ (matches the source spreadsheet, where "ПРЦ" is one number per
// article) — so setting it here also updates the ProductModel, and every
// other open/completed order of that model, so /articles and every ТЗ of
// this model show the same price and markup without drifting apart.
export async function updateRetailPrice(orderId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  // Empty must not become 0 (z.coerce turns "" into 0) and 0 must never
  // overwrite the article's sellingPrice: both are rejected explicitly.
  const priceRes = parsePrice(formData.get("retailPrice"));
  if ("error" in priceRes) return { error: priceRes.error };
  const price = priceRes.value;

  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId },
  });
  if (!order) return { error: "ТЗ не найдено" };

  await prisma.$transaction([
    prisma.productionOrder.updateMany({
      where: { productModelId: order.productModelId, organizationId: session.user.organizationId },
      data: { retailPrice: price },
    }),
    prisma.productModel.update({
      where: { id: order.productModelId },
      data: { sellingPrice: price },
    }),
  ]);

  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
  return {};
}

// Any ТЗ can be edited regardless of status — completed orders are the
// normal case once the historical registry is imported, and mistakes in
// what was entered (wrong lot, wrong quantity, a forgotten expense) need
// to stay fixable. See syncCompletedOrderCost below for how a COMPLETED
// order's fixed cost snapshot (and the finished-goods stock valuation it
// already fed) stays correct after such an edit.
async function getEditableOrder(organizationId: string, orderId: string) {
  return prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId },
    include: { productModel: { include: { materials: true } }, batch: { select: { number: true } } },
  });
}

/**
 * «Начислять 4%» из формы списания: чекбокс commission4 при маркере c4form=1 (снятый чекбокс браузер не шлёт);
 * без маркера (импорт/старые формы) — по умолчанию: true, для ТЗ из партии 6 — false.
 */
function readCommission4(formData: FormData, batchNumber: number | null | undefined): boolean {
  if (formData.get("c4form") === "1") return formData.get("commission4") === "on";
  return defaultCommission4(batchNumber);
}

/**
 * After a material-usage or expense edit on a COMPLETED order, recomputes
 * materialCost/expenseCost/totalCost/unitCost from the current lines (same
 * formula as completeProductionOrder) and carries the resulting delta into
 * the finished-goods stock valuation this order already fed at completion
 * time, so /finished-stock and /articles don't go stale. No-op for
 * PLANNED/IN_PROGRESS orders (nothing snapshotted yet) or zero-quantity ones.
 */
async function syncCompletedOrderCost(tx: Prisma.TransactionClient, orderId: string, organizationId: string) {
  const order = await tx.productionOrder.findUnique({
    where: { id: orderId },
    include: { materialUsages: true, expenses: true },
  });
  if (!order || order.status !== "COMPLETED" || order.producedQuantity.isZero()) return;

  const materialCost = order.materialUsages.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
  const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const totalCost = materialCost.add(expenseCost);
  const unitCost = totalCost.div(order.producedQuantity);
  const delta = totalCost.sub(order.totalCost ?? new Decimal(0));

  await tx.productionOrder.update({
    where: { id: orderId },
    data: { materialCost, expenseCost, totalCost, unitCost },
  });

  if (delta.isZero()) return;

  const stock = await tx.finishedGoodsStock.findUnique({
    where: {
      warehouseId_productModelId: { warehouseId: order.finishedWarehouseId, productModelId: order.productModelId },
    },
  });
  if (!stock) return;

  const newTotalValue = stock.quantity.mul(stock.avgUnitCost).add(delta);
  const newAvgUnitCost = stock.quantity.isZero() ? stock.avgUnitCost : newTotalValue.div(stock.quantity);
  await tx.finishedGoodsStock.update({ where: { id: stock.id }, data: { avgUnitCost: newAvgUnitCost } });
  await tx.finishedGoodsMovement.create({
    data: {
      organizationId,
      warehouseId: order.finishedWarehouseId,
      productModelId: order.productModelId,
      type: delta.greaterThan(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
      quantity: 0,
      unitCost: order.producedQuantity.isZero() ? 0 : delta.abs().div(order.producedQuantity),
      totalCost: delta.abs(),
      productionOrderId: orderId,
      notes: "Корректировка себестоимости после правки завершённого ТЗ",
    },
  });
}

// ---------- Material consumption (draws from a specific lot — see src/lib/stock.ts) ----------

const usageSchema = z.object({
  lotId: z.string().min(1, "Выберите лот"),
  quantity: zNum("Количество", { positive: true, max: MAX_QTY }),
});

export async function addMaterialUsage(orderId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return { error: "ТЗ не найдено" };

  const parsed = usageSchema.safeParse({
    lotId: formData.get("lotId"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  try {
    await prisma.$transaction(async (tx) => {
      const { unitCost, totalCost, rawMaterialId } = await consumeFromLot(tx, {
        organizationId: session.user.organizationId,
        lotId: parsed.data.lotId,
        quantity: parsed.data.quantity,
        productionOrderId: orderId,
      });

      await tx.productionMaterialUsage.create({
        data: {
          productionOrderId: orderId,
          rawMaterialId,
          lotId: parsed.data.lotId,
          quantity: parsed.data.quantity,
          unitCost,
          totalCost,
          commission4: readCommission4(formData, order.batch?.number),
        },
      });

      if (order.status === "PLANNED") {
        await tx.productionOrder.update({ where: { id: orderId }, data: { status: "IN_PROGRESS" } });
      }
      await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Не удалось списать сырьё" };
  }

  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
  return {};
}

// Bulk entry: paste "лот  количество" pairs (one per line) copied straight
// from a ТЗ spreadsheet. Same parser and separators as ТЗ creation (Tab, ';',
// two+ spaces, single space) and the same all-or-nothing rule: any bad line
// (listed with its reason) means nothing is written off.
export type BulkUsageState = { error?: string; errors?: string[]; created?: number };

export async function addMaterialUsagesBulk(
  orderId: string,
  _prev: BulkUsageState,
  formData: FormData
): Promise<BulkUsageState> {
  const session = await requireRole(...EDIT_ROLES);
  const organizationId = session.user.organizationId;
  const order = await getEditableOrder(organizationId, orderId);
  if (!order) return { error: "ТЗ не найдено" };

  const raw = ((formData.get("rows") as string | null) ?? "").toString();
  if (!raw.trim()) return { error: "Вставьте хотя бы одну строку" };

  const { lines, errors } = parseLotLines(raw);
  const res = await resolveLotLines(organizationId, lines, order.rawWarehouseId);
  errors.push(...res.errors);
  if (errors.length > 0) {
    const lineNo = (e: string) => Number(/^строка (\d+)/.exec(e)?.[1] ?? 0);
    return { errors: errors.sort((a, b) => lineNo(a) - lineNo(b)) };
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const r of res.resolved) {
        try {
          const { unitCost, totalCost, rawMaterialId } = await consumeFromLot(tx, {
            organizationId,
            lotId: r.lotId,
            quantity: r.quantity,
            productionOrderId: orderId,
          });
          await tx.productionMaterialUsage.create({
            data: {
              productionOrderId: orderId,
              rawMaterialId,
              lotId: r.lotId,
              quantity: r.quantity,
              unitCost,
              totalCost,
              commission4: readCommission4(formData, order.batch?.number),
            },
          });
        } catch (e) {
          throw new Error(`строка ${r.line}: ${e instanceof Error ? e.message : "не удалось списать"}`);
        }
      }
      if (order.status === "PLANNED") {
        await tx.productionOrder.update({ where: { id: orderId }, data: { status: "IN_PROGRESS" } });
      }
      await syncCompletedOrderCost(tx, orderId, organizationId);
    });
  } catch (e) {
    return { errors: [e instanceof Error ? e.message : "Не удалось списать"] };
  }

  await resetByOrder(orderId);
  revalidateAll(organizationId);
  return { created: res.resolved.length };
}

/**
 * Consumes the BOM-defined quantities for the order's planned quantity,
 * picking lots automatically (oldest received first) until each material's
 * required quantity is covered — a quick-fill convenience. Each line is
 * still a normal ProductionMaterialUsage the technologist can review/undo;
 * for deliberate lot choice (matching skins by color/quality) use the
 * manual form instead.
 */
export async function applyBomToOrder(orderId: string): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return { error: "ТЗ не найдено" };
  if (order.productModel.materials.length === 0) {
    return { error: "У модели не задан состав" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const line of order.productModel.materials) {
        let remaining = line.quantityPerUnit.mul(order.plannedQuantity);

        const availableLots = await tx.rawMaterialLot.findMany({
          where: {
            organizationId: session.user.organizationId,
            warehouseId: order.rawWarehouseId,
            rawMaterialId: line.rawMaterialId,
            quantityRemaining: { gt: 0 },
          },
          orderBy: { receivedDate: "asc" },
        });

        for (const lot of availableLots) {
          if (remaining.lessThanOrEqualTo(0)) break;
          const take = Decimal.min(remaining, lot.quantityRemaining);

          const { unitCost, totalCost } = await consumeFromLot(tx, {
            organizationId: session.user.organizationId,
            lotId: lot.id,
            quantity: take,
            productionOrderId: orderId,
            notes: "Списано по составу",
          });

          await tx.productionMaterialUsage.create({
            data: {
              productionOrderId: orderId,
              rawMaterialId: line.rawMaterialId,
              lotId: lot.id,
              quantity: take,
              unitCost,
              totalCost,
            },
          });

          remaining = remaining.sub(take);
        }

        if (remaining.greaterThan(0)) {
          throw new Error(
            `Недостаточно сырья «${(await tx.rawMaterial.findUnique({ where: { id: line.rawMaterialId } }))?.name}» на складе (не хватает ${remaining.toString()})`
          );
        }
      }

      if (order.status === "PLANNED") {
        await tx.productionOrder.update({ where: { id: orderId }, data: { status: "IN_PROGRESS" } });
      }
      await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Не удалось списать по составу" };
  }

  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
  return {};
}

export async function removeMaterialUsage(orderId: string, usageId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return;

  const usage = await prisma.productionMaterialUsage.findFirst({
    where: { id: usageId, productionOrderId: orderId },
  });
  if (!usage) return;

  await prisma.$transaction(async (tx) => {
    await returnToLot(tx, {
      organizationId: session.user.organizationId,
      lotId: usage.lotId,
      quantity: usage.quantity,
    });
    await tx.productionMaterialUsage.delete({ where: { id: usageId } });
    await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
  });

  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
}

/**
 * Ставка НДС строки списания (по месту в карточке ТЗ). Пусто или равно ставке лота — NULL («как в лоте»).
 * Сумма с НДС (totalCost) не меняется: от ставки зависит только разбивка «без НДС / НДС».
 */
export async function updateUsageVat(orderId: string, usageId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return { error: "ТЗ не найдено" };

  const usage = await prisma.productionMaterialUsage.findFirst({
    where: { id: usageId, productionOrderId: orderId },
    select: { id: true, lot: { select: { vatRate: true } } },
  });
  if (!usage) return { error: "Списание не найдено" };

  const raw = String(formData.get("vatRate") ?? "").trim().replace(",", ".");
  let vatRate: Decimal | null = null;
  if (raw !== "") {
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { error: "НДС: число от 0 до 100, например 20 или 22" };
    const v = new Decimal(raw);
    if (v.gt(100)) return { error: "НДС не может быть больше 100%" };
    vatRate = v.eq(usage.lot.vatRate) ? null : v;
  }
  await prisma.productionMaterialUsage.update({ where: { id: usageId }, data: { vatRate } });
  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
  return {};
}

// Editing an already-entered usage line — same underlying fix as
// updatePurchaseItem, but the safety story is different: unlike a
// received purchase item (where consumption into production is
// deliberately out of scope to unwind), a COMPLETED order's cost snapshot
// is already designed to be recomputed after a material-usage edit —
// that's the whole job of syncCompletedOrderCost, which add/removeMaterialUsage
// already call regardless of order status (see getEditableOrder's comment).
// So there's no separate "was this order completed" block here: any lot/
// quantity change is applied by reversing the old consumption back onto its
// old lot and drawing the new quantity from the (possibly different) new
// lot, exactly like a remove+add would — consumeFromLot's own
// quantityRemaining check then naturally covers "can't consume more than
// what's left", correctly accounting for this usage's own current amount
// because that amount was just returned to the lot first.
export async function updateMaterialUsage(
  orderId: string,
  usageId: string,
  formData: FormData
): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return { error: "ТЗ не найдено" };


  const usage = await prisma.productionMaterialUsage.findFirst({
    where: { id: usageId, productionOrderId: orderId },
  });
  if (!usage) return { error: "Списание не найдено" };

  const parsed = usageSchema.safeParse({
    lotId: formData.get("lotId"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const commission4 = formData.get("c4form") === "1" ? formData.get("commission4") === "on" : usage.commission4;
  if (parsed.data.lotId === usage.lotId && new Decimal(parsed.data.quantity).eq(usage.quantity)) {
    if (commission4 !== usage.commission4) {
      await prisma.productionMaterialUsage.update({ where: { id: usageId }, data: { commission4 } });
      await resetByOrder(orderId);
      revalidateAll(session.user.organizationId);
    }
    return {};
  }

  try {
    await prisma.$transaction(async (tx) => {
      await returnToLot(tx, {
        organizationId: session.user.organizationId,
        lotId: usage.lotId,
        quantity: usage.quantity,
        notes: "Возврат перед правкой списания",
      });
      const { unitCost, totalCost, rawMaterialId } = await consumeFromLot(tx, {
        organizationId: session.user.organizationId,
        lotId: parsed.data.lotId,
        quantity: parsed.data.quantity,
        productionOrderId: orderId,
      });
      await tx.productionMaterialUsage.update({
        where: { id: usageId },
        data: { lotId: parsed.data.lotId, rawMaterialId, quantity: parsed.data.quantity, unitCost, totalCost, commission4 },
      });
      await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Не удалось изменить списание" };
  }

  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
  return {};
}

// ---------- Production expenses ----------

const expenseSchema = z.object({
  categoryId: z.string().min(1, "Выберите статью расходов"),
  amount: zNum("Сумма", { positive: true }),
  description: z.string().trim().max(500).optional(),
});

export async function addProductionExpense(orderId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return { error: "ТЗ не найдено" };

  const parsed = expenseSchema.safeParse({
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const badCat = await checkOrgRefs(session.user.organizationId, { expenseCategory: parsed.data.categoryId });
  if (badCat) return { error: badCat };

  await prisma.$transaction(async (tx) => {
    await tx.productionExpense.create({
      data: { productionOrderId: orderId, ...parsed.data },
    });
    await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
  });

  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
  return {};
}

export async function removeProductionExpense(orderId: string, expenseId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return;

  await prisma.$transaction(async (tx) => {
    // Только расход этого (своего) ТЗ: чужой id не удалится.
    await tx.productionExpense.deleteMany({ where: { id: expenseId, productionOrderId: orderId } });
    await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
  });
  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
}

// Editing an already-entered expense line — wrong category/amount or a typo
// in the description. No lot/stock side-effects to reverse here (unlike
// material usage), so this is a plain update plus the same
// syncCompletedOrderCost cascade add/removeProductionExpense already run.
// `description` is read straight off formData rather than through
// expenseSchema's `.optional()` parsing: that treats a blank field as "not
// specified" (right for addProductionExpense, where blank means "leave
// unset"), but on an edit blank means "clear it", and Prisma reads
// `undefined` as "don't touch this field" — the same bug just fixed for
// purchase-item edits in b17a9bd, avoided here by mapping blank to `null`
// explicitly instead of reusing parsed.data.description.
export async function updateProductionExpense(
  orderId: string,
  expenseId: string,
  formData: FormData
): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return { error: "ТЗ не найдено" };


  const expense = await prisma.productionExpense.findFirst({
    where: { id: expenseId, productionOrderId: orderId },
  });
  if (!expense) return { error: "Расход не найден" };

  const parsed = z
    .object({
      categoryId: z.string().min(1, "Выберите статью расходов"),
      amount: zNum("Сумма", { positive: true }),
    })
    .safeParse({
      categoryId: formData.get("categoryId"),
      amount: formData.get("amount"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const badCat = await checkOrgRefs(session.user.organizationId, { expenseCategory: parsed.data.categoryId });
  if (badCat) return { error: badCat };

  const description = (formData.get("description") as string)?.trim() || null;

  await prisma.$transaction(async (tx) => {
    await tx.productionExpense.update({
      where: { id: expense.id },
      data: { categoryId: parsed.data.categoryId, amount: parsed.data.amount, description },
    });
    await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
  });

  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
  return {};
}

// ---------- Completion: snapshots cost and receives finished goods ----------

const completeSchema = z.object({
  producedQuantity: zNum("Количество", { positive: true, max: MAX_QTY }),
});

export async function completeProductionOrder(
  orderId: string,
  formData: FormData
): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
    include: { materialUsages: true, expenses: true },
  });
  if (!order) return { error: "ТЗ не найдено" };
  if (order.materialUsages.length === 0) {
    return {
      error:
        "Нельзя завершить ТЗ без списаний сырья — продукция встала бы на склад с нулевой себестоимостью. Сначала спишите сырьё.",
    };
  }

  const parsed = completeSchema.safeParse({ producedQuantity: formData.get("producedQuantity") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const materialCost = order.materialUsages.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
  const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const totalCost = materialCost.add(expenseCost);
  const unitCost = totalCost.div(parsed.data.producedQuantity);

  const raced = await prisma.$transaction(async (tx) => {
    // Атомарный переход статуса: две вкладки не должны оприходовать продукцию дважды.
    const moved = await tx.productionOrder.updateMany({
      where: { id: orderId, organizationId: session.user.organizationId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
      data: { status: "COMPLETED" },
    });
    if (moved.count === 0) return true;
    await tx.productionOrder.update({
      where: { id: orderId },
      data: {
        status: "COMPLETED",
        producedQuantity: parsed.data.producedQuantity,
        materialCost,
        expenseCost,
        totalCost,
        unitCost,
        endDate: new Date(),
      },
    });

    await receiveFinishedGoodsStock(tx, {
      organizationId: session.user.organizationId,
      warehouseId: order.finishedWarehouseId,
      productModelId: order.productModelId,
      quantity: parsed.data.producedQuantity,
      unitCost,
      totalCost,
      type: "PRODUCTION_IN",
      productionOrderId: orderId,
    });
    return false;
  });
  if (raced) return { error: "ТЗ уже завершено" };

  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
  return {};
}

// Correcting the produced quantity after completion (e.g. an import typo)
// changes unitCost too (same total cost, different divisor) and needs its
// own finished-goods adjustment, since the quantity fed to stock changes,
// not just its cost — syncCompletedOrderCost only handles the cost-only
// case, so this is a separate, quantity-aware adjustment.
export async function updateProducedQuantity(
  orderId: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = zNum("Количество", { positive: true, max: MAX_QTY }).safeParse(formData.get("producedQuantity"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId, status: "COMPLETED" },
  });
  if (!order) return { error: "ТЗ не найдено или ещё не завершено" };

  const newQuantity = new Decimal(parsed.data as number);
  if (newQuantity.equals(order.producedQuantity)) return {};

  const totalCost = order.totalCost ?? new Decimal(0);
  const newUnitCost = totalCost.div(newQuantity);
  const oldContribution = order.producedQuantity.mul(order.unitCost ?? new Decimal(0));
  const newContribution = newQuantity.mul(newUnitCost);

  await prisma.$transaction(async (tx) => {
    await tx.productionOrder.update({
      where: { id: orderId },
      data: { producedQuantity: newQuantity, unitCost: newUnitCost },
    });

    const stock = await tx.finishedGoodsStock.findUnique({
      where: {
        warehouseId_productModelId: { warehouseId: order.finishedWarehouseId, productModelId: order.productModelId },
      },
    });
    if (!stock) return;

    const newStockQuantity = stock.quantity.sub(order.producedQuantity).add(newQuantity);
    const newStockValue = stock.quantity.mul(stock.avgUnitCost).sub(oldContribution).add(newContribution);
    const newAvgUnitCost = newStockQuantity.isZero() ? stock.avgUnitCost : newStockValue.div(newStockQuantity);

    await tx.finishedGoodsStock.update({
      where: { id: stock.id },
      data: { quantity: newStockQuantity, avgUnitCost: newAvgUnitCost },
    });
    await tx.finishedGoodsMovement.create({
      data: {
        organizationId: session.user.organizationId,
        warehouseId: order.finishedWarehouseId,
        productModelId: order.productModelId,
        type: newQuantity.greaterThan(order.producedQuantity) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
        quantity: newQuantity.sub(order.producedQuantity).abs(),
        unitCost: newUnitCost,
        totalCost: newContribution.sub(oldContribution).abs(),
        productionOrderId: orderId,
        notes: "Корректировка фактически произведённого количества после завершения ТЗ",
      },
    });
  });

  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
  return {};
}

// ---------- Payments from the client (separate ledger from supplier payments) ----------

const productionPaymentSchema = z.object({
  amount: zNum("Сумма", { positive: true }),
  paymentType: z.enum(["ADVANCE", "PARTIAL", "FINAL"]),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"], { message: "Выберите способ оплаты" }),
  paidAt: z
    .string()
    .min(1, "Укажите дату оплаты")
    .refine((s) => parseDateInput(s) !== null, "Некорректная дата оплаты"),
  notes: z.string().trim().max(1000).optional(),
});

// One payment can cover several ТЗ at once (a client paying a lump sum
// against a running tab) — orderId is always included, plus whichever
// sibling orders (same client) were checked in the form.
export async function addProductionPayment(orderId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId },
  });
  if (!order) return { error: "ТЗ не найдено" };
  if (order.status === "CANCELLED") return { error: CANCELLED_ERROR };

  const parsed = productionPaymentSchema.safeParse({
    amount: formData.get("amount"),
    paymentType: formData.get("paymentType") || "FINAL",
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue?.path[0] === "paidAt" ? "Укажите дату оплаты" : issue?.message };
  }

  const extraOrderIds = formData.getAll("orderIds").map(String);
  const orderIds = Array.from(new Set([orderId, ...extraOrderIds]));
  const validOrders = await prisma.productionOrder.findMany({
    where: {
      id: { in: orderIds },
      organizationId: session.user.organizationId,
      OR: [{ id: orderId }, { status: { not: "CANCELLED" } }],
    },
    select: { id: true },
  });

  // Платёж и его разнесение по ТЗ (пропорционально работе, в пределах остатка работы) — одной транзакцией.
  await prisma.$transaction(async (tx) => {
    const created = await tx.productionPayment.create({
      data: {
        organizationId: session.user.organizationId,
        clientId: order.clientId,
        amount: parsed.data.amount,
        paymentType: parsed.data.paymentType,
        method: parsed.data.method,
        status: "COMPLETED",
        paidAt: new Date(parsed.data.paidAt),
        notes: parsed.data.notes,
        orders: { create: validOrders.map((o) => ({ productionOrderId: o.id })) },
      },
    });
    await autoAllocatePayment(tx, session.user.organizationId, created.id);
  });

  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
  for (const id of orderIds) await resetByOrder(id);
  return {};
}

export async function removeProductionPayment(orderId: string, paymentId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId },
  });
  if (!order) return;

  const payment = await prisma.productionPayment.findFirst({
    where: {
      id: paymentId,
      organizationId: session.user.organizationId,
      orders: { some: { productionOrderId: orderId } },
    },
    include: { orders: true },
  });
  if (!payment) return;

  await prisma.productionPayment.delete({ where: { id: paymentId } });
  for (const alloc of payment.orders) await resetByOrder(alloc.productionOrderId);
  revalidateAll(session.user.organizationId);
}

/**
 * Правка оплаты работы: сумма, тип, способ, дата, № п/п, заметка и набор ТЗ, которые она покрывает.
 * Остаток по ТЗ и по партии пересчитывается сам (он считается из оплат); «подтверждено» сбрасывается.
 */
export async function updateProductionPayment(orderId: string, paymentId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const payment = await prisma.productionPayment.findFirst({
    where: { id: paymentId, organizationId: orgId, orders: { some: { productionOrderId: orderId } } },
    include: { orders: { select: { productionOrderId: true } } },
  });
  if (!payment) return { error: "Оплата не найдена (возможно, уже удалена)" };
  const stale = staleError(formData, payment, PRODUCTION_PAYMENT_V);
  if (stale) return { error: stale };
  const parsed = productionPaymentSchema.safeParse({
    amount: formData.get("amount"),
    paymentType: formData.get("paymentType") || payment.paymentType,
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue?.path[0] === "paidAt" ? "Укажите дату оплаты" : issue?.message };
  }
  const wanted = Array.from(new Set(formData.getAll("orderIds").map(String).filter(Boolean)));
  if (wanted.length === 0) return { error: "Отметьте хотя бы одно ТЗ, которое покрывает оплата" };
  const valid = await prisma.productionOrder.findMany({
    where: { id: { in: wanted }, organizationId: orgId },
    select: { id: true },
  });
  if (valid.length !== wanted.length) return { error: "Одно из выбранных ТЗ не найдено — обновите страницу" };
  const docRef = (formData.get("docRef") as string)?.trim().slice(0, 200) || null;
  const oldIds = payment.orders.map((o) => o.productionOrderId);

  // Разнесение по ТЗ: строки на ТЗ, которые платёж больше не покрывает, снимаются; Σ разнесений не может превысить новую сумму.
  const keptAlloc = await prisma.paymentAllocation.findMany({ where: { productionPaymentId: paymentId, productionOrderId: { in: wanted } }, select: { amount: true, source: true } });
  const keptSum = keptAlloc.reduce((s, a) => s.add(a.amount), new Decimal(0));
  if (keptAlloc.some((a) => a.source === "MANUAL") && keptSum.greaterThan(new Decimal(String(parsed.data.amount)))) {
    return { error: `Новая сумма меньше уже разнесённого вручную по ТЗ (${Number(keptSum.toString()).toLocaleString("ru-RU", { minimumFractionDigits: 2 })} ₽). Сначала уменьшите разнесение оплаты.` };
  }
  await prisma.$transaction(async (tx) => {
    await tx.productionPayment.update({
      where: { id: paymentId },
      data: {
        amount: parsed.data.amount,
        paymentType: parsed.data.paymentType,
        method: parsed.data.method,
        paidAt: new Date(parsed.data.paidAt),
        notes: (formData.get("notes") as string)?.trim() || null,
        docRef,
      },
    });
    await tx.productionPaymentOrder.deleteMany({ where: { productionPaymentId: paymentId, productionOrderId: { notIn: wanted } } });
    await tx.paymentAllocation.deleteMany({ where: { productionPaymentId: paymentId, productionOrderId: { notIn: wanted } } });
    await tx.productionPaymentOrder.createMany({
      data: wanted.filter((id) => !oldIds.includes(id)).map((productionOrderId) => ({ productionPaymentId: paymentId, productionOrderId })),
      skipDuplicates: true,
    });
    await autoAllocatePayment(tx, orgId, paymentId);
  });
  const all = Array.from(new Set([...oldIds, ...wanted]));
  await resetByProdPayment(orgId, paymentId, all);
  revalidateAll(orgId);
  return {};
}

const batchSchema = z.object({
  number: z.string().regex(/^\d{1,4}$/, "Номер партии — целое число от 1 до 9999"),
  name: z.string().trim().max(200),
  year: z.string().trim().regex(/^(\d{4})?$/, "Год — четыре цифры"),
  plannedUnits: z.string().trim().regex(/^(\d{1,6})?$/, "План, шт. — целое число"),
  notes: z.string().trim().max(2000),
});

/** Правка партии: номер, название, год, план, примечание. Номер должен быть свободен; ТЗ, документы и оплаты остаются привязаны (связь по id). */
export async function updateProductionBatch(batchId: string, formData: FormData): Promise<FormState & { number?: number }> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const batch = await prisma.productionBatch.findFirst({ where: { id: batchId, organizationId: orgId } });
  if (!batch) return { error: "Партия не найдена" };
  const stale = staleError(formData, batch, BATCH_V);
  if (stale) return { error: stale };
  const parsed = batchSchema.safeParse({
    number: String(formData.get("number") ?? ""),
    name: String(formData.get("name") ?? ""),
    year: String(formData.get("year") ?? ""),
    plannedUnits: String(formData.get("plannedUnits") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля партии" };
  const number = Number(parsed.data.number);
  if (number < 1) return { error: "Номер партии — целое число от 1 до 9999" };
  const year = parsed.data.year ? Number(parsed.data.year) : null;
  if (year !== null && (year < 2000 || year > 2100)) return { error: "Год вне диапазона 2000–2100" };
  if (number !== batch.number) {
    const taken = await prisma.productionBatch.findFirst({ where: { organizationId: orgId, number, id: { not: batchId } }, select: { id: true } });
    if (taken) return { error: `Партия с номером ${number} уже есть — выберите другой номер или объедините ТЗ через карточки ТЗ` };
  }
  try {
    await prisma.productionBatch.update({
      where: { id: batchId },
      data: {
        number,
        name: parsed.data.name || null,
        year,
        plannedUnits: parsed.data.plannedUnits ? Number(parsed.data.plannedUnits) : null,
        notes: parsed.data.notes || null,
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { error: `Партия с номером ${number} уже есть` };
    throw e;
  }
  await resetByBatch(orgId, batchId);
  revalidateAll(orgId);
  return { number };
}

/**
 * Цвета составного ТЗ (несколько цветов в одном приложении): заменяем набор строк целиком.
 * Строки: цвет из справочника, количество (шт., необязательно), размеры («42, 46», необязательно).
 * Пусто — цвет ТЗ снова берётся из основного поля «Цвет» формы ТЗ.
 */
export async function setOrderColors(orderId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: orgId },
    include: { colors: { select: { colorRefId: true, quantity: true, sizes: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!order) return { error: "ТЗ не найдено" };
  const cur = JSON.stringify(order.colors.map((c) => [c.colorRefId, c.quantity ?? "", c.sizes ?? ""]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const sent = formData.get("_v");
  if (typeof sent === "string" && sent !== "" && sent !== cur) {
    return { error: "Цвета ТЗ успели изменить — ваши правки не сохранены. Обновите страницу (F5) и внесите правки заново." };
  }
  const ids = formData.getAll("colorRefId").map(String);
  const qtys = formData.getAll("quantity").map(String);
  const sizes = formData.getAll("sizes").map(String);
  const rows: { colorRefId: string; quantity: number | null; sizes: string | null }[] = [];
  for (let i = 0; i < ids.length; i++) {
    const colorRefId = ids[i].trim();
    if (!colorRefId) continue;
    const q = (qtys[i] ?? "").trim();
    if (q && !/^\d{1,6}$/.test(q)) return { error: "Количество по цвету — целое число" };
    rows.push({ colorRefId, quantity: q ? Number(q) : null, sizes: (sizes[i] ?? "").trim().slice(0, 100) || null });
  }
  if (new Set(rows.map((r) => r.colorRefId)).size !== rows.length) return { error: "Один и тот же цвет выбран дважды — объедините строки" };
  const refs = await prisma.colorRef.count({ where: { organizationId: orgId, id: { in: rows.map((r) => r.colorRefId) } } });
  if (refs !== rows.length) return { error: "Цвет не найден в справочнике — обновите страницу" };
  const total = rows.reduce((s, r) => s + (r.quantity ?? 0), 0);
  if (total > 0 && new Decimal(total).greaterThan(order.plannedQuantity)) {
    return { error: `Сумма по цветам (${total} шт.) больше планового количества ТЗ (${order.plannedQuantity.toString()} шт.)` };
  }
  await prisma.$transaction([
    prisma.productionOrderColor.deleteMany({ where: { orderId } }),
    prisma.productionOrderColor.createMany({ data: rows.map((r) => ({ orderId, ...r })) }),
  ]);
  await resetByOrder(orderId);
  revalidateAll(orgId);
  return {};
}

// Any not-yet-completed ТЗ (planned or in progress) can be cancelled as long
// as nothing has been written off against it.
export async function cancelProductionOrder(orderId: string): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const organizationId = session.user.organizationId;
  const res = await prisma.productionOrder.updateMany({
    where: {
      id: orderId,
      organizationId,
      status: { in: ["PLANNED", "IN_PROGRESS"] },
      materialUsages: { none: {} },
    },
    data: { status: "CANCELLED" },
  });
  if (res.count === 0) {
    const order = await prisma.productionOrder.findFirst({
      where: { id: orderId, organizationId },
      include: { _count: { select: { materialUsages: true } } },
    });
    if (!order) return { error: "ТЗ не найдено" };
    if (order.status === "COMPLETED") return { error: "Завершённое ТЗ отменить нельзя" };
    if (order.status === "CANCELLED") return { error: "ТЗ уже отменено" };
    if (order._count.materialUsages > 0) {
      return { error: "Нельзя отменить ТЗ со списаниями — сначала удалите списания (сырьё вернётся на склад)" };
    }
    return { error: "Не удалось отменить ТЗ" };
  }
  await resetByOrder(orderId);
  revalidateAll(organizationId);
  return {};
}


// ---------- Поля карточки ТЗ, которые лежат не в самом ТЗ ----------

/**
 * Категория ТЗ — это категория АРТИКУЛА (ProductModel.categoryRef): меняется у артикула и, значит, у всех его ТЗ.
 * Группа («Одежда» / «Аксессуары») принадлежит категории справочника и подтягивается вместе с ней.
 */
export async function setOrderCategory(orderId: string, categoryRefId: string): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const order = await prisma.productionOrder.findFirst({ where: { id: orderId, organizationId: orgId }, select: { productModelId: true } });
  if (!order) return { error: "ТЗ не найдено" };
  const ref = await prisma.categoryRef.findFirst({ where: { id: categoryRefId, organizationId: orgId }, select: { id: true, name: true } });
  if (!ref) return { error: "Категория не найдена в справочнике" };
  await prisma.productModel.update({ where: { id: order.productModelId }, data: { categoryRefId: ref.id, category: ref.name } });
  await resetByOrder(orderId);
  revalidateAll(orgId);
  return {};
}

/**
 * Ручной вид меха ТЗ (ProductionOrder.furTypeOverride). Пусто — вид снова определяется по списанным лотам.
 * Учитывается в одном месте (loadOrderRows), поэтому Главная, ТЗ, Изделия, Календарь видят одно и то же.
 */
export async function setOrderFurType(orderId: string, furType: string): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const v = furType.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (v.length > 100) return { error: "Название вида меха слишком длинное" };
  const order = await prisma.productionOrder.findFirst({ where: { id: orderId, organizationId: orgId }, select: { id: true } });
  if (!order) return { error: "ТЗ не найдено" };
  await prisma.productionOrder.update({ where: { id: orderId }, data: { furTypeOverride: v || null } });
  await resetByOrder(orderId);
  revalidateAll(orgId);
  return {};
}

/**
 * НДС ТЗ: одна ставка на все строки списания (мех и подкладка). Пусто — «как в лоте» у каждой строки.
 * Сумма с НДС (totalCost) не меняется, меняется только разбивка «без НДС / НДС» (как updateUsageVat).
 * Работа заказчику в модели без НДС (clientWorkPricePerUnit — одна цена), поэтому ставка на неё не распространяется.
 */
export async function setOrderVat(orderId: string, rate: string): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const order = await prisma.productionOrder.findFirst({ where: { id: orderId, organizationId: orgId }, select: { id: true } });
  if (!order) return { error: "ТЗ не найдено" };
  const raw = rate.trim().replace(",", ".");
  let v: Decimal | null = null;
  if (raw !== "") {
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { error: "НДС: число от 0 до 100, например 20 или 22" };
    v = new Decimal(raw);
    if (v.gt(100)) return { error: "НДС не может быть больше 100%" };
  }
  const usages = await prisma.productionMaterialUsage.findMany({ where: { productionOrderId: orderId }, select: { id: true, lot: { select: { vatRate: true } } } });
  await prisma.$transaction(
    usages.map((u) => prisma.productionMaterialUsage.update({ where: { id: u.id }, data: { vatRate: v && !v.eq(u.lot.vatRate) ? v : null } })),
  );
  await resetByOrder(orderId);
  revalidateAll(orgId);
  return {};
}
