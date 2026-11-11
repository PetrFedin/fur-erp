import type { Prisma } from "@prisma/client";

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const ck = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/Ё/g, "Е").replace(/\s+/g, " ").trim();

export type ChainCounts = { purchases: number; lots: number; lotUses: number; payments: number; allocations: number; expenses: number; lotQtyMismatch: number; lotsNoPurchase: number; overAllocated: number; useVsOrderMaterial: { used: number; orders: number; wip: number; wipOrders: number } };

/** Сквозная цепочка сырья и денег: закупка → лот → расход в ТЗ, платежи (поставщику и за работу) и их распределение, расходы ТЗ. */
export async function buildChainTables(
  tx: Prisma.TransactionClient,
  orgId: string,
  canonOf: (raw: string | null | undefined) => { canon: string },
): Promise<ChainCounts> {
  for (const t of ["dmPurchase", "dmLot", "dmLotUse", "dmPayment", "dmPaymentAlloc", "dmOrderExpense"] as const) await (tx[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { organizationId: orgId } });

  const purchases = await tx.purchase.findMany({
    where: { organizationId: orgId },
    select: { id: true, number: true, supplierId: true, supplier: { select: { name: true } }, isContractorRaw: true, status: true, currency: true, exchangeRate: true, orderDate: true, receivedDate: true, invoiceNumber: true, invoiceDate: true, transferDocument: true, auctionSession: true, items: { select: { subtotal: true, vatRate: true } }, expenses: { select: { amount: true } }, payments: { select: { amount: true, status: true } } },
  });
  const lots = await tx.rawMaterialLot.findMany({
    where: { organizationId: orgId },
    select: { id: true, lotNumber: true, purchaseId: true, grade: true, sizeGrade: true, color: true, receivedDate: true, quantityReceived: true, quantityRemaining: true, unitCost: true, totalCost: true, vatRate: true, materialCostExclVat: true, expenseCostExclVat: true, rawMaterial: { select: { name: true, category: { select: { name: true } } } }, warehouse: { select: { name: true } }, usages: { select: { quantity: true, totalCost: true, productionOrderId: true } } },
  });
  const usages = await tx.productionMaterialUsage.findMany({
    where: { lot: { organizationId: orgId } },
    select: { id: true, lotId: true, productionOrderId: true, quantity: true, unitCost: true, totalCost: true, date: true, commission4: true, productionOrder: { select: { number: true, productModel: { select: { sku: true, name: true } } } } },
  });
  const payments = await tx.payment.findMany({ where: { organizationId: orgId }, select: { id: true, supplier: { select: { name: true } }, purchaseId: true, amount: true, currency: true, kind: true, method: true, status: true, paidAt: true, docRef: true, invoiceNo: true, ppNo: true, confirmed: true } });
  const prodPayments = await tx.productionPayment.findMany({ where: { organizationId: orgId }, select: { id: true, client: { select: { name: true } }, contractor: { select: { name: true } }, amount: true, paymentType: true, method: true, status: true, paidAt: true, docRef: true, invoiceNo: true, ppNo: true, confirmed: true, allocations: { select: { productionOrderId: true, amount: true, source: true, productionOrder: { select: { number: true } } } } } });
  const expenses = await tx.productionExpense.findMany({ where: { productionOrder: { organizationId: orgId } }, select: { productionOrderId: true, amount: true, date: true, description: true, category: { select: { name: true } }, productionOrder: { select: { number: true } } } });

  const lotsByPurchase = new Map<string, { n: number; cost: number }>();
  for (const l of lots) if (l.purchaseId) { const a = lotsByPurchase.get(l.purchaseId) ?? { n: 0, cost: 0 }; a.n++; a.cost += n(l.totalCost); lotsByPurchase.set(l.purchaseId, a); }

  const chunk = async <T>(rows: T[], fn: (c: T[]) => Promise<unknown>) => { for (let i = 0; i < rows.length; i += 1000) await fn(rows.slice(i, i + 1000)); };

  await chunk(purchases, (c) => tx.dmPurchase.createMany({ data: c.map((p) => ({ organizationId: orgId, purchaseId: p.id, number: p.number, supplierId: p.supplierId, supplier: p.supplier.name, isContractor: !!p.isContractorRaw, status: p.status, currency: p.currency, rate: n(p.exchangeRate), orderDate: p.orderDate, receivedDate: p.receivedDate, invoiceNumber: p.invoiceNumber, invoiceDate: p.invoiceDate, transferDoc: p.transferDocument, auction: p.auctionSession, itemsSum: p.items.reduce((a, x) => a + n(x.subtotal), 0), itemsGross: p.items.reduce((a, x) => { const r = n(x.vatRate); return a + n(x.subtotal) * (1 + (r > 1 ? r / 100 : r)); }, 0), expensesSum: p.expenses.reduce((a, x) => a + n(x.amount), 0), lotsCostSum: lotsByPurchase.get(p.id)?.cost ?? 0, paidSum: p.payments.filter((x) => x.status === "COMPLETED").reduce((a, x) => a + n(x.amount), 0), lotsCount: lotsByPurchase.get(p.id)?.n ?? 0 })) }));

  let qtyMismatch = 0, noPurchase = 0;
  await chunk(lots, (c) => tx.dmLot.createMany({ data: c.map((l) => {
    const used = l.usages.reduce((a, u) => a + n(u.quantity), 0);
    if (Math.abs(n(l.quantityReceived) - used - n(l.quantityRemaining)) > 0.001) qtyMismatch++;
    if (!l.purchaseId) noPurchase++;
    return { organizationId: orgId, lotId: l.id, lotNumber: l.lotNumber, purchaseId: l.purchaseId, material: l.rawMaterial.name, category: l.rawMaterial.category?.name ?? null, colorCanon: l.color ? canonOf(l.color).canon : null, grade: l.grade, sizeGrade: l.sizeGrade, warehouse: l.warehouse.name, receivedDate: l.receivedDate, qtyReceived: n(l.quantityReceived), qtyRemaining: n(l.quantityRemaining), qtyUsed: used, unitCost: n(l.unitCost), totalCost: n(l.totalCost), vatRate: n(l.vatRate), materialExcl: n(l.materialCostExclVat), expenseExcl: n(l.expenseCostExclVat), usedCost: l.usages.reduce((a, u) => a + n(u.totalCost), 0), ordersCount: new Set(l.usages.map((u) => u.productionOrderId)).size };
  }) }));

  await chunk(usages, (c) => tx.dmLotUse.createMany({ data: c.map((u) => ({ organizationId: orgId, usageId: u.id, lotId: u.lotId, orderId: u.productionOrderId, orderNumber: u.productionOrder.number, model: u.productionOrder.productModel?.sku ?? u.productionOrder.productModel?.name ?? null, qty: n(u.quantity), unitCost: n(u.unitCost), totalCost: n(u.totalCost), date: u.date, commission4: u.commission4 })) }));

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
