import { auctionSummariesView } from "@/lib/mart/auctions";
import { prisma } from "@/lib/prisma";
import { type AuctionPay } from "@/lib/auction-payments";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import { yearRange, type YearFilter } from "@/lib/year-filter";
import { loadClientDebt } from "@/lib/payment-alloc";
import type { PayFilterValues } from "./helpers";

/** Оплаты, оплаты за работу, партии закупки, закупки аукционов и долг поставщику — общая загрузка вкладок «Все», «За сырьё», «За работу». */
export async function loadPaymentsBase(
  orgId: string,
  tab: "all" | "suppliers" | "clients",
  year: YearFilter,
  period: { gte?: Date; lte?: Date } | undefined,
  clientsTab: boolean,
  pf: PayFilterValues,
) {
  return Promise.all([
    prisma.payment.findMany({
      where: { organizationId: orgId },
      include: {
        supplier: true,
        purchase: { select: { id: true, number: true, auctionSession: true, invoiceNumber: true } },
        document: { select: { id: true, originalName: true, mimeType: true, storagePath: true, sizeBytes: true } },
        driveDocuments: { orderBy: [{ docDate: "asc" }, { createdAt: "asc" }] },
      },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    }),
    tab === "clients"
      ? prisma.productionPayment.findMany({
          where: {
            organizationId: orgId,
            ...(yearRange(year) ? { paidAt: yearRange(year) } : {}),
            ...(period ? { AND: [{ paidAt: period }] } : {}),
            ...(clientsTab && pf.ptype.length ? { paymentType: { in: pf.ptype as ("ADVANCE" | "PARTIAL" | "FINAL")[] } } : {}),
            ...(clientsTab && pf.batch.length ? { orders: { some: { productionOrder: { batch: { number: { in: pf.batch.map(Number) } } } } } } : {}),
          },
          include: {
            client: true,
            allocations: { select: { productionOrderId: true, amount: true, productionOrder: { include: { batch: { select: { number: true } }, productModel: { select: { name: true, salesName: true } } } } } },
            orders: { include: { productionOrder: { include: { batch: { select: { number: true } }, productModel: { select: { name: true, salesName: true } } } } } },
          },
          orderBy: { paidAt: "desc" },
        })
      : Promise.resolve([]),
    tab !== "clients" ? auctionSummariesView(orgId) : Promise.resolve([] as AuctionPay[]),
    tab === "suppliers"
      ? prisma.purchase.findMany({
          where: { organizationId: orgId, auctionSession: { not: null } },
          select: { id: true, number: true, invoiceNumber: true, auctionSession: true },
        })
      : Promise.resolve([]),
    tab === "suppliers" ? loadSupplierDebt(prisma, orgId, year) : Promise.resolve(null),
  ]);
}

type Base = Awaited<ReturnType<typeof loadPaymentsBase>>;
export type PaymentRow = Base[0][number];
export type ClientPaymentRow = Base[1][number];
export type AuctionPurchaseRow = Base[3][number];
export type SupplierDebtData = NonNullable<Base[4]>;

/** Всего оплачено по каждому ТЗ (проведённые платежи). */
export function loadCompletedAllocSums(orgId: string) {
  return prisma.paymentAllocation.groupBy({ by: ["productionOrderId"], where: { organizationId: orgId, productionPayment: { status: "COMPLETED" } }, _sum: { amount: true } });
}

/** Счета на оплату (документы Drive с сохранённым файлом) с 2026 года. */
export function loadPaymentInvoiceDocs(orgId: string) {
  return prisma.driveDocument.findMany({
    where: { organizationId: orgId, docType: "PAYMENT_INVOICE", storagePath: { not: null }, docDate: { gte: new Date("2026-01-01T00:00:00Z") } },
    select: { id: true, title: true, storagePath: true, docDate: true },
  });
}

/** Долг по работе подрядчику и все разнесения по ТЗ — для виджетов «За работу». */
export function loadGoodsDebt(orgId: string, year: YearFilter) {
  return Promise.all([
    loadClientDebt(prisma, orgId, { year }),
    prisma.paymentAllocation.groupBy({ by: ["productionOrderId"], where: { organizationId: orgId }, _sum: { amount: true } }),
  ]);
}

/** Долг подрядчику за работу (нужно поле «шкуры»). */
export function loadClientDebtFor(orgId: string, year: YearFilter) {
  return loadClientDebt(prisma, orgId, { year });
}

/** Закупки (кроме отменённых) с позициями, расходами и проведёнными оплатами. */
export function loadPurchasesWithPayments(orgId: string) {
  return prisma.purchase.findMany({
    where: { organizationId: orgId, status: { not: "CANCELLED" } },
    include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" }, include: { driveDocuments: { select: { driveFileId: true, storagePath: true } }, document: { select: { id: true } } }, orderBy: { paidAt: "asc" } } },
    orderBy: { number: "asc" },
  });
}

/** Все поставщики (для правки авансов). */
export function loadSupplierOptions(orgId: string) {
  return prisma.supplier.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/** Закупки без аукциона (кроме отменённых) — цели разнесения аванса. */
export function loadLoosePurchases(orgId: string) {
  return prisma.purchase.findMany({ where: { organizationId: orgId, status: { not: "CANCELLED" }, auctionSession: null }, select: { id: true, number: true, supplierId: true }, orderBy: { number: "asc" } });
}
