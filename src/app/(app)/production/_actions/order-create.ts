"use server";

import { z } from "zod";
import { revalidateAll } from "@/lib/revalidate-all";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { consumeFromLot } from "@/lib/stock";
import { nextDocumentNumber } from "@/lib/numbering";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { PRODUCTION_EDIT_ROLES as EDIT_ROLES } from "@/lib/production-access";
import { parseLotLines } from "@/lib/lot-lines";
import { checkOrgRefs } from "@/lib/org-guard";
import { MAX_QTY, zNum, zNumOpt, parseDateInput } from "@/lib/input";
import { resolveColorInput } from "@/lib/colors";
import { resolveContractorId } from "@/lib/contractors";
import { resolveLotLines } from "./shared";

const optDate = (label: string) =>
  z.string().optional().refine((s) => !s || parseDateInput(s) !== null, label);

// ---------- Order header ----------

const orderSchema = z.object({
  productModelId: z.string().min(1, "Выберите модель изделия"),
  rawWarehouseId: z.string().min(1, "Не удалось определить место хранения"),
  finishedWarehouseId: z.string().min(1, "Не удалось определить место хранения"),
  plannedQuantity: zNum("Плановое количество", { positive: true, max: MAX_QTY }),
  color: z.string().trim().max(200).optional(),
  size: z.string().trim().max(200).optional(),
  materialDescription: z.string().trim().max(2000).optional(),
  lining: z.string().trim().max(2000).optional(),
  startDate: optDate("Некорректная дата начала"),
  notes: z.string().trim().max(5000).optional(),
  clientId: z.string().trim().optional(),
  contractNumber: z.string().trim().max(200).optional(),
  contractorId: z.string().trim().optional(),
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

// Дополнительные позиции того же ТЗ из формы «Новое ТЗ» («+ ещё артикул»): общие поля берутся с первой позиции.
const extraSchema = z.array(z.object({
  productModelId: z.string().min(1),
  plannedQuantity: z.number().positive().max(MAX_QTY),
  color: z.string().trim().max(200).optional(),
  colorRefId: z.string().trim().optional(),
  size: z.string().trim().max(200).optional(),
  clientWorkPricePerUnit: z.number().min(0).max(1e9).optional(),
})).max(50);

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
    contractorId: formData.get("contractorId") || undefined,
    workOrderNumber: formData.get("workOrderNumber") || undefined,
    workOrderDate: formData.get("workOrderDate") || undefined,
    clientWorkPricePerUnit: formData.get("clientWorkPricePerUnit") || undefined,
    liningMaterialId: formData.get("liningMaterialId") || undefined,
    liningQuantity: formData.get("liningQuantity") || undefined,
  });
  if (!parsed.success) return { errors: parsed.error.issues.map((i) => i.message) };
  const cr = await resolveContractorId(organizationId, parsed.data.contractorId);
  if (cr.error) return { errors: [cr.error] };
  const contractorId = cr.id;

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
  const lotInfo = new Map<string, { id: string; lotNumber: string | null; quantityRemaining: Decimal; vatRate: Decimal; unit: string; materialVat: Decimal | null }>();
  if (draft) {
    const ids = [...new Set(draftLots.map((l) => l.lotId))];
    const rows = ids.length
      ? await prisma.rawMaterialLot.findMany({
          where: { id: { in: ids }, organizationId },
          select: { id: true, lotNumber: true, quantityRemaining: true, vatRate: true, rawMaterial: { select: { unit: true, defaultVatRate: true } } },
        })
      : [];
    for (const r of rows) lotInfo.set(r.id, { id: r.id, lotNumber: r.lotNumber, quantityRemaining: r.quantityRemaining, vatRate: r.vatRate, unit: r.rawMaterial.unit, materialVat: r.rawMaterial.defaultVatRate });
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

  let extras: z.infer<typeof extraSchema> = [];
  const extrasRaw = formData.get("extras");
  if (typeof extrasRaw === "string" && extrasRaw) {
    try {
      const x = extraSchema.safeParse(JSON.parse(extrasRaw));
      if (!x.success) return { errors: ["Не удалось прочитать дополнительные позиции — проверьте артикулы и количество"] };
      extras = x.data;
    } catch {
      return { errors: ["Не удалось прочитать дополнительные позиции — обновите страницу и повторите"] };
    }
  }
  const extraModels = extras.length
    ? await prisma.productModel.findMany({ where: { id: { in: [...new Set(extras.map((x) => x.productModelId))] }, organizationId }, select: { id: true, sellingPrice: true } })
    : [];
  if (extras.some((x) => !extraModels.some((m) => m.id === x.productModelId))) return { errors: ["Один из артикулов дополнительных позиций не найден"] };

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
          contractorId: contractorId ?? undefined,
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
              // Своя ставка: общая «НДС» ТЗ, иначе ставка материала по умолчанию (если задана и отличается от лота).
              vatRate: ((): Decimal | null => { const v = vatOwn ?? info.materialVat; return v && !v.eq(info.vatRate) ? v : null; })(),
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

      // Остальные позиции того же ТЗ: тот же № ТЗ, дата, заказчик, договор, партия, склады; списания вводятся на карточке позиции.
      if (extras.length) {
        const first = await tx.productionOrder.findUniqueOrThrow({ where: { id: order.id }, select: { batchId: true, furTypeOverride: true } });
        for (const x of extras) {
          const xNumber = await nextDocumentNumber(tx, "productionOrder", organizationId, "П");
          const xColor = await resolveColorInput(tx, organizationId, { color: x.color, colorRefId: x.colorRefId ?? null });
          await tx.productionOrder.create({
            data: {
              organizationId,
              number: xNumber,
              productModelId: x.productModelId,
              rawWarehouseId: parsed.data.rawWarehouseId,
              finishedWarehouseId: parsed.data.finishedWarehouseId,
              plannedQuantity: x.plannedQuantity,
              color: xColor.color ?? undefined,
              colorRefId: xColor.colorRefId ?? undefined,
              size: x.size || undefined,
              materialDescription: parsed.data.materialDescription,
              lining: parsed.data.lining,
              startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : new Date(),
              notes: parsed.data.notes,
              clientId: parsed.data.clientId || undefined,
              contractNumber: parsed.data.contractNumber,
              contractorId: contractorId ?? undefined,
              workOrderNumber: parsed.data.workOrderNumber,
              workOrderDate: parsed.data.workOrderDate ? new Date(parsed.data.workOrderDate) : undefined,
              clientWorkPricePerUnit: x.clientWorkPricePerUnit,
              retailPrice: extraModels.find((m) => m.id === x.productModelId)?.sellingPrice ?? undefined,
              batchId: first.batchId ?? undefined,
              furTypeOverride: first.furTypeOverride ?? undefined,
              createdById: session.user.id,
            },
          });
        }
      }

      const tzLabel = parsed.data.workOrderNumber ? `ТЗ №${parsed.data.workOrderNumber}` : number;
      return { id: order.id, label: extras.length ? `${tzLabel} (позиций: ${extras.length + 1})` : tzLabel };
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
