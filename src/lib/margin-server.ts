import "server-only";
// Данные для маркапов: себестоимость модели из ТЗ (те же функции, что в «Изделиях»), прайс и цена модели, строки приходов и продаж.
import { prisma } from "@/lib/prisma";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { isRepair, sumOrders, sumTotal } from "@/lib/orders-sum";
import type { Commission4Mode } from "@/lib/commission4-mode";
import { assignSeasons, classOfLevel2, normCode } from "@/lib/sales-receipts-core";
import { loadRetailPricesState, loadReportSizesState } from "@/lib/import-keys";
import { type FullLine, type MarginInput, type ModelCost, type RetailRow } from "@/lib/margin";
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
      prisma.salesReceiptLine.findMany({ where: { organizationId: orgId }, select: { kind: true, date: true, season: true, level2: true, level3: true, level4: true, fabric: true, modelCode: true, article: true, colorId: true, pcs: true, retailRub: true, retailRubExVat: true, discountRub: true, discountRubExVat: true, retailEur: true, retailEurExVat: true, discountEur: true, discountEurExVat: true } }),
      loadRetailPricesState(orgId),
      prisma.productModel.findMany({ where: { organizationId: orgId, sellingPrice: { not: null } }, select: { name: true, sellingPrice: true } }),
      loadModelCosts(orgId, c4),
    ]);
    if (!rows.length) return null;
    const lines: FullLine[] = assignSeasons(rows.map((r) => ({ kind: r.kind, iso: r.date.toISOString().slice(0, 10), season: r.season, modelCode: r.modelCode, article: r.article, colorId: r.colorId, fabric: r.fabric, level3: r.level3, level4: r.level4, pcs: r.pcs ?? 0, retailRub: r.retailRub?.toNumber() ?? 0, retailRubExVat: r.retailRubExVat?.toNumber() ?? 0, discountRub: r.discountRub?.toNumber() ?? 0, discountRubExVat: r.discountRubExVat?.toNumber() ?? 0, retailEur: r.retailEur?.toNumber() ?? 0, retailEurExVat: r.retailEurExVat?.toNumber() ?? 0, discountEur: r.discountEur?.toNumber() ?? 0, discountEurExVat: r.discountEurExVat?.toNumber() ?? 0, cls: classOfLevel2(r.level2) })));
    const prices = ((state?.value as { rows?: RetailRow[] } | null)?.rows ?? []).filter((r) => r && typeof r.price === "number");
    return { lines, prices, modelPrice: new Map(models.map((m) => [normCode(m.name), m.sellingPrice!.toNumber()])), costs };
  } catch {
    return null;
  }
}

import { type ReportSizeRow } from "@/lib/margin-tree";
import { loadPhotoSummary } from "@/lib/article-photos";

/** Размеры из отчёта о товарах (apply-report-sizes-2026-10-19.ts); нет ключа — пусто. */
export async function loadReportSizes(orgId: string): Promise<ReportSizeRow[]> {
  const st = await loadReportSizesState(orgId);
  const rows = (st?.value as { rows?: ReportSizeRow[] } | null)?.rows;
  if (!Array.isArray(rows)) return [];
  return withOurFw26Delivered(rows, await prisma.salesReceiptLine.findMany({ where: { organizationId: orgId, kind: "RECEIPT" }, select: { kind: true, date: true, season: true, article: true, colorId: true, pcs: true } }));
}

/**
 * «Поступило по FW26/27» (fw26Deliv) в Report считается по дату выгрузки отчёта (24.09), а наш приход — по файлу «поступления и продажи» (позже).
 * Чтобы «заказано = пришло + ждём» везде (Главная, прогноз сырья) считалось от одного прихода, поступившее по FW26/27 берём из нашего прихода
 * (сезон — из файла прихода, по артикулу): ждём по артикулу = max(0, Conf − пришло), на размерные строки — пропорционально Conf.
 */
export function withOurFw26Delivered(rows: ReportSizeRow[], receipts: { kind: string; date: Date; season: string; article: string; colorId: string | null; pcs: number | null }[]): ReportSizeRow[] {
  // Сезон заказа — как в файле прихода (колонка «Сезон»): приход по заказам FW26/27 идёт в «пришло» по FW26/27 независимо от даты прихода.
  // Артикул в файле и в Report пишется по-разному («MH-03 SABLE…» и «MH-03/SABLE…»): сравниваем без знаков и пробелов.
  const key = (a: string) => a.toUpperCase().replace(/[^A-ZА-Я0-9]/g, "");
  const recv = new Map<string, number>();
  for (const l of receipts) if (l.kind === "RECEIPT" && l.season === "FW 26/27") recv.set(key(l.article), (recv.get(key(l.article)) ?? 0) + (l.pcs ?? 0));
  const conf = new Map<string, number>();
  for (const r of rows) conf.set(key(r.acode), (conf.get(key(r.acode)) ?? 0) + (r.fw26Conf ?? 0));
  return rows.map((r) => {
    if (r.fw26Conf === undefined && r.fw26Deliv === undefined) return r;
    const c = conf.get(key(r.acode)) ?? 0;
    const left = Math.max(0, c - (recv.get(key(r.acode)) ?? 0));
    const rowConf = r.fw26Conf ?? 0;
    return { ...r, fw26Deliv: c > 0 ? rowConf * (1 - left / c) : 0 };
  });
}

/** Фото моделей по нормализованному коду модели (для кнопки «Фото»): только модели с фото. */
export async function loadModelPhotos(orgId: string): Promise<Record<string, { modelId: string; photos: { id: string; variant: string; color?: string; itemId?: string }[] }>> {
  const [models, summary] = await Promise.all([prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }), loadPhotoSummary(prisma, orgId)]);
  const out: Record<string, { modelId: string; photos: { id: string; variant: string; color?: string; itemId?: string }[] }> = {};
  for (const m of models) { const ph = summary.get(m.id); if (ph?.length) out[normCode(m.name)] = { modelId: m.id, photos: ph }; }
  return out;
}
