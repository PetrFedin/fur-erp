import "server-only";
// Безопасный пересчёт принятого лота при правке цены, количества, НДС или строк расчётного листа (первоисточник — карточка лота).
// Одна функция строит ПЛАН (что изменится: лот, позиция закупки, движения склада, списания ТЗ, себестоимость ТЗ и готовой продукции,
// состав цены, молоток, $) и применяет его в транзакции. Предпросмотр и запись используют один и тот же план; запись сверяет отпечаток плана.
// Правила: сумма «с НДС» лота — первична (totalCost = unitCost × количество, копейки как при приёмке); цена уже сделанных списаний = количество × новая цена
// единицы лота (как consumeFromLot); остаток лота = новое количество − всё, что уже ушло (ниже нуля нельзя); оплаты закупки не трогаются
// (долг считается от сумм позиций и расходов на лету); состав цены, молоток и $ считаются из расчётного листа лота.
import { createHash } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/library";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lotComposition, splitVat, COMP_CATS, CAT_LABEL, type CompCat, type CompInput } from "@/lib/price-composition";
import { lotHammerListed, lotUsdListed } from "@/lib/lot-hammer";
import { applyRowEdits, pushPriceDelta, scaleLotRows, type RawItem, type RowEdit } from "@/lib/lot-sheet-calc";
import { MAX_MONEY, MAX_QTY } from "@/lib/input";

export type LotChange = {
  /** Новое количество (получено). */
  qty?: string;
  /** Цена в закупке за единицу, без НДС, в валюте закупки. */
  unitPrice?: string;
  /** Цена лота за единицу, ₽ без НДС / с НДС; либо сумма лота с НДС. */
  unitExcl?: string;
  unitIncl?: string;
  totalIncl?: string;
  vatRate?: string;
  /** При смене ставки: сохранить сумму с НДС (по умолчанию) или цену без НДС. */
  vatKeep?: "incl" | "excl";
  /** Молоток: ₽ за шкуру без НДС / $ за шкуру (листы с молотком). */
  hammerExcl?: string;
  hammerUsd?: string;
  /** Правки строк расчётного листа лота. */
  sheet?: RowEdit[];
};

export type LotPlan = {
  hash: string;
  changed: boolean;
  moneyChanged: boolean;
  lines: { label: string; before: string; after: string }[];
  orders: { id: string; number: string; status: string; qty: number; usageBefore: number; usageAfter: number; orderBefore: number | null; orderAfter: number | null; unitBefore: number | null; unitAfter: number | null }[];
  comp: { label: string; before: number; after: number }[] | null;
  notes: string[];
};

type Db = Prisma.TransactionClient | typeof prisma;
const D = (v: Decimal.Value) => new Decimal(v);
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const r3 = (d: Decimal) => d.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
const n = (d: Decimal | number | string | null | undefined) => Number(d ?? 0);
const STATUS_RU: Record<string, string> = { PLANNED: "план", IN_PROGRESS: "в работе", COMPLETED: "завершено", CANCELLED: "отменено" };

function parseDec(label: string, v: string | undefined, o: { min?: number; max?: number } = {}): Decimal | { error: string } | undefined {
  if (v === undefined || v === "") return undefined;
  const t = String(v).replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return { error: `${label}: укажите число` };
  const d = D(t);
  if (o.min != null && d.lt(o.min)) return { error: `${label}: значение не может быть меньше ${o.min}` };
  if (o.max != null && d.gt(o.max)) return { error: `${label}: слишком большое значение` };
  return d;
}
const bad = (x: unknown): x is { error: string } => !!x && typeof x === "object" && "error" in (x as object);

type Writes = {
  lotId: string;
  lot: Prisma.RawMaterialLotUpdateInput | null;
  item: { id: string; data: Prisma.PurchaseItemUpdateInput } | null;
  movements: { id: string; unitCost: Decimal; totalCost: Decimal; quantity?: Decimal }[];
  usages: { id: string; unitCost: Decimal; totalCost: Decimal }[];
  orders: { id: string; materialCost: Decimal; expenseCost: Decimal; totalCost: Decimal; unitCost: Decimal; delta: Decimal; produced: Decimal; finishedWarehouseId: string; productModelId: string }[];
  purchaseId: string | null;
};

export async function buildLotPlan(db: Db, orgId: string, lotId: string, ch: LotChange): Promise<{ error: string } | { plan: LotPlan; writes: Writes }> {
  const lot = await db.rawMaterialLot.findFirst({
    where: { id: lotId, organizationId: orgId },
    include: {
      rawMaterial: { select: { unit: true } },
      purchase: { select: { id: true, number: true, exchangeRate: true, status: true } },
      purchaseItems: true,
      stockMovements: true,
      usages: {
        include: {
          productionOrder: {
            select: {
              id: true, number: true, status: true, producedQuantity: true, materialCost: true, expenseCost: true, totalCost: true, unitCost: true,
              finishedWarehouseId: true, productModelId: true,
              expenses: { select: { amount: true } },
              materialUsages: { select: { id: true, lotId: true, quantity: true, totalCost: true } },
            },
          },
        },
      },
    },
  });
  if (!lot) return { error: "Лот не найден" };

  const q0 = lot.quantityReceived, rem0 = lot.quantityRemaining, out0 = q0.sub(rem0);
  const T0 = lot.totalCost, U0 = lot.unitCost, vat0 = lot.vatRate;
  const pd = (label: string, v: string | undefined, o?: { min?: number; max?: number }) => parseDec(label, v, o);
  const vals = {
    qty: pd("Количество", ch.qty, { max: MAX_QTY }),
    unitPrice: pd("Цена в закупке", ch.unitPrice, { max: MAX_MONEY }),
    unitExcl: pd("Цена без НДС", ch.unitExcl, { max: MAX_MONEY }),
    unitIncl: pd("Цена с НДС", ch.unitIncl, { max: MAX_MONEY }),
    totalIncl: pd("Сумма лота", ch.totalIncl, { max: MAX_MONEY }),
    vatRate: pd("Ставка НДС", ch.vatRate, { min: 0, max: 100 }),
    hammerExcl: pd("Молоток, ₽", ch.hammerExcl, { min: 0, max: MAX_MONEY }),
    hammerUsd: pd("Молоток, $", ch.hammerUsd, { min: 0, max: MAX_MONEY }),
  };
  for (const v of Object.values(vals)) if (bad(v)) return { error: v.error };
  const g = <K extends keyof typeof vals>(k: K) => vals[k] as Decimal | undefined;

  const priceKeys = [g("unitPrice"), g("unitExcl"), g("unitIncl"), g("totalIncl")].filter((x) => x !== undefined).length;
  if (priceKeys > 1) return { error: "Укажите цену одним полем" };
  const q1 = g("qty") ? r3(g("qty")!) : q0;
  const vat1 = g("vatRate") ? g("vatRate")!.toDecimalPlaces(2) : vat0;
  const qtyChanged = !q1.eq(q0), vatChanged = !vat1.eq(vat0);
  const hammerReq = g("hammerExcl") !== undefined || g("hammerUsd") !== undefined;
  const sheetEdits = ch.sheet ?? [];
  const sheetValueEdits = sheetEdits.some((e) => e.value !== undefined);
  const priceReq = priceKeys > 0;
  const moneyReq = qtyChanged || vatChanged || priceReq || hammerReq || sheetValueEdits;

  if (q1.lte(0)) return { error: "Количество должно быть больше нуля" };
  if (q1.lt(out0)) {
    const used = lot.usages.reduce((s, u) => s.add(u.quantity), D(0));
    const orders = Array.from(new Set(lot.usages.map((u) => u.productionOrder.number)));
    const other = out0.sub(used);
    return {
      error: `Нельзя поставить количество ${q1.toString()}: из лота уже ушло ${out0.toString()}` +
        (used.gt(0) ? ` (в ТЗ ${orders.join(", ")} — ${used.toString()}` : "") + (other.gt(0) ? `${used.gt(0) ? ", " : " ("}прочие списания — ${other.toString()}` : "") + (used.gt(0) || other.gt(0) ? ")" : "") +
        `. Сначала уменьшите списания, потом количество.`,
    };
  }

  const item = lot.purchaseItems.length === 1 ? lot.purchaseItems[0] : null;
  if (moneyReq) {
    if (lot.purchaseItems.length > 1) return { error: "Лот собран из нескольких поступлений (общий остаток ткани): цену, количество и НДС одного поступления выделить нельзя" };
    if (!item || !lot.purchase) return { error: "У лота нет позиции закупки — цену и количество менять не к чему привязать" };
  }

  const rate = lot.purchase?.exchangeRate ?? D(1);
  const k1 = D(1).add(vat1.div(100));
  // Доля расходов закупки в лоте (с НДС, всего по лоту) — фиксирована, как при правке позиции закупки; материал — остальное.
  const alloc = lot.expenseCostExclVat.add(lot.expenseVatAmount).mul(q0);
  const notes: string[] = [];

  // Расчётный лист: собственный лота, а при его отсутствии — копия листа позиции закупки (создаётся при правке).
  const ownBd = lot.costBreakdown as { items?: RawItem[] } | null;
  const planBd = (item?.costPlan as { costBreakdown?: { items?: RawItem[] } } | null)?.costBreakdown ?? null;
  const sheetBase: RawItem[] = Array.isArray(ownBd?.items) ? (ownBd!.items as RawItem[]) : Array.isArray(planBd?.items) ? (planBd!.items as RawItem[]) : [];
  const bdObj: Record<string, unknown> = Array.isArray(ownBd?.items) ? { ...(ownBd as object) } : planBd ? { ...(planBd as object) } : {};
  let raw = sheetBase.map((x) => ({ ...x }));
  const cIn = (qty: number, vat: number, total: number): CompInput => ({ breakdown: { items: raw }, plans: [], vatRate: vat, qty, totalIncl: total, purchaseNumber: lot.purchase?.number, lotNumber: lot.lotNumber });
  const plans = lot.purchaseItems.map((i) => i.costPlan);

  // ── Новая сумма лота ──
  let T1: Decimal;
  let up1: Decimal | null = item ? item.unitPrice : null;
  let targetDriven = false;
  if (g("unitPrice") !== undefined) {
    up1 = r2(g("unitPrice")!);
    T1 = r2(up1.mul(q1).mul(rate).mul(k1).add(alloc));
  } else if (priceReq) {
    const Tt = g("totalIncl") ?? (g("unitIncl") ? g("unitIncl")!.mul(q1) : g("unitExcl")!.mul(k1).mul(q1));
    T1 = r2(Tt);
    targetDriven = true;
  } else {
    // Без явной цены: цена за единицу лота сохраняется (пропорционально количеству); при смене ставки — сумма с НДС или цена без НДС.
    const base = T0.mul(q1).div(q0);
    T1 = r2(vatChanged && (ch.vatKeep ?? "incl") === "excl" ? base.mul(k1).div(D(1).add(vat0.div(100))) : base);
    targetDriven = true;
  }

  // ── Лист: масштаб по количеству, затем сдвиг цены в молоток, затем правки строк ──
  let sheetChanged = false;
  if (raw.length && qtyChanged) {
    raw = scaleLotRows(raw, q1.div(q0).toNumber(), cIn(q0.toNumber(), vat0.toNumber(), T0.toNumber()));
    sheetChanged = true;
  }
  if (raw.length && (priceReq || vatChanged)) {
    const scaled = r2(T0.mul(q1).div(q0));
    const dT = T1.sub(scaled).toNumber();
    if (Math.abs(dT) >= 0.005) {
      const res = pushPriceDelta(raw, dT, cIn(q1.toNumber(), vat1.toNumber(), scaled.toNumber()));
      if (res.anchored) { raw = res.items; sheetChanged = true; notes.push("Изменение цены отнесено на строку молотка расчётного листа; связанные строки листа пересчитаны"); }
      else notes.push("В расчётном листе нет строки молотка, на которую можно отнести изменение цены: разница попадёт в «Прочие расходы»");
    }
  }
  let sheetDelta = 0;
  const edits: RowEdit[] = [...sheetEdits];
  if (hammerReq) {
    const idx = raw.findIndex((x) => String(x.label ?? "").trim() === "Стоимость молоток ЛОТ без НДС");
    const uIdx = raw.findIndex((x) => String(x.label ?? "").trim() === "Цена за ед. (ам. долл.)");
    if (g("hammerExcl") !== undefined && idx >= 0) edits.push({ idx, value: g("hammerExcl")!.mul(q1).toNumber() });
    else if (g("hammerUsd") !== undefined && uIdx >= 0) edits.push({ idx: uIdx, value: g("hammerUsd")!.toNumber() });
    else return { error: "В расчётном листе этого лота нет строки молотка — цену шкуры правьте полем «Цена за шкуру» или строкой расчёта" };
  }
  if (edits.length) {
    if (!raw.length) return { error: "У лота нет расчётного листа" };
    const res = applyRowEdits(raw, edits, cIn(q1.toNumber(), vat1.toNumber(), T1.toNumber()));
    raw = res.items as RawItem[];
    notes.push(...res.notes);
    sheetChanged = true;
    if (res.deltaT != null && Math.abs(res.deltaT) >= 0.005) {
      sheetDelta = res.deltaT;
      T1 = r2(T1.add(sheetDelta));
      targetDriven = true;
    }
  }
  if (T1.lt(0.01)) return { error: "Сумма лота должна быть больше нуля" };
  if (T1.gt(MAX_MONEY)) return { error: "Сумма лота слишком большая" };

  const moneyChanged = !T1.eq(T0) || qtyChanged || vatChanged;
  const U1 = r2(T1.div(q1));
  const rem1 = q1.sub(out0);

  // Позиция закупки: цена в валюте закупки подбирается до копейки так, чтобы сумма была ближе всего к сумме лота.
  if (item && moneyChanged && targetDriven) {
    const denom = q1.mul(rate).mul(k1);
    const exact = T1.sub(alloc).div(denom);
    let best = r2(exact), bestErr: Decimal | null = null;
    for (const c of [r2(exact).sub(0.01), r2(exact), r2(exact).add(0.01)]) {
      if (c.lte(0)) continue;
      const err = r2(c.mul(q1).mul(rate).mul(k1).add(alloc)).sub(T1).abs();
      if (bestErr === null || err.lt(bestErr)) { best = c; bestErr = err; }
    }
    up1 = best;
  }
  if (item && moneyChanged && up1 && up1.lte(0)) return { error: "Цена в закупке должна быть больше нуля" };

  // ── Записи ──
  const matIncl = T1.sub(alloc);
  const baseRub = matIncl.div(k1);
  const allocExclTotal = lot.expenseCostExclVat.mul(q0), allocVatTotal = lot.expenseVatAmount.mul(q0);
  const lotData: Prisma.RawMaterialLotUpdateInput = {};
  if (moneyChanged) {
    Object.assign(lotData, {
      quantityReceived: q1, quantityRemaining: rem1, unitCost: U1, totalCost: T1, vatRate: vat1,
      materialCostExclVat: baseRub.div(q1), materialVatAmount: matIncl.sub(baseRub).div(q1),
      expenseCostExclVat: allocExclTotal.div(q1), expenseVatAmount: allocVatTotal.div(q1),
    });
  }
  if (sheetChanged) lotData.costBreakdown = { ...bdObj, items: raw } as Prisma.InputJsonValue;

  const itemData: Prisma.PurchaseItemUpdateInput = {};
  if (item && moneyChanged) {
    const sub1 = r2(q1.mul(up1!));
    Object.assign(itemData, { quantity: q1, unitPrice: up1!, subtotal: sub1, vatRate: vat1 });
    const cp = item.costPlan as Record<string, unknown> | null;
    if (cp && typeof cp === "object" && cp.unitCostInclVat != null) {
      const dU = U1.sub(U0);
      const dM = baseRub.div(q1).sub(lot.materialCostExclVat), dMV = matIncl.sub(baseRub).div(q1).sub(lot.materialVatAmount);
      const add = (key: string, d: Decimal) => (cp[key] != null ? D(String(cp[key])).add(d).toString() : cp[key]);
      itemData.costPlan = { ...cp, unitCostInclVat: add("unitCostInclVat", dU), materialExclVat: add("materialExclVat", dM), materialVat: add("materialVat", dMV) } as Prisma.InputJsonValue;
    }
  }

  const movements: Writes["movements"] = [];
  if (moneyChanged) {
    // Приход сдвигаем на изменение «получено», а не ставим всё q1: часть прихода может быть записана как ADJUSTMENT_IN.
    let shifted = false;
    for (const m of lot.stockMovements) {
      if (m.type === "PURCHASE_IN") {
        const qty = shifted ? m.quantity : m.quantity.add(q1.sub(q0));
        shifted = true;
        movements.push({ id: m.id, quantity: qty, unitCost: U1, totalCost: qty.eq(q1) ? T1 : r2(qty.mul(U1)) });
      }
      else movements.push({ id: m.id, unitCost: U1, totalCost: r2(m.quantity.mul(U1)) });
    }
  }
  const usages: Writes["usages"] = [];
  const newUsageCost = new Map<string, Decimal>();
  if (moneyChanged) {
    for (const u of lot.usages) {
      const tc = r2(u.quantity.mul(U1));
      usages.push({ id: u.id, unitCost: U1, totalCost: tc });
      newUsageCost.set(u.id, tc);
    }
  }
  const orderMap = new Map<string, (typeof lot.usages)[number]["productionOrder"]>();
  for (const u of lot.usages) orderMap.set(u.productionOrder.id, u.productionOrder);
  const ordersOut: LotPlan["orders"] = [];
  const orderWrites: Writes["orders"] = [];
  for (const o of orderMap.values()) {
    const mine = lot.usages.filter((u) => u.productionOrderId === o.id);
    const before = mine.reduce((s, u) => s.add(u.totalCost), D(0));
    const after = moneyChanged ? mine.reduce((s, u) => s.add(newUsageCost.get(u.id) ?? u.totalCost), D(0)) : before;
    let orderBefore: number | null = null, orderAfter: number | null = null, unitBefore: number | null = null, unitAfter: number | null = null;
    if (o.status === "COMPLETED" && !o.producedQuantity.isZero()) {
      const mc1 = o.materialUsages.reduce((s, u) => s.add(newUsageCost.get(u.id) ?? u.totalCost), D(0));
      const ec = o.expenses.reduce((s, e) => s.add(e.amount), D(0));
      const tc1 = mc1.add(ec);
      const uc1 = tc1.div(o.producedQuantity);
      orderBefore = n(o.totalCost); orderAfter = n(tc1); unitBefore = n(o.unitCost); unitAfter = n(uc1.toDecimalPlaces(2));
      if (moneyChanged) orderWrites.push({ id: o.id, materialCost: mc1, expenseCost: ec, totalCost: tc1, unitCost: uc1, delta: tc1.sub(o.totalCost ?? D(0)), produced: o.producedQuantity, finishedWarehouseId: o.finishedWarehouseId, productModelId: o.productModelId });
    }
    ordersOut.push({ id: o.id, number: o.number, status: STATUS_RU[o.status] ?? o.status, qty: n(mine.reduce((s, u) => s.add(u.quantity), D(0))), usageBefore: n(before), usageAfter: n(after), orderBefore, orderAfter, unitBefore, unitAfter });
  }
  ordersOut.sort((a, b) => a.number.localeCompare(b.number, "ru", { numeric: true }));

  // ── Что увидит владелец: сводка до/после ──
  const fm = (d: Decimal) => d.toFixed(2);
  const lines: LotPlan["lines"] = [];
  if (!q1.eq(q0)) lines.push({ label: "Получено", before: q0.toString(), after: q1.toString() });
  if (moneyChanged) {
    if (!q1.eq(q0)) lines.push({ label: "Остаток лота", before: rem0.toString(), after: rem1.toString() });
    lines.push({ label: "Цена за единицу с НДС, ₽", before: fm(U0), after: fm(U1) });
    lines.push({ label: "Цена за единицу без НДС, ₽", before: fm(lot.materialCostExclVat.add(lot.expenseCostExclVat)), after: fm(baseRub.div(q1).add(allocExclTotal.div(q1)).toDecimalPlaces(2)) });
    lines.push({ label: "Сумма лота с НДС, ₽", before: fm(T0), after: fm(T1) });
    if (vatChanged) lines.push({ label: "Ставка НДС, %", before: vat0.toString(), after: vat1.toString() });
    if (item && up1) lines.push({ label: "Цена в закупке (без НДС)", before: fm(item.unitPrice), after: fm(up1) });
    if (item) lines.push({ label: "Сумма позиции закупки", before: fm(item.subtotal), after: fm(r2(q1.mul(up1!))) });
    const usedSum = lot.usages.reduce((s, u) => s.add(u.totalCost), D(0));
    if (lot.usages.length) lines.push({ label: "Стоимость списаний по ТЗ, ₽", before: fm(usedSum), after: fm(lot.usages.reduce((s, u) => s.add(newUsageCost.get(u.id) ?? u.totalCost), D(0))) });
  }
  // состав цены, молоток, $
  const compOf = (breakdown: unknown, qty: Decimal, total: Decimal, vat: Decimal) => {
    const c = lotComposition({ breakdown, plans, vatRate: vat.toNumber(), qty: qty.toNumber(), totalIncl: total.toNumber(), purchaseNumber: lot.purchase?.number, lotNumber: lot.lotNumber });
    if (!c) return null;
    return splitVat(c, vat.toNumber()).excl;
  };
  const cb = compOf(lot.costBreakdown, q0, T0, vat0);
  const ca = compOf(sheetChanged ? { items: raw } : lot.costBreakdown, q1, T1, vat1);
  let comp: LotPlan["comp"] = null;
  if (cb && ca) comp = COMP_CATS.map((c) => ({ label: CAT_LABEL[c.key as CompCat], before: cb[c.key], after: ca[c.key] })).filter((x) => Math.abs(x.before) >= 0.005 || Math.abs(x.after) >= 0.005);
  if (lot.rawMaterial.unit !== "M") {
    const hb = lotHammerListed(lot.costBreakdown, vat0.toNumber(), plans), ha = lotHammerListed(sheetChanged ? { items: raw } : lot.costBreakdown, vat1.toNumber(), plans);
    if (hb && ha && Math.abs(hb.excl - ha.excl) >= 0.005) lines.push({ label: "Молоток, ₽/шт. без НДС", before: hb.excl.toFixed(2), after: ha.excl.toFixed(2) });
    const ub = lotUsdListed(lot.costBreakdown, plans), ua = lotUsdListed(sheetChanged ? { items: raw } : lot.costBreakdown, plans);
    if (ub != null && ua != null && Math.abs(ub - ua) >= 0.00005) lines.push({ label: "Молоток, $/шт.", before: ub.toFixed(2), after: ua.toFixed(2) });
  }
  if (moneyChanged && lot.purchase) notes.push("Подтверждение закупки сбросится; оплаты закупки не меняются, долг пересчитается от новой суммы");

  const writes: Writes = {
    lotId, purchaseId: lot.purchaseId,
    lot: Object.keys(lotData).length ? lotData : null,
    item: item && Object.keys(itemData).length ? { id: item.id, data: itemData } : null,
    movements, usages, orders: orderWrites,
  };
  const changed = !!(writes.lot || writes.item);
  const planNoHash = { changed, moneyChanged, lines, orders: ordersOut, comp, notes };
  const hash = createHash("sha1").update(JSON.stringify({ planNoHash, T1: T1.toString(), q1: q1.toString(), vat1: vat1.toString(), up1: up1?.toString(), rawLen: raw.length, sheet: sheetChanged ? JSON.stringify(raw) : "", base: [T0.toString(), q0.toString(), rem0.toString(), vat0.toString()] })).digest("hex").slice(0, 16);
  return { plan: { ...planNoHash, hash }, writes };
}

/** Записывает план в транзакции (лот блокируется), пересчитывает ТЗ и остатки готовой продукции. */
export async function applyLotWrites(tx: Prisma.TransactionClient, orgId: string, w: Writes) {
  if (w.lot) await tx.rawMaterialLot.update({ where: { id: w.lotId }, data: w.lot });
  if (w.item) await tx.purchaseItem.update({ where: { id: w.item.id }, data: w.item.data });
  for (const m of w.movements) await tx.stockMovement.update({ where: { id: m.id }, data: { unitCost: m.unitCost, totalCost: m.totalCost, ...(m.quantity ? { quantity: m.quantity } : {}) } });
  for (const u of w.usages) await tx.productionMaterialUsage.update({ where: { id: u.id }, data: { unitCost: u.unitCost, totalCost: u.totalCost } });
  for (const o of w.orders) {
    await tx.productionOrder.update({ where: { id: o.id }, data: { materialCost: o.materialCost, expenseCost: o.expenseCost, totalCost: o.totalCost, unitCost: o.unitCost } });
    if (o.delta.isZero()) continue;
    // Та же корректировка остатка готовой продукции, что и при правке завершённого ТЗ (syncCompletedOrderCost в production/actions).
    const stock = await tx.finishedGoodsStock.findUnique({ where: { warehouseId_productModelId: { warehouseId: o.finishedWarehouseId, productModelId: o.productModelId } } });
    if (!stock) continue;
    const newTotalValue = stock.quantity.mul(stock.avgUnitCost).add(o.delta);
    const avg = stock.quantity.isZero() ? stock.avgUnitCost : newTotalValue.div(stock.quantity);
    await tx.finishedGoodsStock.update({ where: { id: stock.id }, data: { avgUnitCost: avg } });
    await tx.finishedGoodsMovement.create({
      data: {
        organizationId: orgId, warehouseId: o.finishedWarehouseId, productModelId: o.productModelId,
        type: o.delta.gt(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", quantity: 0,
        unitCost: o.produced.isZero() ? 0 : o.delta.abs().div(o.produced), totalCost: o.delta.abs(), productionOrderId: o.id,
        notes: "Корректировка себестоимости после пересчёта лота (карточка лота)",
      },
    });
  }
}
