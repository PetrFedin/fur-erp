import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** «счёт № 12», «Счёт №12» → «12». Пусто или служебный текст аукциона — null. */
export function cleanInvoiceNumber(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").replace(/^\s*сч[её]т\p{L}*\s*№?\s*/iu, "").replace(/^\s*№\s*/, "").trim().slice(0, 100);
  return t || null;
}

/**
 * Находит или создаёт счёт по (поставщик + номер) и привязывает к нему закупку (Purchase.invoiceId).
 * Purchase.invoiceNumber/invoiceDate/transferDocument остаются как есть и правятся вызывающим кодом;
 * здесь только таблица Invoice. Нет номера — привязка снимается. Дата счёта дополняет пустую дату в Invoice,
 * но уже заданную не затирает (дату правят в форме закупки — тогда она приходит как `setDate`).
 */
export async function syncPurchaseInvoice(
  db: Db,
  purchaseId: string,
  opts: { setDate?: boolean } = {},
): Promise<string | null> {
  const p = await db.purchase.findUnique({ where: { id: purchaseId }, select: { organizationId: true, supplierId: true, invoiceNumber: true, invoiceDate: true, invoiceId: true } });
  if (!p) return null;
  const number = cleanInvoiceNumber(p.invoiceNumber);
  if (!number) {
    if (p.invoiceId) await db.purchase.update({ where: { id: purchaseId }, data: { invoiceId: null } });
    return null;
  }
  let inv = await db.invoice.findFirst({ where: { organizationId: p.organizationId, supplierId: p.supplierId, number } });
  if (!inv) {
    inv = await db.invoice.create({ data: { organizationId: p.organizationId, supplierId: p.supplierId, number, date: p.invoiceDate } });
  } else if (p.invoiceDate && (opts.setDate || !inv.date)) {
    if (!inv.date || inv.date.getTime() !== p.invoiceDate.getTime()) inv = await db.invoice.update({ where: { id: inv.id }, data: { date: p.invoiceDate } });
  }
  if (p.invoiceId !== inv.id) await db.purchase.update({ where: { id: purchaseId }, data: { invoiceId: inv.id } });
  return inv.id;
}
