"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { removeStoredFiles } from "@/lib/fitting-files";
import { readDocumentFiles, writeDocumentFiles } from "@/lib/purchase-files";

const EDIT_ROLES = ["OWNER", "ADMIN", "PURCHASER"] as const;
const KINDS = ["AUCTION_INVOICE", "SPECIFICATION", "ADVANCE_INVOICE", "CALC_SHEET", "UPD", "PAYMENT_PROOF", "OTHER"] as const;
type Kind = (typeof KINDS)[number];

export type DocFormState = { error?: string; ok?: boolean };

/** Загрузка документов к закупке (scope=purchase) или ко всей партии (scope=batch, по auctionSession). */
export async function uploadPurchaseDocuments(
  purchaseId: string,
  _prev: DocFormState,
  formData: FormData,
): Promise<DocFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId: orgId },
    select: { id: true, auctionSession: true },
  });
  if (!purchase) return { error: "Закупка не найдена" };

  const kindRaw = String(formData.get("kind") ?? "OTHER");
  const kind: Kind = (KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as Kind) : "OTHER";
  const scope = formData.get("scope") === "batch" ? "batch" : "purchase";
  const batch = purchase.auctionSession?.split(/\r?\n/)[0].trim() || null;
  if (scope === "batch" && !batch) return { error: "У закупки не указан аукцион / сессия — документ партии привязать не к чему" };
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);

  const read = await readDocumentFiles(formData.getAll("files"));
  if ("error" in read) return { error: read.error };

  const stored = await writeDocumentFiles(orgId, scope === "batch" ? `batch-${purchase.id}` : purchase.id, read.files);
  try {
    await prisma.purchaseDocument.createMany({
      data: stored.map((s) => ({
        organizationId: orgId,
        purchaseId: scope === "batch" ? null : purchase.id,
        batch: scope === "batch" ? batch : null,
        kind,
        title: title || s.originalName,
        ...s,
      })),
    });
  } catch (e) {
    await removeStoredFiles(stored.map((s) => s.storagePath));
    throw e;
  }
  revalidatePath(`/purchases/${purchaseId}`);
  revalidatePath("/lots");
  return { ok: true };
}

export async function deletePurchaseDocument(purchaseId: string, documentId: string) {
  const session = await requireRole(...EDIT_ROLES);
  const doc = await prisma.purchaseDocument.findFirst({
    where: { id: documentId, organizationId: session.user.organizationId },
  });
  if (!doc) return;
  // Документ партии (purchaseId = null) принадлежит организации, а не одной закупке —
  // удалять его могут те же роли. Файл с диска убираем, только если на него больше никто не ссылается.
  await prisma.purchaseDocument.delete({ where: { id: doc.id } });
  const stillUsed = await prisma.purchaseDocument.count({ where: { storagePath: doc.storagePath } });
  if (stillUsed === 0) await removeStoredFiles([doc.storagePath]);
  revalidatePath(`/purchases/${purchaseId}`);
  revalidatePath("/lots");
}

function revalidateDocPages(purchaseId: string | null | undefined) {
  if (purchaseId) revalidatePath(`/purchases/${purchaseId}`);
  revalidatePath("/lots");
}

/**
 * Замена файла документа: новый файл проверяется как при загрузке (тип по сигнатуре, размер),
 * пишется на диск, строка в БД обновляется, и только потом старый файл удаляется с диска.
 */
export async function replacePurchaseDocument(documentId: string, formData: FormData): Promise<DocFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const orgId = session.user.organizationId;
  const doc = await prisma.purchaseDocument.findFirst({ where: { id: documentId, organizationId: orgId } });
  if (!doc) return { error: "Документ не найден" };

  const entries = formData.getAll("file");
  if (entries.filter((e) => typeof e !== "string" && e.size > 0).length > 1) return { error: "Выберите один файл" };
  const read = await readDocumentFiles(entries);
  if ("error" in read) return { error: read.error };

  // Кладём в тот же каталог, где лежал старый файл (purchase-docs/<org>/<закупка | batch-…>/).
  const scope = path.basename(path.dirname(doc.storagePath)) || (doc.purchaseId ?? "replaced");
  const [stored] = await writeDocumentFiles(orgId, scope, read.files);
  try {
    await prisma.purchaseDocument.update({
      where: { id: doc.id },
      data: {
        storagePath: stored.storagePath,
        originalName: stored.originalName,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
      },
    });
  } catch (e) {
    await removeStoredFiles([stored.storagePath]);
    throw e;
  }
  // Старый файл — только после успешной записи в БД и только если на него больше никто не ссылается.
  if (doc.storagePath !== stored.storagePath) {
    const stillUsed = await prisma.purchaseDocument.count({ where: { storagePath: doc.storagePath } });
    if (stillUsed === 0) await removeStoredFiles([doc.storagePath]);
  }
  revalidateDocPages(doc.purchaseId);
  return { ok: true };
}

/** Переименование документа и смена его типа. */
export async function updatePurchaseDocument(documentId: string, formData: FormData): Promise<DocFormState> {
  const session = await requireRole(...EDIT_ROLES);
  const doc = await prisma.purchaseDocument.findFirst({
    where: { id: documentId, organizationId: session.user.organizationId },
    select: { id: true, purchaseId: true },
  });
  if (!doc) return { error: "Документ не найден" };
  const title = String(formData.get("title") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200);
  if (!title) return { error: "Укажите название документа" };
  const kindRaw = String(formData.get("kind") ?? "");
  if (!(KINDS as readonly string[]).includes(kindRaw)) return { error: "Неизвестный тип документа" };
  await prisma.purchaseDocument.update({ where: { id: doc.id }, data: { title, kind: kindRaw as Kind } });
  revalidateDocPages(doc.purchaseId);
  return { ok: true };
}
