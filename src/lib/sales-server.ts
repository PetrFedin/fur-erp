import "server-only";
// Данные раздела «Продажи и остатки»: строки выгрузки, прайс, себестоимость моделей, размеры Report, фото. Только чтение.
import { prisma } from "@/lib/prisma";
import type { Commission4Mode } from "@/lib/commission4-mode";
import { classOfLevel2, normCode } from "@/lib/sales-receipts-core";
import { loadRetailPricesState } from "@/lib/import-keys";
import { type MarginInput, type RetailRow } from "@/lib/margin";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { isRepair } from "@/lib/orders-sum";
import { loadModelCosts, loadModelPhotos, loadReportSizes } from "@/lib/margin-server";
import type { SLine } from "@/lib/sales-section";
import type { ReportSizeRow } from "@/lib/margin-tree";

export type SalesInput = { lines: SLine[]; input: MarginInput; sizes: ReportSizeRow[]; photos: Awaited<ReturnType<typeof loadModelPhotos>>; models: Record<string, { id: string; name: string }> };

const num = (d: { toNumber(): number } | null) => d?.toNumber() ?? 0;

export async function loadSalesLines(orgId: string, where: { article?: string; modelCode?: string } = {}): Promise<SLine[]> {
  const rows = await prisma.salesReceiptLine.findMany({
    where: { organizationId: orgId, ...where },
    orderBy: [{ date: "asc" }, { kind: "asc" }, { sourceKey: "asc" }],
    select: { id: true, kind: true, date: true, season: true, orderNo: true, level2: true, level3: true, level4: true, level5: true, fabric: true, modelCode: true, article: true, colorId: true, pcs: true, retailRub: true, retailRubExVat: true, discountRub: true, discountRubExVat: true, retailEur: true, retailEurExVat: true, discountEur: true, discountEurExVat: true, importTag: true },
  });
  return rows.map((r) => ({
    id: r.id, kind: r.kind, iso: r.date.toISOString().slice(0, 10), season: r.season, orderNo: r.orderNo, modelCode: r.modelCode, article: r.article, colorId: r.colorId, fabric: r.fabric,
    level2: r.level2, level3: r.level3, level4: r.level4, level5: r.level5, importTag: r.importTag, pcs: r.pcs ?? 0,
    retailRub: num(r.retailRub), retailRubExVat: num(r.retailRubExVat), discountRub: num(r.discountRub), discountRubExVat: num(r.discountRubExVat),
    retailEur: num(r.retailEur), retailEurExVat: num(r.retailEurExVat), discountEur: num(r.discountEur), discountEurExVat: num(r.discountEurExVat), cls: classOfLevel2(r.level2),
  }));
}

/** Прайс 19.10, цены моделей и себестоимость из ТЗ — для расчёта цены к прайсу, себестоимости и маркапа. */
export async function loadPricing(orgId: string, c4: Commission4Mode): Promise<{ prices: RetailRow[]; modelPrice: Map<string, number>; costs: MarginInput["costs"]; models: Record<string, { id: string; name: string }> }> {
  const [state, models, costs] = await Promise.all([
    loadRetailPricesState(orgId),
    prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, sellingPrice: true } }),
    loadModelCosts(orgId, c4),
  ]);
  const prices = ((state?.value as { rows?: RetailRow[] } | null)?.rows ?? []).filter((r) => r && typeof r.price === "number");
  return {
    prices, costs,
    modelPrice: new Map(models.filter((m) => m.sellingPrice).map((m) => [normCode(m.name), m.sellingPrice!.toNumber()])),
    models: Object.fromEntries(models.map((m) => [normCode(m.name), { id: m.id, name: m.name }])),
  };
}

export async function loadSalesInput(orgId: string, c4: Commission4Mode): Promise<SalesInput> {
  const [lines, pricing, sizes, photos] = await Promise.all([loadSalesLines(orgId), loadPricing(orgId, c4), loadReportSizes(orgId), loadModelPhotos(orgId)]);
  return { lines, input: { lines, prices: pricing.prices, modelPrice: pricing.modelPrice, costs: pricing.costs }, sizes, photos, models: pricing.models };
}

export type Chain = { produced: number; inWork: number; shipped: number; accepted: number; returned: number; shipments: number };

/** Цепочка до розницы: произведено (завершённые ТЗ без ремонта), в работе, отгружено (отгрузки «Отгружена» и «Принята»), принято и возвращено по приёмке.
 *  TODO: заменить на единый расчёт ГП (произведено − отгружено) из «Данные и логика», когда он появится в lib. */
export async function loadChain(orgId: string, c4: Commission4Mode): Promise<Chain> {
  const [drill, lines] = await Promise.all([
    loadOrdersDrill(orgId, "all", c4),
    prisma.shipmentLine.findMany({ where: { shipment: { organizationId: orgId, status: { in: ["SHIPPED", "ACCEPTED"] } } }, select: { quantity: true, acceptedQty: true, returnedQty: true, shipmentId: true } }),
  ]);
  const real = drill.filter((o) => !isRepair(o));
  return {
    produced: real.filter((o) => o.st === "COMPLETED").reduce((a, o) => a + o.qty, 0),
    inWork: real.filter((o) => o.st !== "COMPLETED").reduce((a, o) => a + o.qty, 0),
    shipped: lines.reduce((a, l) => a + l.quantity, 0),
    accepted: lines.reduce((a, l) => a + (l.acceptedQty ?? 0), 0),
    returned: lines.reduce((a, l) => a + (l.returnedQty ?? 0), 0),
    shipments: new Set(lines.map((l) => l.shipmentId)).size,
  };
}
