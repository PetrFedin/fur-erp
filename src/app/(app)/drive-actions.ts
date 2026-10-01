"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { PRODUCTION_EDIT_ROLES } from "@/lib/production-access";
import { parseDateInput } from "@/lib/input";
import { DRIVE_DOC_TYPES, parseDriveLink, type DriveDocTypeKey } from "@/lib/drive-docs";

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

/** Добавляет ссылку на файл Google Drive к закупке / ТЗ / партии. */
export async function addDriveDocument(
  entity: Entity,
  entityId: string,
  _prev: DriveDocState,
  formData: FormData,
): Promise<DriveDocState> {
  const session = await requireSession();
  if (!(entity in ROLES)) return { error: "Неизвестный объект привязки" };
  if (!hasRole(session.user.role, ROLES[entity])) return { error: "Недостаточно прав для добавления документов" };
  const orgId = session.user.organizationId;

  const link = parseDriveLink(String(formData.get("link") ?? ""));
  if (!link) return { error: "Не удалось разобрать ссылку: вставьте ссылку на файл или папку Google Drive (https://drive.google.com/…)" };
  const title = String(formData.get("title") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200);
  if (!title) return { error: "Укажите название документа" };
  const typeRaw = String(formData.get("docType") ?? "OTHER");
  const docType: DriveDocTypeKey = (DRIVE_DOC_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as DriveDocTypeKey) : "OTHER";
  const docNumber = String(formData.get("docNumber") ?? "").trim().slice(0, 100) || null;
  const dateRaw = String(formData.get("docDate") ?? "").trim();
  const docDate = dateRaw ? parseDateInput(dateRaw) : null;
  if (dateRaw && !docDate) return { error: "Некорректная дата документа" };

  const base = {
    organizationId: orgId,
    driveFileId: link.fileId,
    viewUrl: link.viewUrl,
    title,
    docType,
    docNumber,
    docDate,
    year: docDate ? docDate.getUTCFullYear() : null,
  };

  // Привязка выбирается после проверки, что объект принадлежит организации.
  let batchNumber: number | null = null;
  if (entity === "purchase") {
    const p = await prisma.purchase.findFirst({ where: { id: entityId, organizationId: orgId }, select: { id: true } });
    if (!p) return { error: "Закупка не найдена" };
    await prisma.driveDocument.create({ data: { ...base, purchaseId: p.id } });
  } else if (entity === "order") {
    const o = await prisma.productionOrder.findFirst({ where: { id: entityId, organizationId: orgId }, select: { id: true } });
    if (!o) return { error: "ТЗ не найдено" };
    await prisma.driveDocument.create({ data: { ...base, productionOrderId: o.id } });
  } else {
    const b = await prisma.productionBatch.findFirst({ where: { id: entityId, organizationId: orgId }, select: { id: true, number: true } });
    if (!b) return { error: "Партия не найдена" };
    batchNumber = b.number;
    await prisma.driveDocument.create({ data: { ...base, productionBatchId: b.id } });
  }
  revalidateFor(entity, entityId, batchNumber);
  return { ok: true };
}

/** Удаляет только ссылку (файл в Google Drive не затрагивается). */
export async function removeDriveDocument(documentId: string): Promise<DriveDocState> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const doc = await prisma.driveDocument.findFirst({
    where: { id: documentId, organizationId: orgId },
    include: { productionBatch: { select: { number: true } } },
  });
  if (!doc) return { error: "Документ не найден" };
  const entity: Entity | null = doc.purchaseId ? "purchase" : doc.productionOrderId ? "order" : doc.productionBatchId ? "batch" : null;
  if (entity && !hasRole(session.user.role, ROLES[entity])) return { error: "Недостаточно прав для удаления документов" };
  if (!entity && !hasRole(session.user.role, ["OWNER", "ADMIN"])) return { error: "Недостаточно прав для удаления документов" };
  await prisma.driveDocument.delete({ where: { id: doc.id } });
  if (entity === "purchase") revalidateFor("purchase", doc.purchaseId!);
  else if (entity === "order") revalidateFor("order", doc.productionOrderId!);
  else if (entity === "batch") revalidateFor("batch", doc.productionBatchId!, doc.productionBatch?.number);
  return { ok: true };
}
