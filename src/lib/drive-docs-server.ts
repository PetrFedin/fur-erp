import "server-only";
import type { DriveDocument } from "@prisma/client";
import type { DriveDocView } from "@/lib/drive-docs";

export function toDriveView(d: DriveDocument, scope?: string | null): DriveDocView {
  return {
    id: d.id,
    title: d.title,
    docType: d.docType,
    docDate: d.docDate ? d.docDate.toISOString() : null,
    docNumber: d.docNumber,
    viewUrl: d.viewUrl,
    drivePath: d.drivePath,
    scope: scope ?? null,
  };
}
