import type { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { lotUnitCostExclVat } from "@/lib/purchase-totals";
import { usageExclVat } from "@/lib/commission4";
import { COMMISSION_RATE } from "@/lib/commission4-const";
import { auctionName, isServiceAuction, shortAuctionName, NO_AUCTION_LABEL } from "@/lib/auction-names";
import { canonicalFur } from "@/lib/fur-ref";
import { getFurIndex } from "@/lib/fur-ref-server";
import { relabelOrders } from "@/lib/order-label-db";
import type { FurLot } from "@/lib/fur-table";
import { purchasePaidShare, type AuctionPay } from "@/lib/auction-payments";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { lotUsdPrice } from "@/lib/lot-hammer";

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const ck = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/Ё/g, "Е").replace(/\s+/g, " ").trim();

export type ChainCounts = { purchases: number; lots: number; lotUses: number; payments: number; allocations: number; expenses: number; lotQtyMismatch: number; lotsNoPurchase: number; overAllocated: number; useVsOrderMaterial: { used: number; orders: number; wip: number; wipOrders: number } };

/** Сквозная цепочка сырья и денег: закупка → лот → расход в ТЗ, платежи (поставщику и за работу) и их распределение, расходы ТЗ. */
export async function buildChainTables(
  tx: Prisma.TransactionClient,
  orgId: string,
  canonOf: (raw: string | null | undefined) => { canon: string },
  /** Строки моста Главной (заказано без лотов, шкуры подрядчика) — loadDashboard(...).syntheticLots; хранятся отдельно от лотов. */
  bridge: FurLot[] = [],
  /** Оплаты по аукционам (loadAuctionSummaries): кладутся в витрину готовыми. */
  auctionPays: AuctionPay[] = [],
): Promise<ChainCounts> {
  const furIdx = await getFurIndex(orgId);
  for (const t of ["dmPurchase", "dmLot", "dmLotUse", "dmLotBridge", "dmAuction", "dmPayment", "dmPaymentAlloc", "dmOrderExpense"] as const) await (tx[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { organizationId: orgId } });

  const purchases = await tx.purchase.findMany({
    where: { organizationId: orgId },
    select: { id: true, number: true, supplierId: true, supplier: { select: { name: true } }, isContractorRaw: true, status: true, currency: true, exchangeRate: true, orderDate: true, receivedDate: true, invoiceNumber: true, invoiceDate: true, transferDocument: true, auctionSession: true, items: { select: { subtotal: true, vatRate: true, quantity: true, costPlan: true } }, expenses: { select: { amount: true, vatRate: true } }, payments: { select: { amount: true, status: true } } },
  });
  const lots = await tx.rawMaterialLot.findMany({
    where: { organizationId: orgId },
    select: { id: true, lotNumber: true, purchaseId: true, grade: true, sizeGrade: true, color: true, receivedDate: true, quantityReceived: true, quantityRemaining: true, unitCost: true, totalCost: true, vatRate: true, materialCostExclVat: true, expenseCostExclVat: true, rawMaterial: { select: { name: true, unit: true, category: { select: { name: true } } } }, purchase: { select: { number: true, auctionSession: true, orderDate: true } }, colorRef: { select: { name: true } }, attrs: { select: { attr: { select: { name: true } } } }, purchaseItems: { select: { quantity: true, costPlan: true } }, costBreakdown: true, stockMovements: { select: { type: true, quantity: true } }, warehouse: { select: { name: true } }, usages: { select: { quantity: true, totalCost: true, productionOrderId: true, commission4: true, vatRate: true } } },
  });
  const usages = await tx.productionMaterialUsage.findMany({
    where: { lot: { organizationId: orgId } },
    select: { id: true, lotId: true, productionOrderId: true, quantity: true, unitCost: true, totalCost: true, date: true, commission4: true, productionOrder: { select: { number: true, workOrderNumber: true, productModelId: true, productModel: { select: { sku: true, name: true } } } } },
  });
  const payments = await tx.payment.findMany({ where: { organizationId: orgId }, select: { id: true, supplier: { select: { name: true } }, purchaseId: true, amount: true, currency: true, kind: true, method: true, status: true, paidAt: true, docRef: true, invoiceNo: true, ppNo: true, confirmed: true } });
  const prodPayments = await tx.productionPayment.findMany({ where: { organizationId: orgId }, select: { id: true, client: { select: { name: true } }, contractor: { select: { name: true } }, amount: true, paymentType: true, method: true, status: true, paidAt: true, docRef: true, invoiceNo: true, ppNo: true, confirmed: true, allocations: { select: { productionOrderId: true, amount: true, source: true, productionOrder: { select: { number: true } } } } } });
  const expenses = await tx.productionExpense.findMany({ where: { productionOrder: { organizationId: orgId } }, select: { productionOrderId: true, amount: true, date: true, description: true, category: { select: { name: true } }, productionOrder: { select: { number: true } } } });

  const lotsByPurchase = new Map<string, { n: number; cost: number }>();
  for (const l of lots) if (l.purchaseId) { const a = lotsByPurchase.get(l.purchaseId) ?? { n: 0, cost: 0 }; a.n++; a.cost += n(l.totalCost); lotsByPurchase.set(l.purchaseId, a); }

  const chunk = async <T>(rows: T[], fn: (c: T[]) => Promise<unknown>) => { for (let i = 0; i < rows.length; i += 1000) await fn(rows.slice(i, i + 1000)); };

  // Единая формула «оплачено по закупке»: собственные оплаты + доля оплат аукциона по стоимости; итог закупки — как в «Оплатах».
  const payByName = new Map(auctionPays.map((a) => [a.name, a]));
  const payOf = (p: (typeof purchases)[number]) => {
    const own = p.payments.filter((x) => x.status === "COMPLETED").reduce((a, x) => a.add(x.amount), new Decimal(0));
    const name = auctionName(p.auctionSession);
    const a = name ? payByName.get(name) : undefined;
    const total = purchaseTotalInclVat({ exchangeRate: p.exchangeRate, items: p.items, expenses: p.expenses });
    const paid = a ? purchasePaidShare(a, p.id, own) : own;
    return { payTotal: total.toNumber(), paidShare: paid.toNumber() };
  };
  await tx.dmAuction.createMany({ data: auctionPays.map((a) => ({ organizationId: orgId, name: a.name, purchases: a.purchases, total: a.total.toNumber(), paid: a.paid.toNumber(), remaining: a.remaining.toNumber(), status: a.status })) });
  await chunk(purchases, (c) => tx.dmPurchase.createMany({ data: c.map((p) => ({ organizationId: orgId, purchaseId: p.id, number: p.number, supplierId: p.supplierId, supplier: p.supplier.name, isContractor: !!p.isContractorRaw, status: p.status, currency: p.currency, rate: n(p.exchangeRate), orderDate: p.orderDate, receivedDate: p.receivedDate, invoiceNumber: p.invoiceNumber, invoiceDate: p.invoiceDate, transferDoc: p.transferDocument, auction: p.auctionSession, itemsSum: p.items.reduce((a, x) => a + n(x.subtotal), 0), itemsGross: p.items.reduce((a, x) => { const r = n(x.vatRate); return a + n(x.subtotal) * (1 + (r > 1 ? r / 100 : r)); }, 0), expensesSum: p.expenses.reduce((a, x) => a + n(x.amount), 0), lotsCostSum: lotsByPurchase.get(p.id)?.cost ?? 0, ...payOf(p), paidSum: p.payments.filter((x) => x.status === "COMPLETED").reduce((a, x) => a + n(x.amount), 0), lotsCount: lotsByPurchase.get(p.id)?.n ?? 0 })) }));

  let qtyMismatch = 0, noPurchase = 0;
  await chunk(lots, (c) => tx.dmLot.createMany({ data: c.map((l) => {
    const used = l.usages.reduce((a, u) => a + n(u.quantity), 0);
    if (Math.abs(n(l.quantityReceived) - used - n(l.quantityRemaining)) > 0.001) qtyMismatch++;
    if (!l.purchaseId) noPurchase++;
    // Все варианты показа считаем здесь один раз (те же формулы, что в аналитике сырья): без НДС и надбавка 4 % по строкам списания.
    const unitExcl = lotUnitCostExclVat(l);
    const kRate = new Decimal(COMMISSION_RATE);
    let usedExcl = new Decimal(0), extraIncl = new Decimal(0), extraExcl = new Decimal(0);
    for (const u of l.usages) {
      const ex = usageExclVat(u, unitExcl);
      usedExcl = usedExcl.add(ex);
      if (u.commission4) { extraIncl = extraIncl.add(new Decimal(u.totalCost).mul(kRate)); extraExcl = extraExcl.add(ex.mul(kRate)); }
    }
    const dt = l.purchase?.orderDate ?? l.receivedDate;
    let jIn = 0, jProd = 0, jOther = 0;
    for (const m of l.stockMovements) { if (m.type === "PURCHASE_IN" || m.type === "ADJUSTMENT_IN" || m.type === "TRANSFER_IN") jIn += n(m.quantity); else if (m.type === "PRODUCTION_OUT") jProd += n(m.quantity); else jOther += n(m.quantity); }
    const aName = auctionName(l.purchase?.auctionSession);
    const isM = l.rawMaterial.unit === "M";
    return { usdUnit: isM ? null : (() => { const u = lotUsdPrice(l.costBreakdown, l.purchaseItems.map((i) => i.costPlan), { vatRate: n(l.vatRate), purchaseNumber: l.purchase?.number ?? null, lotNumber: l.lotNumber }); return u.source === "none" ? null : u.usd; })(), kindName: isM ? "Подкладка" : (canonicalFur(l.rawMaterial.name, furIdx)?.name ?? l.rawMaterial.name), auctionLabel: !aName || isServiceAuction(aName) ? NO_AUCTION_LABEL : shortAuctionName(aName), colorName: l.colorRef?.name ?? l.color ?? null, attrs: l.attrs.map((a) => a.attr.name).join("|"), itemsQty: l.purchaseItems.reduce((a, i) => a + n(i.quantity), 0), jIn, jProdOut: jProd, jOtherOut: jOther, remCost: n(l.quantityRemaining) * n(l.unitCost), remCostExcl: n(l.quantityRemaining) * unitExcl.toNumber(), purchaseNumber: l.purchase?.number ?? null, unit: l.rawMaterial.unit === "M" ? "M" : "PCS", auction: auctionName(l.purchase?.auctionSession), purchaseYear: dt.getUTCFullYear(), purchaseMonth: `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`, unitCostExcl: unitExcl.toNumber(), totalCostExcl: unitExcl.mul(l.quantityReceived).toNumber(), usedCostExcl: usedExcl.toNumber(), usedExtraIncl: extraIncl.toNumber(), usedExtraExcl: extraExcl.toNumber(), organizationId: orgId, lotId: l.id, lotNumber: l.lotNumber, purchaseId: l.purchaseId, material: l.rawMaterial.name, category: l.rawMaterial.category?.name ?? null, colorCanon: l.color ? canonOf(l.color).canon : null, grade: l.grade, sizeGrade: l.sizeGrade, warehouse: l.warehouse.name, receivedDate: l.receivedDate, qtyReceived: n(l.quantityReceived), qtyRemaining: n(l.quantityRemaining), qtyUsed: used, unitCost: n(l.unitCost), totalCost: n(l.totalCost), vatRate: n(l.vatRate), materialExcl: n(l.materialCostExclVat), expenseExcl: n(l.expenseCostExclVat), usedCost: l.usages.reduce((a, u) => a + n(u.totalCost), 0), ordersCount: new Set(l.usages.map((u) => u.productionOrderId)).size };
  }) }));

  // Готовая строка каждого лота (FurLot) — для таблиц «Мех / Подкладка» и Главной: считается здесь один раз, экраны читают DmLot.furLot.
  {
    const { buildAllFurLots } = await import("@/lib/fur-table-server");
    const furLots = await buildAllFurLots(tx as never, orgId, furIdx);
    const payload = JSON.stringify(furLots.map((f) => ({ lotId: f.id, j: f })));
    await tx.$executeRaw`UPDATE "DmLot" d SET "furLot" = v.j FROM jsonb_to_recordset(${payload}::jsonb) AS v("lotId" text, j jsonb) WHERE d."organizationId" = ${orgId} AND d."lotId" = v."lotId"`;
  }
  await chunk(usages, (c) => tx.dmLotUse.createMany({ data: c.map((u) => ({ organizationId: orgId, usageId: u.id, lotId: u.lotId, orderId: u.productionOrderId, orderNumber: u.productionOrder.number, model: u.productionOrder.productModel?.sku ?? u.productionOrder.productModel?.name ?? null, qty: n(u.quantity), unitCost: n(u.unitCost), totalCost: n(u.totalCost), date: u.date, commission4: u.commission4, orderWo: u.productionOrder.workOrderNumber, modelId: u.productionOrder.productModelId ?? "" })) }));
  // Единая подпись ТЗ («ТЗ 182 · поз. 1/3») считается один раз при сборке и хранится в витрине.
  {
    const refs = Array.from(new Map(usages.map((u) => [u.productionOrderId, { label: "", orderId: u.productionOrderId, number: u.productionOrder.number, wo: u.productionOrder.workOrderNumber }])).values());
    await relabelOrders(orgId, refs, (r) => ({ orderId: r.orderId, number: r.number, wo: r.wo }));
    for (const r of refs) await tx.dmLotUse.updateMany({ where: { organizationId: orgId, orderId: r.orderId }, data: { orderLabel: r.label } });
  }
  await chunk(bridge, (c) => tx.dmLotBridge.createMany({ data: c.map((b) => ({ organizationId: orgId, key: b.id, kind: b.id.startsWith("hides:") ? "hides" : "ordered", furKind: b.item, auction: b.auction, auctionLabel: b.auctionLabel, year: b.year, qtyReceived: b.recv, qtyRemaining: b.rem, totalCost: b.recvIncl, totalCostExcl: b.recvExcl, usedCost: b.usedIncl, usedCostExcl: b.usedExcl, remCost: b.remIncl, remCostExcl: b.remExcl })) }));

  const allocByPayment = (id: string) => prodPayments.find((p) => p.id === id)?.allocations.reduce((a, x) => a + n(x.amount), 0) ?? 0;
  await chunk(payments, (c) => tx.dmPayment.createMany({ data: c.map((p) => ({ organizationId: orgId, paymentId: p.id, flow: "purchase", counterparty: p.supplier.name, purchaseId: p.purchaseId, amount: n(p.amount), currency: p.currency, kind: p.kind, method: p.method, status: p.status, paidAt: p.paidAt, docRef: p.docRef, invoiceNo: p.invoiceNo, ppNo: p.ppNo, confirmed: p.confirmed, allocated: 0 })) }));
  let overAlloc = 0;
  await chunk(prodPayments, (c) => tx.dmPayment.createMany({ data: c.map((p) => { const al = allocByPayment(p.id); if (al > n(p.amount) + 0.01) overAlloc++; return { organizationId: orgId, paymentId: p.id, flow: "production", counterparty: p.contractor?.name ?? p.client?.name ?? "", purchaseId: null, amount: n(p.amount), currency: "RUB", kind: p.paymentType, method: p.method, status: p.status, paidAt: p.paidAt, docRef: p.docRef, invoiceNo: p.invoiceNo, ppNo: p.ppNo, confirmed: p.confirmed, allocated: al }; }) }));
  const allocs = prodPayments.flatMap((p) => p.allocations.map((a) => ({ organizationId: orgId, paymentId: p.id, orderId: a.productionOrderId, orderNumber: a.productionOrder.number, amount: n(a.amount), source: String(a.source) })));
  await chunk(allocs, (c) => tx.dmPaymentAlloc.createMany({ data: c }));
  await chunk(expenses, (c) => tx.dmOrderExpense.createMany({ data: c.map((e) => ({ organizationId: orgId, orderId: e.productionOrderId, orderNumber: e.productionOrder.number, category: ck(e.category.name) ? e.category.name : "", amount: n(e.amount), date: e.date, description: e.description })) }));

  const orders = await tx.productionOrder.findMany({ where: { organizationId: orgId }, select: { id: true, status: true, materialCost: true } });
  const done = new Set(orders.filter((o) => o.status === "COMPLETED").map((o) => o.id));
  const wip = new Set(orders.filter((o) => o.status !== "COMPLETED").map((o) => o.id));
  return { purchases: purchases.length, lots: lots.length, lotUses: usages.length, payments: payments.length + prodPayments.length, allocations: allocs.length, expenses: expenses.length, lotQtyMismatch: qtyMismatch, lotsNoPurchase: noPurchase, overAllocated: overAlloc, useVsOrderMaterial: { used: usages.filter((u) => done.has(u.productionOrderId)).reduce((a, u) => a + n(u.totalCost), 0), orders: orders.filter((o) => o.status === "COMPLETED").reduce((a, o) => a + n(o.materialCost), 0), wip: usages.filter((u) => wip.has(u.productionOrderId)).reduce((a, u) => a + n(u.totalCost), 0), wipOrders: new Set(usages.filter((u) => wip.has(u.productionOrderId)).map((u) => u.productionOrderId)).size } };
}
