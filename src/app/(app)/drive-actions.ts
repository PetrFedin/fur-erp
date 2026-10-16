"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { PRODUCTION_EDIT_ROLES } from "@/lib/production-access";
import { parseDateInput } from "@/lib/input";
import { DRIVE_DOC_TYPES, type DriveDocTypeKey } from "@/lib/drive-docs";
import { driveDocRemoveRoles } from "@/lib/drive-docs-server";
import { randomUUID } from "node:crypto";
import { revalidateAll } from "@/lib/revalidate-all";
import { removeStoredFiles } from "@/lib/fitting-files";
import { readOneDriveFile, removeDriveFileIfUnused, writeDriveFile } from "@/lib/drive-files";
import { resetByDriveDoc } from "@/lib/verification";
import { staleError, DRIVE_DOC_V } from "@/lib/concurrency";

export type DriveDocState = { error?: string; ok?: boolean };

type Entity = "purchase" | "order" | "batch";

const ROLES: Record<Entity, readonly string[]> = {
  purchase: ACCESS.purchases,
  order: PRODUCTION_EDIT_ROLES,
  batch: PRODUCTION_EDIT_ROLES,
};

function revalidateFor(entity: Entity, id: string, extra?: string | number | null) {
  if (entity === "purchase") {
    revalidatePath(`/purchases/${id}`);
    revalidatePath("/lots");
  } else if (entity === "order") {
    revalidatePath(`/production/${id}`);
  } else {
    revalidatePath("/production/batches");
    if (extra != null) revalidatePath(`/production/batches/${extra}`);
  }
}

/** Общий ли файл документа с другими записями (по storagePath): тогда «Убрать» не удалит сам файл. */
export async function isDriveFileShared(documentId: string): Promise<boolean> {
  const session = await requireSession();
  const doc = await prisma.driveDocument.findFirst({
    where: { id: documentId, organizationId: session.user.organizationId },
    select: { id: true, storagePath: true },
  });
  if (!doc?.storagePath) return false;
  const [a, b] = await Promise.all([
    prisma.driveDocument.count({ where: { storagePath: doc.storagePath, id: { not: doc.id } } }),
    prisma.purchaseDocument.count({ where: { storagePath: doc.storagePath } }),
  ]);
  return a + b > 0;
}

/** Удаляет запись документа (и прикреплённый файл, если на него больше никто не ссылается). */
export async function removeDriveDocument(documentId: string): Promise<DriveDocState> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const doc = await prisma.driveDocument.findFirst({
    where: { id: documentId, organizationId: orgId },
    include: {
      productionBatch: { select: { number: true } },
      payment: { select: { purchaseId: true } },
      lot: { select: { purchaseId: true } },
      productionPayment: { select: { clientId: true, orders: { select: { productionOrderId: true } } } },
    },
  });
  if (!doc) return { error: "Документ не найден" };
  if (!hasRole(session.user.role, driveDocRemoveRoles(doc))) return { error: "Недостаточно прав для удаления документов" };
  await prisma.driveDocument.delete({ where: { id: doc.id } });
  // Оригинал файла убираем с диска, только если на путь больше никто не ссылается.
  await removeDriveFileIfUnused(doc.storagePath);
  await resetByDriveDoc(doc);
  revalidateDriveDoc(doc);
  revalidateAll(orgId);
  return { ok: true };
}

type DocForRevalidate = {
  purchaseId: string | null;
  productionOrderId: string | null;
  productionBatchId: string | null;
  paymentId: string | null;
  lotId: string | null;
  productionPaymentId: string | null;
  clientId: string | null;
  supplierId: string | null;
  productionBatch?: { number: number } | null;
  payment?: { purchaseId: string | null } | null;
  lot?: { purchaseId: string | null } | null;
  productionPayment?: { clientId: string | null; orders: { productionOrderId: string }[] } | null;
};

/** Сбрасывает кэш всех страниц, где документ мог быть показан. */
function revalidateDriveDoc(doc: DocForRevalidate) {
  
  if (doc.purchaseId) revalidateFor("purchase", doc.purchaseId);
  if (doc.productionOrderId) revalidateFor("order", doc.productionOrderId);
  if (doc.productionBatchId) revalidateFor("batch", doc.productionBatchId, doc.productionBatch?.number);
  if (doc.paymentId) {
    revalidatePath("/payments");
    revalidatePath("/lots");
    const pid = doc.payment?.purchaseId;
    if (pid) revalidatePath(`/purchases/${pid}`);
  }
  if (doc.lotId) {
    revalidatePath("/lots");
    const pid = doc.lot?.purchaseId;
    if (pid) revalidatePath(`/purchases/${pid}`);
  }
  if (doc.productionPaymentId) {
    revalidatePath("/production");
    revalidatePath("/payments");
    for (const o of doc.productionPayment?.orders ?? []) revalidatePath(`/production/${o.productionOrderId}`);
    if (doc.productionPayment?.clientId) revalidatePath(`/clients/${doc.productionPayment.clientId}`);
  }
  if (doc.clientId) {
    revalidatePath("/clients");
    revalidatePath(`/clients/${doc.clientId}`);
  }
  if (doc.supplierId) {
    revalidatePath("/suppliers");
    revalidatePath(`/suppliers/${doc.supplierId}`);
  }
}

type UploadEntity = Entity | "payment" | "productionPayment" | "lot";

const UPLOAD_ROLES: Record<UploadEntity, readonly string[]> = {
  ...ROLES,
  payment: ["OWNER", "ADMIN"],
  productionPayment: ["OWNER", "ADMIN"],
  lot: ACCESS.purchases,
};

const DOC_INCLUDE = {
  productionBatch: { select: { number: true } },
  payment: { select: { purchaseId: true } },
  lot: { select: { purchaseId: true } },
  productionPayment: { select: { clientId: true, orders: { select: { productionOrderId: true } } } },
} as const;

/**
 * «Прикрепить документ»: файл + название + тип. Создаёт DriveDocument с файлом в приложении
 * (driveFileId — внутренний ключ local-…). entity: закупка / ТЗ / партия / оплата поставщику / оплата производства.
 */
export async function uploadDriveDocument(
  entity: UploadEntity,
  entityId: string,
  formData: FormData,
): Promise<DriveDocState> {
  const session = await requireSession();
  if (!(entity in UPLOAD_ROLES)) return { error: "Неизвестный объект привязки" };
  if (!hasRole(session.user.role, UPLOAD_ROLES[entity])) return { error: "Недостаточно прав для загрузки документов" };
  const orgId = session.user.organizationId;

  const read = await readOneDriveFile(formData);
  if ("error" in read) return { error: read.error };
  const title =
    String(formData.get("title") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200) ||
    read.file.originalName.replace(/\.[A-Za-z0-9]{1,8}$/, "").slice(0, 200);
  const typeRaw = String(formData.get("docType") ?? "OTHER");
  const docType: DriveDocTypeKey = (DRIVE_DOC_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as DriveDocTypeKey) : "OTHER";
  // Номер и дата документа необязательны: блок «Документы-основания» передаёт те, что названы в данных (УПД №124 от 29.07.2025).
  const docNumber = String(formData.get("docNumber") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 100) || null;
  const dateRaw = String(formData.get("docDate") ?? "").trim();
  const docDate = dateRaw ? parseDateInput(dateRaw) : null;
  if (dateRaw && !docDate) return { error: "Некорректная дата документа" };

  // Привязка — только к объекту своей организации.
  const link: {
    purchaseId?: string;
    productionOrderId?: string;
    productionBatchId?: string;
    paymentId?: string;
    productionPaymentId?: string;
    lotId?: string;
  } = {};
  if (entity === "purchase") {
    const p = await prisma.purchase.findFirst({ where: { id: entityId, organizationId: orgId }, select: { id: true } });
    if (!p) return { error: "Закупка не найдена" };
    link.purchaseId = p.id;
  } else if (entity === "order") {
    const o = await prisma.productionOrder.findFirst({ where: { id: entityId, organizationId: orgId }, select: { id: true } });
    if (!o) return { error: "ТЗ не найдено" };
    link.productionOrderId = o.id;
  } else if (entity === "batch") {
    const b = await prisma.productionBatch.findFirst({ where: { id: entityId, organizationId: orgId }, select: { id: true } });
    if (!b) return { error: "Партия не найдена" };
    link.productionBatchId = b.id;
  } else if (entity === "lot") {
    const l = await prisma.rawMaterialLot.findFirst({ where: { id: entityId, organizationId: orgId }, select: { id: true } });
    if (!l) return { error: "Лот не найден" };
    link.lotId = l.id;
  } else if (entity === "payment") {
    const p = await prisma.payment.findFirst({ where: { id: entityId, organizationId: orgId }, select: { id: true } });
    if (!p) return { error: "Оплата не найдена" };
    link.paymentId = p.id;
  } else {
    const p = await prisma.productionPayment.findFirst({ where: { id: entityId, organizationId: orgId }, select: { id: true } });
    if (!p) return { error: "Оплата не найдена" };
    link.productionPaymentId = p.id;
  }

  const stored = await writeDriveFile(orgId, read.file);
  try {
    const doc = await prisma.driveDocument.create({
      data: {
        organizationId: orgId,
        driveFileId: `local-${randomUUID()}`,
        title,
        docType,
        mimeType: stored.storedMime,
        sizeBytes: stored.storedSize,
        docNumber,
        docDate,
        year: docDate ? docDate.getUTCFullYear() : null,
        ...stored,
        storedAt: new Date(),
        ...link,
      },
      include: DOC_INCLUDE,
    });
    await resetByDriveDoc(doc);
    revalidateDriveDoc(doc);
    revalidateAll(orgId);
  } catch (e) {
    await removeStoredFiles([stored.storagePath]);
    throw e;
  }
  return { ok: true };
}

/** Прикрепляет / заменяет файл у уже существующего документа (запись остаётся). */
export async function uploadDriveDocumentFile(documentId: string, formData: FormData): Promise<DriveDocState> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const doc = await prisma.driveDocument.findFirst({ where: { id: documentId, organizationId: orgId }, include: DOC_INCLUDE });
  if (!doc) return { error: "Документ не найден" };
  if (!hasRole(session.user.role, driveDocRemoveRoles(doc))) return { error: "Недостаточно прав для загрузки документов" };

  const read = await readOneDriveFile(formData);
  if ("error" in read) return { error: read.error };
  const stored = await writeDriveFile(orgId, read.file);
  try {
    await prisma.driveDocument.update({
      where: { id: doc.id },
      data: { ...stored, storedAt: new Date(), mimeType: stored.storedMime, sizeBytes: stored.storedSize },
    });
  } catch (e) {
    await removeStoredFiles([stored.storagePath]);
    throw e;
  }
  // Старый файл — только после успешной записи и только если на него больше никто не ссылается.
  if (doc.storagePath && doc.storagePath !== stored.storagePath) await removeDriveFileIfUnused(doc.storagePath);
  await resetByDriveDoc(doc);
  revalidateDriveDoc(doc);
  revalidateAll(orgId);
  return { ok: true };
}

/** Удаляет только файл; запись остаётся со статусом «не прикреплён». */
export async function removeDriveDocumentFile(documentId: string): Promise<DriveDocState> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const doc = await prisma.driveDocument.findFirst({ where: { id: documentId, organizationId: orgId }, include: DOC_INCLUDE });
  if (!doc) return { error: "Документ не найден" };
  if (!hasRole(session.user.role, driveDocRemoveRoles(doc))) return { error: "Недостаточно прав для удаления файла" };
  if (!doc.storagePath) return { ok: true };
  // У документа, созданного загрузкой, файл — единственное содержимое: убрать его можно только вместе с записью.
  if (doc.driveFileId.startsWith("local-")) return { error: "Это единственное содержимое документа — удалите документ целиком («Убрать») либо замените файл" };
  await prisma.driveDocument.update({
    where: { id: doc.id },
    data: { storagePath: null, storedName: null, storedMime: null, storedSize: null, storedAt: null },
  });
  await removeDriveFileIfUnused(doc.storagePath);
  await resetByDriveDoc(doc);
  revalidateDriveDoc(doc);
  revalidateAll(orgId);
  return { ok: true };
}

/**
 * Метаданные документа: название, тип, номер, дата, примечание (год берётся из даты).
 * Файл здесь не меняем (файл — «Заменить файл»). Подтверждение того, к чему привязан документ, сбрасывается:
 * тип/номер/дата документа входят в правила «все документы на месте».
 */
export async function updateDriveDocument(documentId: string, formData: FormData): Promise<DriveDocState> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const doc = await prisma.driveDocument.findFirst({ where: { id: documentId, organizationId: orgId }, include: DOC_INCLUDE });
  if (!doc) return { error: "Документ не найден" };
  if (!hasRole(session.user.role, driveDocRemoveRoles(doc))) return { error: "Недостаточно прав для правки документов" };
  const stale = staleError(formData, doc, DRIVE_DOC_V);
  if (stale) return { error: stale };
  const title = String(formData.get("title") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200);
  if (!title) return { error: "Укажите название документа" };
  const typeRaw = String(formData.get("docType") ?? "OTHER");
  if (!(DRIVE_DOC_TYPES as readonly string[]).includes(typeRaw)) return { error: "Неизвестный тип документа" };
  const dateRaw = String(formData.get("docDate") ?? "").trim();
  const docDate = dateRaw ? parseDateInput(dateRaw) : null;
  if (dateRaw && !docDate) return { error: "Некорректная дата документа" };
  await prisma.driveDocument.update({
    where: { id: doc.id },
    data: {
      title,
      docType: typeRaw as DriveDocTypeKey,
      docNumber: String(formData.get("docNumber") ?? "").trim().slice(0, 100) || null,
      docDate,
      year: docDate ? docDate.getUTCFullYear() : null,
      notes: String(formData.get("notes") ?? "").trim().slice(0, 1000) || null,
    },
  });
  await resetByDriveDoc(doc);
  revalidateDriveDoc(doc);
  revalidatePath("/documents");
  return { ok: true };
}
