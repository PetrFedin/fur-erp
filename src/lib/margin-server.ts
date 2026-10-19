import "server-only";
// Данные для маркапов: себестоимость модели из ТЗ (те же функции, что в «Изделиях»), прайс и цена модели, строки приходов и продаж.
import { prisma } from "@/lib/prisma";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { isRepair, sumOrders, sumTotal } from "@/lib/orders-sum";
import type { Commission4Mode } from "@/lib/commission4-mode";
import { classOfLevel2, normCode } from "@/lib/sales-receipts-core";
import { RETAIL_PRICES_KEY, type FullLine, type MarginInput, type ModelCost, type RetailRow } from "@/lib/margin";
import type { DrillOrder } from "@/lib/dashboard-drill";

/** Себестоимость единицы по моделям: Σ полной себестоимости ТЗ ÷ выпуск (как столбец «Себестоимость на 1 изделие» в «Изделиях»). Ключ — нормализованный код модели. */
export async function loadModelCosts(orgId: string, c4: Commission4Mode): Promise<Map<string, ModelCost>> {
  const [models, drill] = await Promise.all([
    prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
    loadOrdersDrill(orgId, "all", c4),
  ]);
  const by = new Map<string, DrillOrder[]>();
  for (const o of drill) if (!isRepair(o)) (by.get(o.mid) ?? by.set(o.mid, []).get(o.mid)!).push(o);
  const out = new Map<string, ModelCost>();
  for (const m of models) {
    const os = by.get(m.id) ?? [];
    const sI = sumOrders(os, "incl"), sE = sumOrders(os, "excl");
    if (sI.qty > 0) out.set(normCode(m.name), { name: m.name, unitIncl: sumTotal(sI) / sI.qty, unitExcl: sumTotal(sE) / sI.qty, qty: sI.qty });
  }
  return out;
}

export async function loadMarginInput(orgId: string, c4: Commission4Mode): Promise<MarginInput | null> {
  try {
    const [rows, state, models, costs] = await Promise.all([
      prisma.salesReceiptLine.findMany({ where: { organizationId: orgId }, select: { kind: true, date: true, season: true, level2: true, fabric: true, modelCode: true, article: true, colorId: true, pcs: true, retailRub: true, retailRubExVat: true } }),
      prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: RETAIL_PRICES_KEY } }, select: { value: true } }),
      prisma.productModel.findMany({ where: { organizationId: orgId, sellingPrice: { not: null } }, select: { name: true, sellingPrice: true } }),
      loadModelCosts(orgId, c4),
    ]);
    if (!rows.length) return null;
    const lines: FullLine[] = rows.map((r) => ({ kind: r.kind, iso: r.date.toISOString().slice(0, 10), season: r.season, modelCode: r.modelCode, article: r.article, colorId: r.colorId, fabric: r.fabric, pcs: r.pcs ?? 0, retailRub: r.retailRub?.toNumber() ?? 0, retailRubExVat: r.retailRubExVat?.toNumber() ?? 0, cls: classOfLevel2(r.level2) }));
    const prices = ((state?.value as { rows?: RetailRow[] } | null)?.rows ?? []).filter((r) => r && typeof r.price === "number");
    return { lines, prices, modelPrice: new Map(models.map((m) => [normCode(m.name), m.sellingPrice!.toNumber()])), costs };
  } catch {
    return null;
  }
}

import { REPORT_SIZES_KEY, type ReportSizeRow } from "@/lib/margin-tree";
import { loadPhotoSummary } from "@/lib/article-photos";

/** Размеры из отчёта о товарах (apply-report-sizes-2026-10-19.ts); нет ключа — пусто. */
export async function loadReportSizes(orgId: string): Promise<ReportSizeRow[]> {
  const st = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: REPORT_SIZES_KEY } }, select: { value: true } });
  const rows = (st?.value as { rows?: ReportSizeRow[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

/** Фото моделей по нормализованному коду модели (для кнопки «Фото»): только модели с фото. */
export async function loadModelPhotos(orgId: string): Promise<Record<string, { modelId: string; photos: { id: string; variant: string; color?: string; itemId?: string }[] }>> {
  const [models, summary] = await Promise.all([prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }), loadPhotoSummary(prisma, orgId)]);
  const out: Record<string, { modelId: string; photos: { id: string; variant: string; color?: string; itemId?: string }[] }> = {};
  for (const m of models) { const ph = summary.get(m.id); if (ph?.length) out[normCode(m.name)] = { modelId: m.id, photos: ph }; }
  return out;
}
