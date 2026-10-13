// Загрузка лотов для таблицы «Мех / Подкладка» (расчёт — в fur-table.ts). Без "server-only":
// функцию вызывают и страницы (клиент БД — общий prisma), и scripts/test-fur-table.ts (свой PrismaClient).
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma, PrismaClient } from "@prisma/client";
import { canonicalFur, type FurIndex } from "./fur-ref";
import { lotUnitCostExclVat } from "./purchase-totals";
import { usageExclVat } from "./commission4";
import { lotHammer, lotUsdPrice } from "./lot-hammer";
import { lotYear } from "./year-scope";
import { COMMISSION_RATE } from "./commission4-const";
import { NO_AUCTION_LABEL, auctionName, shortAuctionName } from "./auction-names";
import { classifyPurchaseSource } from "./purchase-source";
import { lotSizes } from "./lot-size";
import type { YearFilter } from "./year-filter";
import { NO_AUCTION, NOT_SET, flowOf, type Flow, type FurKind, type FurLot } from "./fur-table";
import type { RawLot } from "./raw-analytics";

/** «Красная» из названия материала («Лиса красная») — это цвет: пока colorRefId не проставлен скриптом color-red-fox.ts, показываем его так. */
export function colorFromMaterialName(name: string): string | null {
  return /^лиса\s+красная$/i.test(name.trim()) ? "Красный" : null;
}

const LOT_SELECT = {
  id: true,
  lotNumber: true,
  grade: true,
  color: true,
  sizeGrade: true,
  receivedDate: true,
  quantityReceived: true,
  quantityRemaining: true,
  unitCost: true,
  vatRate: true,
  materialCostExclVat: true,
  expenseCostExclVat: true,
  costBreakdown: true,
  rawMaterial: { select: { name: true, unit: true } },
  colorRef: { select: { name: true } },
  attrs: { select: { attr: { select: { name: true } } }, orderBy: { attr: { name: "asc" as const } } },
  purchase: { select: { id: true, number: true, auctionSession: true, isContractorRaw: true, auction: { select: { kind: true, house: true } }, orderDate: true, currency: true, status: true, supplier: { select: { name: true } } } },
  purchaseItems: { select: { quantity: true, subtotal: true, costPlan: true } },
  usages: {
    where: { productionOrder: { status: { not: "CANCELLED" as const } } },
    select: { quantity: true, totalCost: true, commission4: true, vatRate: true, productionOrder: { select: { id: true, number: true } } },
    orderBy: { date: "asc" as const },
  },
} satisfies Prisma.RawMaterialLotSelect;

type LotRecord = Prisma.RawMaterialLotGetPayload<{ select: typeof LOT_SELECT }>;

const zero = () => new Decimal(0);
const num = (d: Decimal) => d.toNumber();

/** Одна запись лота склада → строка таблицы. */
export function furLotFromRecord(l: LotRecord, furIdx?: FurIndex): FurLot {
  const kind: FurKind = l.rawMaterial.unit === "M" ? "lining" : "fur";
  const k = new Decimal(COMMISSION_RATE);
  const unitExcl = lotUnitCostExclVat(l);
  let used = zero();
  let usedIncl = zero();
  let usedExcl = zero();
  let extraIncl = zero();
  let extraExcl = zero();
  const byOrder = new Map<string, { orderId: string; number: string; qty: Decimal; incl: Decimal; excl: Decimal; extraIncl: Decimal; extraExcl: Decimal }>();
  for (const u of l.usages) {
    used = used.add(u.quantity);
    usedIncl = usedIncl.add(u.totalCost);
    const ex = usageExclVat(u, unitExcl);
    usedExcl = usedExcl.add(ex);
    if (u.commission4) {
      extraIncl = extraIncl.add(u.totalCost.mul(k));
      extraExcl = extraExcl.add(ex.mul(k));
    }
    const cur = byOrder.get(u.productionOrder.id);
    const uExtraIncl = u.commission4 ? u.totalCost.mul(k) : zero();
    const uExtraExcl = u.commission4 ? ex.mul(k) : zero();
    if (cur) {
      cur.qty = cur.qty.add(u.quantity); cur.incl = cur.incl.add(u.totalCost); cur.excl = cur.excl.add(ex);
      cur.extraIncl = cur.extraIncl.add(uExtraIncl); cur.extraExcl = cur.extraExcl.add(uExtraExcl);
    } else byOrder.set(u.productionOrder.id, { orderId: u.productionOrder.id, number: u.productionOrder.number, qty: u.quantity, incl: u.totalCost, excl: ex, extraIncl: uExtraIncl, extraExcl: uExtraExcl });
  }
  const name = auctionName(l.purchase?.auctionSession);
  const d = l.purchase?.orderDate ?? l.receivedDate;
  const usdByPurchase = l.purchase?.currency === "USD";
  const usdInfo = lotUsdPrice(l.costBreakdown, l.purchaseItems.map((i) => i.costPlan), {
    vatRate: Number(l.vatRate), purchaseNumber: l.purchase?.number, lotNumber: l.lotNumber,
  });
  const usdPrice = usdInfo.usd;
  const hammer = lotHammer(l.costBreakdown, Number(l.vatRate), l.purchaseItems.map((i) => i.costPlan), { purchaseNumber: l.purchase?.number, lotNumber: l.lotNumber });
  const recvN = num(l.quantityReceived);
  const remN = num(l.quantityRemaining);
  const usedN = num(used);
  const material = l.rawMaterial.name;
  return {
    id: l.id,
    kind,
    item: kind === "lining" ? material : canonicalFur(material, furIdx)?.name ?? material,
    materialName: material,
    color: l.colorRef?.name?.trim() || l.color?.trim() || colorFromMaterialName(material) || NOT_SET,
    // Размер — только по документам (RawMaterialLot.sizeGrade); из текста сорта не угадываем (lot-size.ts: lotSizes).
    size: lotSizes(l.sizeGrade).join(", ") || NOT_SET,
    sizes: lotSizes(l.sizeGrade),
    attrs: l.attrs.map((a) => a.attr.name),
    auction: name ?? NO_AUCTION,
    auctionLabel: name ? shortAuctionName(name) || NO_AUCTION_LABEL : NO_AUCTION_LABEL,
    year: d.getUTCFullYear(),
    lotNumber: l.lotNumber?.trim() || "без номера",
    grade: l.grade?.trim() ?? "",
    purchaseId: l.purchase?.id ?? null,
    purchaseNumber: l.purchase?.number ?? null,
    supplier: l.purchase?.supplier?.name ?? null,
    recv: num(l.quantityReceived),
    used: num(used),
    rem: num(l.quantityRemaining),
    recvIncl: num(l.quantityReceived.mul(l.unitCost)),
    recvExcl: num(l.quantityReceived.mul(unitExcl)),
    usedIncl: num(usedIncl),
    usedExcl: num(usedExcl),
    usedExtraIncl: num(extraIncl),
    usedExtraExcl: num(extraExcl),
    remIncl: num(l.quantityRemaining.mul(l.unitCost)),
    remExcl: num(l.quantityRemaining.mul(unitExcl)),
    vatRate: Number(l.vatRate),
    usdPrice,
    usdSource: usdInfo.source,
    // Цена в USD — из документов лота (молоток, $/шт.); лоты без неё в среднюю $ не входят. Закупка с валютой USD (Purchase.currency) — запасной путь.
    usdQty: usdPrice != null ? recvN : usdByPurchase ? num(l.purchaseItems.reduce((a, i) => a.add(i.quantity), zero())) : 0,
    usdSubtotal: usdPrice != null ? recvN * usdPrice : usdByPurchase ? num(l.purchaseItems.reduce((a, i) => a.add(i.subtotal), zero())) : 0,
    usdUsedQty: usdPrice != null ? usedN : 0,
    usdUsedSubtotal: usdPrice != null ? usedN * usdPrice : 0,
    usdRemQty: usdPrice != null ? remN : 0,
    usdRemSubtotal: usdPrice != null ? remN * usdPrice : 0,
    usdQtyDirect: usdInfo.source === "direct" ? recvN : 0,
    usdQtyEur: usdInfo.source === "eur×rate" ? recvN : 0,
    usdQtyRub: usdInfo.source === "rub÷rate" ? recvN : 0,
    usdQtyCalc: usdInfo.source === "calc" ? recvN : 0,
    hammerExcl: hammer?.excl ?? null,
    hammerIncl: hammer?.incl ?? null,
    hammerSource: hammer?.source ?? null,
    hamQty: hammer ? recvN : 0,
    hamSubExcl: hammer ? recvN * hammer.excl : 0,
    hamSubIncl: hammer ? recvN * hammer.incl : 0,
    source: l.purchase?.isContractorRaw ? "supplier" : classifyPurchaseSource(l.purchase?.auction),
    purchaseStatus: l.purchase ? (l.purchase.status === "RECEIVED" ? "RECEIVED" : l.purchase.status === "CANCELLED" ? "CANCELLED" : "DRAFT") : "RECEIVED",
    orderDate: l.purchase?.orderDate ? l.purchase.orderDate.toISOString().slice(0, 10) : undefined,
    usages: Array.from(byOrder.values()).map((u) => ({ orderId: u.orderId, number: u.number, qty: num(u.qty), incl: num(u.incl), excl: num(u.excl), extraIncl: num(u.extraIncl), extraExcl: num(u.extraExcl) })),
  };
}

/**
 * Все лоты меха или подкладки организации за год (по дате закупки, общий фильтр года).
 * extraWhere — дополнительное условие (например, поиск по № лота на странице «Сырьё»).
 */
export async function loadFurLots(
  db: PrismaClient,
  organizationId: string,
  opts: { kind: FurKind; year: YearFilter; furIdx?: FurIndex; extraWhere?: Prisma.RawMaterialLotWhereInput },
): Promise<FurLot[]> {
  const rows = await db.rawMaterialLot.findMany({
    where: {
      organizationId,
      ...lotYear(opts.year),
      rawMaterial: { unit: opts.kind === "lining" ? "M" : { not: "M" } },
      ...(opts.extraWhere ?? {}),
    },
    select: LOT_SELECT,
    orderBy: [{ receivedDate: "asc" }, { lotNumber: "asc" }],
  });
  return rows.map((r) => furLotFromRecord(r, opts.furIdx));
}

/**
 * Суммы по лотам аналитики сырья (/analytics/raw) тем же расчётом, что у таблицы «Мех / Подкладка»:
 * плитки «Куплено / Использовано / Остаток» и средневзвешенные цены берутся отсюда.
 */
export function flowOfRawLots(lots: RawLot[]): Flow {
  return flowOf(
    lots.map((l) => ({ l, v: l.fixed ?? { recvIncl: l.recv.mul(l.unitIncl), recvExcl: l.recv.mul(l.unitExcl), remIncl: l.rem.mul(l.unitIncl), remExcl: l.rem.mul(l.unitExcl) } })).map(({ l, v }) => ({
      recv: num(l.recv),
      used: num(l.used),
      rem: num(l.rem),
      recvIncl: num(v.recvIncl),
      recvExcl: num(v.recvExcl),
      usedIncl: num(l.usedIncl),
      usedExcl: num(l.usedExcl),
      usedExtraIncl: num(l.usedExtraIncl),
      usedExtraExcl: num(l.usedExtraExcl),
      remIncl: num(v.remIncl),
      remExcl: num(v.remExcl),
      usdQty: 0,
      usdSubtotal: 0,
      usdUsedQty: 0,
      usdUsedSubtotal: 0,
      usdRemQty: 0,
      usdRemSubtotal: 0,
      usdQtyDirect: 0,
      usdQtyEur: 0,
      usdQtyRub: 0,
      usdQtyCalc: 0,
      hammerExcl: null, hammerIncl: null, hammerSource: null, hamQty: 0, hamSubExcl: 0, hamSubIncl: 0,
    })),
  );
}
