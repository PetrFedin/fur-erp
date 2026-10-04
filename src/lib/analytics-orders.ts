import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { orderYearOf, orderYearWhere } from "@/lib/year-scope";
import type { YearFilter } from "@/lib/year-filter";
import { sumUsagesWith4 } from "@/lib/commission4";
import type { Commission4Mode } from "@/lib/commission4-mode";
import {
  classifyProduct,
  furFromText,
  normalizeColor,
  normalizeSize,
  UNDEFINED_FUR,
  type CategorySource,
} from "@/lib/product-category";

// Строка аналитики = одно ТЗ (не отменённое). Все суммы — обычные числа в рублях (с НДС и без НДС),
// чтобы строки можно было свободно группировать и передавать в разметку.
// Себестоимость ТЗ — как в «Партиях» и «Изделиях»: снимок totalCost (сырьё + подкладка + расходы ТЗ) или расчёт по строкам,
// плюс надбавка 4% на сырьё и подкладку в режиме «С 4%». Работа (цена работы × количество) — отдельно, в себестоимость системы НЕ входит.

export type LotLine = {
  rawName: string;
  isLining: boolean;
  lotId: string;
  lotNumber: string | null;
  grade: string | null;
  color: string | null;
  qty: number;
  incl: number;
  excl: number;
  c4: boolean;
};

export type OrderRow = {
  id: string;
  number: string;
  workOrderNumber: string | null;
  modelId: string;
  modelName: string;
  category: string;
  categorySource: CategorySource;
  fur: string;
  furFromUsage: boolean;
  size: string;
  sizeRaw: string;
  color: string;
  batchNumber: number | null;
  year: number | null;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
  /** done — завершён; work — запланирован или в работе. */
  group: "done" | "work";
  qty: number;
  // мех и подкладка без надбавки 4% (с НДС / без НДС); надбавка — отдельно ниже
  furIncl: number;
  furExcl: number;
  liningIncl: number;
  liningExcl: number;
  /** Надбавка 4% в выбранном режиме (0 в режиме «Без 4%»). */
  c4Incl: number;
  c4Excl: number;
  /** Надбавка 4%, которую добавил бы режим «С 4%» (для подсказок), с НДС. */
  c4PotIncl: number;
  expenses: number;
  work: number;
  /** Себестоимость системы: материалы + 4% (по режиму) + расходы; с НДС / без НДС. */
  costIncl: number;
  costExcl: number;
  furQty: number;
  liningQty: number;
  usageCount: number;
  lines: LotLine[];
  retailPrice: number | null;
};

const n = (d: Decimal | null | undefined) => (d ? Number(d) : 0);

export async function loadOrderRows(orgId: string, year: YearFilter, mode: Commission4Mode): Promise<OrderRow[]> {
  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: orgId, status: { not: "CANCELLED" }, AND: [orderYearWhere(year)] },
    select: {
      id: true,
      number: true,
      workOrderNumber: true,
      status: true,
      productModelId: true,
      productModel: { select: { name: true, category: true } },
      batch: { select: { number: true, year: true } },
      plannedQuantity: true,
      producedQuantity: true,
      color: true,
      size: true,
      materialDescription: true,
      workOrderDate: true,
      endDate: true,
      startDate: true,
      clientWorkPricePerUnit: true,
      retailPrice: true,
      totalCost: true,
      materialUsages: {
        select: {
          quantity: true,
          totalCost: true,
          commission4: true,
          rawMaterial: { select: { name: true, unit: true } },
          lot: {
            select: {
              id: true,
              lotNumber: true,
              grade: true,
              color: true,
              materialCostExclVat: true,
              expenseCostExclVat: true,
              unitCost: true,
              vatRate: true,
            },
          },
        },
      },
      expenses: { select: { amount: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return orders.map((o) => {
    const qty = o.producedQuantity.greaterThan(0) ? o.producedQuantity : o.plannedQuantity;
    const furUs = o.materialUsages.filter((u) => u.rawMaterial.unit !== "M");
    const linUs = o.materialUsages.filter((u) => u.rawMaterial.unit === "M");
    const fs = sumUsagesWith4(furUs, mode);
    const ls = sumUsagesWith4(linUs, mode);
    const exp = o.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
    const projected = o.materialUsages.reduce((s, u) => s.add(u.totalCost), new Decimal(0)).add(exp);
    const c4Incl = fs.extraIncl.add(ls.extraIncl);
    const c4Excl = fs.extraExcl.add(ls.extraExcl);
    const costIncl = (o.totalCost ?? projected).add(c4Incl);
    const costExcl = fs.excl.add(ls.excl).add(exp);
    const c4Pot = sumUsagesWith4(furUs, "on").extraIncl.add(sumUsagesWith4(linUs, "on").extraIncl);

    const cls = classifyProduct({
      modelCategory: o.productModel.category,
      orderDescription: o.materialDescription,
      modelName: o.productModel.name,
    });
    // Вид меха: по сырью из списаний; несколько видов — «A + B»; нет списаний — по тексту названия/описания.
    const furNames = Array.from(new Set(furUs.map((u) => u.rawMaterial.name))).sort((a, b) => a.localeCompare(b, "ru"));
    const fromText = furFromText(o.productModel.category) ?? furFromText(o.materialDescription);
    const fur = furNames.length > 0 ? furNames.join(" + ") : (fromText ?? UNDEFINED_FUR);

    const q = Number(qty);
    const work = o.clientWorkPricePerUnit ? Number(o.clientWorkPricePerUnit.mul(qty)) : 0;
    const when = orderYearOf({ workOrderDate: o.workOrderDate, endDate: o.endDate, startDate: o.startDate, batch: o.batch });

    return {
      id: o.id,
      number: o.number,
      workOrderNumber: o.workOrderNumber,
      modelId: o.productModelId,
      modelName: o.productModel.name,
      category: cls.category,
      categorySource: cls.source,
      fur,
      furFromUsage: furNames.length > 0,
      size: normalizeSize(o.size),
      sizeRaw: (o.size ?? "").trim(),
      color: normalizeColor(o.color),
      batchNumber: o.batch?.number ?? null,
      year: when,
      status: o.status as OrderRow["status"],
      group: o.status === "COMPLETED" ? "done" : "work",
      qty: q,
      // мех и подкладка — БЕЗ надбавки 4% (она отдельной строкой c4*)
      furIncl: Number(fs.incl.sub(fs.extraIncl)),
      furExcl: Number(fs.excl.sub(fs.extraExcl)),
      liningIncl: Number(ls.incl.sub(ls.extraIncl)),
      liningExcl: Number(ls.excl.sub(ls.extraExcl)),
      c4Incl: Number(c4Incl),
      c4Excl: Number(c4Excl),
      c4PotIncl: Number(c4Pot),
      expenses: Number(exp),
      work,
      costIncl: Number(costIncl),
      costExcl: Number(costExcl),
      furQty: furUs.reduce((s, u) => s + Number(u.quantity), 0),
      liningQty: linUs.reduce((s, u) => s + Number(u.quantity), 0),
      usageCount: o.materialUsages.length,
      lines: o.materialUsages.map((u) => {
        const isLining = u.rawMaterial.unit === "M";
        const quantity = Number(u.quantity);
        // без НДС: количество × цена лота без НДС (как lotUnitCostExclVat)
        const split = Number(u.lot.materialCostExclVat) + Number(u.lot.expenseCostExclVat);
        const unitExcl =
          split === 0 && Number(u.lot.unitCost) > 0 ? Number(u.lot.unitCost) / (1 + n(u.lot.vatRate) / 100) : split;
        return {
          rawName: u.rawMaterial.name,
          isLining,
          lotId: u.lot.id,
          lotNumber: u.lot.lotNumber,
          grade: u.lot.grade,
          color: u.lot.color,
          qty: quantity,
          incl: Number(u.totalCost),
          excl: quantity * unitExcl,
          c4: u.commission4,
        };
      }),
      retailPrice: o.retailPrice ? Number(o.retailPrice) : null,
    };
  });
}
