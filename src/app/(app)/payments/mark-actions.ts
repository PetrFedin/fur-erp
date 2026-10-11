"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { removeStoredFiles } from "@/lib/fitting-files";
import { isPickedFile, readDocumentFiles, writeDocumentFiles, type ReadDoc } from "@/lib/purchase-files";
import { resetVerification } from "@/lib/verification";

/**
 * Приложить платёжку к существующей оплате поставщику (кнопка в панели «Документы и оплата»).
 * Отметка новой оплаты вынесена в единую форму оплаты: src/components/payment-form.tsx + payments/pay-actions.ts.
 */

const ROLES = ACCESS.supplierPayments;

export type MarkState = { error?: string; ok?: boolean; confirm?: string };

/** Файл-основание (необязательный), как у платёжки аукциона. */
async function readProof(formData: FormData): Promise<{ error: string } | { file: ReadDoc | null }> {
  const entries = formData.getAll("file").filter(isPickedFile);
  if (entries.length === 0) return { file: null };
  if (entries.length > 1) return { error: "Прикрепите один файл платёжки" };
  const read = await readDocumentFiles(entries);
  if ("error" in read) return read;
  return { file: read.files[0] };
}

/** Приложить платёжку к существующей оплате: файл сохраняется, оплата становится «подтверждена». */
export async function attachSupplierPaymentProof(paymentId: string, formData: FormData): Promise<MarkState> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const pay = await prisma.payment.findFirst({
    where: { id: paymentId, organizationId: orgId },
    select: { id: true, purchaseId: true, auctionSession: true, paidAt: true, documentId: true, status: true },
  });
  if (!pay) return { error: "Оплата не найдена" };
  if (pay.status === "CANCELLED") return { error: "Оплата отменена" };
  const file = await readProof(formData);
  if ("error" in file) return { error: file.error };
  if (!file.file) return { error: "Выберите файл платёжки" };
  const stored = await writeDocumentFiles(orgId, "payments", [file.file]);
  try {
    await prisma.$transaction(async (tx) => {
      const doc = await tx.purchaseDocument.create({
        data: {
          organizationId: orgId,
          purchaseId: pay.purchaseId,
          batch: pay.purchaseId ? null : pay.auctionSession?.split(/\r?\n/)[0].trim() || null,
          kind: "PAYMENT_PROOF",
          title: `Платёжка: оплата ${pay.paidAt.toISOString().slice(0, 10)}`,
          ...stored[0],
        },
      });
      await tx.payment.update({ where: { id: pay.id }, data: { documentId: doc.id, confirmed: true } });
    });
  } catch (e) {
    await removeStoredFiles(stored.map((x) => x.storagePath));
    throw e;
  }
  await resetVerification(prisma, orgId, { paymentIds: [pay.id], purchaseIds: [pay.purchaseId], auctions: [pay.auctionSession] });
  revalidateAll(orgId);
  return { ok: true };
}
