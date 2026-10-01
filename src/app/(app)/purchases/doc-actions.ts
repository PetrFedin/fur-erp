"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { removeStoredFiles } from "@/lib/fitting-files";
import { readDocumentFiles, writeDocumentFiles } from "@/lib/purchase-files";

const EDIT_ROLES = ["OWNER", "ADMIN", "PURCHASER"] as const;
const KINDS = ["AUCTION_INVOICE", "SPECIFICATION", "ADVANCE_INVOICE", "CALC_SHEET", "UPD", "OTHER"] as const;
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
  await prisma.purchaseDocument.delete({ where: { id: doc.id } });
  await removeStoredFiles([doc.storagePath]);
  revalidatePath(`/purchases/${purchaseId}`);
  revalidatePath("/lots");
}
