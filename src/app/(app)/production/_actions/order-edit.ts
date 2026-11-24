"use server";

import { z } from "zod";
import { revalidateAll } from "@/lib/revalidate-all";
import { resetByBatch, resetByOrder } from "@/lib/verification";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { Decimal } from "@prisma/client/runtime/library";
import { PRODUCTION_EDIT_ROLES as EDIT_ROLES } from "@/lib/production-access";
import { checkOrgRefs } from "@/lib/org-guard";
import { MAX_QTY, zNum, parseNumber, parseDateInput } from "@/lib/input";
import { resolveColorInput } from "@/lib/colors";
import { staleError, ORDER_V } from "@/lib/concurrency";
import { resolveContractorId } from "@/lib/contractors";
import { type FormState, syncCompletedOrderCost } from "./shared";
import { updateProducedQuantity } from "./order-complete";

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
  rawWarehouseId: z.string().min(1, "Не удалось определить место хранения"),
  finishedWarehouseId: z.string().min(1, "Не удалось определить место хранения"),
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
    // Склад в интерфейсе не выбирается: без поля остаётся прежний склад ТЗ.
    rawWarehouseId: (formData.get("rawWarehouseId") as string | null) || order.rawWarehouseId,
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
  // Подрядчик меняется, только если поле пришло (пусто = «не указан»).
  let contractorPatch: { contractorId?: string | null } = {};
  if (formData.has("contractorId")) {
    const cr = await resolveContractorId(session.user.organizationId, formData.get("contractorId") as string | null);
    if (cr.error) return { error: cr.error };
    contractorPatch = { contractorId: cr.id };
  }
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
      ...contractorPatch,
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

  // Цена работы входит в полную себестоимость на складе готовой продукции (только у ТЗ, которые ведутся по ней — см. syncCompletedOrderCost).
  if (order.status === "COMPLETED" && !(clientWorkPricePerUnit ?? new Decimal(0)).equals(order.clientWorkPricePerUnit ?? new Decimal(0))) {
    await prisma.$transaction((tx) => syncCompletedOrderCost(tx, orderId, session.user.organizationId));
  }

  await resetByOrder(orderId);
  await afterBatchChange(session.user.organizationId, orderId, batchRes);
  revalidateAll(session.user.organizationId);
  return {};
}

/** Поля ТЗ, которые правятся по месту в таблице «Параметры ТЗ» (одно поле за раз). */
const PATCH_FIELDS = new Set([
  "productModelId", "rawWarehouseId", "finishedWarehouseId", "plannedQuantity", "producedQuantity", "colorRefId", "color", "size",
  "materialDescription", "lining", "startDate", "notes", "clientId", "batchId", "contractNumber", "contractorId", "workOrderNumber",
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
  fd.set("contractorId", order.contractorId ?? "");
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
