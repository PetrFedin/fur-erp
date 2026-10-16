import "server-only";
import { prisma } from "@/lib/prisma";
import { RAW_STATUS_LABEL } from "@/lib/supplier-raw";
import { itemsOfBreakdown } from "@/lib/price-composition";
import type { CalcPayload } from "@/lib/supplier-calc";

/**
 * Данные страницы аукциона у поставщика («Сырьё» → аукцион). Только закупка ЭТОГО поставщика и организации:
 * чужая — null (страница отдаёт 404). Наших остатков, списаний в ТЗ, оплат и долгов здесь нет.
 */
export async function loadSupplierAuction(orgId: string, supplierId: string, purchaseId: string) {
  const p = await prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId: orgId, supplierId, status: { not: "CANCELLED" } },
    select: {
      id: true, number: true, status: true, currency: true, auctionId: true, exchangeRate: true, auctionSession: true, invoiceNumber: true, invoiceDate: true,
      orderDate: true, expectedDate: true, receivedDate: true,
      auction: { select: { name: true } }, supplier: { select: { name: true } },
      items: {
        orderBy: { lotNumber: "asc" },
        select: {
          id: true, lotNumber: true, grade: true, color: true, quantity: true, unitPrice: true, subtotal: true, costPlan: true,
          rawMaterial: { select: { name: true } }, lot: { select: { costBreakdown: true } },
        },
      },
    },
  });
  if (!p) return null;
  // Аукцион целиком: все счета (закупки) этого поставщика с тем же аукционом. Страница открывается с любого из них.
  const sibRows = p.auctionId
    ? await prisma.purchase.findMany({
        where: { organizationId: orgId, supplierId, auctionId: p.auctionId, status: { not: "CANCELLED" }, id: { not: p.id } },
        orderBy: { number: "asc" },
        select: {
          id: true, number: true, status: true, invoiceNumber: true, exchangeRate: true,
          items: {
            orderBy: { lotNumber: "asc" },
            select: { id: true, lotNumber: true, grade: true, color: true, quantity: true, unitPrice: true, subtotal: true, costPlan: true, rawMaterial: { select: { name: true } }, lot: { select: { costBreakdown: true } } },
          },
        },
      })
    : [];
  // Принятый расчёт этого поставщика, из которого создана закупка.
  const calcRow = await prisma.supplierInbox.findFirst({
    where: { organizationId: orgId, supplierId, kind: "AUCTION_CALC", status: "ACCEPTED", createdEntityType: "Purchase", createdEntityId: { contains: p.id } },
    orderBy: { decidedAt: "desc" },
    select: { id: true, title: true, payload: true },
  });
  const docRows = await prisma.supplierInbox.findMany({
    where: {
      organizationId: orgId, supplierId, status: { in: ["SENT", "ACCEPTED"] },
      OR: [
        ...(calcRow ? [{ id: calcRow.id }] : []),
        ...[p.id, ...sibRows.map((x) => x.id)].map((id) => ({ kind: "DOCUMENT" as const, payload: { path: ["purchaseId"], equals: id } })),
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, status: true, files: { orderBy: { createdAt: "asc" }, select: { id: true, originalName: true, kind: true, sizeBytes: true } } },
  });
  const mine = { id: p.id, number: p.number, status: p.status, invoiceNumber: p.invoiceNumber, exchangeRate: p.exchangeRate, items: p.items };
  const allPurchases = [mine, ...sibRows].sort((a, b) => a.number.localeCompare(b.number, "ru", { numeric: true }));
  const items = allPurchases.flatMap((pp) => pp.items.map((i) => ({ i, pp }))).map(({ i, pp }) => {
    const raw = (i.lot?.costBreakdown ?? (i.costPlan as { costBreakdown?: unknown } | null)?.costBreakdown) as unknown;
    return {
      id: i.id, purchaseId: pp.id, invoice: pp.invoiceNumber ?? pp.number, lot: i.lotNumber ?? "", fur: i.rawMaterial.name, color: i.color ?? "", size: i.grade ?? "",
      qty: Number(i.quantity), unitPrice: Number(i.unitPrice), subtotal: Number(i.subtotal),
      breakdown: itemsOfBreakdown(raw).map((b) => ({ label: b.label, value: b.value })),
    };
  });
  return {
    purchase: {
      id: p.id, number: p.number, status: RAW_STATUS_LABEL[p.status] ?? p.status, received: p.status === "RECEIVED", currency: p.currency,
      rate: Number(p.exchangeRate), auction: p.auction?.name ?? p.auctionSession ?? "", invoice: p.invoiceNumber ?? "", invoiceDate: p.invoiceDate,
      orderDate: p.orderDate, expectedDate: p.expectedDate, receivedDate: p.receivedDate, supplier: p.supplier.name,
    },
    items,
    invoices: allPurchases.map((pp) => ({ id: pp.id, number: pp.number, invoice: pp.invoiceNumber ?? "", received: pp.status === "RECEIVED", status: pp.status, rate: Number(pp.exchangeRate) })),
    calc: calcRow ? { id: calcRow.id, title: calcRow.title, payload: calcRow.payload as unknown as CalcPayload } : null,
    docs: docRows,
  };
}
