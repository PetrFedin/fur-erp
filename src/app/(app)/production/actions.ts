"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { consumeFromLot, returnToLot, receiveFinishedGoodsStock } from "@/lib/stock";
import { nextDocumentNumber } from "@/lib/numbering";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";

const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;

export type FormState = { error?: string };

// ---------- Order header ----------

const orderSchema = z.object({
  productModelId: z.string().min(1, "Выберите модель изделия"),
  rawWarehouseId: z.string().min(1, "Выберите склад сырья"),
  finishedWarehouseId: z.string().min(1, "Выберите склад готовой продукции"),
  plannedQuantity: z.coerce.number().positive("Плановое количество должно быть больше 0"),
  color: z.string().trim().optional(),
  size: z.string().trim().optional(),
  materialDescription: z.string().trim().optional(),
  lining: z.string().trim().optional(),
  startDate: z.string().optional(),
  notes: z.string().trim().optional(),
  clientId: z.string().trim().optional(),
  contractNumber: z.string().trim().optional(),
  workOrderNumber: z.string().trim().optional(),
  workOrderDate: z.string().optional(),
  clientWorkPricePerUnit: z.coerce
    .number()
    .nonnegative()
    .optional()
    .or(z.nan().transform(() => undefined)),
  liningMaterialId: z.string().trim().optional(),
  liningQuantity: z.coerce
    .number()
    .positive()
    .optional()
    .or(z.nan().transform(() => undefined)),
});

export type CreateOrderState = { error?: string; errors?: string[] };

type LotLine = { line: number; lotNumber: string; quantity: number };

// Parses text pasted from Excel: "лот <Tab> кол-во" per line (Tab, ';' or
// spaces as separators). Returns every problem, line by line — never just
// the first few — so the user can fix the whole paste in one pass.
function parseLotLines(raw: string): { lines: LotLine[]; errors: string[] } {
  const lines: LotLine[] = [];
  const errors: string[] = [];
  raw.split(/\r?\n/).forEach((text, i) => {
    const t = text.trim();
    if (!t) return;
    const n = i + 1;
    const cells = t.split(/[\t;]+|\s+/).map((c) => c.trim()).filter(Boolean);
    if (cells.length !== 2) {
      errors.push(`строка ${n}: ожидается «лот количество», получено «${t}»`);
      return;
    }
    const quantity = Number(cells[1].replace(",", "."));
    if (!Number.isFinite(quantity)) {
      errors.push(`строка ${n}: не число «${cells[1]}»`);
      return;
    }
    if (quantity <= 0) {
      errors.push(`строка ${n}: количество должно быть больше 0`);
      return;
    }
    lines.push({ line: n, lotNumber: cells[0], quantity });
  });
  return { lines, errors };
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

  // Resolve lot numbers against every lot that still has stock, across all
  // purchases. An ambiguous number is never guessed — listed instead.
  const resolved: { line: number; lotId: string; quantity: number }[] = [];
  if (lines.length > 0) {
    const lots = await prisma.rawMaterialLot.findMany({
      where: { organizationId, quantityRemaining: { gt: 0 }, lotNumber: { not: null } },
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
  }
  if (errors.length > 0) {
    const lineNo = (e: string) => Number(/^строка (\d+)/.exec(e)?.[1] ?? 0);
    return { errors: errors.sort((a, b) => lineNo(a) - lineNo(b)) };
  }

  let orderId: string;
  try {
    orderId = await prisma.$transaction(async (tx) => {
      const number = await nextDocumentNumber(tx, "productionOrder", organizationId, "П");
      const order = await tx.productionOrder.create({
        data: {
          organizationId,
          number,
          productModelId: parsed.data.productModelId,
          rawWarehouseId: parsed.data.rawWarehouseId,
          finishedWarehouseId: parsed.data.finishedWarehouseId,
          plannedQuantity: parsed.data.plannedQuantity,
          color: parsed.data.color,
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
          createdById: session.user.id,
        },
      });

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
      if (resolved.length > 0 || (parsed.data.liningMaterialId && parsed.data.liningQuantity)) {
        await tx.productionOrder.update({ where: { id: order.id }, data: { status: "IN_PROGRESS" } });
      }

      return order.id;
    });
  } catch (e) {
    return { errors: [e instanceof Error ? e.message : "Не удалось создать заказ"] };
  }

  revalidatePath("/production");
  revalidatePath("/lots");
  revalidatePath("/lining");
  redirect(`/production/${orderId}`);
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
  plannedQuantity: z.coerce.number().positive("Плановое количество должно быть больше 0"),
});

export async function updateProductionOrder(orderId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId },
    include: { _count: { select: { materialUsages: true } } },
  });
  if (!order) return { error: "Заказ не найден" };

  const parsed = editOrderSchema.safeParse({
    productModelId: formData.get("productModelId"),
    rawWarehouseId: formData.get("rawWarehouseId"),
    finishedWarehouseId: formData.get("finishedWarehouseId"),
    plannedQuantity: formData.get("plannedQuantity"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const modelLocked = order._count.materialUsages > 0 || order.producedQuantity.greaterThan(0);
  if (modelLocked && parsed.data.productModelId !== order.productModelId) {
    return {
      error:
        "Нельзя изменить модель изделия — по заказу уже списано сырьё или зафиксирован выпуск. Заведите новый заказ.",
    };
  }

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
  const color = (formData.get("color") as string)?.trim() || null;
  const size = (formData.get("size") as string)?.trim() || null;
  const materialDescription = (formData.get("materialDescription") as string)?.trim() || null;
  const lining = (formData.get("lining") as string)?.trim() || null;
  const notes = (formData.get("notes") as string)?.trim() || null;
  const clientId = (formData.get("clientId") as string)?.trim() || null;
  const contractNumber = (formData.get("contractNumber") as string)?.trim() || null;
  const workOrderNumber = (formData.get("workOrderNumber") as string)?.trim() || null;

  const startDateRaw = (formData.get("startDate") as string)?.trim();
  const startDate = startDateRaw ? new Date(startDateRaw) : null;

  const workOrderDateRaw = (formData.get("workOrderDate") as string)?.trim();
  const workOrderDate = workOrderDateRaw ? new Date(workOrderDateRaw) : null;

  const clientWorkPriceRaw = (formData.get("clientWorkPricePerUnit") as string)?.trim();
  let clientWorkPricePerUnit: Decimal | null = null;
  if (clientWorkPriceRaw) {
    const n = Number(clientWorkPriceRaw);
    if (!Number.isFinite(n) || n < 0) {
      return { error: "Стоимость работ за ед. должна быть числом ≥ 0" };
    }
    clientWorkPricePerUnit = new Decimal(n);
  }

  await prisma.productionOrder.update({
    where: { id: orderId },
    data: {
      productModelId: parsed.data.productModelId,
      rawWarehouseId: parsed.data.rawWarehouseId,
      finishedWarehouseId: parsed.data.finishedWarehouseId,
      plannedQuantity: newPlannedQuantity,
      color,
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

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/production");
  return {};
}

// Retail price is really an attribute of the article, not of one specific
// ТЗ (matches the source spreadsheet, where "ПРЦ" is one number per
// article) — so setting it here also updates the ProductModel, and every
// other open/completed order of that model, so /articles and every ТЗ of
// this model show the same price and markup without drifting apart.
export async function updateRetailPrice(orderId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const parsed = z.coerce.number().nonnegative().safeParse(formData.get("retailPrice"));
  if (!parsed.success) return;

  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId },
  });
  if (!order) return;

  await prisma.$transaction([
    prisma.productionOrder.updateMany({
      where: { productModelId: order.productModelId, organizationId: session.user.organizationId },
      data: { retailPrice: parsed.data },
    }),
    prisma.productModel.update({
      where: { id: order.productModelId },
      data: { sellingPrice: parsed.data },
    }),
  ]);

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/production");
  revalidatePath("/articles");
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
    include: { productModel: { include: { materials: true } } },
  });
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
  quantity: z.coerce.number().positive("Количество должно быть больше 0"),
});

export async function addMaterialUsage(orderId: string, formData: FormData): Promise<FormState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return { error: "Заказ не найден" };

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

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/lots");
  return {};
}

// Bulk entry: paste "лот  количество" pairs (one per line, tab- or
// multi-space-separated) copied straight from a ТЗ spreadsheet instead of
// picking each lot one at a time — real orders here run up to a few dozen
// lot lines. Lot numbers are matched within this order's raw-material
// warehouse; unmatched or insufficient lines are reported back, matched
// ones are still applied.
export type BulkUsageState = { error?: string; created?: number; skipped?: string[] };

export async function addMaterialUsagesBulk(
  orderId: string,
  _prev: BulkUsageState,
  formData: FormData
): Promise<BulkUsageState> {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return { error: "Заказ не найден" };

  const raw = (formData.get("rows") as string | null)?.trim();
  if (!raw) return { error: "Вставьте хотя бы одну строку" };

  const lots = await prisma.rawMaterialLot.findMany({
    where: { organizationId: session.user.organizationId, warehouseId: order.rawWarehouseId },
  });
  const lotByNumber = new Map(lots.filter((l) => l.lotNumber).map((l) => [l.lotNumber!.trim().toLowerCase(), l]));

  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const skipped: string[] = [];
  let created = 0;

  for (const line of lines) {
    const cells = line.split("\t").length > 1 ? line.split("\t") : line.split(/ {2,}/);
    const [lotNumberRaw, quantityRaw] = cells.map((c) => c?.trim());
    const quantity = Number((quantityRaw ?? "").replace(",", "."));
    const lot = lotNumberRaw ? lotByNumber.get(lotNumberRaw.toLowerCase()) : undefined;

    if (!lot || !Number.isFinite(quantity) || quantity <= 0) {
      skipped.push(line);
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const { unitCost, totalCost, rawMaterialId } = await consumeFromLot(tx, {
          organizationId: session.user.organizationId,
          lotId: lot.id,
          quantity,
          productionOrderId: orderId,
        });
        await tx.productionMaterialUsage.create({
          data: { productionOrderId: orderId, rawMaterialId, lotId: lot.id, quantity, unitCost, totalCost },
        });
        if (order.status === "PLANNED") {
          await tx.productionOrder.update({ where: { id: orderId }, data: { status: "IN_PROGRESS" } });
        }
        await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
      });
      created++;
    } catch {
      skipped.push(line);
    }
  }

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/lots");
  return { created, skipped: skipped.length ? skipped : undefined };
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
  if (!order) return { error: "Заказ не найден" };
  if (order.productModel.materials.length === 0) {
    return { error: "У модели не задана норма расхода (BOM)" };
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
            notes: "Списано по норме (BOM)",
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
    return { error: e instanceof Error ? e.message : "Не удалось списать сырьё по норме" };
  }

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/lots");
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

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/lots");
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
  if (!order) return { error: "Заказ не найден" };

  const usage = await prisma.productionMaterialUsage.findFirst({
    where: { id: usageId, productionOrderId: orderId },
  });
  if (!usage) return { error: "Списание не найдено" };

  const parsed = usageSchema.safeParse({
    lotId: formData.get("lotId"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  if (parsed.data.lotId === usage.lotId && new Decimal(parsed.data.quantity).eq(usage.quantity)) {
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
        data: { lotId: parsed.data.lotId, rawMaterialId, quantity: parsed.data.quantity, unitCost, totalCost },
      });
      await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Не удалось изменить списание" };
  }

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/lots");
  return {};
}

// ---------- Production expenses ----------

const expenseSchema = z.object({
  categoryId: z.string().min(1, "Выберите статью расходов"),
  amount: z.coerce.number().positive("Сумма должна быть больше 0"),
  description: z.string().trim().optional(),
});

export async function addProductionExpense(orderId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return;

  const parsed = expenseSchema.safeParse({
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return;

  await prisma.$transaction(async (tx) => {
    await tx.productionExpense.create({
      data: { productionOrderId: orderId, ...parsed.data },
    });
    await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
  });

  revalidatePath(`/production/${orderId}`);
}

export async function removeProductionExpense(orderId: string, expenseId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await getEditableOrder(session.user.organizationId, orderId);
  if (!order) return;

  await prisma.$transaction(async (tx) => {
    await tx.productionExpense.delete({ where: { id: expenseId } });
    await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
  });
  revalidatePath(`/production/${orderId}`);
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
  if (!order) return { error: "Заказ не найден" };

  const expense = await prisma.productionExpense.findFirst({
    where: { id: expenseId, productionOrderId: orderId },
  });
  if (!expense) return { error: "Расход не найден" };

  const parsed = z
    .object({
      categoryId: z.string().min(1, "Выберите статью расходов"),
      amount: z.coerce.number().positive("Сумма должна быть больше 0"),
    })
    .safeParse({
      categoryId: formData.get("categoryId"),
      amount: formData.get("amount"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const description = (formData.get("description") as string)?.trim() || null;

  await prisma.$transaction(async (tx) => {
    await tx.productionExpense.update({
      where: { id: expenseId },
      data: { categoryId: parsed.data.categoryId, amount: parsed.data.amount, description },
    });
    await syncCompletedOrderCost(tx, orderId, session.user.organizationId);
  });

  revalidatePath(`/production/${orderId}`);
  return {};
}

// ---------- Completion: snapshots cost and receives finished goods ----------

const completeSchema = z.object({
  producedQuantity: z.coerce.number().positive("Количество должно быть больше 0"),
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
  if (!order) return { error: "Заказ не найден" };

  const parsed = completeSchema.safeParse({ producedQuantity: formData.get("producedQuantity") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const materialCost = order.materialUsages.reduce((s, u) => s.add(u.totalCost), new Decimal(0));
  const expenseCost = order.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const totalCost = materialCost.add(expenseCost);
  const unitCost = totalCost.div(parsed.data.producedQuantity);

  await prisma.$transaction(async (tx) => {
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
  });

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/production");
  revalidatePath("/finished-stock");
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
  const parsed = z.coerce.number().positive("Количество должно быть больше 0").safeParse(formData.get("producedQuantity"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId, status: "COMPLETED" },
  });
  if (!order) return { error: "Заказ не найден или ещё не завершён" };

  const newQuantity = new Decimal(parsed.data);
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

  revalidatePath(`/production/${orderId}`);
  revalidatePath("/production");
  revalidatePath("/finished-stock");
  revalidatePath("/articles");
  return {};
}

// ---------- Payments from the client (separate ledger from supplier payments) ----------

const productionPaymentSchema = z.object({
  amount: z.coerce.number().positive("Сумма должна быть больше 0"),
  paymentType: z.enum(["ADVANCE", "PARTIAL", "FINAL"]),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]),
  paidAt: z.string().min(1),
  notes: z.string().trim().optional(),
});

// One payment can cover several ТЗ at once (a client paying a lump sum
// against a running tab) — orderId is always included, plus whichever
// sibling orders (same client) were checked in the form.
export async function addProductionPayment(orderId: string, formData: FormData) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId },
  });
  if (!order) return;

  const parsed = productionPaymentSchema.safeParse({
    amount: formData.get("amount"),
    paymentType: formData.get("paymentType") || "FINAL",
    method: formData.get("method"),
    paidAt: formData.get("paidAt"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return;

  const extraOrderIds = formData.getAll("orderIds").map(String);
  const orderIds = Array.from(new Set([orderId, ...extraOrderIds]));
  const validOrders = await prisma.productionOrder.findMany({
    where: { id: { in: orderIds }, organizationId: session.user.organizationId },
    select: { id: true },
  });

  await prisma.productionPayment.create({
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

  revalidatePath(`/production/${orderId}`);
  for (const id of orderIds) revalidatePath(`/production/${id}`);
}

export async function removeProductionPayment(orderId: string, paymentId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const order = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: session.user.organizationId },
  });
  if (!order) return;

  const payment = await prisma.productionPayment.findFirst({
    where: { id: paymentId, organizationId: session.user.organizationId },
    include: { orders: true },
  });
  if (!payment) return;

  await prisma.productionPayment.delete({ where: { id: paymentId } });
  for (const alloc of payment.orders) revalidatePath(`/production/${alloc.productionOrderId}`);
}

export async function cancelProductionOrder(orderId: string) {
  const session = await requireRole(...EDIT_ROLES);
  await prisma.productionOrder.updateMany({
    where: {
      id: orderId,
      organizationId: session.user.organizationId,
      status: "PLANNED",
      materialUsages: { none: {} },
    },
    data: { status: "CANCELLED" },
  });
  revalidatePath(`/production/${orderId}`);
  revalidatePath("/production");
}
