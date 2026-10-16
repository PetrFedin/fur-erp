import { orderUnits } from "@/lib/production-totals";
import { memoRequest } from "@/lib/req-memo";
import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { orderYearOf, orderYearWhere } from "@/lib/year-scope";
import type { YearFilter } from "@/lib/year-filter";
import { buildFurIndex, canonicalFur } from "@/lib/fur-ref";
import { sumUsagesWith4, usageExclVat } from "@/lib/commission4";
import type { Commission4Mode } from "@/lib/commission4-mode";
import { lotHammer } from "@/lib/lot-hammer";
import {
  classifyProduct,
  furFromText,
  normalizeColor,
  normalizeSize,
  UNDEFINED_COLOR,
  UNDEFINED_FUR,
  type CategorySource,
} from "@/lib/product-category";
import { articleHint, articleLabel } from "@/lib/article-label";
import { orderColors } from "@/lib/order-colors";
import { parseOrderSizes } from "@/lib/order-sizes";
import { batchLabel } from "@/lib/batch-label";

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
  /** Ставка НДС лота, %. */
  vat: number;
  /** Цвет лота (по справочнику цветов, иначе как записан). */
  lotColor: string | null;
  /** Признаки меха лота (справочник /settings/fur-attrs). */
  lotAttrs: string[];
  /** Молоток за шкуру, ₽ (без НДС / с НДС) и откуда он взят; null — в расчёте лота молотка нет. Для подкладки всегда null. */
  hammerExcl: number | null;
  hammerIncl: number | null;
  hammerUsd: number | null;
  hammerSource: string | null;
  purchaseId: string | null;
  purchaseNumber: string | null;
  /** Аукцион / сессия закупки лота. */
  auction: string | null;
  supplier: string | null;
  purchaseYear: number | null;
};

export type VatKind = "20" | "22" | "mix" | "none";

export type OrderRow = {
  id: string;
  number: string;
  workOrderNumber: string | null;
  modelId: string;
  modelName: string;
  /** Подпись артикула по справочнику: «M012 · Пальто» (modelName остаётся кодом — по нему группировка и фильтры). */
  modelLabel: string;
  modelHint: string;
  category: string;
  /** Группа категории из справочника («Одежда», «Аксессуары»); пусто — без группы. */
  categoryGroup: string;
  categorySource: CategorySource;
  fur: string;
  furFromUsage: boolean;
  size: string;
  sizeRaw: string;
  /** Для группировок: цвета ТЗ через «; » (составной ТЗ — списком) либо «Цвет не указан». */
  color: string;
  /** ВСЕ цвета ТЗ (канонические названия справочника): по ним работает фильтр «Цвет»; пусто — цвет в документах не указан. */
  colors: string[];
  /** Размеры из текста ТЗ (parseOrderSizes): по ним работает фильтр «Размер»; пусто — размер не указан. */
  sizes: string[];
  batchNumber: number | null;
  /** «Партия 5 · 2025» (год партии; нет — «≈год» по ТЗ). */
  batchText: string | null;
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
  /** Часть надбавки на мех и на подкладку отдельно (в выбранном режиме). */
  c4FurIncl: number;
  c4FurExcl: number;
  c4LiningIncl: number;
  c4LiningExcl: number;
  /** Надбавка 4%, которую добавил бы режим «С 4%» (для подсказок), с НДС. */
  c4PotIncl: number;
  expenses: number;
  /** Расходы ТЗ по статьям (Σ = expenses). */
  expenseList: { n: string; a: number }[];
  work: number;
  /** Себестоимость системы: материалы + 4% (по режиму) + расходы; с НДС / без НДС. */
  costIncl: number;
  costExcl: number;
  furQty: number;
  liningQty: number;
  usageCount: number;
  lines: LotLine[];
  /** Σ молотка по шкурам с данными (₽, без НДС / с НДС) и сколько шкур с данными; всего шкур — furQty. */
  hammerExcl: number;
  hammerIncl: number;
  hammerSkins: number;
  /** Лоты меха в ТЗ: сколько всего и у скольких есть молоток. */
  furLotCount: number;
  furLotHammerCount: number;
  seasonCode: string | null;
  clientName: string | null;
  salesCode: string | null;
  modelSku: string | null;
  modelAliases: string[];
  vatKind: VatKind;
  /** Значения для фильтров по сырью: цвета лотов, аукционы, годы закупки (только меховые лоты). */
  lotColors: string[];
  /** Признаки меха ТЗ: названные в самом ТЗ и признаки списанных лотов меха (фильтр attr). */
  attrs: string[];
  auctions: string[];
  purchaseYears: number[];
};

const n = (d: Decimal | null | undefined) => (d ? Number(d) : 0);

type Ref = { name: string; aliases: string[]; nameEn?: string | null };

/** Название по справочнику (имя, английское имя или синоним без учёта регистра); нет в справочнике — null. */
function makeResolver(refs: Ref[]) {
  const m = new Map<string, string>();
  const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  for (const r of refs) {
    for (const v of [r.name, r.nameEn ?? "", ...r.aliases]) if (v && v.trim()) m.set(key(v), r.name);
  }
  return (text: string | null | undefined) => (text && text.trim() ? (m.get(key(text)) ?? null) : null);
}

async function loadOrderRowsImpl(orgId: string, year: YearFilter, mode: Commission4Mode): Promise<OrderRow[]> {
  const [orders, colorRefs, furRefs] = await Promise.all([
    prisma.productionOrder.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" }, AND: [orderYearWhere(year)] },
      select: {
        id: true,
        number: true,
        workOrderNumber: true,
        status: true,
        productModelId: true,
        productModel: { select: { name: true, category: true, categoryRef: { select: { name: true, group: true } }, salesCode: true, salesName: true, sku: true, aliases: true } },
        batch: { select: { number: true, year: true } },
        season: { select: { code: true } },
        client: { select: { name: true } },
        colorRef: { select: { id: true, name: true } },
        colors: { select: { quantity: true, sizes: true, colorRef: { select: { id: true, name: true } } } },
        plannedQuantity: true,
        producedQuantity: true,
        color: true,
        size: true,
        materialDescription: true,
        furTypeOverride: true,
        attrs: { select: { attr: { select: { name: true } } } },
        workOrderDate: true,
        endDate: true,
        startDate: true,
        clientWorkPricePerUnit: true,
        totalCost: true,
        materialUsages: {
          select: {
            quantity: true,
            totalCost: true,
            commission4: true,
            vatRate: true,
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
        expenses: { select: { amount: true, description: true, category: { select: { name: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.colorRef.findMany({ where: { organizationId: orgId }, select: { name: true, aliases: true } }),
    prisma.furRef.findMany({ where: { organizationId: orgId }, select: { name: true, nameEn: true, aliases: true } }),
  ]);
  const colorOf = makeResolver(colorRefs);
  // Вид меха — через общий хелпер справочника меха (любое написание → каноническое русское название); пустой справочник — встроенный набор.
  const furIdx = furRefs.length > 0 ? buildFurIndex(furRefs) : undefined;
  const furOf = (text: string | null | undefined) => canonicalFur(text, furIdx)?.name ?? null;

  // Сведения о лотах (молоток, закупка, цвет по справочнику) — одним запросом по лотам, которые реально списаны.
  const lotIds = Array.from(new Set(orders.flatMap((o) => o.materialUsages.map((u) => u.lot.id))));
  const lotRows = lotIds.length
    ? await prisma.rawMaterialLot.findMany({
        where: { id: { in: lotIds } },
        select: {
          id: true,
          costBreakdown: true,
          vatRate: true,
          colorRef: { select: { name: true } },
          attrs: { select: { attr: { select: { name: true } } } },
          purchase: { select: { id: true, number: true, orderDate: true, auctionSession: true, supplier: { select: { name: true } } } },
          purchaseItems: { select: { costPlan: true } },
        },
      })
    : [];
  const lotInfo = new Map(
    lotRows.map((l) => {
      const h = lotHammer(l.costBreakdown, Number(l.vatRate), l.purchaseItems.map((i) => i.costPlan));
      return [l.id, { h, colorRef: l.colorRef?.name ?? null, attrs: l.attrs.map((a) => a.attr.name), purchase: l.purchase }] as const;
    }),
  );

  return orders.map((o) => {
    const qty = orderUnits(o); // production-totals.ts: выпуск завершённого ТЗ, план ТЗ в работе
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
      refName: o.productModel.categoryRef?.name,
      modelCategory: o.productModel.category,
      orderDescription: o.materialDescription,
      modelName: o.productModel.name,
    });
    // Вид меха: по сырью из списаний (через справочник меха, если он заполнен); несколько видов — «A + B»; нет списаний — по тексту.
    const furNames = Array.from(new Set(furUs.map((u) => furOf(u.rawMaterial.name) ?? u.rawMaterial.name))).sort((a, b) => a.localeCompare(b, "ru"));
    const fromText = furOf(o.productModel.category) ?? furOf(o.materialDescription) ?? furFromText(o.productModel.category) ?? furFromText(o.materialDescription);
    // Ручной вид меха ТЗ (furTypeOverride) главнее вывода из списаний; пусто — как раньше. Единственное место, где вид меха ТЗ определяется.
    const furOverride = o.furTypeOverride?.trim() || null;
    const fur = furOverride ?? (furNames.length > 0 ? furNames.join(" + ") : (fromText ?? UNDEFINED_FUR));

    const q = qty;
    const work = o.clientWorkPricePerUnit ? Number(o.clientWorkPricePerUnit.mul(qty)) : 0;
    const when = orderYearOf({ workOrderDate: o.workOrderDate, endDate: o.endDate, startDate: o.startDate, batch: o.batch });

    // Цвет ТЗ: справочник цветов (по ссылке, затем по названию/синониму), иначе текст как записан.
    // Все цвета ТЗ: составной — строки ProductionOrderColor, обычный — один (справочник либо текст).
    const colorList = Array.from(
      new Set(orderColors({ color: o.color, colorRef: o.colorRef, colors: o.colors }).map((c) => (c.color ? c.name : (colorOf(c.name) ?? normalizeColor(c.name))))),
    );
    const color = colorList.join("; ");

    const lines = o.materialUsages.map((u) => {
      const isLining = u.rawMaterial.unit === "M";
      const quantity = Number(u.quantity);
      // без НДС: количество × цена лота без НДС (как lotUnitCostExclVat)
      const split = Number(u.lot.materialCostExclVat) + Number(u.lot.expenseCostExclVat);
      const unitExcl =
        split === 0 && Number(u.lot.unitCost) > 0 ? Number(u.lot.unitCost) / (1 + n(u.lot.vatRate) / 100) : split;
      const info = lotInfo.get(u.lot.id);
      const h = isLining ? null : (info?.h ?? null);
      const lotColor = info?.colorRef ?? colorOf(u.lot.color) ?? (u.lot.color && u.lot.color.trim() ? normalizeColor(u.lot.color) : null);
      const pu = info?.purchase ?? null;
      return {
        rawName: u.rawMaterial.name,
        isLining,
        lotId: u.lot.id,
        lotNumber: u.lot.lotNumber,
        grade: u.lot.grade,
        color: u.lot.color,
        qty: quantity,
        incl: Number(u.totalCost),
        excl: u.vatRate != null ? Number(usageExclVat(u, 0)) : quantity * unitExcl,
        c4: u.commission4,
        vat: u.vatRate != null ? n(u.vatRate) : n(u.lot.vatRate),
        lotColor,
        lotAttrs: isLining ? [] : (info?.attrs ?? []),
        hammerExcl: h?.excl ?? null,
        hammerIncl: h?.incl ?? null,
        hammerUsd: h?.usd ?? null,
        hammerSource: h?.source ?? null,
        purchaseId: pu?.id ?? null,
        purchaseNumber: pu?.number ?? null,
        auction: pu?.auctionSession?.trim() || null,
        supplier: pu?.supplier.name ?? null,
        purchaseYear: pu ? pu.orderDate.getUTCFullYear() : null,
      } satisfies LotLine;
    });
    const furLines = lines.filter((l) => !l.isLining);
    const withH = furLines.filter((l) => l.hammerExcl != null);
    const vats = new Set(lines.map((l) => l.vat));
    const vatKind: VatKind = vats.size === 0 ? "none" : vats.size > 1 ? "mix" : vats.has(22) ? "22" : vats.has(20) ? "20" : "mix";
    const uniq = <T,>(a: (T | null)[]) => Array.from(new Set(a.filter((x): x is T => x != null)));

    return {
      id: o.id,
      number: o.number,
      workOrderNumber: o.workOrderNumber,
      modelId: o.productModelId,
      modelName: o.productModel.name,
      modelLabel: articleLabel(o.productModel),
      modelHint: articleHint(o.productModel),
      category: cls.category,
      categoryGroup: o.productModel.categoryRef?.group ?? "",
      categorySource: cls.source,
      fur,
      furFromUsage: furNames.length > 0,
      size: normalizeSize(o.size),
      sizeRaw: (o.size ?? "").trim(),
      color: color || UNDEFINED_COLOR,
      colors: colorList,
      sizes: parseOrderSizes(o.size),
      batchNumber: o.batch?.number ?? null,
      batchText: o.batch ? batchLabel(o.batch.number, o.batch.year, [o]) : null,
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
      c4FurIncl: Number(fs.extraIncl),
      c4FurExcl: Number(fs.extraExcl),
      c4LiningIncl: Number(ls.extraIncl),
      c4LiningExcl: Number(ls.extraExcl),
      c4PotIncl: Number(c4Pot),
      expenses: Number(exp),
      expenseList: o.expenses.map((e) => ({ n: [e.category.name, e.description].filter(Boolean).join(" · "), a: Number(e.amount) })),
      work,
      costIncl: Number(costIncl),
      costExcl: Number(costExcl),
      furQty: furUs.reduce((s, u) => s + Number(u.quantity), 0),
      liningQty: linUs.reduce((s, u) => s + Number(u.quantity), 0),
      usageCount: o.materialUsages.length,
      lines,
      hammerExcl: withH.reduce((s, l) => s + l.qty * (l.hammerExcl ?? 0), 0),
      hammerIncl: withH.reduce((s, l) => s + l.qty * (l.hammerIncl ?? 0), 0),
      hammerSkins: withH.reduce((s, l) => s + l.qty, 0),
      furLotCount: new Set(furLines.map((l) => l.lotId)).size,
      furLotHammerCount: new Set(withH.map((l) => l.lotId)).size,
      seasonCode: o.season?.code ?? null,
      clientName: o.client?.name ?? null,
      salesCode: o.productModel.salesCode,
      modelSku: o.productModel.sku,
      modelAliases: o.productModel.aliases,
      vatKind,
      lotColors: uniq(furLines.map((l) => l.lotColor)),
      attrs: Array.from(new Set([...o.attrs.map((a) => a.attr.name), ...furLines.flatMap((l) => l.lotAttrs)])).sort((a, b) => a.localeCompare(b, "ru", { numeric: true })),
      auctions: uniq(furLines.map((l) => l.auction)),
      purchaseYears: uniq(furLines.map((l) => l.purchaseYear)).sort(),
    };
  });
}

export const loadOrderRows = memoRequest("orderRows", loadOrderRowsImpl, (orgId, year, mode) => `${orgId}|${year}|${mode}`);
