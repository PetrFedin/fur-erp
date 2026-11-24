"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { lockPurchase } from "@/lib/purchase-receive";
import { Decimal } from "@prisma/client/runtime/library";
import { MAX_QTY, zNum } from "@/lib/input";
import { resetByPurchase } from "@/lib/verification";
import { buildCostPlanJson, deriveCostPlanInputs, computeCostPlan, roundQty, roundPrice, roundVat, roundRate } from "@/lib/cost-plan";
import { AMOUNT_TOO_BIG, tooBig, EDIT_ROLES, type FormState } from "./shared";

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
