"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { resetByOrder } from "@/lib/verification";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { consumeFromLot, returnToLot } from "@/lib/stock";
import { Decimal } from "@prisma/client/runtime/library";
import { PRODUCTION_EDIT_ROLES as EDIT_ROLES } from "@/lib/production-access";
import { parseLotLines } from "@/lib/lot-lines";
import { defaultCommission4 } from "@/lib/commission4-const";
import { type FormState, resolveLotLines, getEditableOrder, syncCompletedOrderCost, usageSchema, applyUsageEdit } from "./shared";

/**
 * «Начислять 4%» из формы списания: чекбокс commission4 при маркере c4form=1 (снятый чекбокс браузер не шлёт);
 * без маркера (импорт/старые формы) — по умолчанию: true, для ТЗ из партии 6 — false.
 */
function readCommission4(formData: FormData, batchNumber: number | null | undefined): boolean {
  if (formData.get("c4form") === "1") return formData.get("commission4") === "on";
  return defaultCommission4(batchNumber);
}

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
    await prisma.$transaction((tx) => applyUsageEdit(tx, session.user.organizationId, orderId, usage, parsed.data.lotId, parsed.data.quantity, commission4));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Не удалось изменить списание" };
  }

  await resetByOrder(orderId);
  revalidateAll(session.user.organizationId);
  return {};
}
