import "server-only";
import { prisma } from "@/lib/prisma";

/** Статус закупки для поставщика: только «в пути / заказано» и «принято на склад» (без наших складских подробностей). */
export const RAW_STATUS_LABEL: Record<string, string> = {
  DRAFT: "в пути / заказано",
  ORDERED: "в пути / заказано",
  IN_TRANSIT: "в пути / заказано",
  RECEIVED: "принято на склад",
};

export type RawRow = {
  itemId: string;
  purchaseId: string;
  auction: string;
  purchaseNumber: string;
  invoice: string;
  lotId: string | null;
  lotNumber: string;
  fur: string;
  furId: string;
  color: string;
  size: string;
  quantity: number;
  status: string;
  received: boolean;
  doc: string;
  unitPrice: number;
  subtotal: number;
  currency: string;
  /** Год закупки (по дате заказа) — для группировки по годам. */
  year: number;
};

/**
 * Лоты, которые поставщик продал нам: строки закупок ЭТОГО поставщика. Фильтр по supplierId и организации — на сервере.
 * Выбираем только то, что можно показывать поставщику: никаких остатков лота, списаний в ТЗ, себестоимости и расчётных листов.
 */
export async function supplierRawRows(orgId: string, supplierId: string): Promise<RawRow[]> {
  const items = await prisma.purchaseItem.findMany({
    where: { purchase: { organizationId: orgId, supplierId, status: { not: "CANCELLED" } } },
    select: {
      id: true, lotNumber: true, grade: true, color: true, quantity: true, unitPrice: true, subtotal: true, lotId: true,
      rawMaterial: { select: { id: true, name: true } },
      purchase: {
        select: {
          id: true, number: true, status: true, currency: true, orderDate: true, auctionSession: true, invoiceNumber: true, invoiceDate: true, transferDocument: true,
          auction: { select: { name: true } },
          driveDocuments: { where: { docType: { in: ["UPD", "SPECIFICATION"] } }, select: { docType: true, docNumber: true, docDate: true, lotId: true } },
          documents: { where: { kind: { in: ["UPD", "SPECIFICATION"] } }, select: { kind: true, title: true, lotId: true } },
        },
      },
    },
    orderBy: [{ purchase: { orderDate: "desc" } }, { lotNumber: "asc" }],
  });
  const ru = (d: Date | null) => (d ? d.toLocaleDateString("ru-RU", { timeZone: "UTC" }) : "");
  return items.map((i) => {
    const p = i.purchase;
    const upd = p.driveDocuments.filter((d) => d.docType === "UPD" && (!d.lotId || d.lotId === i.lotId));
    const spec = p.driveDocuments.filter((d) => d.docType === "SPECIFICATION" && (!d.lotId || d.lotId === i.lotId));
    const fmt = (kind: string, d: { docNumber: string | null; docDate: Date | null }) => `${kind}${d.docNumber ? ` № ${d.docNumber}` : ""}${d.docDate ? ` от ${ru(d.docDate)}` : ""}`;
    const parts = [
      ...upd.map((d) => fmt("УПД", d)),
      ...spec.map((d) => fmt("Спец.", d)),
    ];
    if (parts.length === 0) {
      if (p.transferDocument) parts.push(`УПД ${p.transferDocument}`);
      for (const d of p.documents.filter((x) => !x.lotId || x.lotId === i.lotId)) parts.push(d.title);
    }
    return {
      itemId: i.id,
      purchaseId: p.id,
      auction: p.auction?.name ?? p.auctionSession ?? "",
      purchaseNumber: p.number,
      invoice: [p.invoiceNumber, ru(p.invoiceDate)].filter(Boolean).join(" от "),
      lotId: i.lotId,
      lotNumber: i.lotNumber ?? "",
      fur: i.rawMaterial.name,
      furId: i.rawMaterial.id,
      color: i.color ?? "",
      size: i.grade ?? "",
      quantity: Number(i.quantity),
      status: RAW_STATUS_LABEL[p.status] ?? p.status,
      received: p.status === "RECEIVED",
      doc: Array.from(new Set(parts)).join("; "),
      unitPrice: Number(i.unitPrice),
      subtotal: Number(i.subtotal),
      currency: p.currency,
      year: p.orderDate.getUTCFullYear(),
    };
  });
}

/** Принятые расчёты аукционов поставщика, из которых созданы закупки (те же, что на странице аукциона). */
export async function supplierAcceptedCalcs(orgId: string, supplierId: string, purchaseIds: string[]) {
  if (purchaseIds.length === 0) return [];
  const rows = await prisma.supplierInbox.findMany({
    where: { organizationId: orgId, supplierId, kind: "AUCTION_CALC", status: "ACCEPTED", createdEntityType: "Purchase" },
    orderBy: { decidedAt: "desc" },
    select: { id: true, createdEntityId: true, payload: true },
  });
  return rows
    .map((r) => ({ id: r.id, purchaseIds: purchaseIds.filter((id) => (r.createdEntityId ?? "").includes(id)), payload: r.payload as unknown as import("@/lib/supplier-calc").CalcPayload }))
    .filter((r) => r.purchaseIds.length > 0 && r.payload?.v === 1 && Array.isArray(r.payload.rows));
}
