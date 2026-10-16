import "server-only";
import { prisma } from "@/lib/prisma";
import { paymentDocFlags, type PayRow } from "@/lib/supplier-payment-docs-core";

/**
 * «Платёжный документ: есть / нет» по счетам закупок поставщика. Только булев признак: суммы, даты, получатели и файл
 * из этого модуля наружу не выходят. Источник — наши оплаты (Payment) поставщика: привязка к счёту по purchaseId
 * или по номеру счёта (invoiceNo) и наличие нашего документа оплаты (PurchaseDocument или любой DriveDocument, кроме PAYMENT_INVOICE — это счёт самого Веллмеха).
 */
export async function paymentDocFlagsFor(orgId: string, supplierId: string, purchases: { id: string; invoice: string; number: string }[]): Promise<Map<string, boolean>> {
  if (purchases.length === 0) return new Map();
  const pays = await prisma.payment.findMany({
    where: { organizationId: orgId, supplierId, status: { not: "CANCELLED" } },
    select: { purchaseId: true, invoiceNo: true, documentId: true, driveDocuments: { where: { docType: { not: "PAYMENT_INVOICE" }, storagePath: { not: null } }, select: { id: true }, take: 1 } },
  });
  const rows: PayRow[] = pays.map((x) => ({ purchaseId: x.purchaseId, invoiceNo: x.invoiceNo, hasDoc: Boolean(x.documentId) || x.driveDocuments.length > 0 }));
  return paymentDocFlags(purchases, rows);
}
