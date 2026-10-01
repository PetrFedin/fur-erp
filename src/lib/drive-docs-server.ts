import "server-only";
import type { DriveDocument } from "@prisma/client";
import type { DriveDocView } from "@/lib/drive-docs";
import { ACCESS, hasRole } from "@/lib/access";
import { PRODUCTION_EDIT_ROLES } from "@/lib/production-access";

/**
 * Кому разрешено убирать ссылку: закупка — как закупки; ТЗ/партия — как производство;
 * документы оплат, лотов без закупки, клиентов и поставщиков — только OWNER/ADMIN.
 * Один источник правды для сервера (removeDriveDocument) и кнопки «Убрать».
 */
export function driveDocRemoveRoles(d: Pick<DriveDocument, "purchaseId" | "productionOrderId" | "productionBatchId">): readonly string[] {
  if (d.purchaseId) return ACCESS.purchases;
  if (d.productionOrderId || d.productionBatchId) return PRODUCTION_EDIT_ROLES;
  return ["OWNER", "ADMIN"];
}

export function toDriveView(d: DriveDocument, scope?: string | null, role?: string | null): DriveDocView {
  return {
    id: d.id,
    title: d.title,
    docType: d.docType,
    docDate: d.docDate ? d.docDate.toISOString() : null,
    docNumber: d.docNumber,
    viewUrl: d.viewUrl,
    drivePath: d.drivePath,
    scope: scope ?? null,
    hasFile: !!d.storagePath,
    storedName: d.storedName,
    storedMime: d.storedMime,
    storedSize: d.storedSize,
    canRemove: role === undefined ? undefined : hasRole(role, driveDocRemoveRoles(d)),
  };
}
